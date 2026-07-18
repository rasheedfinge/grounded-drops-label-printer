'use strict';

/**
 * Thin Shopify Admin GraphQL client plus every order operation the portal needs.
 *
 * All GraphQL shapes were checked against the live Admin schema (introspection
 * + shopify.dev docs), and the read queries were executed against the real
 * store. The order-editing flow follows Shopify's three steps:
 * orderEditBegin -> stage changes -> orderEditCommit.
 */

const config = require('./config');

function endpoint() {
  return `https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a GraphQL operation. Read queries get a short retry on throttling /
 * gateway blips; mutations never auto-retry (a duplicated order-edit commit
 * would be worse than a failed one).
 */
async function gql(query, variables = {}, attempt = 0) {
  if (!config.shop || !config.adminToken) {
    throw new Error('Shopify is not configured (set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN).');
  }
  const isMutation = /^\s*mutation/i.test(query);
  const retryable = !isMutation && attempt < 2;

  let res;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.adminToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (retryable) {
      await sleep(400 * (attempt + 1));
      return gql(query, variables, attempt + 1);
    }
    throw new Error(`Could not reach Shopify: ${err.message}`);
  }

  if ((res.status === 429 || res.status === 502 || res.status === 503) && retryable) {
    await sleep(600 * (attempt + 1));
    return gql(query, variables, attempt + 1);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Shopify returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (body.errors) {
    const throttled = Array.isArray(body.errors) &&
      body.errors.some((e) => e.extensions && e.extensions.code === 'THROTTLED');
    if (throttled && retryable) {
      await sleep(1000 * (attempt + 1));
      return gql(query, variables, attempt + 1);
    }
    const msg = Array.isArray(body.errors) ? body.errors.map((e) => e.message).join('; ') : JSON.stringify(body.errors);
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  return body.data;
}

/* ----------------------------------------------------------- pure helpers */

/** Last run of digits in a GID, e.g. gid://shopify/LineItem/123 -> "123". */
const numericId = (gid) => {
  const groups = String(gid || '').match(/\d+/g);
  return groups ? groups[groups.length - 1] : '';
};

const digitsOf = (s) => (String(s || '').match(/\d/g) || []).join('');

const money = (set) => (set && set.presentmentMoney ? Number(set.presentmentMoney.amount) : null);

/**
 * The discount (as a percentage) a customer effectively received on a line,
 * derived from what they paid per unit vs the undiscounted unit price.
 * Used to carry their pricing over to a replacement line during a swap,
 * because order-edit-added items never inherit the original discounts.
 */
function effectiveDiscountPercent(originalUnit, paidUnit) {
  const orig = Number(originalUnit);
  const paid = Number(paidUnit);
  if (!Number.isFinite(orig) || orig <= 0) return 0;
  if (!Number.isFinite(paid) || paid >= orig) return 0;
  const pct = (1 - paid / orig) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
}

/* ------------------------------------------------------------------ reads */

async function getShopInfo() {
  const data = await gql(`{ shop { name myshopifyDomain currencyCode } }`);
  return data.shop;
}

const ORDER_FIELDS = `
  id name email createdAt cancelledAt edited confirmationNumber
  displayFulfillmentStatus displayFinancialStatus
  totalPriceSet { presentmentMoney { amount currencyCode } }
  totalOutstandingSet { presentmentMoney { amount currencyCode } }
  shippingAddress {
    firstName lastName address1 address2 city province provinceCode
    zip country countryCodeV2 phone company
  }
  lineItems(first: 50) { edges { node {
    id name title variantTitle quantity currentQuantity unfulfilledQuantity
    restockable merchantEditable sku
    image { url altText }
    sellingPlan { name }
    originalUnitPriceSet { presentmentMoney { amount currencyCode } }
    discountedUnitPriceAfterAllDiscountsSet { presentmentMoney { amount currencyCode } }
    variant { id title price availableForSale selectedOptions { name value } }
    product { id title handle hasOnlyDefaultVariant totalVariants status tags }
  } } }
`;

async function getOrderByGid(orderGid) {
  const data = await gql(`query OrderForEdit($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: orderGid });
  return data.order;
}

/**
 * Find an order that belongs to `email` and matches the entered order number.
 * Searching by email (not by order name) means we never surface another
 * customer's order, even if someone guesses an order number.
 */
