'use strict';

/**
 * Decides whether an order can still be self-edited, and which line items are
 * safe to change. This is the gatekeeper that mirrors Order Editing's "edit
 * window" concept: once an order is fulfilled or the window closes, edits stop.
 *
 * Every customer-facing mutation re-runs these checks server-side — the browser
 * is never trusted to decide eligibility.
 */

function orderEligibility(order, settings) {
  const reasons = [];

  if (!order) {
    return { editable: false, reasons: ['Order not found.'], closesAt: null };
  }
  if (order.cancelledAt) {
    reasons.push('This order has been cancelled.');
  }
  if (order.displayFulfillmentStatus && order.displayFulfillmentStatus !== 'UNFULFILLED') {
    reasons.push('This order is already being prepared for shipping, so it can no longer be changed.');
  }

  const createdMs = new Date(order.createdAt).getTime();
  const minutes = Number(settings && settings.editWindowMinutes);
  const windowMs = Math.max(0, Number.isFinite(minutes) ? minutes : 0) * 60 * 1000;
  const closesAt = Number.isFinite(createdMs) ? createdMs + windowMs : null;
  if (closesAt && Date.now() > closesAt) {
    reasons.push('The window for editing this order has closed.');
  }

  return { editable: reasons.length === 0, reasons, closesAt };
}

/**
 * Whether a normalized line item (see shopify.normalizeOrder) may be swapped
 * to a different variant. Subscription lines (managed by Recharge), lines
 * Shopify marks non-editable, single-variant products, and excluded-tag
 * products are all off limits.
 */
function isLineSwappable(li, settings) {
  if (!li) return false;
  if (li.isSubscription) return false;
  if (li.merchantEditable === false) return false;
  if (li.productHasOnlyDefaultVariant) return false;
  if ((li.quantity || 0) < 1) return false;
  const exclude = ((settings && settings.excludeProductTags) || []).map((t) => String(t).toLowerCase());
  if (exclude.length && (li.productTags || []).some((t) => exclude.includes(String(t).toLowerCase()))) {
    return false;
  }
  return true;
}

module.exports = { orderEligibility, isLineSwappable };
