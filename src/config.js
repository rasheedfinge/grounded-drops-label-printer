'use strict';

/**
 * Central configuration, loaded from environment variables.
 *
 * Secrets and store-specific values live in the environment (.env locally, or
 * the host's config vars in production). Nothing secret is ever sent to the
 * browser — only the values under `config.public` are exposed to the portal.
 */

require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Shopify Admin API (custom app installed on the single store)
  shop: (process.env.SHOPIFY_SHOP || '').trim(), // e.g. grounded-drops.myshopify.com
  adminToken: (process.env.SHOPIFY_ADMIN_TOKEN || '').trim(), // shpat_...
  apiVersion: (process.env.SHOPIFY_API_VERSION || '2025-01').trim(),

  // Secret used to sign tamper-proof "edit your order" links.
  linkSecret: process.env.LINK_SIGNING_SECRET || '',

  // Shared password protecting the merchant settings screen (/admin).
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // Branding / email
  storeName: process.env.STORE_NAME || 'Our store',
  // Public origin where this app is hosted, used to build edit links.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // "from" address used when emailing balance invoices. Must be a store or
  // staff email that Shopify recognises, otherwise Shopify rejects the send.
  invoiceFromEmail: process.env.INVOICE_FROM_EMAIL || '',

  // How many lookup attempts a single IP may make per window (basic abuse guard).
  lookupRateLimit: int(process.env.LOOKUP_RATE_LIMIT, 30),
  lookupRateWindowMs: int(process.env.LOOKUP_RATE_WINDOW_MS, 10 * 60 * 1000),
};

/** Values that are safe to expose to the browser. */
config.public = {
  storeName: config.storeName,
};

/** Throws at startup if anything required to run is missing. */
function assertReady() {
  const missing = [];
  if (!config.shop) missing.push('SHOPIFY_SHOP');
  if (!config.adminToken) missing.push('SHOPIFY_ADMIN_TOKEN');
  if (!config.linkSecret) missing.push('LINK_SIGNING_SECRET');
  if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
  return missing;
}

config.assertReady = assertReady;

module.exports = config;
