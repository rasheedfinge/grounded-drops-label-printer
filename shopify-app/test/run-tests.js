/*
 * Headless browser tests for the gift-offers widget.
 *
 * Runs the real gift-offers.js against a mock Shopify storefront
 * (mock-store.js) in headless Chromium and asserts on actual cart state.
 *
 *   npm install && npm test        (from shopify-app/test)
 */
'use strict';

process.env.MOCK_STORE_PORT = process.env.MOCK_STORE_PORT || '4477';
const PORT = process.env.MOCK_STORE_PORT;
const BASE = `http://localhost:${PORT}`;

const { server } = require('./mock-store');
const { chromium } = require('playwright-core');
const fs = require('fs');

const CHROMIUM_PATH = process.env.CHROMIUM_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// ---------------------------------------------------------------------------
// Tiny test framework
// ---------------------------------------------------------------------------
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function getCart() {
  const res = await fetch(`${BASE}/cart.js`);
  return res.json();
}
async function getState() {
  const res = await fetch(`${BASE}/__test/state`);
  return res.json();
}
async function resetStore(init) {
  await fetch(`${BASE}/__test/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(init || {}),
  });
}

function giftLines(cart, offerId) {
  return cart.items.filter((i) => i.properties && (offerId ? i.properties._gift === offerId : i.properties._gift));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Poll until fn() returns truthy or timeout.
async function until(fn, ms, what) {
  const deadline = Date.now() + (ms || 4000);
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${what} (last=${JSON.stringify(last)})`);
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
let browser;
let pageErrors;

async function openStore(offers, opts) {
  opts = opts || {};
  const context = await browser.newContext();
  const page = await context.newPage();
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  if (process.env.DEBUG_TESTS) {
    page.on('console', (m) => console.log('  [page]', m.text()));
  }
  const config = Object.assign({ offersRaw: JSON.stringify(offers) }, opts.config || {});
  const params = new URLSearchParams({ config: JSON.stringify(config) });
  if (opts.designMode) params.set('designMode', '1');
  let loads = 0;
  page.on('load', () => loads++);
  await page.goto(`${BASE}/?${params}`);
  return { page, context, loadCount: () => loads };
}

// Common offer fixtures (coffee variant 111 costs $20)
const AUTO_50 = { id: 'auto50', type: 'auto', minSpend: 50, gift: { product: 'sample-pack-citrus' } };
const SLIDER_40 = {
  id: 'slider40', type: 'slider', title: 'Pick a gift', minSpend: 40,
  gifts: [{ product: 'sample-pack-citrus' }, { product: 'sample-pack-berry' }, { product: 'mini-tote' }],
};
const BOGO = { id: 'bogo', type: 'bogo', buy: { product: 'ground-coffee', quantity: 2 }, get: { product: 'ground-coffee', quantity: 1 } };

const COFFEE = (qty) => ({ items: [{ id: 111, quantity: qty }] });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('auto: adds gift when threshold met, refreshes drawer without reload', async () => {
  await resetStore({ cart: COFFEE(3) }); // $60 >= $50
  const { page, context, loadCount } = await openStore([AUTO_50]);
  const cart = await until(async () => {
    const c = await getCart();
    return giftLines(c, 'auto50').length === 1 ? c : null;
  }, 5000, 'gift auto-added');
  eq(giftLines(cart, 'auto50')[0].variant_id, 222, 'gift variant');
  eq(giftLines(cart, 'auto50')[0].quantity, 1, 'gift qty');
  // Drawer section re-rendered in place (no navigation).
  await until(
    () => page.$eval('#drawer-lines', (el) => el.textContent.includes('Citrus Sample Pack')).catch(() => false),
    5000, 'drawer shows gift'
  );
  // Dawn-style header badge (#cart-icon-bubble, no shopify-section wrapper)
  // also refreshed: 3 coffees + 1 gift = 4.
  await until(
    () => page.$eval('#cart-icon-bubble .bubble-count', (el) => el.dataset.count === '4').catch(() => false),
    5000, 'cart icon bubble refreshed'
  );
  eq(loadCount(), 1, 'no page reload');
  await context.close();
});

test('auto: removes gift when cart drops below threshold', async () => {
  await resetStore({ cart: COFFEE(3) });
  const { page, context } = await openStore([AUTO_50]);
  await until(async () => giftLines(await getCart(), 'auto50').length === 1, 5000, 'gift added first');
  // Theme reduces coffee to 1 ($20 < $50)
  await page.evaluate(async () => {
    const cart = await (await fetch('/cart.js')).json();
    const paid = cart.items.find((i) => i.variant_id === 111 && !i.properties._gift);
    await fetch('/cart/change.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: paid.key, quantity: 1 }),
    });
  });
  await until(async () => giftLines(await getCart(), 'auto50').length === 0, 5000, 'gift removed');
  await context.close();
});

