'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'giveaways.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS giveaways (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    prize       TEXT NOT NULL DEFAULT '',
    period      TEXT NOT NULL,                 -- e.g. "2026-06"
    status      TEXT NOT NULL DEFAULT 'open',  -- open | drawn
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    drawn_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS participants (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id      INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    email            TEXT NOT NULL,
    name             TEXT NOT NULL DEFAULT '',
    referral_code    TEXT NOT NULL UNIQUE,
    referred_by_code TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (giveaway_id, email)
  );

  -- Each ticket is one chance to win. Weighting = number of tickets a participant holds.
  CREATE TABLE IF NOT EXISTS tickets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id    INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    source         TEXT NOT NULL,   -- signup | referral | purchase
    note           TEXT NOT NULL DEFAULT '',
    order_id       TEXT,            -- Shopify order id, when source = purchase
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Prevents double-counting the same Shopify order.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_order
    ON tickets(giveaway_id, order_id) WHERE order_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS winners (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id    INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    drawn_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---- Config knobs (overridable via env) ----
const REFERRAL_TICKET_CAP = Number(process.env.REFERRAL_TICKET_CAP || 10);
const PURCHASE_TICKETS_PER_ORDER = Number(process.env.PURCHASE_TICKETS_PER_ORDER || 5);

function genReferralCode() {
  // Short, URL-safe, unambiguous.
  return crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
}

// ---- Giveaways ----
function createGiveaway({ title, description = '', prize = '', period }) {
  const info = db
    .prepare('INSERT INTO giveaways (title, description, prize, period) VALUES (?, ?, ?, ?)')
    .run(title, description, prize, period);
  return getGiveaway(info.lastInsertRowid);
}

function getGiveaway(id) {
  return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
}

function listGiveaways() {
  return db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM participants p WHERE p.giveaway_id = g.id) AS participant_count,
              (SELECT COUNT(*) FROM tickets t WHERE t.giveaway_id = g.id)      AS ticket_count
       FROM giveaways g
       ORDER BY g.created_at DESC, g.id DESC`
    )
    .all();
}

function getCurrentOpenGiveaway() {
  return db
    .prepare("SELECT * FROM giveaways WHERE status = 'open' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get();
}

// ---- Participants & tickets ----
function getParticipantByEmail(giveawayId, email) {
  return db
    .prepare('SELECT * FROM participants WHERE giveaway_id = ? AND email = ?')
    .get(giveawayId, email.toLowerCase());
}

function getParticipantByCode(giveawayId, code) {
  return db
    .prepare('SELECT * FROM participants WHERE giveaway_id = ? AND referral_code = ?')
    .get(giveawayId, code);
}

function addTicket(giveawayId, participantId, source, note = '', orderId = null) {
  try {
    db.prepare(
      'INSERT INTO tickets (giveaway_id, participant_id, source, note, order_id) VALUES (?, ?, ?, ?, ?)'
    ).run(giveawayId, participantId, source, note, orderId);
    return true;
  } catch (err) {
    // Unique index violation => duplicate order, treat as no-op.
    if (String(err.message).includes('UNIQUE')) return false;
    throw err;
  }
}

function referralTicketCount(participantId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE participant_id = ? AND source = 'referral'")
    .get(participantId).n;
}

/**
 * Idempotent enrollment. Creates the participant on first contact (with a signup ticket),
 * credits the referrer once, and always returns the participant + their referral code.
 */
const enroll = db.transaction(({ giveawayId, email, name = '', refCode = null }) => {
  email = String(email).trim().toLowerCase();
  name = String(name || '').trim();

  let participant = getParticipantByEmail(giveawayId, email);
  let isNew = false;

  if (!participant) {
    isNew = true;
    let code;
    // Retry on the (astronomically unlikely) code collision.
    for (let i = 0; i < 5; i++) {
      code = genReferralCode();
      if (!db.prepare('SELECT 1 FROM participants WHERE referral_code = ?').get(code)) break;
    }
    const info = db
      .prepare(
        'INSERT INTO participants (giveaway_id, email, name, referral_code, referred_by_code) VALUES (?, ?, ?, ?, ?)'
      )
      .run(giveawayId, email, name, code, refCode);
    participant = getParticipant(info.lastInsertRowid);
    addTicket(giveawayId, participant.id, 'signup', 'Joined the giveaway');

    // Credit the referrer (only for genuinely new participants, never self-referral).
    if (refCode) {
      const referrer = getParticipantByCode(giveawayId, refCode);
      if (referrer && referrer.id !== participant.id && referralTicketCount(referrer.id) < REFERRAL_TICKET_CAP) {
        addTicket(giveawayId, referrer.id, 'referral', `Referred ${email}`);
      }
    }
  } else if (name && !participant.name) {
    db.prepare('UPDATE participants SET name = ? WHERE id = ?').run(name, participant.id);
    participant = getParticipant(participant.id);
  }

  return { participant, isNew };
});

function getParticipant(id) {
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
}

function participantTicketCount(participantId) {
  return db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE participant_id = ?').get(participantId).n;
}

/** Record entries for a Shopify order. Idempotent on order_id. */
const recordPurchase = db.transaction(({ giveawayId, email, name, orderId, tickets }) => {
  const { participant } = enroll({ giveawayId, email, name });
  let granted = 0;
  for (let i = 0; i < tickets; i++) {
    // Only the first ticket carries the order_id (the dedupe key); the rest are plain bonus tickets.
    const ok = addTicket(
      giveawayId,
      participant.id,
      'purchase',
      `Order ${orderId}`,
      i === 0 ? String(orderId) : null
    );
    if (i === 0 && !ok) return { participant, granted: 0, duplicate: true }; // order already counted
    granted++;
  }
  return { participant, granted, duplicate: false };
});

// ---- Reporting & draw ----
function giveawayStats(giveawayId) {
  const participants = db
    .prepare(
      `SELECT p.id, p.email, p.name, p.referral_code, p.created_at,
              (SELECT COUNT(*) FROM tickets t WHERE t.participant_id = p.id) AS tickets,
              (SELECT COUNT(*) FROM tickets t WHERE t.participant_id = p.id AND t.source = 'referral') AS referrals,
              (SELECT COUNT(*) FROM tickets t WHERE t.participant_id = p.id AND t.source = 'purchase')  AS purchases
       FROM participants p
       WHERE p.giveaway_id = ?
       ORDER BY tickets DESC, p.created_at ASC`
    )
    .all(giveawayId);
  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM participants WHERE giveaway_id = ?) AS participants,
         (SELECT COUNT(*) FROM tickets WHERE giveaway_id = ?)      AS tickets`
    )
    .get(giveawayId, giveawayId);
  return { participants, totals };
}

