'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  numericId,
  digitsOf,
  effectiveDiscountPercent,
  variantImage,
  normalizeOrder,
} = require('../src/shopify');

test('numericId extracts the trailing id from a gid', () => {
  assert.equal(numericId('gid://shopify/LineItem/15848773287994'), '15848773287994');
  assert.equal(numericId('gid://shopify/CalculatedLineItem/123'), '123');
  assert.equal(numericId(''), '');
  assert.equal(numericId(null), '');
});

test('digitsOf strips everything but digits', () => {
  assert.equal(digitsOf('GD#99128665'), '99128665');
  assert.equal(digitsOf('  #12-34 '), '1234');
  assert.equal(digitsOf(null), '');
});

test('effectiveDiscountPercent derives the paid-vs-list discount', () => {
  assert.equal(effectiveDiscountPercent(100, 85), 15);
  assert.equal(effectiveDiscountPercent(28.55, 28.55), 0);
  assert.equal(effectiveDiscountPercent(100, 0), 100);
  assert.equal(effectiveDiscountPercent(29.99, 19.99), 33.34); // rounded to 2dp
  // Degenerate inputs never produce a discount.
  assert.equal(effectiveDiscountPercent(0, 10), 0);
  assert.equal(effectiveDiscountPercent(100, 120), 0);
  assert.equal(effectiveDiscountPercent(null, null), 0);
});

test('variantImage prefers the variant image, falls back to product featured image', () => {
  const featured = { product: { featuredMedia: { preview: { image: { url: 'https://cdn/prod.jpg' } } } } };
  assert.equal(variantImage({ image: { url: 'https://cdn/var.jpg' }, ...featured }), 'https://cdn/var.jpg');
  assert.equal(variantImage({ image: null, ...featured }), 'https://cdn/prod.jpg');
  assert.equal(variantImage({ image: null, product: {} }), null);
  assert.equal(variantImage(null), null);
});

test('normalizeOrder reshapes a raw order into the portal payload', () => {
  const raw = {
    id: 'gid://shopify/Order/1',
    name: 'GD#1001',
    createdAt: '2026-06-23T06:09:01Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    totalPriceSet: { presentmentMoney: { amount: '112.02', currencyCode: 'AUD' } },
    shippingAddress: { firstName: 'John', country: 'Australia' },
    lineItems: {
      edges: [{
        node: {
          id: 'gid://shopify/LineItem/11',
          title: 'Drip Coffee Bags',
          variantTitle: 'Hodophile / 36 bags',
          quantity: 2,
          currentQuantity: 2,
          merchantEditable: true,
          image: { url: 'https://cdn/x.jpg' },
          sellingPlan: null,
          originalUnitPriceSet: { presentmentMoney: { amount: '65.89', currencyCode: 'AUD' } },
          discountedUnitPriceAfterAllDiscountsSet: { presentmentMoney: { amount: '55.89', currencyCode: 'AUD' } },
          variant: { id: 'gid://shopify/ProductVariant/21' },
          product: { id: 'gid://shopify/Product/31', hasOnlyDefaultVariant: false, tags: ['coffee'] },
        },
      }],
    },
  };
  const o = normalizeOrder(raw);
  assert.equal(o.name, 'GD#1001');
  assert.equal(o.currency, 'AUD');
  assert.equal(o.total, 112.02);
  assert.equal(o.lineItems.length, 1);
  const li = o.lineItems[0];
  assert.equal(li.unitPrice, 65.89);
  assert.equal(li.paidUnitPrice, 55.89);
  assert.equal(li.isSubscription, false);
  assert.equal(li.productHasOnlyDefaultVariant, false);
  assert.deepEqual(li.productTags, ['coffee']);
});

test('normalizeOrder marks subscription lines and falls back paid price to list price', () => {
  const raw = {
    id: 'gid://shopify/Order/2',
    name: 'GD#1002',
    createdAt: '2026-06-23T06:09:01Z',
    totalPriceSet: { presentmentMoney: { amount: '30.95', currencyCode: 'AUD' } },
    lineItems: {
      edges: [{
        node: {
          id: 'gid://shopify/LineItem/12',
          title: 'Subscribe blend',
          quantity: 1,
          sellingPlan: { name: 'Monthly' },
          originalUnitPriceSet: { presentmentMoney: { amount: '30.95', currencyCode: 'AUD' } },
          discountedUnitPriceAfterAllDiscountsSet: null,
          variant: null,
          product: null,
        },
      }],
    },
  };
  const li = normalizeOrder(raw).lineItems[0];
  assert.equal(li.isSubscription, true);
  assert.equal(li.paidUnitPrice, 30.95);
  assert.equal(li.productHasOnlyDefaultVariant, true); // safe default: not swappable
});
