'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_KEYS = ['EDIT_WINDOW_MINUTES', 'UPSELL_DISCOUNT_PERCENT', 'UPSELL_VARIANT_IDS', 'ALLOW_UPSELL'];

function freshSettings(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/settings')];
  return require('../src/settings');
}

test.after(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

test('defaults load with the expected shape', () => {
  const s = freshSettings().load();
  assert.equal(typeof s.editWindowMinutes, 'number');
  assert.ok(Array.isArray(s.upsellVariantIds));
  assert.ok(Array.isArray(s.excludeProductTags));
  assert.equal(typeof s.allowAddressEdit, 'boolean');
});

test('numeric env override wins over defaults', () => {
  const s = freshSettings({ EDIT_WINDOW_MINUTES: '45' }).load();
  assert.equal(s.editWindowMinutes, 45);
});

test('unparseable numeric env override is ignored, not zeroed', () => {
  const s = freshSettings({ EDIT_WINDOW_MINUTES: 'garbage' }).load();
  assert.equal(typeof s.editWindowMinutes, 'number');
  assert.ok(s.editWindowMinutes > 0, 'window must not silently collapse to 0');
});

test('variant id list env override parses to an array', () => {
  const s = freshSettings({ UPSELL_VARIANT_IDS: 'gid://shopify/ProductVariant/1, gid://shopify/ProductVariant/2' }).load();
  assert.deepEqual(s.upsellVariantIds, ['gid://shopify/ProductVariant/1', 'gid://shopify/ProductVariant/2']);
});

test('boolean env override parses truthy forms', () => {
  assert.equal(freshSettings({ ALLOW_UPSELL: 'false' }).load().allowUpsell, false);
  assert.equal(freshSettings({ ALLOW_UPSELL: 'true' }).load().allowUpsell, true);
});
