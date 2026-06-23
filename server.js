'use strict';

/**
 * Grounded Drops — self-service Order Editor.
 *
 * A single-store, standalone portal where customers can fix their shipping
 * address, swap a variant, or add an upsell item to an order that hasn't
 * shipped yet. Changes are written straight to Shopify via the Admin API.
 *
 *   /            -> customer portal (enter order # + email)
 *   /edit?token= -> customer portal via a signed link
 *   /admin       -> merchant settings (password protected)
 *   /api/portal  -> customer API
 *   /api/admin   -> merchant API
 *   /healthz     -> health check
 */

const path = require('path');
const express = require('express');

const config = require('./src/config');
const portalRoutes = require('./src/routes/portal');
const adminRoutes = require('./src/routes/admin');

const app = express();

// Behind a hosting proxy (Heroku/Render/etc.) so req.ip reflects the real client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true }));

// APIs
app.use('/api/portal', portalRoutes);
app.use('/api/admin', adminRoutes);

// Merchant settings page (password protected)
app.get('/admin', adminRoutes.requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Customer portal entry points
const indexFile = path.join(__dirname, 'public', 'index.html');
app.get('/', (req, res) => res.sendFile(indexFile));
app.get('/edit', (req, res) => res.sendFile(indexFile));

// Static assets (css/js). Index served explicitly above, so disable autoindex.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Clean JSON errors (e.g. malformed request bodies) instead of HTML stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  console.error('[unhandled]', err && err.message);
  return res.status(500).json({ error: 'Server error.' });
});

app.listen(config.port, () => {
  const missing = config.assertReady();
  console.log(`Order editor listening on http://localhost:${config.port}`);
  if (missing.length) {
    console.warn(`[startup] Missing required config: ${missing.join(', ')}.`);
    console.warn('[startup] The app will run but Shopify calls / admin login will fail until these are set. See .env.example.');
  } else {
    console.log(`[startup] Configured for store: ${config.shop}`);
  }
});

module.exports = app;
