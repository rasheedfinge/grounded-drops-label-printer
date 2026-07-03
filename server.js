'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const AUTO_DRAW = process.env.AUTO_DRAW !== 'false'; // on by default
const MAIL_FROM = process.env.MAIL_FROM || 'Grounded Drops <giveaways@groundeddrops.com>';

if (ADMIN_PASSWORD === 'changeme') {
  console.warn('[warn] ADMIN_PASSWORD is unset — using the default "changeme". Set it before deploying.');
}
if (!SHOPIFY_WEBHOOK_SECRET) {
  console.warn('[warn] SHOPIFY_WEBHOOK_SECRET is unset — Shopify webhooks are NOT verified (dev mode).');
}

// Optional SMTP transport for sending the drafted emails. Without it, drafts
// can still be viewed/edited/copied in the admin — just not sent from the app.
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;

app.use(cors());

// ---------------------------------------------------------------------------
// Shopify webhook — must read the RAW body to verify the HMAC, so it is
// registered before the JSON body parser.
// ---------------------------------------------------------------------------
app.post(
  '/webhooks/shopify/orders',
  express.raw({ type: '*/*' }),
  (req, res) => {
    if (SHOPIFY_WEBHOOK_SECRET) {
      const hmac = req.get('X-Shopify-Hmac-Sha256') || '';
      const digest = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body) // raw Buffer
        .digest('base64');
      const ok =
        hmac.length === digest.length &&
        crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest));
      if (!ok) return res.status(401).send('Invalid HMAC');
    }

    let order;
    try {
      order = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).send('Invalid JSON');
    }

    const giveaway = store.getCurrentOpenGiveaway();
    if (!giveaway) return res.status(202).send('No open giveaway');

    const email = order.email || (order.customer && order.customer.email);
    if (!email) return res.status(202).send('Order has no email');

    const name = order.customer
      ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ')
      : '';
    const orderId = order.id || order.order_number || order.name;

    const result = store.recordPurchase({
      giveawayId: giveaway.id,
      email,
      name,
      orderId,
      tickets: store.PURCHASE_TICKETS_PER_ORDER,
    });

    return res.status(200).json({
      ok: true,
      duplicate: result.duplicate,
      ticketsGranted: result.granted,
    });
  }
);

app.use(express.json({ limit: '2mb' }));

function baseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function publicGiveaway(g) {
  if (!g) return null;
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    prize: g.prize,
    period: g.period,
    month: store.periodMonthName(g.period),
    status: g.status,
  };
}

app.get('/api/current', (req, res) => {
  res.json({ giveaway: publicGiveaway(store.getCurrentOpenGiveaway()) });
});

// Past winners, shown as "Jamie O." — never full names or emails.
app.get('/api/winners', (req, res) => {
  res.json({ winners: store.publicWinners() });
});

app.post('/api/enter', async (req, res) => {
  const { name = '', email = '', ref = null } = req.body || {};
  const clean = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const giveaway = store.getCurrentOpenGiveaway();
  if (!giveaway) {
    return res.status(409).json({ error: 'There is no giveaway open right now. Check back soon!' });
  }

  const { participant, isNew } = store.enroll({
    giveawayId: giveaway.id,
    email: clean,
    name,
    refCode: ref ? String(ref).trim().toUpperCase() : null,
  });

  const shareUrl = `${baseUrl(req)}/?ref=${participant.referral_code}`;
  let shareQr = null;
  try {
    shareQr = await QRCode.toDataURL(shareUrl, { margin: 1, width: 220 });
  } catch {
    /* QR is a nice-to-have; ignore failures */
  }

  res.json({
    ok: true,
    alreadyEntered: !isNew,
    tickets: store.participantTicketCount(participant.id),
    referralCode: participant.referral_code,
    shareUrl,
    shareQr,
  });
});

// ---------------------------------------------------------------------------
// Admin — HTTP Basic auth gated by ADMIN_PASSWORD
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const header = req.get('Authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [, pass = ''] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const a = Buffer.from(pass);
    const b = Buffer.from(ADMIN_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Grounded Drops Admin"');
  return res.status(401).send('Authentication required');
}

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/giveaways', requireAdmin, (req, res) => {
  res.json({ giveaways: store.listGiveaways(), autoDraw: AUTO_DRAW, mailerConfigured: Boolean(mailer) });
});

app.post('/api/admin/giveaways', requireAdmin, (req, res) => {
  const { title = '', description = '', prize = '', period = '' } = req.body || {};
  if (!title.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return res.status(400).json({ error: 'Period must be in YYYY-MM format (e.g. 2026-06).' });
  }
  const giveaway = store.createGiveaway({
    title: title.trim(),
    description: description.trim(),
    prize: prize.trim(),
    period,
  });
  res.status(201).json({ giveaway });
});

app.put('/api/admin/giveaways/:id', requireAdmin, (req, res) => {
  const { title, description, prize } = req.body || {};
  if (title !== undefined && !String(title).trim()) {
    return res.status(400).json({ error: 'Title cannot be empty.' });
  }
  const giveaway = store.updateGiveaway(Number(req.params.id), { title, description, prize });
  if (!giveaway) return res.status(404).json({ error: 'Giveaway not found.' });
  res.json({ giveaway });
});

