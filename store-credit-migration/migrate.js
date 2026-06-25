#!/usr/bin/env node
/*
 * Grounded Drops — Rise → Shopify native store credit migration
 * -------------------------------------------------------------
 * Reads a CSV export of customer balances (from Rise) and issues each
 * customer's remaining balance as NATIVE Shopify store credit using the
 * Admin GraphQL API (storeCreditAccountCredit mutation).
 *
 * Safe by design:
 *   - Dry-run by default. Nothing is written unless you pass --commit.
 *   - Re-runnable. Customers who already hold store credit are SKIPPED
 *     (unless you pass --force), so a second run won't double-credit.
 *
 * Usage:
 *   node migrate.js customers.csv            # dry-run preview
 *   node migrate.js customers.csv --commit   # actually issue the credit
 *   node migrate.js customers.csv --commit --force   # credit even if a balance exists
 *
 * Requires (see .env.example):
 *   SHOPIFY_STORE_DOMAIN   e.g. grounded-drops.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    Admin API access token (shpat_...)
 *   SHOPIFY_API_VERSION    optional, defaults to 2025-01
 *   STORE_CURRENCY         optional, overrides the shop's default currency
 */

'use strict';
const fs = require('fs');
const path = require('path');

// ---------- tiny .env loader (no dependencies) ----------
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const CURRENCY_OVERRIDE = process.env.STORE_CURRENCY;

// ---------- argv ----------
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FORCE = args.includes('--force');
const csvPath = args.find((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!csvPath) {
  die('Provide a CSV file path. e.g.  node migrate.js customers.csv [--commit] [--force]');
}
if (!STORE_DOMAIN || !ADMIN_TOKEN) {
  die('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN. Copy .env.example to .env and fill it in.');
}
if (!fs.existsSync(csvPath)) {
  die(`CSV file not found: ${csvPath}`);
}

// ---------- minimal CSV parser (handles quotes + commas) ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
  }
  return rows;
}

// Find the email column and the balance column from the header row.
function resolveColumns(header) {
  const norm = header.map((h) => h.trim().toLowerCase());
  const emailIdx = norm.findIndex((h) => h.includes('email'));
  // Prefer an explicit "balance"/"remaining"/"credit" column, else "amount".
  let balanceIdx = norm.findIndex((h) => h.includes('balance') || h.includes('remaining'));
  if (balanceIdx === -1) balanceIdx = norm.findIndex((h) => h.includes('credit'));
  if (balanceIdx === -1) balanceIdx = norm.findIndex((h) => h.includes('amount'));
  return { emailIdx, balanceIdx };
}

function parseAmount(raw) {
  if (raw == null) return NaN;
  // strip currency symbols, spaces, thousands separators
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return NaN;
  return Number(cleaned);
}

// ---------- Shopify Admin GraphQL helper ----------
const ENDPOINT = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

const SHOP_QUERY = `query { shop { name currencyCode } }`;

const CUSTOMER_QUERY = `
query($q: String!) {
  customers(first: 5, query: $q) {
    edges {
      node {
        id
        email
        displayName
        storeCreditAccounts(first: 10) {
          edges { node { id balance { amount currencyCode } } }
        }
      }
    }
  }
}`;

const CREDIT_MUTATION = `
mutation($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
    storeCreditAccountTransaction {
      id
      amount { amount currencyCode }
      account { id balance { amount currencyCode } }
    }
    userErrors { field message }
  }
}`;

