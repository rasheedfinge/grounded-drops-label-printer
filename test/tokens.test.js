'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshTokens(secret) {
  process.env.LINK_SIGNING_SECRET = secret;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/tokens')];
  return require('../src/tokens');
}

test('sign/verify roundtrip returns the order gid', () => {
  const tokens = freshTokens('test-secret-1');
  const gid = 'gid://shopify/Order/6334034870330';
  assert.equal(tokens.verify(tokens.sign(gid)), gid);
});

test('tampered token is rejected', () => {
  const tokens = freshTokens('test-secret-1');
  const tok = tokens.sign('gid://shopify/Order/123');
  const tampered = tok.slice(0, -2) + (tok.endsWith('xx') ? 'yy' : 'xx');
  assert.equal(tokens.verify(tampered), null);
});

test('garbage input is rejected without throwing', () => {
  const tokens = freshTokens('test-secret-1');
  for (const bad of [null, undefined, '', 'nope', 'a.b', 'a.b.c', 42, {}]) {
    assert.equal(tokens.verify(bad), null);
  }
});

test('token signed for a non-order gid is rejected', () => {
  const tokens = freshTokens('test-secret-1');
  const tok = tokens.sign('gid://shopify/Product/123');
  assert.equal(tokens.verify(tok), null);
});

test('token signed with a different secret is rejected', () => {
  const a = freshTokens('secret-a');
  const tok = a.sign('gid://shopify/Order/123');
  const b = freshTokens('secret-b');
  assert.equal(b.verify(tok), null);
});
