'use strict';

/**
 * Customer-facing API for the editing portal.
 *
 * Trust model:
 *   - A request is authorised either by a signed link token (possession proves
 *     ownership) or by order-number + email (verified against Shopify). After
 *     a successful lookup the client is handed a signed session token, so
 *     follow-up calls don't re-run the order search.
 *   - Every mutating endpoint re-resolves the order and re-checks eligibility
 *     server-side. The browser is never trusted for permissions or pricing.
 *   - Mutations on the same order are serialised in-process, so a double
 *     submit (or two tabs) can't run overlapping order-edit sessions.
 */

const express = require('express');
const shopify = require('../shopify');
const tokens = require('../tokens');
const settingsStore = require('../settings');
const events = require('../events');
const { orderEligibility, isLineSwappable, quantityChangeCheck } = require('../eligibility');
const config = require('../config');

const router = express.Router();

/* --------------------------------------------------------- rate limiting */

function makeLimiter(max, windowMs, message) {
  const hits = new Map(); // ip -> { count, resetAt }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
  }, 5 * 60 * 1000);
  timer.unref();
  return function limiter(req, res, next) {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now > rec.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) {
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

// Every portal endpoint accepts order credentials, so every endpoint gets a
// limiter — otherwise /address et al. would be a brute-force side door around
// the lookup limit. Lookups get a stricter budget on top.
const apiLimiter = makeLimiter(
  Math.max(120, config.lookupRateLimit * 4),
  config.lookupRateWindowMs,
  'Too many requests. Please wait a few minutes and try again.'
);
const lookupLimiter = makeLimiter(
  config.lookupRateLimit,
  config.lookupRateWindowMs,
  'Too many attempts. Please wait a few minutes and try again.'
);

router.use(apiLimiter);

/* ------------------------------------------------------ per-order locking */

const orderLocks = new Map(); // orderGid -> tail promise

/** Serialise mutations per order so concurrent edits can't interleave. */
async function withOrderLock(orderGid, fn) {
  const prev = orderLocks.get(orderGid) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  orderLocks.set(orderGid, tail);
  try {
    return await run;
  } finally {
    if (orderLocks.get(orderGid) === tail) orderLocks.delete(orderGid);
  }
}

/* --------------------------------------------------------------- helpers */

const str = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Customer-safe error text: keep Shopify's userError phrasing, hide plumbing. */
function publicError(err, fallback) {
  let msg = String((err && err.message) || '');
  if (/Could not reach Shopify|non-JSON response|not configured/i.test(msg)) {
    return 'We could not reach the store right now — please try again in a moment.';
  }
  msg = msg.replace(/^Shopify GraphQL error:\s*/i, '');
  if (!msg || msg.length > 220) return fallback;
  return msg;
}

/** Resolve + authorise an order from request credentials. Returns {gid, raw} or null. */
async function resolveOrder(body) {
  let gid = null;
  if (body && body.token) {
    gid = tokens.verify(body.token);
  } else if (body && body.orderNumber && body.email) {
    gid = await shopify.findOrderByNumberAndEmail(str(body.orderNumber, 40), str(body.email, 120));
  }
  if (!gid) return null;
  const raw = await shopify.getOrderByGid(gid);
  return raw ? { gid, raw } : null;
}

/** Build the resolved list of upsell offers (skips unavailable / already-bought). */
async function buildUpsellOffers(settings, rawOrder) {
  try {
    const ids = (settings.upsellVariantIds || []).slice(0, 8);
    if (!ids.length) return [];
    const owned = new Set(
      (rawOrder.lineItems.edges || []).map((e) => e.node.variant && e.node.variant.id).filter(Boolean)
    );
    const discount = Number(settings.upsellDiscountPercent) || 0;
    const variants = await shopify.getVariantsByIds(ids);
    const offers = [];
    for (const v of variants) {
      if (!v || !v.availableForSale) continue;
      if (owned.has(v.id)) continue;
      if (v.product && v.product.status && v.product.status !== 'ACTIVE') continue;
      const price = Number(v.price);
      const discounted = Math.round(price * (1 - discount / 100) * 100) / 100;
      offers.push({
        variantId: v.id,
        title: v.product ? v.product.title : v.title,
        variantTitle: v.title && v.title !== 'Default Title' ? v.title : null,
        image: shopify.variantImage(v),
        price,
        discountedPrice: discounted,
        discountPercent: discount,
      });
    }
    return offers;
  } catch (err) {
    // Offers are a nice-to-have; never let them break the lookup.
    console.error('[upsell-offers]', err.message);
    return [];
  }
}

function eligibilityPermissions(elig, settings) {
  return {
    address: elig.editable && settings.allowAddressEdit !== false,
    swap: elig.editable && settings.allowVariantSwap !== false,
    upsell: elig.editable && settings.allowUpsell !== false,
    quantity: elig.editable && settings.allowQuantityEdit !== false,
    remove: elig.editable && settings.allowItemRemoval === true,
    cancel: elig.editable && settings.allowCancel === true,
  };
}

/** Whether a line's quantity may be adjusted at all (direction gates are per-permission). */
function isQtyEditable(li) {
  return Boolean(li) && !li.isSubscription && li.merchantEditable !== false && (li.quantity || 0) >= 1;
}

const fmtAmount = (n, currency) => `${currency} ${Math.abs(Number(n) || 0).toFixed(2)}`;

/* ----------------------------------------------------------------- routes */

// Look up an order and return everything the portal needs to render.
router.post('/lookup', lookupLimiter, async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) {
      return res.status(404).json({ error: "We couldn't find an order matching those details. Double-check your order number and the email you used at checkout." });
    }
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    const order = shopify.normalizeOrder(resolved.raw);
    const permissions = eligibilityPermissions(elig, settings);
    order.lineItems = order.lineItems.map((li) => ({
      ...li,
      swappable: permissions.swap && isLineSwappable(li, settings),
      qtyEditable: (permissions.quantity || permissions.remove) && isQtyEditable(li),
    }));
    const upsellOffers = permissions.upsell ? await buildUpsellOffers(settings, resolved.raw) : [];

    return res.json({
      store: config.public,
      // Ownership is proven, so hand back a signed token: follow-up calls
      // skip the Shopify order search and stay within rate limits.
      sessionToken: tokens.sign(resolved.gid),
      order,
      eligibility: { editable: elig.editable, reasons: elig.reasons, closesAt: elig.closesAt },
      permissions,
      upsell: {
        heading: settings.upsellHeading,
        subheading: settings.upsellSubheading,
        offers: upsellOffers,
      },
    });
  } catch (err) {
    console.error('[lookup]', err.message);
    return res.status(500).json({ error: 'Something went wrong looking up your order. Please try again shortly.' });
  }
});

