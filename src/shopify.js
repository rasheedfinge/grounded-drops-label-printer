'use strict';

/**
 * Thin Shopify Admin GraphQL client plus every order operation the portal needs.
 *
 * All GraphQL shapes here were checked against the live Admin schema
 * (introspection + shopify.dev docs). The order-editing flow follows Shopify's
 * three steps: orderEditBegin -> stage changes -> orderEditCommit.
 */

const config = require('./config');

function endpoint() {
  return `https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`;
}

async function gql(query, variables = {}) {
  if (!config.shop || !config.adminToken) {
    throw new Error('Shopify is not configured (set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN).');
  }
  let res;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.adminToken,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new Error(`Could not reach Shopify: ${err.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Shopify returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (body.errors) {
    const msg = Array.isArray(body.errors) ? body.errors.map((e) => e.message).join('; ') : JSON.stringify(body.errors);
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  return body.data;
}

const numericId = (gid) => (String(gid || '').match(/\d+/g) || []).join('');
const digitsOf = (s) => (String(s || '').match(/\d/g) || []).join('');
const money = (set) => (set && set.presentmentMoney ? Number(set.presentmentMoney.amount) : null);

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
    discountedUnitPriceSet { presentmentMoney { amount currencyCode } }
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

async function getVariant(variantGid) {
  const data = await gql(
    `query($id: ID!) {
      productVariant(id: $id) {
        id title price availableForSale
        image { url altText }
        selectedOptions { name value }
        product { id title status }
      }
    }`,
    { id: variantGid }
  );
  return data.productVariant;
}

/* --------------------------------------------------------------- normalize */

/** Reshape a raw order into the minimal, safe payload the browser receives. */
function normalizeOrder(order) {
  const currency =
    (order.totalPriceSet && order.totalPriceSet.presentmentMoney && order.totalPriceSet.presentmentMoney.currencyCode) ||
    'AUD';
  const lineItems = (order.lineItems.edges || []).map((e) => {
    const li = e.node;
    return {
      id: li.id,
      title: li.title,
      variantTitle: li.variantTitle,
      quantity: li.currentQuantity ?? li.quantity,
      image: li.image ? li.image.url : null,
      unitPrice: money(li.originalUnitPriceSet),
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
 * Swap one line item to a different variant of the same product:
 * add the new variant, then zero-out (and restock) the original, then commit.
 */
async function swapVariant(orderGid, { originalLineItemId, originalVariantId, newVariantId, quantity, notifyCustomer, staffNote }) {
  const calc = await beginEdit(orderGid);
  const nodes = (calc.lineItems.edges || []).map((e) => e.node);
  // The calculated line item for an existing line carries the original line
  // item's numeric id; fall back to matching on the current variant id.
  const wantedNumeric = numericId(originalLineItemId);
  let target = nodes.find((n) => numericId(n.id) === wantedNumeric);
  if (!target && originalVariantId) {
    target = nodes.find((n) => n.variant && n.variant.id === originalVariantId);
  }
  if (!target) {
    throw new Error('That item could not be found on the order any more — it may already have changed.');
  }
  await editAddVariant(calc.id, newVariantId, quantity || target.quantity || 1);
  await editSetQuantity(calc.id, target.id, 0, true);
  const order = await commitEdit(calc.id, notifyCustomer, staffNote);
  return { outstanding: money(order.totalOutstandingSet) || 0 };
}

/**
 * Add an upsell item to the order at a discount, then commit. If the edit
 * leaves a balance owing, optionally email the customer a secure pay link.
 */
async function addUpsellItem(orderGid, { variantId, quantity, discountPercent, invoice, invoiceEmail, notifyCustomer, staffNote }) {
  const calc = await beginEdit(orderGid);
  const added = await editAddVariant(calc.id, variantId, quantity || 1);
  if (discountPercent && discountPercent > 0) {
    await editAddLineItemDiscount(calc.id, added.id, discountPercent, `Post-purchase offer (${discountPercent}% off)`);
  }
  const order = await commitEdit(calc.id, notifyCustomer, staffNote);
  const outstanding = money(order.totalOutstandingSet) || 0;
  let invoiced = false;
  if (invoice && outstanding > 0) {
    await sendInvoice(orderGid, {
      to: invoiceEmail,
      subject: `Complete your addition to order`,
      customMessage: 'Thanks for adding to your order! Use the secure link below to pay the small balance and we’ll pack it together.',
    });
    invoiced = true;
  }
  return { outstanding, invoiced };
}

module.exports = {
  gql,
  numericId,
  getShopInfo,
  getOrderByGid,
  findOrderByNumberAndEmail,
  getProductVariants,
  getVariant,
  normalizeOrder,
  updateShippingAddress,
  swapVariant,
  addUpsellItem,
  sendInvoice,
};
