'use strict';

/**
 * Merchant settings API, protected by a shared password (HTTP Basic auth).
 * Lets the store owner choose which edits are allowed, set the edit window,
 * curate upsell offers, and generate signed "edit your order" links to drop
 * into confirmation emails or the order-status page.
 */

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const settingsStore = require('../settings');
const shopify = require('../shopify');
const tokens = require('../tokens');

const router = express.Router();

/* -------------------------------------------------------------- basic auth */

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Failed-attempt tracking so the shared password can't be brute-forced.
const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;
const authFails = new Map(); // ip -> { count, resetAt }
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of authFails) if (now > rec.resetAt) authFails.delete(ip);
}, 5 * 60 * 1000).unref();

function requireAuth(req, res, next) {
  if (!config.adminPassword) {
    return res.status(500).send('ADMIN_PASSWORD is not set on the server.');
  }
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const fails = authFails.get(ip);
  if (fails && now <= fails.resetAt && fails.count >= AUTH_FAIL_LIMIT) {
    return res.status(429).send('Too many failed sign-in attempts. Try again later.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [, password] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(password || '', config.adminPassword)) {
      authFails.delete(ip);
      return next();
    }
    // Only count actual wrong-password attempts, not the browser's initial
    // credential-less request that triggers the login prompt.
    if (!fails || now > fails.resetAt) {
      authFails.set(ip, { count: 1, resetAt: now + AUTH_FAIL_WINDOW_MS });
    } else {
      fails.count += 1;
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Order editor admin"');
  return res.status(401).send('Authentication required.');
}

router.use(requireAuth);

/* ----------------------------------------------------------------- routes */

router.get('/shop', async (req, res) => {
  try {
    const shop = await shopify.getShopInfo();
    res.json({ shop, publicUrl: config.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', (req, res) => {
  res.json(settingsStore.load());
});

router.post('/settings', express.json(), (req, res) => {
  const b = req.body || {};
  const patch = {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

  if (b.editWindowMinutes !== undefined) patch.editWindowMinutes = Math.max(0, num(b.editWindowMinutes) ?? 60);
  if (b.upsellDiscountPercent !== undefined) patch.upsellDiscountPercent = Math.min(100, Math.max(0, num(b.upsellDiscountPercent) ?? 0));
  if (b.swapPriceTolerance !== undefined) patch.swapPriceTolerance = Math.max(0, num(b.swapPriceTolerance) ?? 0);
  if (b.allowAddressEdit !== undefined) patch.allowAddressEdit = Boolean(b.allowAddressEdit);
  if (b.allowVariantSwap !== undefined) patch.allowVariantSwap = Boolean(b.allowVariantSwap);
  if (b.allowUpsell !== undefined) patch.allowUpsell = Boolean(b.allowUpsell);
  if (b.allowPricedSwaps !== undefined) patch.allowPricedSwaps = Boolean(b.allowPricedSwaps);
  if (b.notifyCustomerOnEdit !== undefined) patch.notifyCustomerOnEdit = Boolean(b.notifyCustomerOnEdit);
  if (b.invoiceForBalance !== undefined) patch.invoiceForBalance = Boolean(b.invoiceForBalance);
  if (typeof b.upsellHeading === 'string') patch.upsellHeading = b.upsellHeading.slice(0, 160);
  if (typeof b.upsellSubheading === 'string') patch.upsellSubheading = b.upsellSubheading.slice(0, 400);
  if (Array.isArray(b.upsellVariantIds)) {
    patch.upsellVariantIds = b.upsellVariantIds
      .filter((s) => typeof s === 'string' && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s))
      .slice(0, 8);
  }
  if (Array.isArray(b.excludeProductTags)) {
    patch.excludeProductTags = b.excludeProductTags.filter((s) => typeof s === 'string').map((s) => s.trim()).slice(0, 30);
  }

  const saved = settingsStore.save(patch);
  res.json(saved);
});

// Product search to help curate upsell offers in the UI.
router.get('/search-products', async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 120);
    const data = await shopify.gql(
      `query($q: String) {
        products(first: 10, query: $q) {
          edges { node {
            id title status featuredImage { url }
            variants(first: 25) { edges { node { id title price availableForSale } } }
          } }
        }
      }`,
      { q: q || 'status:active' }
    );
    const products = (data.products.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      status: e.node.status,
      image: e.node.featuredImage ? e.node.featuredImage.url : null,
      variants: (e.node.variants.edges || []).map((v) => ({
        id: v.node.id,
        title: v.node.title,
        price: Number(v.node.price),
        availableForSale: v.node.availableForSale,
      })),
    }));
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve a list of variant GIDs to titles/prices (for displaying upsell chips).
router.get('/resolve-variants', async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s))
      .slice(0, 8);
    const variants = await shopify.getVariantsByIds(ids);
    res.json({
      variants: variants.filter(Boolean).map((v) => ({
        id: v.id,
        title: v.product ? v.product.title : v.title,
        variantTitle: v.title && v.title !== 'Default Title' ? v.title : null,
        price: Number(v.price),
        availableForSale: v.availableForSale,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a signed "edit your order" link for a given order number + email.
// Use this to populate confirmation emails / the order-status page, or to test.
router.get('/link', async (req, res) => {
  try {
    const orderNumber = String(req.query.order || '');
    const email = String(req.query.email || '');
    if (!orderNumber || !email) return res.status(400).json({ error: 'Provide ?order= and ?email=' });
    const gid = await shopify.findOrderByNumberAndEmail(orderNumber, email);
    if (!gid) return res.status(404).json({ error: 'No matching order for that number + email.' });
    const token = tokens.sign(gid);
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    res.json({ orderGid: gid, token, url: `${base}/edit?token=${encodeURIComponent(token)}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
