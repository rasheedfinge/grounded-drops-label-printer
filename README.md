# Grounded Drops — Monthly Giveaway App

A small, self-contained app for running monthly giveaways. Customers enter by
email, earn **bonus entries for referring friends**, and automatically earn
entries from **Shopify purchases**. An admin dashboard creates each month's
giveaway, tracks entries, and draws a weighted random winner.

> The original thermal-label editor is preserved at **`/label.html`**.

## How entries work

Every entry is one "ticket" — one equal chance in the draw. A participant can hold many tickets:

| Source | Tickets | Notes |
| --- | --- | --- |
| Email signup | 1 | One participant per email per giveaway (idempotent). |
| Referral | +1 per friend who joins via your link | Capped at `REFERRAL_TICKET_CAP` (default 10). |
| Shopify purchase | `PURCHASE_TICKETS_PER_ORDER` per order (default 5) | De-duplicated by Shopify order id. |

The winner is drawn by picking a random ticket, so more tickets = higher odds.

## Run locally

```bash
npm install
cp .env.example .env        # then set ADMIN_PASSWORD
npm start                   # http://localhost:3000
```

- **Public entry page:** `http://localhost:3000/`
- **Admin dashboard:** `http://localhost:3000/admin` (HTTP Basic auth — any
  username, password = `ADMIN_PASSWORD`)

Data is stored in a local SQLite file (`giveaways.db` by default).

## Configuration (`.env`)

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Password for `/admin`. **Set this before deploying.** |
| `SHOPIFY_WEBHOOK_SECRET` | Verifies Shopify webhook signatures. Required in production. |
| `PUBLIC_BASE_URL` | Base URL for referral links (e.g. `https://giveaways.groundeddrops.com`). Inferred from the request if unset. |
| `PURCHASE_TICKETS_PER_ORDER` | Tickets granted per Shopify order (default 5). |
| `REFERRAL_TICKET_CAP` | Max referral tickets one participant can earn (default 10). |
| `DB_PATH` | SQLite file location (default `./giveaways.db`). |
| `PORT` | Port to listen on (default 3000). |

## Shopify setup

In your Shopify admin, create a webhook:

- **Event:** `Order creation`
- **Format:** JSON
- **URL:** `https://your-app.com/webhooks/shopify/orders`

Copy the signing secret Shopify shows you into `SHOPIFY_WEBHOOK_SECRET`. Each
qualifying order then grants entries to the buyer in the currently open
giveaway (matched by email). Orders are de-duplicated by id, so webhook
retries never double-count.

## Running a monthly giveaway

1. Open `/admin`, create a giveaway for the month (e.g. period `2026-06`).
   The newest open giveaway is the one shown publicly and the one Shopify
   orders count toward.
2. Share the entry page. Entrants get a personal referral link + QR code to
   earn bonus entries.
3. At month end, open the giveaway in the admin and click **Draw Winner**.
   This closes the giveaway and records the winner. Export entrants to CSV any
   time.

## API reference

Public:
- `GET /api/current` — the currently open giveaway (or `null`).
- `POST /api/enter` — `{ name?, email, ref? }` → tickets, referral code, share URL + QR.
- `POST /webhooks/shopify/orders` — Shopify order webhook (HMAC-verified when a secret is set).

Admin (HTTP Basic auth):
- `GET  /api/admin/giveaways` — list all giveaways with counts.
- `POST /api/admin/giveaways` — `{ title, prize?, period (YYYY-MM), description? }`.
- `GET  /api/admin/giveaways/:id` — stats, entrants, winner.
- `POST /api/admin/giveaways/:id/draw` — draw the winner (once).
- `GET  /api/admin/giveaways/:id/export.csv` — entrant export.

## Deploy

The included `Procfile` (`web: node server.js`) runs on Heroku/Render. Set the
env vars above. For a persistent SQLite file across restarts, point `DB_PATH`
at a mounted volume (or swap in a managed database).

## Tech

Node.js + Express, SQLite via `better-sqlite3`, `qrcode` for share codes. No
build step.