test('teaser: shows remaining amount below threshold, strips HTML money format', async () => {
  await resetStore({ cart: COFFEE(1) }); // $20 < $50 → $30 to go
  const { page, context } = await openStore([AUTO_50], {
    config: { moneyFormat: '<span class="money">${{amount}}</span>' },
  });
  const text = await until(
    () => page.$eval('.gd-teaser__text', (el) => (el.getBoundingClientRect().height > 0 ? el.textContent : null)).catch(() => null),
    5000, 'teaser visible'
  );
  assert(text.includes('$30.00'), `teaser shows remaining amount, got: ${text}`);
  assert(!text.includes('<span'), 'money format HTML stripped');
  eq(giftLines(await getCart()).length, 0, 'no gift under threshold');
  await context.close();
});

test('slider: renders gifts, picks first AVAILABLE variant for multi-variant product', async () => {
  await resetStore({ cart: COFFEE(2) }); // $40 >= $40
  const { page, context } = await openStore([SLIDER_40]);
  await until(() => page.$('.gd-slider:not([hidden]) .gd-card').catch(() => null), 5000, 'slider cards render');
  const cards = await page.$$eval('.gd-card', (els) => els.map((e) => e.dataset.variantId));
  eq(cards.length, 3, 'three gift cards');
  assert(cards.includes('445') && !cards.includes('444'), 'tote uses first available variant (445)');
  await context.close();
});

test('slider: choose, switch, and toggle off a gift', async () => {
  await resetStore({ cart: COFFEE(2) });
  const { page, context } = await openStore([SLIDER_40]);
  await until(() => page.$('.gd-slider:not([hidden]) .gd-card[data-variant-id="222"]').catch(() => null), 5000, 'cards');

  await page.click('.gd-card[data-variant-id="222"] .gd-card__btn');
  await until(async () => {
    const g = giftLines(await getCart(), 'slider40');
    return g.length === 1 && g[0].variant_id === 222;
  }, 5000, 'citrus chosen');
  await until(
    () => page.$eval('.gd-card[data-variant-id="222"]', (el) => el.classList.contains('is-selected')).catch(() => false),
    5000, 'citrus card marked selected'
  );

  await page.click('.gd-card[data-variant-id="333"] .gd-card__btn');
  await until(async () => {
    const g = giftLines(await getCart(), 'slider40');
    return g.length === 1 && g[0].variant_id === 333;
  }, 5000, 'switched to berry (exactly one gift line)');

  await page.click('.gd-card[data-variant-id="333"] .gd-card__btn');
  await until(async () => giftLines(await getCart(), 'slider40').length === 0, 5000, 'toggled off');
  await context.close();
});

test('slider: dismiss shows reopen chip; chip restores slider', async () => {
  await resetStore({ cart: COFFEE(2) });
  const { page, context } = await openStore([SLIDER_40]);
  await until(() => page.$('.gd-slider:not([hidden])').catch(() => null), 5000, 'slider open');
  await page.click('.gd-slider__close');
  await until(() => page.$('.gd-slider[hidden]').catch(() => null), 3000, 'slider hidden');
  await until(() => page.$('.gd-chip:not([hidden])').catch(() => null), 3000, 'chip visible');
  await page.click('.gd-chip');
  await until(() => page.$('.gd-slider:not([hidden])').catch(() => null), 3000, 'slider reopened');
  await context.close();
});

