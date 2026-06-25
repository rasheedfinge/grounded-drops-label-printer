# Replace Rise with native Shopify store credit

A one-time migration to move your prepaid-wallet customers off **Rise**
($80/mo) and onto **Shopify's built-in store credit** (free). After this,
balances live on each customer's Shopify profile and apply themselves at
checkout — no app to host, no monthly fee.

> **Why this works:** Shopify added native store credit to the platform in
> 2024. It's the same thing Rise was selling you. For fewer than ~10
> customers, the entire migration takes a few minutes.

---

## How it changes for customers

| | Before (Rise) | After (native) |
|---|---|---|
| Where the balance lives | Rise app | Customer's Shopify account |
| How they redeem | Enter a code | Sign in at checkout → "Apply store credit" (automatic) |
| Monthly cost | $80 | $0 |
| Who manages it | Rise dashboard | Shopify Admin → customer profile |

The remaining balance carries over **exactly**. The only change is that there's
no code to type — they just sign in. Use `customer-email-template.md` to give
them a heads-up before you cancel Rise.

> **Requirement:** customers must be able to sign in at checkout. Make sure
> **Settings → Customer accounts** has accounts enabled (Shopify "new customer
> accounts" / Shop Pay). Most stores already do.

---

## One-time setup

### 1. Create a custom app to get an API token

1. Shopify Admin → **Settings → Apps and sales channels → Develop apps**.
2. Click **Allow custom app development** (if prompted), then **Create an app**.
   Name it e.g. `Wallet migration`.
3. Open the app → **Configuration → Admin API integration → Configure**, and
   enable these scopes:
   - `read_customers`
   - `write_store_credit_account_transactions`
   - `read_store_credit_account_transactions`
4. **Save**, then go to **API credentials → Install app**.
5. Copy the **Admin API access token** (starts with `shpat_`). You only see it
   once.

### 2. Configure this tool

```bash
cd store-credit-migration
cp .env.example .env
# edit .env and paste your store domain + token
```

### 3. Export balances from Rise

In the Rise dashboard, export your customers' **store-credit balances** to CSV.
Save it here as `customers.csv` (gitignored). The tool just needs an **email**
column and a **balance** column — extra columns are ignored. See
`customers.example.csv` for the shape:

```csv
email,balance
jane@example.com,142.50
john@example.com,80.00
```

> Not sure where to find the export in Rise? Look under
> Customers / Store Credit → Export. If you'd rather, just hand-build the CSV
> with the <10 emails and amounts.

---

## Run the migration

**No `npm install` needed** — the script uses only built-in Node (v18+).

```bash
# 1) Preview — shows exactly what WOULD happen, changes nothing:
node migrate.js customers.csv

# 2) Looks right? Issue the credit for real:
node migrate.js customers.csv --commit
```

What you'll see per customer: the amount that would be / was issued, and the
resulting balance. A summary prints at the end.

### Safety built in
- **Dry-run by default.** Nothing is written unless you pass `--commit`.
- **Re-run safe.** A customer who already has store credit is **skipped**, so
  running twice won't double-credit. (Override with `--force` only if you
  intentionally want to add on top.)
- **Currency-aware.** Uses your store's default currency automatically (or set
  `STORE_CURRENCY` in `.env`).

---

## After it's done

1. **Spot-check** a couple of customers: Shopify Admin → **Customers** → open a
   profile → the **Store credit** section shows the balance.
2. **Email your customers** (`customer-email-template.md`).
3. **Test a checkout** as a signed-in customer to confirm "Apply store credit"
   appears.
4. **Cancel Rise** (Settings → Apps → Rise → uninstall). $80/mo gone.

## Managing balances going forward ("until they run out")

You don't need this tool again — it's all native now:
- **See / adjust a balance:** Customer profile → **Store credit** → Add or
  Remove credit.
- **Balances draw down automatically** as customers spend, until they hit $0.
- **Top someone up** the same way, or re-run this script with a new CSV +
  `--force`.

---

## Troubleshooting

- **"Could not reach Shopify Admin API"** — check the domain ends in
  `.myshopify.com`, the token is pasted fully, and the scopes above are enabled
  (re-install the app after changing scopes).
- **"no matching Shopify customer found"** — that email isn't a customer in
  Shopify. Confirm the address, or create the customer first.
- **"Apply store credit" missing at checkout** — the customer isn't signed in,
  or customer accounts aren't enabled (Settings → Customer accounts).
