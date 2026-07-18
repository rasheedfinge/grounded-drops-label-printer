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
    status      TEXT NOT NULL DEFAULT 'open',  -- open | drawn | closed
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
    source         TEXT NOT NULL,   -- signup | referral | purchase | import
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
    discount_code  TEXT,
    drawn_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Emails prepared when a winner is drawn: one announcement for the whole list,
  -- one confirmation request for the winner. Editable before sending.
  CREATE TABLE IF NOT EXISTS email_drafts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,                  -- announcement | winner
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',  -- draft | sent
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at     TEXT
  );
`);

// Migration for databases created before winners.discount_code existed.
try {
  db.exec('ALTER TABLE winners ADD COLUMN discount_code TEXT');
} catch {
  /* column already exists */
}

// ---- Config knobs (overridable via env) ----
const REFERRAL_TICKET_CAP = Number(process.env.REFERRAL_TICKET_CAP || 10);
const PURCHASE_TICKETS_PER_ORDER = Number(process.env.PURCHASE_TICKETS_PER_ORDER || 5);

function genReferralCode() {
  // Short, URL-safe, unambiguous.
  return crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
}

function genDiscountCode() {
  return 'GD' + crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10);
}

function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function periodMonthName(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Jamie Oliver-Smith" -> "Jamie O." — public-safe winner display name. */
function displayName(name, email) {
  const clean = String(name || '').trim();
  if (clean) {
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  }
  return `${String(email)[0].toUpperCase()}***`;
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

function updateGiveaway(id, { title, description, prize }) {
  const g = getGiveaway(id);
  if (!g) return null;
  db.prepare('UPDATE giveaways SET title = ?, description = ?, prize = ? WHERE id = ?').run(
    title ?? g.title,
    description ?? g.description,
    prize ?? g.prize,
    id
  );
  return getGiveaway(id);
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
const enroll = db.transaction(({ giveawayId, email, name = '', refCode = null, source = 'signup' }) => {
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
    addTicket(giveawayId, participant.id, source, source === 'import' ? 'Imported from customer list' : 'Joined the giveaway');

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

/** Bulk-import a customer list. Each row: { email, name? }. Idempotent per email. */
const importEntrants = db.transaction((giveawayId, rows) => {
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped++;
      continue;
    }
    const { isNew } = enroll({ giveawayId, email, name: row.name || '', source: 'import' });
    if (isNew) added++;
    else skipped++;
  }
  return { added, skipped };
});

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

/**
 * Weighted random draw: every ticket is one equal chance.
 * Also generates the winner's discount code and both email drafts.
 */
const drawWinner = db.transaction((giveawayId, { baseUrl = '' } = {}) => {
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway) throw new Error('Giveaway not found');
  if (giveaway.status !== 'open') throw new Error('A winner has already been drawn for this giveaway');

  const ticketIds = db
    .prepare('SELECT id, participant_id FROM tickets WHERE giveaway_id = ?')
    .all(giveawayId);
  if (ticketIds.length === 0) throw new Error('No entries to draw from');

  const pick = ticketIds[crypto.randomInt(ticketIds.length)];
  const discountCode = genDiscountCode();
  db.prepare('INSERT INTO winners (giveaway_id, participant_id, discount_code) VALUES (?, ?, ?)').run(
    giveawayId,
    pick.participant_id,
    discountCode
  );
  db.prepare("UPDATE giveaways SET status = 'drawn', drawn_at = datetime('now') WHERE id = ?").run(
    giveawayId
  );

  const winner = getWinner(giveawayId);
  createDraftsForWinner(giveaway, winner, baseUrl);
  return winner;
});

function getWinner(giveawayId) {
  return db
    .prepare(
      `SELECT w.drawn_at, w.discount_code, p.email, p.name, p.referral_code,
              (SELECT COUNT(*) FROM tickets t WHERE t.participant_id = p.id) AS tickets
       FROM winners w JOIN participants p ON p.id = w.participant_id
       WHERE w.giveaway_id = ?
       ORDER BY w.drawn_at DESC LIMIT 1`
    )
    .get(giveawayId);
}

/** Publicly showable winner list: "Jamie O." style names only. */
function publicWinners(limit = 12) {
  return db
    .prepare(
      `SELECT g.title, g.period, g.prize, w.drawn_at, p.name, p.email
       FROM winners w
       JOIN giveaways g ON g.id = w.giveaway_id
       JOIN participants p ON p.id = w.participant_id
       ORDER BY w.drawn_at DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => ({
      title: r.title,
      period: r.period,
      month: periodMonthName(r.period),
      prize: r.prize,
      drawnAt: r.drawn_at,
      winner: displayName(r.name, r.email),
    }));
}

// ---- Email drafts ----
// Required on anything sent to a list (CAN-SPAM/GDPR): say why they got it
// and how to stop. Kept in the draft body so the admin can reword it.
const LIST_FOOTER = `

—
You’re receiving this because you entered a Grounded Drops giveaway.
Reply “unsubscribe” and we’ll stop sending giveaway emails.`;

