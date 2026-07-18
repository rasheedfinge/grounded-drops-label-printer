'use strict';

/**
 * Lightweight activity log so the merchant can see what the portal is doing
 * for them: edits made, upsell revenue invoiced, tickets that never happened.
 *
 * Events are appended as JSON lines to data/events.jsonl — no database, no
 * PII beyond the order name. On hosts with an ephemeral filesystem the log
 * resets on redeploy; it's operational insight, not a system of record.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'events.jsonl');

let dirReady = false;

/** Fire-and-forget append; never throws into a request path. */
function record(type, data = {}) {
  try {
    if (!dirReady) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      dirReady = true;
    }
    const line = JSON.stringify({ t: Date.now(), type, ...data });
    fs.appendFile(FILE, line + '\n', () => {});
  } catch {
    /* stats must never break the portal */
  }
}

/** Read up to the last `limit` events (oldest first). */
function readRecent(limit = 5000) {
  try {
    const text = fs.readFileSync(FILE, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Pure aggregation over an event list (exported for tests). */
function aggregate(events) {
  const out = {
    total: 0,
    byType: {},
    upsellInvoiced: 0, // value of added items invoiced via pay link
    balancesInvoiced: 0, // swap/quantity differences invoiced via pay link
    refundsFlagged: 0, // value owed back to customers (processed manually)
    cancelledValue: 0,
  };
  for (const e of events || []) {
    if (!e || !e.type) continue;
    out.total += 1;
    out.byType[e.type] = (out.byType[e.type] || 0) + 1;
    const value = Number(e.value) || 0;
    if (e.type === 'upsell' && value > 0) out.upsellInvoiced += value;
    if ((e.type === 'swap' || e.type === 'quantity') && value > 0) out.balancesInvoiced += value;
    if ((e.type === 'swap' || e.type === 'quantity') && value < 0) out.refundsFlagged += -value;
    if (e.type === 'cancel' && value > 0) out.cancelledValue += value;
  }
  const round = (n) => Math.round(n * 100) / 100;
  out.upsellInvoiced = round(out.upsellInvoiced);
  out.balancesInvoiced = round(out.balancesInvoiced);
  out.refundsFlagged = round(out.refundsFlagged);
  out.cancelledValue = round(out.cancelledValue);
  return out;
}

/** Aggregate + the most recent events for display, newest first. */
function summary() {
  const events = readRecent();
  return { ...aggregate(events), recent: events.slice(-20).reverse() };
}

module.exports = { record, readRecent, aggregate, summary };