async function findOrderByNumberAndEmail(orderNumber, email) {
  const wanted = digitsOf(orderNumber);
  if (!wanted || !email) return null;
  const data = await gql(
    `query($q: String!) {
      orders(first: 30, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node { id name email } }
      }
    }`,
    { q: `email:${JSON.stringify(email)}` }
  );
  const edges = (data.orders && data.orders.edges) || [];
  const match = edges
    .map((e) => e.node)
    .find((o) => digitsOf(o.name) === wanted && (o.email || '').toLowerCase() === email.toLowerCase());
  return match ? match.id : null;
}

/** Fetch every variant of a product (for the swap picker), capped for safety. */
async function getProductVariants(productGid, cap = 250) {
  const out = [];
  let after = null;
  let product = null;
  do {
    const data = await gql(
      `query($id: ID!, $after: String) {
        product(id: $id) {
          id title status
          variants(first: 100, after: $after) {
            edges { node { id title availableForSale price selectedOptions { name value } } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: productGid, after }
    );
    product = data.product;
    if (!product) break;
    const conn = product.variants;
    out.push(...conn.edges.map((e) => e.node));
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after && out.length < cap);
  return { id: product && product.id, title: product && product.title, variants: out.slice(0, cap) };
}

const VARIANT_FIELDS = `
  id title price availableForSale
  image { url altText }
  selectedOptions { name value }
  product {
    id title status
    featuredMedia { preview { image { url } } }
  }
`;

/** The best display image for a variant: its own image, else the product's. */
function variantImage(v) {
  if (!v) return null;
  if (v.image && v.image.url) return v.image.url;
  const fm = v.product && v.product.featuredMedia;
  return (fm && fm.preview && fm.preview.image && fm.preview.image.url) || null;
}

async function getVariant(variantGid) {
  const data = await gql(
    `query($id: ID!) { productVariant(id: $id) { ${VARIANT_FIELDS} } }`,
    { id: variantGid }
  );
  return data.productVariant;
}

/** Batch-fetch variants by GID in one round trip (order preserved, nulls kept). */
async function getVariantsByIds(variantGids) {
  if (!variantGids || !variantGids.length) return [];
  const data = await gql(
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { ${VARIANT_FIELDS} } } }`,
    { ids: variantGids }
  );
  // nodes() yields null for missing ids and {} for non-variant nodes.
  return (data.nodes || []).map((n) => (n && n.id ? n : null));
}

/* --------------------------------------------------------------- normalize */

/** Reshape a raw order into the minimal, safe payload the browser receives. */
function normalizeOrder(order) {
  const currency =
    (order.totalPriceSet && order.totalPriceSet.presentmentMoney && order.totalPriceSet.presentmentMoney.currencyCode) ||
    'AUD';
  const lineItems = (order.lineItems.edges || []).map((e) => {
    const li = e.node;
    const unitPrice = money(li.originalUnitPriceSet);
    const paidUnitPrice = money(li.discountedUnitPriceAfterAllDiscountsSet);
    return {
      id: li.id,
      title: li.title,
      variantTitle: li.variantTitle,
      quantity: li.currentQuantity ?? li.quantity,
      image: li.image ? li.image.url : null,
      unitPrice,
      paidUnitPrice: paidUnitPrice != null ? paidUnitPrice : unitPrice,
      isSubscription: Boolean(li.sellingPlan),
      variantId: li.variant ? li.variant.id : null,
      productId: li.product ? li.product.id : null,
      productHasOnlyDefaultVariant: li.product ? li.product.hasOnlyDefaultVariant : true,
      productTags: li.product ? li.product.tags : [],
      merchantEditable: li.merchantEditable,
    };
  });
  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    currency,
    total: money(order.totalPriceSet),
    outstanding: money(order.totalOutstandingSet) || 0,
    shippingAddress: order.shippingAddress || null,
    lineItems,
  };
}

/* ------------------------------------------------------------------ writes */

async function updateShippingAddress(orderGid, address) {
  const data = await gql(
    `mutation($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id shippingAddress { firstName lastName address1 address2 city province zip country phone company } }
        userErrors { field message }
      }
    }`,
    { input: { id: orderGid, shippingAddress: address } }
  );
  const errs = data.orderUpdate.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return data.orderUpdate.order;
}

async function beginEdit(orderGid) {
  const data = await gql(
    `mutation($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder {
          id
          lineItems(first: 100) { edges { node { id quantity editableQuantity variant { id } } } }
        }
        userErrors { field message }
      }
    }`,
    { id: orderGid }
  );
  const { calculatedOrder, userErrors } = data.orderEditBegin;
  if (userErrors && userErrors.length) throw new Error(userErrors.map((e) => e.message).join('; '));
  return calculatedOrder;
}