// Variants available to swap a given line item to (same product).
router.post('/swap-options', async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) return res.status(404).json({ error: 'Order not found.' });
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    if (!elig.editable || settings.allowVariantSwap === false) {
      return res.status(403).json({ error: 'Swapping items is not available for this order.' });
    }
    const order = shopify.normalizeOrder(resolved.raw);
    const li = order.lineItems.find((x) => x.id === str(req.body.lineItemId, 100));
    if (!li || !isLineSwappable(li, settings) || !li.productId) {
      return res.status(400).json({ error: 'That item cannot be changed.' });
    }
    const product = await shopify.getProductVariants(li.productId);
    const allowPriced = settings.allowPricedSwaps === true;
    const tolerance = Number(settings.swapPriceTolerance) || 0;
    const options = product.variants
      .filter((v) => v.id !== li.variantId)
      .filter((v) => v.availableForSale)
      .filter((v) => allowPriced || Number(v.price) <= li.unitPrice + tolerance)
      .map((v) => ({
        variantId: v.id,
        title: v.title,
        price: Number(v.price),
        options: v.selectedOptions,
      }));
    return res.json({ lineItemId: li.id, currency: order.currency, current: { variantId: li.variantId, price: li.unitPrice }, options });
  } catch (err) {
    console.error('[swap-options]', err.message);
    return res.status(500).json({ error: 'Could not load alternatives for that item.' });
  }
});