test('bogo: auto-adds free unit of same product; removes when qty drops', async () => {
  await resetStore({ cart: COFFEE(2) });
  const { page, context } = await openStore([BOGO]);
  await until(async () => {
    const g = giftLines(await getCart(), 'bogo');
    return g.length === 1 && g[0].variant_id === 111 && g[0].quantity === 1;
  }, 5000, 'free coffee added as separate line');
  // Paid line still qty 2 (gift excluded from the buy-count).
  const cart = await getCart();
  const paid = cart.items.find((i) => i.variant_id === 111 && !i.properties._gift);
  eq(paid.quantity, 2, 'paid quantity untouched');

  await page.evaluate(async (key) => {
    await fetch('/cart/change.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: 1 }),
    });
  }, paid.key);
  await until(async () => giftLines(await getCart(), 'bogo').length === 0, 5000, 'free coffee removed');
  await context.close();
});

test('no duplicate gifts under rapid cart activity', async () => {
  await resetStore(); // empty cart
  const { page, context } = await openStore([AUTO_50]);
  await sleep(400);
  // Three rapid theme adds → $60
  await page.click('#theme-add-coffee');
  await page.click('#theme-add-coffee');
  await page.click('#theme-add-coffee');
  await until(async () => giftLines(await getCart(), 'auto50').length === 1, 6000, 'gift added');
  await sleep(1500); // let any straggler reconciles land
  const g = giftLines(await getCart(), 'auto50');
  eq(g.length, 1, 'exactly one gift line');
  eq(g[0].quantity, 1, 'gift quantity stays 1');
  await context.close();
});

test('out-of-stock gift: fails gracefully, no retry storm, no page errors', async () => {
  await resetStore({ cart: COFFEE(1) }); // $20 >= $10 threshold
  const oos = { id: 'oos', type: 'auto', minSpend: 10, gift: { product: 'out-of-stock-gift' } };
  const { context } = await openStore([oos]);
  await sleep(3000);
  eq(giftLines(await getCart(), 'oos').length, 0, 'no gift added');
  const state = await getState();
  const addAttempts = state.requestLog.filter((r) => r.path.startsWith('/cart/add.js')).length;
  assert(addAttempts <= 2, `add attempts bounded, got ${addAttempts}`);
  eq(pageErrors.length, 0, `no uncaught page errors: ${pageErrors.join('; ')}`);
  await context.close();
});

test('design mode: renders UI but never writes to the cart', async () => {
  await resetStore({ cart: COFFEE(3) });
  const { context } = await openStore([AUTO_50, SLIDER_40], { designMode: true });
  await sleep(2500);
  const state = await getState();
  const writes = state.requestLog.filter((r) => r.method === 'POST' && r.path.startsWith('/cart/'));
  eq(writes.length, 0, 'no cart writes in design mode');
  await context.close();
});

test('XHR-based theme cart writes are detected', async () => {
  await resetStore({ cart: COFFEE(2) }); // $40 < $50
  const { page, context } = await openStore([AUTO_50]);
  await sleep(600);
  eq(giftLines(await getCart(), 'auto50').length, 0, 'no gift yet');
  await page.click('#theme-add-coffee-xhr'); // → $60
  await until(async () => giftLines(await getCart(), 'auto50').length === 1, 6000, 'gift added after XHR write');
  await context.close();
});

test('legacy v1 offer fields still work (minSubtotal cents + giftVariantId)', async () => {
  await resetStore({ cart: COFFEE(3) });
  const legacy = { id: 'legacy', type: 'auto', minSubtotal: 5000, giftVariantId: 222 };
  const { context } = await openStore([legacy]);
  await until(async () => giftLines(await getCart(), 'legacy').length === 1, 5000, 'legacy offer adds gift');
  await context.close();
});