async function editSetQuantity(calcOrderId, calcLineItemId, quantity, restock) {
  const data = await gql(
    `mutation($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
      orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
        calculatedOrder { id }
        userErrors { field message }
      }
    }`,
    { id: calcOrderId, lineItemId: calcLineItemId, quantity, restock }
  );
  const errs = data.orderEditSetQuantity.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}

async function editAddVariant(calcOrderId, variantId, quantity) {
  const data = await gql(
    `mutation($id: ID!, $variantId: ID!, $quantity: Int!) {
      orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) {
        calculatedLineItem { id quantity }
        userErrors { field message }
      }
    }`,
    { id: calcOrderId, variantId, quantity }
  );
  const { calculatedLineItem, userErrors } = data.orderEditAddVariant;
  if (userErrors && userErrors.length) throw new Error(userErrors.map((e) => e.message).join('; '));
  return calculatedLineItem;
}

async function editAddLineItemDiscount(calcOrderId, calcLineItemId, percentValue, description) {
  const data = await gql(
    `mutation($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
      orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
        calculatedLineItem { id }
        userErrors { field message }
      }
    }`,
    { id: calcOrderId, lineItemId: calcLineItemId, discount: { percentValue, description } }
  );
  const errs = data.orderEditAddLineItemDiscount.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}

async function commitEdit(calcOrderId, notifyCustomer, staffNote) {
  const data = await gql(
    `mutation($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
        order {
          id displayFinancialStatus
          totalOutstandingSet { presentmentMoney { amount currencyCode } }
        }
        userErrors { field message }
      }
    }`,
    { id: calcOrderId, notifyCustomer: Boolean(notifyCustomer), staffNote: staffNote || null }
  );
  const { order, userErrors } = data.orderEditCommit;
  if (userErrors && userErrors.length) throw new Error(userErrors.map((e) => e.message).join('; '));
  return order;
}

async function sendInvoice(orderGid, { to, subject, customMessage } = {}) {
  const email = {};
  if (to) email.to = to;
  if (subject) email.subject = subject;
  if (customMessage) email.customMessage = customMessage;
  if (config.invoiceFromEmail) email.from = config.invoiceFromEmail;
  const data = await gql(
    `mutation($id: ID!, $email: EmailInput) {
      orderInvoiceSend(id: $id, email: $email) {
        order { id }
        userErrors { field message }
      }
    }`,
    { id: orderGid, email: Object.keys(email).length ? email : null }
  );
  const errs = data.orderInvoiceSend.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}

/* -------------------------------------------------- high-level operations */

/**
 * Find the calculated line that corresponds to an original order line. The
 * calculated line item carries the original line's numeric id; fall back to
 * matching on the current variant id.
 */
function findCalcLine(calc, originalLineItemId, originalVariantId) {
  const nodes = (calc.lineItems.edges || []).map((e) => e.node);
  const wantedNumeric = numericId(originalLineItemId);
  let target = nodes.find((n) => numericId(n.id) === wantedNumeric);
  if (!target && originalVariantId) {
    target = nodes.find((n) => n.variant && n.variant.id === originalVariantId);
  }
  return target || null;
}

/** Email a Shopify-hosted pay link when an edit left a balance owing. */
async function invoiceIfOwing(orderGid, outstanding, { invoice, invoiceEmail, orderName, customMessage }) {
  if (!invoice || !(outstanding > 0)) return false;
  await sendInvoice(orderGid, {
    to: invoiceEmail,
    subject: `Payment link for your updated order${orderName ? ` ${orderName}` : ''}`,
    customMessage,
  });
  return true;
}

/**
 * Swap one line item to a different variant of the same product:
 * add the new variant (carrying over the customer's effective discount),
 * zero-out and restock the original, commit, then settle any balance.
 *
 * Order-edit-added lines never inherit the original order's discounts, so
 * without `preserveDiscountPercent` a discounted customer would silently be
 * re-charged full price on a like-for-like swap.
 */