// Update the shipping address.
router.post('/address', async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) return res.status(404).json({ error: 'Order not found.' });
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    if (!elig.editable || settings.allowAddressEdit === false) {
      return res.status(403).json({ error: 'This order can no longer be changed.' });
    }
    const a = req.body.address || {};
    const address = {
      firstName: str(a.firstName, 80),
      lastName: str(a.lastName, 80),
      address1: str(a.address1, 200),
      address2: str(a.address2, 200),
      city: str(a.city, 120),
      province: str(a.province, 120),
      zip: str(a.zip, 30),
      country: str(a.country, 120),
      phone: str(a.phone, 40),
      company: str(a.company, 120),
    };

    // Shipping was priced for the original destination country, so
    // self-service corrections stay within it. (If the order somehow has no
    // address yet, accept what was submitted.)
    const existing = resolved.raw.shippingAddress || {};
    if (existing.country) address.country = existing.country;

    if (!address.firstName || !address.lastName || !address.address1 || !address.city || !address.country) {
      return res.status(400).json({ error: 'Please fill in first name, last name, address, city and country.' });
    }
    if (existing.zip && !address.zip) {
      return res.status(400).json({ error: 'Please include your postcode.' });
    }
    // Drop empties so we don't overwrite good values with blanks.
    Object.keys(address).forEach((k) => { if (!address[k]) delete address[k]; });

    await withOrderLock(resolved.gid, () => shopify.updateShippingAddress(resolved.gid, address));
    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    events.record('address', { orderName: fresh.name });
    return res.json({ ok: true, message: 'Your shipping address has been updated.', order: fresh });
  } catch (err) {
    console.error('[address]', err.message);
    return res.status(400).json({ error: `We couldn't update the address: ${publicError(err, 'please double-check the details and try again.')}` });
  }
});

// Swap a line item to a different variant of the same product.
router.post('/swap', async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) return res.status(404).json({ error: 'Order not found.' });
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    if (!elig.editable || settings.allowVariantSwap === false) {
      return res.status(403).json({ error: 'Swapping items is not available for this order.' });
    }
    const order = shopify.normalizeOrder(resolved.raw);
    const lineItemId = str(req.body.lineItemId, 100);
    const newVariantId = str(req.body.newVariantId, 100);
    const li = order.lineItems.find((x) => x.id === lineItemId);
    if (!li || !isLineSwappable(li, settings)) {
      return res.status(400).json({ error: 'That item cannot be changed.' });
    }
    const newVariant = await shopify.getVariant(newVariantId);
    if (!newVariant || !newVariant.availableForSale) {
      return res.status(400).json({ error: 'That option is no longer available.' });
    }
    if (!newVariant.product || newVariant.product.id !== li.productId) {
      return res.status(400).json({ error: 'You can only switch to another option of the same product.' });
    }
    if (settings.allowPricedSwaps !== true) {
      const tolerance = Number(settings.swapPriceTolerance) || 0;
      if (Number(newVariant.price) > li.unitPrice + tolerance) {
        return res.status(400).json({ error: 'That option costs more than your current item, so it can’t be swapped in self-service. Please contact us and we’ll help.' });
      }
    }

    // Carry the customer's effective discount over to the replacement line —
    // edit-added items never inherit the original order's discounts.
    const preserveDiscountPercent = shopify.effectiveDiscountPercent(li.unitPrice, li.paidUnitPrice);

    const result = await withOrderLock(resolved.gid, () => shopify.swapVariant(resolved.gid, {
      originalLineItemId: li.id,
      originalVariantId: li.variantId,
      newVariantId,
      quantity: li.quantity,
      preserveDiscountPercent,
      notifyCustomer: settings.notifyCustomerOnEdit !== false,
      staffNote: `Self-service swap: ${li.title} ${li.variantTitle || ''} → ${newVariant.title}`.trim(),
      invoice: settings.invoiceForBalance !== false,
      invoiceEmail: resolved.raw.email,
      orderName: order.name,
    }));

    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    events.record('swap', { orderName: fresh.name, value: result.outstanding });
    let message = 'Your item has been updated.';
    if (result.outstanding > 0) {
      message = result.invoiced
        ? `Your item has been updated. We’ve emailed you a secure link to pay the ${fmtAmount(result.outstanding, fresh.currency)} difference.`
        : `Your item has been updated. There’s a ${fmtAmount(result.outstanding, fresh.currency)} difference — we’ll be in touch about payment.`;
    } else if (result.outstanding < 0) {
      message = `Your item has been updated. We owe you ${fmtAmount(result.outstanding, fresh.currency)} — we’ll refund the difference to your original payment method.`;
    }
    return res.json({ ok: true, message, outstanding: result.outstanding, order: fresh });
  } catch (err) {
    console.error('[swap]', err.message);
    return res.status(400).json({ error: `We couldn't change that item: ${publicError(err, 'please try again or contact us.')}` });
  }
});

