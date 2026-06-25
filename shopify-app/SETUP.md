# Grounded Drops Gift Offers — Setup Guide

This replaces the **BOGOS** app ($70/mo) with a free, self-hosted solution.

It has two halves:

1. **This theme app extension** — auto-adds free gifts and shows the "pick your
   gift" slider. Runs on Shopify's CDN. **Hosting cost: $0.**
2. **Native Shopify Automatic Discounts** — make the gift / BOGO items free.
   Built into Shopify. **Cost: $0.** No code.

You set up #1 once, then create one discount per offer in #2.

---

## Part A — Install the theme app extension

You need this only once. It publishes the widget to your store.

### 1. Install the Shopify CLI

```bash
npm install -g @shopify/cli@latest
```

### 2. Create the app shell

From the `shopify-app/` folder, create a new app project. The CLI generates the
account-specific config (`shopify.app.toml`, client id, etc.) — that's why it
isn't checked in.

```bash
cd shopify-app
shopify app init        # choose "Start with an empty app", name it "Grounded Drops Gifts"
```

This creates a new folder (e.g. `grounded-drops-gifts/`). Now move the extension
in this repo into that app:

```bash
mv extensions/gift-offers ../grounded-drops-gifts/extensions/gift-offers
cd ../grounded-drops-gifts
```

### 3. Preview it on your store

```bash
shopify app dev
```

Follow the prompts to log in and connect your **Grounded Drops** store. This
opens a preview. Leave it running while you test.

### 4. Deploy it for good

```bash
shopify app deploy
```

This pushes the extension to Shopify permanently — no server, no monthly fee.

### 5. Turn the widget on in your theme

1. Shopify admin → **Online Store → Themes → Customize**.
2. Bottom-left → **App embeds** (the puzzle-piece icon).
3. Enable **Gift Offers**.
4. Paste your offer rules into **Offers JSON** (schema below).
5. **Save**.

---

## Part B — Make the gifts free (native discounts)

The widget *adds* the gift; a native discount makes it **free**. Do this in
Shopify admin → **Discounts → Create discount → Amount off products** (set it to
an **Automatic** discount, not a code).

### For "free gift with purchase" and the gift slider

1. Create a collection called **Free Gifts** and add every product a customer
   could receive for free.
2. Create an automatic **Amount off products** discount:
   - **Applies to:** the *Free Gifts* collection.
   - **Discount value:** 100% off.
   - **Minimum requirements:** match your offer (e.g. "Minimum purchase amount
     $50") so the gift is only free once the cart qualifies.
   - Optionally cap quantity (e.g. max 1 at 100% off) so they can't get many.

> Because the price is enforced by Shopify, a shopper can never keep a gift for
> free by editing the cart — if the cart stops qualifying, the discount stops
> applying.

### For BOGO ("buy 2 get 1 free")

Shopify does this natively with **zero code or widget** — you often don't even
need the JSON entry:

1. **Discounts → Create discount → Buy X get Y.**
2. Customer buys: quantity 2 of product/collection. Customer gets: quantity 1 of
   the same, at **100% off**, **Automatic**.

If you want the free item *auto-added* to the cart for a nicer UX, also add a
`bogo` entry to the Offers JSON (below). The discount still does the pricing.

---

## Offers JSON schema

Paste a JSON **array** of offer objects into the **Offers JSON** setting.
All money values are in **cents** (e.g. `$50.00` → `5000`).

### Common fields

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique string. Used to tag the gift cart line. |
| `type` | yes | `"auto"`, `"slider"`, or `"bogo"`. |
| `title` | no | Shown on the slider. |
| `minSubtotal` | no | Cart must reach this (cents), gifts excluded. |
| `requiredVariantId` / `requiredProductId` | no | Cart must contain this variant/product. Accepts one id or an array. |
| `requiredQuantity` | no | How many of the required item (default 1). |

### `auto` — auto-add one free gift

```json
{
  "id": "gift-over-50",
  "type": "auto",
  "minSubtotal": 5000,
  "giftVariantId": 41234567890123,
  "giftQuantity": 1
}
```

### `slider` — customer chooses their gift

```json
{
  "id": "choose-gift-75",
  "type": "slider",
  "title": "🎁 Spend $75, pick a free gift!",
  "minSubtotal": 7500,
  "giftQuantity": 1,
  "gifts": [
    { "handle": "sample-pack-citrus" },
    { "handle": "sample-pack-berry" },
    { "handle": "mini-tote-bag", "variantId": 41999999999999, "label": "FREE" }
  ]
}
```

`handle` is the product's URL handle (`/products/<handle>`). If a product has
multiple variants, set `variantId` to pick one; otherwise the first available
variant is used.

### `bogo` — auto-add the free item (optional; pair with a native Buy X Get Y discount)

```json
{
  "id": "bogo-coffee",
  "type": "bogo",
  "requiredVariantId": 41555555555555,
  "requiredQuantity": 2,
  "getVariantId": 41555555555555,
  "getQuantity": 1
}
```

### Finding a variant ID

Open the product in admin; the URL ends in `/products/<productId>/variants/<variantId>`.
Or visit `https://groundeddrops.com/products/<handle>.js` — the `id` of each
variant in that JSON is the variant ID.

---

## Theme refresh (the one theme-specific bit)

After the widget adds/removes a gift, your cart drawer needs to redraw. The
widget dispatches the `cart:refresh` event that **Dawn** and most modern themes
listen for, and reloads the `/cart` page as a guaranteed fallback.

If your drawer doesn't update on its own:
- Confirm your theme version (most 2.0 themes work out of the box).
- Tell me your theme name and I'll wire the widget to its specific cart events.

Turn on **Debug mode** in the app embed settings to see what the widget is doing
in the browser console.

---

## Cost comparison

| | BOGOS | This |
|---|------|------|
| Monthly fee | ~$70 | **$0** |
| Hosting | Theirs | Shopify CDN (free) |
| Pricing engine | Theirs | Shopify native discounts (free) |
| You maintain | nothing | the Offers JSON + this extension |
