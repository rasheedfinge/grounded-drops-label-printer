'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { orderEligibility, isLineSwappable } = require('../src/eligibility');

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

const baseOrder = (over = {}) => ({
  createdAt: minsAgo(5),
  cancelledAt: null,
  displayFulfillmentStatus: 'UNFULFILLED',
  ...over,
});

const settings = { editWindowMinutes: 60 };

test('fresh unfulfilled order is editable, closesAt = createdAt + window', () => {
  const order = baseOrder();
  const r = orderEligibility(order, settings);
  assert.equal(r.editable, true);
  assert.deepEqual(r.reasons, []);
  const expected = new Date(order.createdAt).getTime() + 60 * 60 * 1000;
  assert.equal(r.closesAt, expected);
});

test('order outside the window is not editable', () => {
  const r = orderEligibility(baseOrder({ createdAt: minsAgo(61) }), settings);
  assert.equal(r.editable, false);
  assert.ok(r.reasons.some((x) => /window/i.test(x)));
});

test('cancelled order is not editable', () => {
  const r = orderEligibility(baseOrder({ cancelledAt: minsAgo(1) }), settings);
  assert.equal(r.editable, false);
  assert.ok(r.reasons.some((x) => /cancelled/i.test(x)));
});

test('fulfilled / in-progress order is not editable', () => {
  for (const status of ['FULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS']) {
    const r = orderEligibility(baseOrder({ displayFulfillmentStatus: status }), settings);
    assert.equal(r.editable, false, status);
  }
});

test('missing order yields not-found reason', () => {
  const r = orderEligibility(null, settings);
  assert.equal(r.editable, false);
});

test('non-numeric window closes the portal rather than crashing', () => {
  const r = orderEligibility(baseOrder(), { editWindowMinutes: 'abc' });
  assert.equal(r.editable, false);
});

/* ---------------------------------------------------------- isLineSwappable */

const line = (over = {}) => ({
  isSubscription: false,
  merchantEditable: true,
  productHasOnlyDefaultVariant: false,
  quantity: 1,
  productTags: [],
  ...over,
});

test('normal multi-variant line is swappable', () => {
  assert.equal(isLineSwappable(line(), {}), true);
});

test('subscription line is never swappable', () => {
  assert.equal(isLineSwappable(line({ isSubscription: true }), {}), false);
});

test('single-variant product is not swappable', () => {
  assert.equal(isLineSwappable(line({ productHasOnlyDefaultVariant: true }), {}), false);
});

test('non-merchant-editable and zero-quantity lines are not swappable', () => {
  assert.equal(isLineSwappable(line({ merchantEditable: false }), {}), false);
  assert.equal(isLineSwappable(line({ quantity: 0 }), {}), false);
});

test('excluded tag blocks swapping, case-insensitively', () => {
  const s = { excludeProductTags: ['Subscription'] };
  assert.equal(isLineSwappable(line({ productTags: ['subscription'] }), s), false);
  assert.equal(isLineSwappable(line({ productTags: ['coffee'] }), s), true);
});
