'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quantityChangeCheck } = require('../src/eligibility');
const { aggregate } = require('../src/events');

const line = (over = {}) => ({
  isSubscription: false,
  merchantEditable: true,
  quantity: 2,
  ...over,
});

test('increase is allowed by default', () => {
  assert.equal(quantityChangeCheck(line(), 3, {}).ok, true);
});

test('increase is blocked when allowQuantityEdit is off', () => {
  const r = quantityChangeCheck(line(), 3, { allowQuantityEdit: false });
  assert.equal(r.ok, false);
});

test('decrease/removal is blocked by default', () => {
  assert.equal(quantityChangeCheck(line(), 1, {}).ok, false);
  assert.equal(quantityChangeCheck(line(), 0, {}).ok, false);
});

test('decrease/removal is allowed when allowItemRemoval is on', () => {
  const s = { allowItemRemoval: true };
  assert.equal(quantityChangeCheck(line(), 1, s).ok, true);
  assert.equal(quantityChangeCheck(line(), 0, s).ok, true);
});

test('unchanged quantity is rejected', () => {
  assert.equal(quantityChangeCheck(line(), 2, { allowItemRemoval: true }).ok, false);
});

test('bounds and bad input are rejected', () => {
  const s = { allowItemRemoval: true };
  assert.equal(quantityChangeCheck(line(), -1, s).ok, false);
  assert.equal(quantityChangeCheck(line(), 100, s).ok, false);
  assert.equal(quantityChangeCheck(line(), 2.5, s).ok, false);
  assert.equal(quantityChangeCheck(line(), 'x', s).ok, false);
});

test('subscription and non-editable lines are rejected', () => {
  assert.equal(quantityChangeCheck(line({ isSubscription: true }), 3, {}).ok, false);
  assert.equal(quantityChangeCheck(line({ merchantEditable: false }), 3, {}).ok, false);
  assert.equal(quantityChangeCheck(null, 3, {}).ok, false);
});

/* ------------------------------------------------------- events.aggregate */

test('aggregate counts types and sums money correctly', () => {
  const out = aggregate([
    { type: 'address' },
    { type: 'address' },
    { type: 'swap', value: 0 },
    { type: 'swap', value: 4.4 },       // pricier swap invoiced
    { type: 'quantity', value: -12.5 }, // removal → refund flagged
    { type: 'upsell', value: 39.61 },
    { type: 'upsell', value: 0 },
    { type: 'cancel', value: 112.02 },
  ]);
  assert.equal(out.total, 8);
  assert.equal(out.byType.address, 2);
  assert.equal(out.byType.swap, 2);
  assert.equal(out.byType.upsell, 2);
  assert.equal(out.upsellInvoiced, 39.61);
  assert.equal(out.balancesInvoiced, 4.4);
  assert.equal(out.refundsFlagged, 12.5);
  assert.equal(out.cancelledValue, 112.02);
});

test('aggregate tolerates junk entries', () => {
  const out = aggregate([null, {}, { type: 'swap', value: 'x' }, undefined]);
  assert.equal(out.total, 1);
  assert.equal(out.byType.swap, 1);
  assert.equal(out.balancesInvoiced, 0);
});