test('gift quantity edits are reverted (free line can\'t be multiplied)', async () => {
  await resetStore({ cart: COFFEE(3) });
  const { page, context } = await openStore([AUTO_50]);
  await until(async () => giftLines(await getCart(), 'auto50').length === 1, 5000, 'gift added');
  // Shopper bumps the FREE line to quantity 5 via the theme.
  await page.evaluate(async () => {
    const cart = await (await fetch('/cart.js')).json();
    const gift = cart.items.find((i) => i.properties._gift);
    await fetch('/cart/change.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gift.key, quantity: 5 }),
    });
  });
  await until(async () => {
    const g = giftLines(await getCart(), 'auto50');
    return g.length === 1 && g[0].quantity === 1;
  }, 5000, 'gift quantity reset to 1');
  await context.close();
});

test('orphaned gift lines from retired offers are removed', async () => {
  // Cart carries a gift from an offer id that's no longer configured.
  await resetStore({ cart: { items: [{ id: 111, quantity: 3 }, { id: 222, quantity: 1, properties: { _gift: 'old-deleted-offer' } }] } });
  const { context } = await openStore([AUTO_50]);
  await until(async () => {
    const c = await getCart();
    return giftLines(c, 'old-deleted-offer').length === 0 && giftLines(c, 'auto50').length === 1;
  }, 5000, 'orphan removed, current offer gift added');
  await context.close();
});

test('open cart drawer stays open across section refresh', async () => {
  await resetStore({ cart: COFFEE(2) }); // $40 < $50
  const { page, context } = await openStore([AUTO_50]);
  await sleep(600);
  // Shopper opens the drawer (Dawn keeps open state as classes on <cart-drawer>).
  await page.evaluate(() => document.querySelector('cart-drawer').classList.add('active', 'animate'));
  await page.click('#theme-add-coffee'); // → $60, widget adds gift + refreshes section
  await until(async () => giftLines(await getCart(), 'auto50').length === 1, 6000, 'gift added');
  await until(
    () => page.$eval('#drawer-lines', (el) => el.textContent.includes('Citrus Sample Pack')).catch(() => false),
    5000, 'drawer content refreshed'
  );
  const classes = await page.$eval('cart-drawer', (el) => el.className);
  assert(classes.includes('active'), `drawer still open after refresh, got classes: "${classes}"`);
  await context.close();
});

test('gift line does not count toward its own threshold (no oscillation)', async () => {
  // Cart exactly at threshold; gift price must not push/keep it over.
  await resetStore({ cart: { items: [{ id: 111, quantity: 3 }, { id: 222, quantity: 1, properties: { _gift: 'auto50' } }] } });
  const { page, context } = await openStore([AUTO_50]);
  await sleep(500);
  // Drop paid coffee to 2 ($40): even though gift ($8) would make $48→ still <$50 — gift must go.
  await page.evaluate(async () => {
    const cart = await (await fetch('/cart.js')).json();
    const paid = cart.items.find((i) => i.variant_id === 111 && !i.properties._gift);
    await fetch('/cart/change.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: paid.key, quantity: 2 }),
    });
  });
  await until(async () => giftLines(await getCart(), 'auto50').length === 0, 5000, 'gift removed at $40');
  await sleep(1200);
  eq(giftLines(await getCart(), 'auto50').length, 0, 'gift stays removed (no oscillation)');
  await context.close();
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    process.stdout.write(`  • ${t.name} ... `);
    try {
      await t.fn();
      passed++;
      console.log('ok');
    } catch (e) {
      failures.push({ name: t.name, error: e });
      console.log('FAIL');
      console.log(`      ${e.message}`);
    }
  }
  await browser.close();
  server.close();
  console.log(`\n${passed}/${tests.length} passed`);
  if (failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
