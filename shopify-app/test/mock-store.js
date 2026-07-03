/*
 * Mock Shopify storefront for testing the gift-offers widget headlessly.
 *
 * Implements the subset of Shopify's AJAX API the widget touches:
 *   GET  /cart.js
 *   POST /cart/add.js          (JSON body, items[] with properties)
 *   POST /cart/change.js       ({ id: <line key>, quantity })
 *   POST /cart/update.js
 *   POST /cart/clear.js
 *   GET  /products/<handle>.js
 *   GET  /?sections=a,b        (Section Rendering API)
 *
 * Plus test hooks:
 *   POST /__test/reset         ({ cart?, products? } — resets state)
 *   GET  /__test/state         (raw internal state)
 *
 * The storefront page (GET /) mimics a theme: a cart drawer section
 * (#shopify-section-cart-drawer), a cart count bubble, and "theme" add-to-cart
 * buttons that write to the cart the way a real theme would (fetch + XHR).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'extensions', 'gift-offers', 'assets');

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
const DEFAULT_PRODUCTS = {
  'ground-coffee': {
    id: 1001, title: 'Ground Coffee', handle: 'ground-coffee',
    variants: [{ id: 111, title: 'Default', price: 2000, available: true }],
    images: ['/img/coffee.png'], featured_image: '/img/coffee.png',
  },
  'sample-pack-citrus': {
    id: 1002, title: 'Citrus Sample Pack', handle: 'sample-pack-citrus',
    variants: [{ id: 222, title: 'Default', price: 800, available: true }],
    images: ['/img/citrus.png'], featured_image: '/img/citrus.png',
  },
  'sample-pack-berry': {
    id: 1003, title: 'Berry Sample Pack', handle: 'sample-pack-berry',
    variants: [{ id: 333, title: 'Default', price: 800, available: true }],
    images: ['/img/berry.png'], featured_image: '/img/berry.png',
  },
  'mini-tote': {
    id: 1004, title: 'Mini Tote Bag', handle: 'mini-tote',
    variants: [
      { id: 444, title: 'Natural', price: 1200, available: false },
      { id: 445, title: 'Black', price: 1200, available: true },
    ],
    images: ['/img/tote.png'], featured_image: '/img/tote.png',
  },
  'out-of-stock-gift': {
    id: 1005, title: 'Sold Out Gift', handle: 'out-of-stock-gift',
    variants: [{ id: 555, title: 'Default', price: 500, available: false }],
    images: [], featured_image: null,
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let products;
let cart;
let lineSeq;
let requestLog;

function reset(initial) {
  products = JSON.parse(JSON.stringify((initial && initial.products) || DEFAULT_PRODUCTS));
  cart = { items: [] };
  lineSeq = 0;
  requestLog = [];
  ((initial && initial.cart && initial.cart.items) || []).forEach((item) => {
    addItem(item.id, item.quantity || 1, item.properties || {});
  });
}

function findVariant(variantId) {
  for (const handle of Object.keys(products)) {
    const p = products[handle];
    const v = p.variants.find((v) => v.id === Number(variantId));
    if (v) return { product: p, variant: v };
  }
  return null;
}

function addItem(variantId, quantity, properties) {
  const hit = findVariant(variantId);
  if (!hit) return { error: 404, description: 'Cannot find variant' };
  if (!hit.variant.available) {
    return { error: 422, description: `The product '${hit.product.title}' is already sold out.` };
  }
  // Shopify merges lines with identical variant + properties.
  const propsKey = JSON.stringify(properties || {});
  const existing = cart.items.find(
    (i) => i.variant_id === hit.variant.id && JSON.stringify(i.properties || {}) === propsKey
  );
  if (existing) {
    existing.quantity += quantity;
    return { item: existing };
  }
  lineSeq += 1;
  const item = {
    key: `${hit.variant.id}:mock${lineSeq}`,
    id: hit.variant.id,
    variant_id: hit.variant.id,
    product_id: hit.product.id,
    handle: hit.product.handle,
    title: hit.product.title,
    quantity,
    properties: properties || {},
    price: hit.variant.price,
  };
  cart.items.push(item);
  return { item };
}

function cartJson() {
  let total = 0;
  const items = cart.items.map((i) => {
    const linePrice = i.price * i.quantity;
    total += linePrice;
    return {
      key: i.key,
      id: i.id,
      variant_id: i.variant_id,
      product_id: i.product_id,
      handle: i.handle,
      title: i.title,
      quantity: i.quantity,
      properties: i.properties,
      price: i.price,
      line_price: linePrice,
      final_line_price: linePrice, // mock: no line-level discounts
    };
  });
  return {
    token: 'mock-token',
    currency: 'USD',
    items_subtotal_price: total,
    total_price: total,
    item_count: items.reduce((s, i) => s + i.quantity, 0),
    items,
  };
}

// ---------------------------------------------------------------------------
// Section rendering (mimics a theme's cart drawer + count bubble)
// ---------------------------------------------------------------------------
function renderCartDrawerSection() {
  const c = cartJson();
  const lines = c.items
    .map(
      (i) =>
        `<li class="drawer-line" data-key="${i.key}" data-variant="${i.variant_id}">` +
        `${i.title} × ${i.quantity}</li>`
    )
    .join('');
  // <cart-drawer> mimics Dawn: open state lives in classes on this element,
  // and a freshly rendered section always comes back "closed" (no class).
  return (
    `<div id="shopify-section-cart-drawer" class="shopify-section">` +
    `<cart-drawer><div class="drawer" data-rendered-at="${lineSeq}">` +
    `<span id="drawer-count" data-count="${c.item_count}">${c.item_count} items</span>` +
    `<ul id="drawer-lines">${lines}</ul>` +
    `</div></cart-drawer></div>`
  );
}

// Dawn-style header count badge: a bare #cart-icon-bubble element whose
// content is refreshed from the "cart-icon-bubble" section.
function renderCartIconBubbleContent() {
  return `<span class="bubble-count" data-count="${cartJson().item_count}">${cartJson().item_count}</span>`;
}

function renderSections(ids) {
  const out = {};
  ids.forEach((id) => {
    if (id === 'cart-drawer') out[id] = renderCartDrawerSection();
    else if (id === 'cart-icon-bubble') out[id] = `<div class="shopify-section">${renderCartIconBubbleContent()}</div>`;
    else out[id] = `<div id="shopify-section-${id}" class="shopify-section"></div>`;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Storefront page
// ---------------------------------------------------------------------------
function storefrontPage(query) {
  // Widget config comes in via ?config=<encoded JSON> so each test controls it.
  const config = query.get('config') || '{}';
  const shopifyGlobals = query.get('designMode') === '1'
    ? `{ designMode: true, routes: { root: '/' }, currency: { active: 'USD' } }`
    : `{ routes: { root: '/' }, currency: { active: 'USD' } }`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mock Store</title>
<link rel="stylesheet" href="/assets/gift-offers.css">
</head>
<body>
<h1>Mock Store</h1>

<button id="theme-add-coffee">Add coffee (theme fetch)</button>
<button id="theme-add-coffee-xhr">Add coffee (theme XHR)</button>
<button id="theme-clear">Clear cart</button>

<div id="cart-icon-bubble">${renderCartIconBubbleContent()}</div>

${renderCartDrawerSection()}

<script>
  window.Shopify = ${shopifyGlobals};
  window.GroundedGiftOffers = Object.assign({
    moneyFormat: '\${{amount}}',
    currency: 'USD',
    debug: true
  }, JSON.parse(decodeURIComponent('${encodeURIComponent(config).replace(/'/g, "%27")}')));

  // "Theme" behaviour: add to cart with fetch or XHR, like real themes do.
  document.getElementById('theme-add-coffee').addEventListener('click', function () {
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 111, quantity: 1 }] })
    });
  });
  document.getElementById('theme-add-coffee-xhr').addEventListener('click', function () {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/cart/add.js');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ items: [{ id: 111, quantity: 1 }] }));
  });
  document.getElementById('theme-clear').addEventListener('click', function () {
    fetch('/cart/clear.js', { method: 'POST' });
  });
</script>
<script src="/assets/gift-offers.js" defer></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
  });
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

reset();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  requestLog.push({ method: req.method, path: pathname + url.search });

  // Section Rendering API (any route + ?sections=)
  if (req.method === 'GET' && url.searchParams.get('sections')) {
    const ids = url.searchParams.get('sections').split(',').map((s) => s.trim()).filter(Boolean);
    return send(res, 200, renderSections(ids));
  }

  if (req.method === 'GET' && pathname === '/') {
    return send(res, 200, storefrontPage(url.searchParams), 'text/html');
  }

  if (req.method === 'GET' && pathname === '/cart.js') {
    return send(res, 200, cartJson());
  }

  if (req.method === 'POST' && pathname === '/cart/add.js') {
    const body = await readBody(req);
    const items = body.items || [{ id: body.id, quantity: body.quantity, properties: body.properties }];
    const added = [];
    for (const it of items) {
      const result = addItem(it.id, it.quantity || 1, it.properties || {});
      if (result.error) {
        return send(res, result.error, { status: result.error, message: 'Cart Error', description: result.description });
      }
      added.push(result.item);
    }
    const response = { items: added };
    // Shopify supports bundled section rendering on cart mutations.
    if (body.sections) {
      const ids = String(body.sections).split(',').map((s) => s.trim());
      response.sections = renderSections(ids);
    }
    return send(res, 200, response);
  }

  if (req.method === 'POST' && pathname === '/cart/change.js') {
    const body = await readBody(req);
    const idx = cart.items.findIndex((i) => i.key === body.id || String(i.id) === String(body.id));
    if (idx !== -1) {
      if (body.quantity === 0) cart.items.splice(idx, 1);
      else cart.items[idx].quantity = body.quantity;
    }
    const response = cartJson();
    if (body.sections) {
      const ids = String(body.sections).split(',').map((s) => s.trim());
      response.sections = renderSections(ids);
    }
    return send(res, 200, response);
  }

  if (req.method === 'POST' && pathname === '/cart/update.js') {
    const body = await readBody(req);
    Object.keys(body.updates || {}).forEach((variantId) => {
      const item = cart.items.find((i) => String(i.id) === String(variantId));
      if (item) item.quantity = body.updates[variantId];
    });
    cart.items = cart.items.filter((i) => i.quantity > 0);
    return send(res, 200, cartJson());
  }

  if (req.method === 'POST' && pathname === '/cart/clear.js') {
    cart.items = [];
    return send(res, 200, cartJson());
  }

  const productMatch = pathname.match(/^\/products\/([a-z0-9-]+)\.js$/);
  if (req.method === 'GET' && productMatch) {
    const p = products[productMatch[1]];
    if (!p) return send(res, 404, { status: 404 });
    return send(res, 200, p);
  }

  // Test hooks
  if (req.method === 'POST' && pathname === '/__test/reset') {
    reset(await readBody(req));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && pathname === '/__test/state') {
    return send(res, 200, { cart: cartJson(), requestLog });
  }

  // Widget assets
  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    const file = path.join(ASSETS_DIR, path.basename(pathname));
    if (fs.existsSync(file)) {
      const type = file.endsWith('.css') ? 'text/css' : 'application/javascript';
      return send(res, 200, fs.readFileSync(file, 'utf8'), type);
    }
  }

  // Images: 1x1 gif so <img> tags don't 404 noisily
  if (req.method === 'GET' && pathname.startsWith('/img/')) {
    res.writeHead(200, { 'Content-Type': 'image/gif' });
    return res.end(Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64'));
  }

  send(res, 404, { status: 404 });
});

const PORT = process.env.MOCK_STORE_PORT || 4477;
server.listen(PORT, () => {
  if (require.main === module) console.log(`Mock store on http://localhost:${PORT}`);
});

module.exports = { server, reset };
