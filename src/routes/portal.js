'use strict';

/**
 * Customer-facing API for the editing portal.
 *
 * Trust model:
 *   - A request is authorised either by a signed link token (possession proves
 *     ownership) or by order-number + email (verified against Shopify).
 *   - Every mutating endpoint re-resolves the order and re-checks eligibility
 *     server-side. The browser is never trusted for permissions or pricing.
 */

const express = require('express');
const shopify = require('../shopify');
const tokens = require('../tokens');
const settingsStore = require('../settings');
const { orderEligibility } = require('../eligibility');
const config = require('../config');

const router = express.Router();

/* --------------------------------------------------------- rate limiting */

const hits = new Map(); // ip -> { count, resetAt }

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + config.lookupRateWindowMs });
    return next();
  }
  rec.count += 1;
  if (rec.count > config.lookupRateLimit) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  return next();
}

// Opportunistically drop expired rate-limit records so the map can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
}, 5 * 60 * 1000).unref();

/* --------------------------------------------------------------- helpers */

const str = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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

function isSwappable(li, settings) {
  if (li.isSubscription) return false;
  if (li.merchantEditable === false) return false;
  if (li.productHasOnlyDefaultVariant) return false;
  if ((li.quantity || 0) < 1) return false;
  const exclude = (settings.excludeProductTags || []).map((t) => String(t).toLowerCase());
  if (exclude.length && (li.productTags || []).some((t) => exclude.includes(String(t).toLowerCase()))) return false;
  return true;
}

/** Build the resolved list of upsell offers (skips out-of-stock / already-bought). */
async function buildUpsellOffers(settings, order) {
  const ids = (settings.upsellVariantIds || []).slice(0, 8);
  if (!ids.length) return [];
  const owned = new Set((order.lineItems.edges || []).map((e) => e.node.variant && e.node.variant.id).filter(Boolean));
  const discount = Number(settings.upsellDiscountPercent) || 0;
  const variants = await Promise.all(
    ids.map((id) => shopify.getVariant(id).catch(() => null))
  );
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
      image: v.image ? v.image.url : null,
      price,
      discountedPrice: discounted,
      discountPercent: discount,
    });
  }
  return offers;
}

function eligibilityPermissions(elig, settings) {
  return {
    address: elig.editable && settings.allowAddressEdit !== false,
    swap: elig.editable && settings.allowVariantSwap !== false,
    upsell: elig.editable && settings.allowUpsell !== false,
  };
}

/* ----------------------------------------------------------------- routes */

// Look up an order and return everything the portal needs to render.
router.post('/lookup', rateLimit, async (req, res) => {
  try {
    const resolved = await resolveOrder(req.body);
    if (!resolved) {
      return res.status(404).json({ error: "We couldn't find an order matching those details. Double-check your order number and the email you used at checkout." });
    }
    const settings = settingsStore.load();
    const elig = orderEligibility(resolved.raw, settings);
    const order = shopify.normalizeOrder(resolved.raw);
    order.lineItems = order.lineItems.map((li) => ({ ...li, swappable: elig.editable && settings.allowVariantSwap !== false && isSwappable(li, settings) }));

    const permissions = eligibilityPermissions(elig, settings);
    const upsellOffers = permissions.upsell ? await buildUpsellOffers(settings, resolved.raw) : [];

    return res.json({
      store: config.public,
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
    if (!li || !isSwappable(li, settings) || !li.productId) {
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
    if (!address.firstName || !address.lastName || !address.address1 || !address.city || !address.country) {
      return res.status(400).json({ error: 'Please fill in first name, last name, address, city and country.' });
    }
    // Drop empties so we don't overwrite good values with blanks.
    Object.keys(address).forEach((k) => { if (!address[k]) delete address[k]; });

    await shopify.updateShippingAddress(resolved.gid, address);
    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    return res.json({ ok: true, message: 'Your shipping address has been updated.', order: fresh });
  } catch (err) {
    console.error('[address]', err.message);
    return res.status(400).json({ error: `We couldn't update the address: ${err.message}` });
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
    if (!li || !isSwappable(li, settings)) {
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
    await shopify.swapVariant(resolved.gid, {
      originalLineItemId: li.id,
      originalVariantId: li.variantId,
      newVariantId,
      quantity: li.quantity,
      notifyCustomer: settings.notifyCustomerOnEdit !== false,
      staffNote: `Self-service swap: ${li.title} ${li.variantTitle || ''} → ${newVariant.title}`.trim(),
    });
    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    return res.json({ ok: true, message: 'Your item has been updated.', order: fresh });
  } catch (err) {
    console.error('[swap]', err.message);
    return res.status(400).json({ error: `We couldn't change that item: ${err.message}` });
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
    const result = await shopify.addUpsellItem(resolved.gid, {
      variantId,
      quantity,
      discountPercent: Number(settings.upsellDiscountPercent) || 0,
      invoice: settings.invoiceForBalance !== false,
      invoiceEmail: resolved.raw.email,
      notifyCustomer: false, // the invoice email is the customer-facing notice
      staffNote: `Self-service upsell: +${quantity}× ${variant.title}`,
    });
    const fresh = shopify.normalizeOrder(await shopify.getOrderByGid(resolved.gid));
    const message = result.invoiced
      ? `Added! We’ve emailed you a secure link to pay the ${fresh.currency} balance — once paid, it ships with your order.`
      : 'Added to your order!';
    return res.json({ ok: true, message, outstanding: result.outstanding, order: fresh });
  } catch (err) {
    console.error('[upsell]', err.message);
    return res.status(400).json({ error: `We couldn't add that item: ${err.message}` });
  }
});

module.exports = router;