app.get('/api/admin/giveaways/:id', requireAdmin, (req, res) => {
  const giveaway = store.getGiveaway(Number(req.params.id));
  if (!giveaway) return res.status(404).json({ error: 'Giveaway not found.' });
  const { participants, totals } = store.giveawayStats(giveaway.id);
  res.json({
    giveaway,
    participants,
    totals,
    winner: store.getWinner(giveaway.id),
    drafts: store.listDrafts(giveaway.id),
  });
});

app.post('/api/admin/giveaways/:id/draw', requireAdmin, (req, res) => {
  try {
    const winner = store.drawWinner(Number(req.params.id), { baseUrl: baseUrl(req) });
    res.json({ winner });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk-import an email list. Accepts { entries: [{email, name}] } or { text }
// where text is one entry per line: "email" or "email, name" (CSV-ish).
app.post('/api/admin/giveaways/:id/import', requireAdmin, (req, res) => {
  const giveaway = store.getGiveaway(Number(req.params.id));
  if (!giveaway) return res.status(404).json({ error: 'Giveaway not found.' });
  if (giveaway.status !== 'open') return res.status(400).json({ error: 'This giveaway is no longer open.' });

  let rows = [];
  if (Array.isArray(req.body?.entries)) {
    rows = req.body.entries;
  } else if (typeof req.body?.text === 'string') {
    rows = req.body.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [email, ...rest] = line.split(',');
        return { email: email.trim(), name: rest.join(',').trim() };
      })
      // Skip a CSV header row if present.
      .filter((r) => !/^e-?mail$/i.test(r.email));
  }
  if (!rows.length) return res.status(400).json({ error: 'No entries found to import.' });
  if (rows.length > 50000) return res.status(400).json({ error: 'Import is limited to 50,000 rows at a time.' });

  const result = store.importEntrants(giveaway.id, rows);
  res.json({ ok: true, ...result });
});

// ---- Email drafts ----
app.put('/api/admin/drafts/:id', requireAdmin, (req, res) => {
  const draft = store.getDraft(Number(req.params.id));
  if (!draft) return res.status(404).json({ error: 'Draft not found.' });
  const { subject = draft.subject, body = draft.body } = req.body || {};
  res.json({ draft: store.updateDraft(draft.id, { subject, body }) });
});

app.post('/api/admin/drafts/:id/send', requireAdmin, async (req, res) => {
  const draft = store.getDraft(Number(req.params.id));
  if (!draft) return res.status(404).json({ error: 'Draft not found.' });
  if (draft.status === 'sent') return res.status(400).json({ error: 'This email was already sent.' });
  if (!mailer) {
    return res.status(400).json({
      error: 'No SMTP server configured. Set SMTP_HOST (and friends) in .env, or copy the draft into your email tool.',
    });
  }

  try {
    if (draft.type === 'winner') {
      const winner = store.getWinner(draft.giveaway_id);
      if (!winner) return res.status(400).json({ error: 'No winner recorded for this giveaway.' });
      await mailer.sendMail({ from: MAIL_FROM, to: winner.email, subject: draft.subject, text: draft.body });
    } else {
      // Announcement: BCC the whole entrant list in chunks.
      const emails = store.participantEmails(draft.giveaway_id);
      if (!emails.length) return res.status(400).json({ error: 'No entrants to send to.' });
      for (let i = 0; i < emails.length; i += 50) {
        await mailer.sendMail({
          from: MAIL_FROM,
          to: MAIL_FROM,
          bcc: emails.slice(i, i + 50),
          subject: draft.subject,
          text: draft.body,
        });
      }
    }
    res.json({ draft: store.markDraftSent(draft.id) });
  } catch (err) {
    res.status(502).json({ error: `Sending failed: ${err.message}` });
  }
});

// Force one lifecycle tick (draw expired months, open the new month) — useful
// for testing and for "draw now without waiting for the scheduler".
app.post('/api/admin/auto-draw/run', requireAdmin, (req, res) => {
  const actions = store.autoDrawTick({ baseUrl: baseUrl(req) });
  res.json({ actions });
});

app.get('/api/admin/giveaways/:id/export.csv', requireAdmin, (req, res) => {
  const giveaway = store.getGiveaway(Number(req.params.id));
  if (!giveaway) return res.status(404).send('Giveaway not found');
  const { participants } = store.giveawayStats(giveaway.id);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['email', 'name', 'tickets', 'referrals', 'purchases', 'referral_code', 'joined']];
  for (const p of participants) {
    rows.push([p.email, p.name, p.tickets, p.referrals, p.purchases, p.referral_code, p.created_at]);
  }
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', `attachment; filename="giveaway-${giveaway.id}-entries.csv"`);
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
});

// ---------------------------------------------------------------------------
// Static assets & health
// ---------------------------------------------------------------------------
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Grounded Drops giveaways running on http://localhost:${PORT}`);
    if (AUTO_DRAW) {
      const tick = () => {
        try {
          const actions = store.autoDrawTick({ baseUrl: PUBLIC_BASE_URL });
          for (const a of actions) console.log('[auto-draw]', JSON.stringify(a));
        } catch (err) {
          console.error('[auto-draw] tick failed:', err.message);
        }
      };
      tick(); // run once at boot, then hourly
      setInterval(tick, 60 * 60 * 1000).unref();
      console.log('[auto-draw] enabled — expired giveaways are drawn automatically each month');
    }
  });
}

module.exports = app;
