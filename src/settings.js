'use strict';

/**
 * Merchant settings: what edits are allowed, the edit window, upsell offers, etc.
 *
 * Settings come from three layers, lowest priority first:
 *   1. config/settings.default.json  (committed defaults)
 *   2. data/settings.json            (written by the /admin screen at runtime)
 *   3. environment variables         (always win, so critical config survives
 *                                     redeploys on ephemeral hosts)
 *
 * Note: data/settings.json is not committed. On hosts with an ephemeral
 * filesystem (Heroku, many container platforms) changes made in /admin reset on
 * redeploy — so for anything you can't afford to lose, also set the matching
 * env var (see .env.example).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULTS_FILE = path.join(ROOT, 'config', 'settings.default.json');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'settings.json');

let cache = null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function envOverrides() {
  const out = {};
  const e = process.env;
  if (e.EDIT_WINDOW_MINUTES) out.editWindowMinutes = parseInt(e.EDIT_WINDOW_MINUTES, 10);
  if (e.UPSELL_DISCOUNT_PERCENT) out.upsellDiscountPercent = parseInt(e.UPSELL_DISCOUNT_PERCENT, 10);
  if (e.UPSELL_VARIANT_IDS) {
    out.upsellVariantIds = e.UPSELL_VARIANT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (e.ALLOW_ADDRESS_EDIT) out.allowAddressEdit = /^(1|true|yes|on)$/i.test(e.ALLOW_ADDRESS_EDIT);
  if (e.ALLOW_VARIANT_SWAP) out.allowVariantSwap = /^(1|true|yes|on)$/i.test(e.ALLOW_VARIANT_SWAP);
  if (e.ALLOW_UPSELL) out.allowUpsell = /^(1|true|yes|on)$/i.test(e.ALLOW_UPSELL);
  return out;
}

function load() {
  if (cache) return cache;
  const defaults = readJson(DEFAULTS_FILE) || {};
  const saved = readJson(DATA_FILE) || {};
  cache = { ...defaults, ...saved, ...envOverrides() };
  return cache;
}

/** Persist a partial settings patch and return the merged result. */
function save(patch) {
  const defaults = readJson(DEFAULTS_FILE) || {};
  const saved = readJson(DATA_FILE) || {};
  const next = { ...defaults, ...saved, ...patch };
  // Don't persist env-derived values; they're reapplied on load().
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2));
  cache = { ...next, ...envOverrides() };
  return cache;
}

module.exports = { load, save };