/** Draft inviting past entrants to join a newly opened giveaway. */
function createInviteDraft(giveaway, baseUrl = '') {
  const month = periodMonthName(giveaway.period);
  const enterUrl = baseUrl ? `${baseUrl}/` : '[your giveaway page URL]';
  const prize = giveaway.prize || 'this month’s prize';
  db.prepare('INSERT INTO email_drafts (giveaway_id, type, subject, body) VALUES (?, ?, ?, ?)').run(
    giveaway.id,
    'invite',
    `The ${month} Grounded Drops giveaway is open \u{1F331}`,
    `Hey Grounded Drops fam,

A new month, a new giveaway — this time you could win ${prize}.

Entering takes 10 seconds:

${enterUrl}

Every friend you refer after entering earns you a bonus entry, and orders count too.

Good luck!
— The Grounded Drops team${LIST_FOOTER}`
  );
}

function createDraftsForWinner(giveaway, winner, baseUrl) {
  const month = periodMonthName(giveaway.period);
  const winnerPublic = displayName(winner.name, winner.email);
  const firstName = (winner.name || '').trim().split(/\s+/)[0] || 'there';
  const enterUrl = baseUrl ? `${baseUrl}/` : '[your giveaway page URL]';
  const prize = giveaway.prize || 'this month’s prize';

  const insert = db.prepare(
    'INSERT INTO email_drafts (giveaway_id, type, subject, body) VALUES (?, ?, ?, ?)'
  );

  insert.run(
    giveaway.id,
    'announcement',
    `\u{1F389} Our ${month} giveaway winner is ${winnerPublic}!`,
    `Hey Grounded Drops fam,

The results are in — our ${month} giveaway winner is ${winnerPublic}, taking home ${prize}. Congratulations!

Didn’t win this time? A brand-new giveaway is already open. Enter here (it takes 10 seconds):

${enterUrl}

Pro tip: share your personal referral link after entering — every friend who joins earns you a bonus entry. Shopify orders count too.

Good luck!
— The Grounded Drops team${LIST_FOOTER}`
  );

  insert.run(
    giveaway.id,
    'winner',
    `You WON the ${giveaway.title}! \u{1F389}`,
    `Hi ${firstName},

Amazing news — you’re the winner of our ${month} giveaway, and ${prize} is yours!

To claim your prize, just reply to this email and confirm:
  • Your full name
  • Your shipping address
  • A phone number for the courier

As an extra thank-you, here’s a personal discount code for your next order:

  ${winner.discount_code}

Please confirm within 14 days so we can get your prize shipped.

Congratulations again!
— The Grounded Drops team`
  );
}

function listDrafts(giveawayId) {
  return db
    .prepare('SELECT * FROM email_drafts WHERE giveaway_id = ? ORDER BY id ASC')
    .all(giveawayId);
}

function getDraft(id) {
  return db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id);
}

function updateDraft(id, { subject, body }) {
  db.prepare('UPDATE email_drafts SET subject = ?, body = ? WHERE id = ?').run(subject, body, id);
  return getDraft(id);
}

function markDraftSent(id) {
  db.prepare("UPDATE email_drafts SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(id);
  return getDraft(id);
}

function participantEmails(giveawayId) {
  return db
    .prepare('SELECT email FROM participants WHERE giveaway_id = ?')
    .all(giveawayId)
    .map((r) => r.email);
}

/** Every email that has ever entered any giveaway — the invite/reminder list. */
function allParticipantEmails() {
  return db.prepare('SELECT DISTINCT email FROM participants').all().map((r) => r.email);
}

// ---- Automatic monthly draw ----
/**
 * Runs the monthly lifecycle. For every open giveaway whose month has ended:
 * draw a winner (or close it if it had no entries). Then, if no giveaway is
 * open, create one for the current month. Returns a log of actions taken.
 */
function autoDrawTick({ baseUrl = '', autoCreate = true, now = new Date() } = {}) {
  const period = currentPeriod(now);
  const actions = [];

  const expired = db
    .prepare("SELECT * FROM giveaways WHERE status = 'open' AND period < ?")
    .all(period);

  for (const g of expired) {
    const tickets = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE giveaway_id = ?').get(g.id).n;
    if (tickets > 0) {
      const winner = drawWinner(g.id, { baseUrl });
      actions.push({ action: 'drew_winner', giveawayId: g.id, title: g.title, winner: displayName(winner.name, winner.email) });
    } else {
      db.prepare("UPDATE giveaways SET status = 'closed' WHERE id = ?").run(g.id);
      actions.push({ action: 'closed_empty', giveawayId: g.id, title: g.title });
    }
  }

  if (autoCreate && !getCurrentOpenGiveaway()) {
    const month = periodMonthName(period);
    const prev = db.prepare('SELECT prize, description FROM giveaways ORDER BY id DESC LIMIT 1').get();
    const created = createGiveaway({
      title: `${month} Giveaway`,
      description: prev?.description || 'Enter for a chance to win this month’s Grounded Drops giveaway!',
      prize: prev?.prize || '',
      period,
    });
    createInviteDraft(created, baseUrl);
    actions.push({ action: 'created_giveaway', giveawayId: created.id, title: created.title });
  }

  return actions;
}

module.exports = {
  db,
  REFERRAL_TICKET_CAP,
  PURCHASE_TICKETS_PER_ORDER,
  currentPeriod,
  periodMonthName,
  displayName,
  createGiveaway,
  getGiveaway,
  updateGiveaway,
  listGiveaways,
  getCurrentOpenGiveaway,
  getParticipantByEmail,
  enroll,
  importEntrants,
  recordPurchase,
  participantTicketCount,
  giveawayStats,
  drawWinner,
  getWinner,
  publicWinners,
  listDrafts,
  getDraft,
  updateDraft,
  markDraftSent,
  participantEmails,
  allParticipantEmails,
  createInviteDraft,
  autoDrawTick,
};
