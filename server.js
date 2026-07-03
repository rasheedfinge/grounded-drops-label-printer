'use strict';

/**
 * Grounded Drops — self-service Order Editor.
 *
 * A single-store, standalone portal where customers can fix their shipping
 * address, swap a variant, or add an upsell item to an order that hasn't
 * shipped yet. Changes are written straight to Shopify via the Admin API.
 *
 *   /              -> customer portal (enter order # + email)
 *   /edit?token=   -> customer portal via a signed link
 *   /admin         -> merchant settings (password protected, incl. its JS)
 *   /api/portal    -> customer API
 *   /api/admin     -> merchant API
 *   /healthz       -> health check
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

// Baseline security headers. The CSP allows exactly what the two pages use:
// same-origin scripts/styles (plus inline <style>/style=""), Shopify CDN
// product images, and same-origin fetches. No inline event handlers exist.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://cdn.shopify.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

// Order data and settings must never land in shared caches.
app.use(['/api', '/admin'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true }));

// APIs
app.use('/api/portal', portalRoutes);
app.use('/api/admin', adminRoutes);

// Merchant settings screen. The page AND its script live outside public/ so
// nothing admin-related is served without credentials.
const privateDir = path.join(__dirname, 'private');
app.get('/admin', adminRoutes.requireAuth, (req, res) => {
  res.sendFile(path.join(privateDir, 'admin.html'));
});
app.get('/admin/app.js', adminRoutes.requireAuth, (req, res) => {
  res.sendFile(path.join(privateDir, 'admin.js'));
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
