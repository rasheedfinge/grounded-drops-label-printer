# Grounded Drops Tools

Two self-hosted tools that replace paid apps:

## 1. Gift offers — BOGOS replacement (`shopify-app/`)

Free gifts with purchase, customer-choice gift slider, BOGO, and a
"spend $X more" progress nudge — for **$0/month** instead of BOGOS's ~$70/month.

- Widget = a Shopify **theme app extension** (hosted free on Shopify's CDN)
- Pricing = native Shopify **Buy X Get Y automatic discounts** (free, tamper-proof)

Start here → **[shopify-app/SETUP.md](shopify-app/SETUP.md)**
Build your offer rules with → **[shopify-app/offer-builder.html](shopify-app/offer-builder.html)**

Run the widget's browser test suite:

```bash
npm test
```

## 2. Discount label printer (`server.js` + `public/`)

Prints thermal package-insert labels with a real, scannable QR code that opens
the store with the discount code pre-applied (`/discount/<code>` deep link).

```bash
npm install
npm start        # → http://localhost:3000
```

Deployable to any Node host (Heroku `Procfile` included).