function fmt(amount, currency) {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

async function main() {
  console.log('\n=== Rise → Shopify native store credit migration ===');
  console.log(`Store:    ${STORE_DOMAIN}`);
  console.log(`API:      ${API_VERSION}`);
  console.log(`Mode:     ${COMMIT ? '🟢 COMMIT (will issue credit)' : '🟡 DRY-RUN (no changes)'}${FORCE ? '  + FORCE' : ''}`);

  // Confirm credentials + get default currency.
  let shop;
  try {
    shop = (await gql(SHOP_QUERY)).shop;
  } catch (e) {
    die(`Could not reach Shopify Admin API. Check domain/token/scopes.\n   ${e.message}`);
  }
  const currency = CURRENCY_OVERRIDE || shop.currencyCode;
  console.log(`Shop:     ${shop.name} (default currency ${shop.currencyCode}${CURRENCY_OVERRIDE ? `, using override ${CURRENCY_OVERRIDE}` : ''})`);

  // Parse CSV.
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) die('CSV appears empty (need a header row plus at least one customer).');
  const header = rows[0];
  const { emailIdx, balanceIdx } = resolveColumns(header);
  if (emailIdx === -1 || balanceIdx === -1) {
    die(`Could not find email/balance columns. Header was: ${header.join(', ')}\n   Expected a column containing "email" and one containing "balance"/"credit"/"amount".`);
  }
  console.log(`Columns:  email="${header[emailIdx].trim()}", balance="${header[balanceIdx].trim()}"\n`);

  const summary = { credited: 0, skippedExisting: 0, skippedZero: 0, notFound: 0, failed: 0, totalIssued: 0 };

  for (let r = 1; r < rows.length; r++) {
    const email = (rows[r][emailIdx] || '').trim();
    const amount = parseAmount(rows[r][balanceIdx]);
    if (!email) { console.log(`Row ${r}: (no email) — skipped`); continue; }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.log(`• ${email}: balance is ${rows[r][balanceIdx]} → nothing to migrate, skipped`);
      summary.skippedZero++;
      continue;
    }

    // Look up customer by email.
    let node;
    try {
      const data = await gql(CUSTOMER_QUERY, { q: `email:"${email.replace(/"/g, '\\"')}"` });
      const edges = data.customers.edges;
      node = edges.find((e) => (e.node.email || '').toLowerCase() === email.toLowerCase())?.node || edges[0]?.node;
    } catch (e) {
      console.log(`• ${email}: lookup failed — ${e.message}`);
      summary.failed++;
      continue;
    }
    if (!node) {
      console.log(`• ${email}: ⚠️  no matching Shopify customer found — skipped`);
      summary.notFound++;
      continue;
    }

    // Existing native store credit in the target currency.
    const existing = node.storeCreditAccounts.edges
      .map((e) => e.node.balance)
      .filter((b) => b.currencyCode === currency)
      .reduce((sum, b) => sum + Number(b.amount), 0);

    if (existing > 0 && !FORCE) {
      console.log(`• ${email}: already has ${fmt(existing, currency)} store credit → SKIPPED (re-run safety; use --force to add anyway)`);
      summary.skippedExisting++;
      continue;
    }

    if (!COMMIT) {
      console.log(`• ${email}: would issue ${fmt(amount, currency)} (current native credit: ${fmt(existing, currency)})`);
      summary.credited++;
      summary.totalIssued += amount;
      continue;
    }

    // Commit: issue the credit.
    try {
      const data = await gql(CREDIT_MUTATION, {
        id: node.id,
        creditInput: { creditAmount: { amount: amount.toFixed(2), currencyCode: currency } },
      });
      const result = data.storeCreditAccountCredit;
      if (result.userErrors && result.userErrors.length) {
        console.log(`• ${email}: ❌ ${result.userErrors.map((u) => u.message).join('; ')}`);
        summary.failed++;
        continue;
      }
      const newBal = result.storeCreditAccountTransaction.account.balance;
      console.log(`• ${email}: ✅ issued ${fmt(amount, currency)} → new balance ${fmt(newBal.amount, newBal.currencyCode)}`);
      summary.credited++;
      summary.totalIssued += amount;
    } catch (e) {
      console.log(`• ${email}: ❌ ${e.message}`);
      summary.failed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`${COMMIT ? 'Credited' : 'Would credit'}: ${summary.credited} customer(s), total ${fmt(summary.totalIssued, currency)}`);
  if (summary.skippedExisting) console.log(`Skipped (already had credit): ${summary.skippedExisting}`);
  if (summary.skippedZero) console.log(`Skipped (zero/blank balance):  ${summary.skippedZero}`);
  if (summary.notFound) console.log(`Customer not found:            ${summary.notFound}`);
  if (summary.failed) console.log(`Failed:                        ${summary.failed}`);
  if (!COMMIT) console.log('\n👉 This was a DRY-RUN. Re-run with --commit to actually issue the credit.');
  console.log('');
}

main().catch((e) => die(e.stack || e.message));