/** Weighted random draw: every ticket is one equal chance. */
const drawWinner = db.transaction((giveawayId) => {
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway) throw new Error('Giveaway not found');
  if (giveaway.status === 'drawn') throw new Error('A winner has already been drawn for this giveaway');

  const ticketIds = db
    .prepare('SELECT id, participant_id FROM tickets WHERE giveaway_id = ?')
    .all(giveawayId);
  if (ticketIds.length === 0) throw new Error('No entries to draw from');

  const pick = ticketIds[crypto.randomInt(ticketIds.length)];
  db.prepare('INSERT INTO winners (giveaway_id, participant_id) VALUES (?, ?)').run(
    giveawayId,
    pick.participant_id
  );
  db.prepare("UPDATE giveaways SET status = 'drawn', drawn_at = datetime('now') WHERE id = ?").run(
    giveawayId
  );
  return getWinner(giveawayId);
});

function getWinner(giveawayId) {
  return db
    .prepare(
      `SELECT w.drawn_at, p.email, p.name, p.referral_code,
              (SELECT COUNT(*) FROM tickets t WHERE t.participant_id = p.id) AS tickets
       FROM winners w JOIN participants p ON p.id = w.participant_id
       WHERE w.giveaway_id = ?
       ORDER BY w.drawn_at DESC LIMIT 1`
    )
    .get(giveawayId);
}

module.exports = {
  db,
  REFERRAL_TICKET_CAP,
  PURCHASE_TICKETS_PER_ORDER,
  createGiveaway,
  getGiveaway,
  listGiveaways,
  getCurrentOpenGiveaway,
  getParticipantByEmail,
  enroll,
  recordPurchase,
  participantTicketCount,
  giveawayStats,
  drawWinner,
  getWinner,
};