// Add a configured upsell item to the order.
router.post('/upsell', async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) return res.status(404).json({ error: 'Order not found.' });
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    if (!elig.editable || settings.allowUpsell === false) {
      return res.status(403).json({ error: 'Adding items is not available for this order.' });
    }
    const variantId = str(req.body.variantId, 100);
    const quantity = Math.max(1, Math.min(10, parseInt(req.body.quantity, 10) || 1));
    if (!(settings.upsellVariantIds || []).includes(variantId)) {
      return res.status(400).json({ error: 'That offer is not available.' });
    }
    const variant = await shopify.getVariant(variantId);
    if (!variant || !variant.availableForSale) {
      return res.status(400).json({ error: 'That offer is sold out.' });
    }

    const willInvoice = settings.invoiceForBalance !== false;
    const order = shopify.normalizeOrder(resolved.raw);
    const result = await withOrderLock(resolved.gid, () => shopify.addUpsellItem(resolved.gid, {
      variantId,
      quantity,
      discountPercent: Number(settings.upsellDiscountPercent) || 0,
      invoice: willInvoice,
      invoiceEmail: resolved.raw.email,
      // The invoice email is the customer-facing notice when invoicing;
      // otherwise fall back to Shopify's order-updated email.
      notifyCustomer: !willInvoice && settings.notifyCustomerOnEdit !== false,
      staffNote: `Self-service upsell: +${quantity}× ${variant.title}`,
      orderName: order.name,
    }));

    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    events.record('upsell', { orderName: fresh.name, value: result.outstanding, qty: quantity });
    let message = 'Added to your order!';
    if (result.invoiced) {
      message = `Added! We’ve emailed you a secure link to pay the ${fmtAmount(result.outstanding, fresh.currency)} balance — once paid, it ships with your order.`;
    } else if (result.outstanding > 0) {
      message = `Added! There’s a ${fmtAmount(result.outstanding, fresh.currency)} balance — we’ll be in touch about payment.`;
    }
    return res.json({ ok: true, message, outstanding: result.outstanding, order: fresh });
  } catch (err) {
    console.error('[upsell]', err.message);
    return res.status(400).json({ error: `We couldn't add that item: ${publicError(err, 'please try again or contact us.')}` });
  }
});

