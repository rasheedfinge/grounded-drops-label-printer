# Grounded Drops — Self-Service Order Editor

A lightweight, single-store version of [Order Editing](https://www.orderediting.com/)
for **Grounded Drops**. It lets customers fix mistakes on an order **after
checkout but before it ships** — without emailing support — and gently upsells
them while the order is still open.

What customers can do (within an edit window):

- **Fix the shipping address** — corrected straight on the Shopify order.
- **Swap an item** — change size / grind / blend to another variant of the same
  product (equal-or-cheaper by default).
- **Add an item / upsell** — add a curated product at a discount; Shopify emails
  a secure link to pay the small balance, then it ships with the order.

It's a plain Node/Express app that talks to the Shopify Admin GraphQL API. No
database required.

---

## How it works

```
Customer ──▶  /edit?token=…  (link in confirmation email / order-status page)
         └─▶  /              (enter order number + email)
                    │
                    ▼
         Express portal  ──GraphQL──▶  Shopify Admin API
         · verifies ownership (signed token, or email match)
         · checks eligibility (unfulfilled + inside the edit window)
         · address  → orderUpdate
         · swap     → orderEditBegin → addVariant + setQuantity(0) → orderEditCommit
         · upsell   → orderEditBegin → addVariant + lineItemDiscount → orderEditCommit → orderInvoiceSend
```

**Eligibility** mirrors Order Editing's "edit window": an order is editable only
while it is **unfulfilled, not cancelled, and within `editWindowMinutes` of being
placed**. Every change re-checks this on the server. Subscription (Recharge) line
items are never swappable.

**Payment for added items:** adding a product raises the order total, leaving a
balance. The app commits the edit and asks Shopify to email the customer a secure
pay link (`orderInvoiceSend`). This keeps the app completely out of card data.

---

## 1. Create a Shopify custom app (one time)

1. Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. **Configure Admin API scopes** and enable:
   - `read_orders`, `write_orders`
   - `read_products`
   - `read_order_edits`, `write_order_edits`
3. **Install app**, then open **API credentials** and copy the **Admin API access
   token** (`shpat_…`). You'll paste it into `.env`.

## 2. Configure

```bash
cp .env.example .env
# then edit .env — at minimum:
#   SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN, LINK_SIGNING_SECRET, ADMIN_PASSWORD
```

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Run

```bash
npm install
npm start
# → http://localhost:3000        (customer portal)
# → http://localhost:3000/admin  (settings; user = anything, password = ADMIN_PASSWORD)
```

## 4. Configure offers in /admin

Open `/admin`, log in with `ADMIN_PASSWORD`, and:

- toggle which edits are allowed and set the **edit window**,
- set the **upsell discount** and **curate upsell products** (search + add),
- generate a test **edit link** for any real order.

## 5. Add the link for customers

Put a per-customer signed link where customers will see it after ordering. The
`/admin` "Generate an edit link" tool shows the exact URL format. In Shopify’s
**order confirmation email** (Settings → Notifications → Order confirmation) you
can add a button — the safest pattern is to send customers to the bare portal:

```html
<a href="https://YOUR_APP_URL/">Need to change your order?</a>
```

…and let them enter their order number + email (no token needed). For one-click
links you can generate signed tokens server-side and inject them; that’s a small
enhancement on top of `tokens.sign()`.

---

## Deploy

Any Node host works. A `Procfile` (`web: node server.js`) is included for
Heroku-style platforms (Heroku, Render, Railway).

1. Push this repo to the host.
2. Set the same variables from `.env` as **config vars** in the host dashboard.
3. Set `PUBLIC_URL` to the deployed URL.

> **Ephemeral filesystem note:** settings changed in `/admin` are written to
> `data/settings.json`, which resets on redeploy on hosts like Heroku. For values
> you can't lose, also set the matching env vars (`EDIT_WINDOW_MINUTES`,
> `UPSELL_VARIANT_IDS`, `UPSELL_DISCOUNT_PERCENT`, `ALLOW_*`) — env always wins.

---

## Security notes

- **No card data** ever touches this app — balances are paid via Shopify’s hosted
  invoice.
- **Ownership** is enforced two ways: signed-link tokens (HMAC) can’t be forged,
  and the manual lookup matches the entered email against the order’s email, so
  one customer can never load another’s order.
- The Admin API token lives only on the server and is never sent to the browser.
- `/admin` is protected by HTTP Basic auth (`ADMIN_PASSWORD`).
- Lookups are rate-limited per IP.

## Project layout

```
server.js                 Express bootstrap + routes
src/config.js             env config
src/shopify.js            Admin GraphQL client + all order operations
src/tokens.js             signed edit-link tokens
src/settings.js           merchant settings (defaults → file → env)
src/eligibility.js        edit-window / eligibility rules
src/routes/portal.js      customer API (lookup, address, swap, upsell)
src/routes/admin.js       merchant settings API (password protected)
config/settings.default.json   committed default settings
public/                   portal + admin UI (no build step)
```

## Not in this version (easy next steps)

- Cancel order / remove items + refund-to-store-credit.
- Inline card payment for upsells (instead of an emailed pay link).
- Holding orders from a 3PL during the window (`fulfillmentOrderHold`) — useful
  only once fulfillment is automated.
- One-click signed links auto-injected into Shopify notification emails.

## License

MIT