async function swapVariant(orderGid, {
  originalLineItemId,
  originalVariantId,
  newVariantId,
  quantity,
  preserveDiscountPercent,
  notifyCustomer,
  staffNote,
  invoice,
  invoiceEmail,
  orderName,
}) {
  const calc = await beginEdit(orderGid);
  const target = findCalcLine(calc, originalLineItemId, originalVariantId);
  if (!target) {
    throw new Error('That item could not be found on the order any more — it may already have changed.');
  }
  const added = await editAddVariant(calc.id, newVariantId, quantity || target.quantity || 1);
  const pct = Number(preserveDiscountPercent) || 0;
  if (pct > 0) {
    await editAddLineItemDiscount(calc.id, added.id, pct, 'Carried over from your original order');
  }
  await editSetQuantity(calc.id, target.id, 0, true);
  const order = await commitEdit(calc.id, notifyCustomer, staffNote);
  const outstanding = money(order.totalOutstandingSet) || 0;
  const invoiced = await invoiceIfOwing(orderGid, outstanding, {
    invoice,
    invoiceEmail,
    orderName,
    customMessage: 'Your order was updated as requested. Use the secure link below to pay the difference and we’ll get it packed.',
  });
  return { outstanding, invoiced };
}

/**
 * Change the quantity of an existing line item (increase, decrease, or remove
 * with quantity 0). Existing line pricing/discounts are recalculated by
 * Shopify; whatever balance results is settled via invoice or flagged for
 * refund by the caller.
 */
async function changeQuantity(orderGid, {
  originalLineItemId,
  originalVariantId,
  newQuantity,
  notifyCustomer,
  staffNote,
  invoice,
  invoiceEmail,
  orderName,
}) {
  const calc = await beginEdit(orderGid);
  const target = findCalcLine(calc, originalLineItemId, originalVariantId);
  if (!target) {
    throw new Error('That item could not be found on the order any more — it may already have changed.');
  }
  const restock = newQuantity < (target.quantity || 0);
  await editSetQuantity(calc.id, target.id, newQuantity, restock);
  const order = await commitEdit(calc.id, notifyCustomer, staffNote);
  const outstanding = money(order.totalOutstandingSet) || 0;
  const invoiced = await invoiceIfOwing(orderGid, outstanding, {
    invoice,
    invoiceEmail,
    orderName,
    customMessage: 'Your order quantity was updated. Use the secure link below to pay the difference and we’ll get it packed.',
  });
  return { outstanding, invoiced };
}

/**
 * Cancel the whole order: refund to the original payment method, restock, and
 * (by default) let Shopify email the customer its cancellation confirmation.
 * Shopify processes the cancel as an async job.
 */
async function cancelOrder(orderGid, { staffNote, notifyCustomer = true } = {}) {
  const data = await gql(
    `mutation($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String) {
      orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
        job { id done }
        orderCancelUserErrors { field message }
      }
    }`,
    { orderId: orderGid, reason: 'CUSTOMER', refund: true, restock: true, notifyCustomer, staffNote: staffNote || null }
  );
  const errs = data.orderCancel.orderCancelUserErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return data.orderCancel.job;
}

/**
 * Add an upsell item to the order at a discount, then commit. If the edit
 * leaves a balance owing, optionally email the customer a secure pay link.
 */
async function addUpsellItem(orderGid, {
  variantId,
  quantity,
  discountPercent,
  invoice,
  invoiceEmail,
  notifyCustomer,
  staffNote,
  orderName,
}) {
  const calc = await beginEdit(orderGid);
  const added = await editAddVariant(calc.id, variantId, quantity || 1);
  if (discountPercent && discountPercent > 0) {
    await editAddLineItemDiscount(calc.id, added.id, discountPercent, `Post-purchase offer (${discountPercent}% off)`);
  }
  const order = await commitEdit(calc.id, notifyCustomer, staffNote);
  const outstanding = money(order.totalOutstandingSet) || 0;
  const invoiced = await invoiceIfOwing(orderGid, outstanding, {
    invoice,
    invoiceEmail,
    orderName,
    customMessage: 'Thanks for adding to your order! Use the secure link below to pay the small balance and we’ll pack it together.',
  });
  return { outstanding, invoiced };
}

module.exports = {
  gql,
  numericId,
  digitsOf,
  effectiveDiscountPercent,
  variantImage,
  getShopInfo,
  getOrderByGid,
  findOrderByNumberAndEmail,
  getProductVariants,
  getVariant,
  getVariantsByIds,
  normalizeOrder,
  updateShippingAddress,
  swapVariant,
  changeQuantity,
  cancelOrder,
  addUpsellItem,
  sendInvoice,
};