// Change the quantity of a line item (0 removes it).
router.post('/quantity', async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) return res.status(404).json({ error: 'Order not found.' });
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    if (!elig.editable) {
      return res.status(403).json({ error: 'This order can no longer be changed.' });
    }
    const order = shopify.normalizeOrder(resolved.raw);
    const lineItemId = str(req.body.lineItemId, 100);
    const newQuantity = parseInt(req.body.quantity, 10);
    const li = order.lineItems.find((x) => x.id === lineItemId);

    const check = quantityChangeCheck(li, newQuantity, settings);
    if (!check.ok) return res.status(400).json({ error: check.reason });

    if (newQuantity === 0) {
      const others = order.lineItems.filter((x) => x.id !== li.id && (x.quantity || 0) > 0);
      if (others.length === 0) {
        return res.status(400).json({
          error: settings.allowCancel === true
            ? 'That’s the last item on the order — use “Cancel this order” below instead.'
            : 'That’s the last item on the order — contact us and we’ll sort it out.',
        });
      }
    }

    const delta = newQuantity - li.quantity;
    const result = await withOrderLock(resolved.gid, () => shopify.changeQuantity(resolved.gid, {
      originalLineItemId: li.id,
      originalVariantId: li.variantId,
      newQuantity,
      notifyCustomer: settings.notifyCustomerOnEdit !== false,
      staffNote: `Self-service quantity change: ${li.title} ${li.variantTitle || ''} ${li.quantity} → ${newQuantity}`.trim(),
      invoice: settings.invoiceForBalance !== false,
      invoiceEmail: resolved.raw.email,
      orderName: order.name,
    }));

    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    events.record('quantity', { orderName: fresh.name, value: result.outstanding, delta });
    let message = newQuantity === 0 ? 'Item removed from your order.' : 'Quantity updated.';
    if (result.outstanding > 0) {
      message += result.invoiced
        ? ` We’ve emailed you a secure link to pay the ${fmtAmount(result.outstanding, fresh.currency)} difference.`
        : ` There’s a ${fmtAmount(result.outstanding, fresh.currency)} difference — we’ll be in touch about payment.`;
    } else if (result.outstanding < 0) {
      message += ` We owe you ${fmtAmount(result.outstanding, fresh.currency)} — we’ll refund the difference to your original payment method.`;
    }
    return res.json({ ok: true, message, outstanding: result.outstanding, order: fresh });
  } catch (err) {
    console.error('[quantity]', err.message);
    return res.status(400).json({ error: `We couldn't update that quantity: ${publicError(err, 'please try again or contact us.')}` });
  }
});

// Cancel the whole order (merchant opt-in; full refund to original payment).
router.post('/cancel', async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) return res.status(404).json({ error: 'Order not found.' });
    const settings = settingsStore.load();
    if (settings.allowCancel !== true) {
      return res.status(403).json({ error: 'Self-service cancellation is not available. Please contact us.' });
    }
    const elig = orderEligibility(resolved.raw, settings);
    if (!elig.editable) {
      return res.status(403).json({ error: 'This order can no longer be cancelled here. Please contact us.' });
    }
    const order = shopify.normalizeOrder(resolved.raw);

    await withOrderLock(resolved.gid, () => shopify.cancelOrder(resolved.gid, {
      staffNote: 'Self-service cancellation via order editor',
      notifyCustomer: true,
    }));

    events.record('cancel', { orderName: order.name, value: order.total });
    const paidSomething = order.financialStatus && order.financialStatus !== 'PENDING';
    const message = paidSomething
      ? `Your order ${order.name} has been cancelled. Your payment will be refunded to your original payment method — this usually takes a few business days.`
      : `Your order ${order.name} has been cancelled.`;
    return res.json({ ok: true, cancelled: true, message });
  } catch (err) {
    console.error('[cancel]', err.message);
    return res.status(400).json({ error: `We couldn't cancel the order: ${publicError(err, 'please contact us and we’ll take care of it.')}` });
  }
});

module.exports = router;
