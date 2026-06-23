'use strict';

/**
 * Tamper-proof tokens for "edit your order" links.
 *
 * A token is `base64url(orderGID).hmacSHA256`. Because the customer can't forge
 * the HMAC, possession of a valid token proves the link came from us (e.g. it
 * was placed in their order-confirmation email), so we can skip the
 * email-verification step. Tokens carry no expiry of their own — the edit
 * window (checked separately against the order) is what limits their use.
 */

const crypto = require('crypto');
const config = require('./config');

function hmac(payload) {
  return crypto.createHmac('sha256', config.linkSecret).update(payload).digest('base64url');
}

/** Build a signed token for an order GID (e.g. gid://shopify/Order/123). */
function sign(orderGid) {
  const payload = Buffer.from(String(orderGid), 'utf8').toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

/** Return the order GID if the token is authentic, otherwise null. */
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = hmac(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const gid = Buffer.from(payload, 'base64url').toString('utf8');
    return /^gid:\/\/shopify\/Order\/\d+$/.test(gid) ? gid : null;
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
