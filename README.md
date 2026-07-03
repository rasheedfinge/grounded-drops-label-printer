# Grounded Drops — Monthly Giveaway App

A small, self-contained app for running monthly giveaways. Customers enter by
email, earn **bonus entries for referring friends**, and automatically earn
entries from **Shopify purchases**. You can also **import your existing
customer list**. When the month ends the app **draws the winner automatically**,
publishes them on the public page as "Jamie O." (first name + surname initial),
drafts the **announcement email for your list** and the **winner confirmation
email** (with a prize discount code), and opens next month's giveaway.

> The original thermal-label editor is preserved at **`/label.html`**.

## How entries work

Every entry is one "ticket" — one equal chance in the draw. A participant can hold many tickets:

| Source | Tickets | Notes |
| --- | --- | --- |
| Email signup | 1 | One participant per email per giveaway (idempotent). |
| Referral | +1 per friend who joins via your link | Capped at `REFERRAL_TICKET_CAP` (default 10). |
| Shopify purchase | `PURCHASE_TICKETS_PER_ORDER` per order (default 5) | De-duplicated by Shopify order id. |
| Imported list | 1 | Paste your customer list in the admin; existing entrants are skipped. |

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
| `PUBLIC_BASE_URL` | Base URL for referral links and email drafts (e.g. `https://giveaways.groundeddrops.com`). Inferred from the request if unset. |
| `AUTO_DRAW` | Automatic monthly lifecycle (default on). Set `false` to draw manually only. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Optional SMTP settings so the admin can send the drafted emails directly. Without them, drafts are copy/paste. |
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

With `AUTO_DRAW` on (the default) the app runs itself:

1. On boot (and every hour) the app makes sure a giveaway is open for the
   current month, creating one automatically if needed. Edit its title, prize,
   and description in the admin. You can also import your existing customer
   list there.
2. Share the entry page. Entrants get a personal referral link + QR code to
   earn bonus entries; Shopify orders add entries automatically.
3. When the month ends, the app draws the winner, generates their prize
   discount code, shows them on the public page as "Jamie O.", prepares two
   email drafts — the **announcement to your whole entrant list** and the
   **winner email asking them to confirm their shipping details** — and opens
   next month's giveaway.
4. Review/edit the drafts in the admin and hit **Send** (with SMTP configured)
   or copy them into your email tool. You can also click **Draw Winner** or
   **Run monthly cycle now** at any time instead of waiting.

Winners are only ever shown publicly as first name + surname initial — never
their full name or email.

## API reference

Public:
- `GET /api/current` — the currently open giveaway (or `null`).
- `GET /api/winners` — past winners as display names ("Jamie O.").
- `POST /api/enter` — `{ name?, email, ref? }` → tickets, referral code, share URL + QR.
- `POST /webhooks/shopify/orders` — Shopify order webhook (HMAC-verified when a secret is set).

Admin (HTTP Basic auth):
- `GET  /api/admin/giveaways` — list all giveaways with counts.
- `POST /api/admin/giveaways` — `{ title, prize?, period (YYYY-MM), description? }`.
- `PUT  /api/admin/giveaways/:id` — edit title / prize / description.
- `GET  /api/admin/giveaways/:id` — stats, entrants, winner, email drafts.
- `POST /api/admin/giveaways/:id/draw` — draw the winner (once) + create email drafts.
- `POST /api/admin/giveaways/:id/import` — bulk-import `{ text }` (one `email, name` per line) or `{ entries: [...] }`.
- `PUT  /api/admin/drafts/:id` — edit a draft; `POST /api/admin/drafts/:id/send` — send it (needs SMTP).
- `POST /api/admin/auto-draw/run` — force the monthly cycle right now.
- `GET  /api/admin/giveaways/:id/export.csv` — entrant export.

## Deploy

The included `Procfile` (`web: node server.js`) runs on Heroku/Render. Set the
env vars above. For a persistent SQLite file across restarts, point `DB_PATH`
at a mounted volume (or swap in a managed database).

## Tech

Node.js + Express, SQLite via `better-sqlite3`, `qrcode` for share codes. No
build step.
