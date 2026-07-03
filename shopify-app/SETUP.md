# Grounded Drops Gift Offers — Setup Guide

A free replacement for the BOGOS app (~$70/mo → **$0/mo**).

## How it works — two halves

| Job | Done by | Cost |
|---|---|---|
| Show the gift slider, auto-add/remove gifts, "spend $X more" nudge | **This theme app extension** (runs on Shopify's CDN — no server) | $0 |
| Actually make the gift **free** | **Native Shopify "Buy X Get Y" automatic discounts** (built into every plan) | $0 |

The split is deliberate. Shopify's own discount engine enforces pricing, so a
shopper can never keep a gift for free by editing their cart — the moment the
cart stops qualifying, the discount stops applying. Shopify officially supports
free-gift-with-purchase through Buy X Get Y discounts; the only thing it does
**not** do is put the gift into the cart for the customer. That's the widget's
job (and the gift slider, and the progress nudge).

**Order of operations:** deploy the extension once (Part A) → create one native
discount per offer (Part B) → paste your offer rules into the theme editor
(Part C) → test, then cancel BOGOS (Part D).

---

## Part A — Deploy the theme app extension (one-time, ~20 min)

You need [Node.js](https://nodejs.org) 18+ on your computer, and a free
**Shopify Partners** account (partners.shopify.com — sign up with the same
email as your store; the CLI will walk you through it on first login).

### 1. Install the Shopify CLI

```bash
npm install -g @shopify/cli@latest
```

### 2. Create the app shell

The CLI generates account-specific config (client id, `shopify.app.toml`), so
it isn't checked into this repo. From the `shopify-app/` folder:

```bash
cd shopify-app
shopify app init
```

When it asks what to build, pick the minimal/extension-only option (the exact
wording changes between CLI versions — you want "start minimal", **not** the
Remix/full-stack template). Name it e.g. `grounded-drops-gifts`.

Move the extension from this repo into the app the CLI just created:

```bash
mv extensions/gift-offers grounded-drops-gifts/extensions/gift-offers
cd grounded-drops-gifts
```

### 3. (Optional) Preview on a development store

`shopify app dev` previews on a free **development store**, not your live
store — useful if you want to poke at the widget before it goes anywhere real.
If you're comfortable skipping this, go straight to step 4; Part D has a safe
way to test on your live store without shoppers seeing anything.

### 4. Deploy

```bash
shopify app deploy
```

This uploads the extension to Shopify — no server to run, nothing billed.

### 5. Install the app on your store ← don't skip

Deploying alone does **not** put the app on your store — the embed won't
appear in the theme editor until the app is installed:

1. [Shopify Partner/Dev Dashboard](https://partners.shopify.com) → **Apps** →
   your app → **Distribution** (or "Choose distribution").
2. Pick **Custom distribution** and enter your store's
   `xxxx.myshopify.com` domain.
3. Open the generated install link and approve the install on your store.

### 6. Turn it on in your theme

1. Shopify admin → **Online Store → Themes → Customize**
2. Bottom-left sidebar → **App embeds** (puzzle-piece icon)
3. Toggle **Gift Offers** on
4. You'll fill in **Offers JSON** in Part C
5. **Save**

> Tip: app embed toggles are saved **per theme**. That's what makes the safe
> test path in Part D work — you can enable it on an unpublished copy first.

---

## Part B — Create the native discounts (makes gifts free)

> ⚠️ **Use "Buy X Get Y", not "Amount off products".** With *Amount off
> products*, only items inside the discount's own scope count toward its
> minimum-purchase requirement, so a "100% off gifts when cart ≥ $50" discount
> would check the $50 against the *gift items only* — it would never work the
> way you expect. Buy X Get Y is Shopify's officially supported way to do free
> gifts, and it evaluates the spend on the products **you** choose.

### B0. One-time prep: two collections

1. **Free Gifts** — contains every product a customer can receive free
   (your slider choices, auto-gifts, etc.). Consider hiding this collection
   from navigation/search.
2. **All Products** — an automated collection with the condition
   *Price is greater than $0* (i.e. everything). Buy X Get Y has no built-in
   "all products" option, so this collection is the qualifying-spend pool.

> Why "everything" and not "everything except gifts"? The widget decides when
> to *offer* a gift by counting the shopper's paid items; Shopify decides when
> to make it *free*. If the discount's qualifying pool were narrower than what
> the widget counts, there'd be carts where the widget promises a free gift
> that checkout then charges for. With the pool set to all products, the
> discount is always at least as generous as the widget's promise — a shown
> gift is always actually free. (The tiny flip side: someone who manually adds
> a gift product to a nearly-qualifying cart can tip themselves over the
> threshold. That costs you at most one cheap gift and is invisible to
> everyone else.)

### B1. "Free gift when you spend $X" (also covers the gift slider)

Admin → **Discounts → Create discount → Buy X Get Y**:

| Setting | Value |
|---|---|
| Method | **Automatic discount** |
| Title | e.g. `Free gift over $50` *(customers see this at checkout)* |
| Customer buys | **Minimum purchase amount** → `$50.00` |
| Any items from | **Specific collections** → `All Products` |
| Customer gets | Quantity `1` from **Specific collections** → `Free Gifts` |
| At a discounted value | **Free** |
| Set a maximum number of uses per order | ✔ `1` |

The "max uses per order" cap is your server-side backstop: even if someone
manually adds five gift products, Shopify only makes one of them free — the
rest ring up at full price. (The widget also enforces one gift per offer in
the cart UI.)

### B2. BOGO — "Buy 2, get 1 free"

Admin → **Discounts → Create discount → Buy X Get Y**:

| Setting | Value |
|---|---|
| Method | **Automatic discount** |
| Customer buys | **Minimum quantity of items** → `2` |
| Any items from | Specific products → *your product* |
| Customer gets | Quantity `1` of Specific products → *the same product* |
| At a discounted value | **Free** |
| Max uses per order | ✔ `1` |

The widget's matching `bogo` offer auto-adds the free third unit so the
customer doesn't have to figure out they should add it themselves. (The widget
adds one free unit per offer; if you allow the discount to repeat — buy 4 get
2 — Shopify will still price a second free unit correctly, but the customer
has to add it manually.)

### B3. Combinations (only if you run several discounts at once)

- Each discount has a **Combinations** section. Two discounts only stack if
  **each is ticked to combine with the other's class** (product/order/shipping).
- If they aren't set to combine, Shopify applies the single **best** discount
  only — which can silently turn off your free gift when a bigger discount
  code is entered. If customers use discount codes on your store, tick
  "Other product discounts" (and "Order discounts" if relevant) on your gift
  discounts, and the same on the codes.
- A line that's already 100% off (the gift) can't be discounted further, and
  Shopify generally won't layer a second product discount onto an item already
  covered by a Buy X Get Y — which is fine here.
- Store-wide limit: max **25 active automatic discounts** — plenty here.

### What customers see

At checkout the gift line shows the original price struck through, `$0.00`,
and your discount title as a label. On the cart page, modern themes (Dawn
family) show the same; some older themes only show the discount at checkout —
that's a theme display choice, the math is always right.

---

## Part C — Configure your offers

Open **`offer-builder.html`** (double-click it — it runs entirely in your
browser) to build the JSON with a form instead of writing it by hand. Then
paste the result into **Theme editor → App embeds → Gift Offers → Offers
JSON** and save.

Every offer here should have a matching discount from Part B — the widget adds
the gift, the discount makes it free. Keep the thresholds identical.

### Offer types

**`auto` — free gift, added automatically**

```json
{
  "id": "free-gift-50",
  "type": "auto",
  "minSpend": 50,
  "gift": { "product": "sample-pack-citrus" }
}
```

**`slider` — customer picks one gift**

```json
{
  "id": "choose-gift-50",
  "type": "slider",
  "title": "You unlocked a free gift — pick one!",
  "minSpend": 50,
  "gifts": [
    { "product": "sample-pack-citrus" },
    { "product": "sample-pack-berry" },
    { "product": "mini-tote", "variantId": 41999999999999 }
  ]
}
```

**`bogo` — buy X get Y**

```json
{
  "id": "bogo-coffee",
  "type": "bogo",
  "buy": { "product": "ground-coffee", "quantity": 2 },
  "get": { "product": "ground-coffee", "quantity": 1 }
}
```

### Field reference

| Field | Meaning |
|---|---|
| `id` | Unique name for the offer (used to tag gift lines in the cart). |
| `type` | `auto`, `slider`, or `bogo`. |
| `title` | Slider headline (optional). |
| `minSpend` | Minimum spend in **dollars** (e.g. `50` or `49.99`). Gift lines never count toward it. |
| `minSpendByCurrency` | Optional per-currency thresholds for Shopify Markets stores, e.g. `{"USD": 50, "EUR": 45}`. Currencies not listed fall back to `minSpend`; with no `minSpend` set, the offer stays inactive for unlisted currencies. |
| `buy` | Required purchase: `{ "product": "handle", "quantity": 2 }`. `product` accepts one handle or a list. `variantId`/`productId` also work. |
| `gift` / `get` / `gifts` | The gift(s): `{ "product": "handle", "variantId": 123, "quantity": 1, "label": "FREE" }`. `variantId` only needed for multi-variant products (otherwise the first available variant is used). |
| `startsAt` / `endsAt` | Optional ISO dates to schedule the offer, e.g. `"2026-07-04T00:00:00Z"`. Schedule the matching discount too (discounts have native start/end dates). |
| `showTeaser` | Set `false` to exclude this offer from the "spend $X more" nudge. |

Product **handle** = the last part of the product URL
(`/products/ground-coffee` → `ground-coffee`).

Widget appearance, wording, position, and the progress nudge are all settings
on the app embed itself — no JSON needed.

---

## Part D — Test, then cut over from BOGOS

### Test without shoppers seeing anything

App embed settings are saved **per theme**, so you can do the whole dry run on
a copy:

1. **Online Store → Themes** → your live theme → **⋯ → Duplicate**.
2. On the *copy*: **Customize → App embeds** → enable Gift Offers and paste
   your Offers JSON. Shoppers still see the live theme, untouched.
3. Create the Part B discounts but set their **start date** to a few days out —
   scheduled discounts don't apply to real carts yet. For your own testing,
   temporarily set one live for a few minutes at a quiet hour (automatic
   discounts have no "draft" mode), or briefly accept that the discount side is
   live while the widget side isn't (a discount alone never adds anything to
   anyone's cart — worst case a shopper who manually buys a gift product gets
   it free).
4. Test using the theme copy's **preview** link.

### Full checklist (run on the preview, then once on live)

1. **Pause your BOGOS offers first** (in the BOGOS app) so the two systems
   don't both add gifts to the same cart.
2. Run through this checklist:
   - [ ] Under threshold: progress nudge shows the right remaining amount
   - [ ] Cross the threshold: gift auto-adds / slider appears
   - [ ] Slider: picking a second gift replaces the first (never two)
   - [ ] Remove items until under threshold: gift disappears from cart
   - [ ] **Checkout page: gift shows $0.00 with your discount title** ← the
         one that matters; if it's not free here, revisit Part B
   - [ ] Manually add 2+ gift products: only one is free at checkout
   - [ ] If you use discount codes: enter one — does the gift stay free?
         (If not: Combinations, Part B3)
3. Place one real test order (you can cancel/refund it).

### Cut over

1. Everything passes → publish the tested theme copy (or enable the embed on
   the live theme) and set the discounts live.
2. **Uninstall BOGOS** in Shopify admin → Apps.
3. After uninstalling, check Online Store → Themes → **Edit code** for leftover
   BOGOS snippets if your theme was customized long ago (app embeds clean up
   automatically; old manually-pasted snippets don't).
4. Cancel the BOGOS subscription if billed outside Shopify (Shopify-billed app
   charges stop at uninstall).

---

## Troubleshooting

**"Gift Offers" doesn't appear under App embeds.**
The app isn't installed on the store — deploying isn't installing. Go back to
Part A step 5 (custom distribution → install link). If it's installed and still
missing, confirm `shopify app deploy` finished without errors and that you're
editing a theme (embeds are per-theme).

**The cart drawer doesn't update when a gift is added.**
The widget re-renders your theme's cart sections in place (the same mechanism
Dawn uses) and fires the common `cart:refresh` events. If your theme's drawer
still doesn't update: App embed → **Cart refresh strategy** → try `Reload page`
— it always works, at the cost of a visible refresh.

**The gift isn't free at checkout.**
The widget never sets prices — check Part B: is the discount **Automatic** (not
a code)? Is the gift product in the **Free Gifts** collection? Is the spend
threshold scoped to the **All Products** collection? Same threshold as the
offer JSON?

**Customers can see a `_gift: offer-id` line under the gift in the cart.**
Shopify hides underscore-prefixed properties at checkout automatically, and
Dawn-family themes hide them in the cart. A few older themes print all
properties — if yours does, its cart template needs a one-line filter for
properties starting with `_` (standard Shopify convention; any theme developer
will recognize it).

**The gift appears, disappears, or never shows.**
Turn on **Debug mode** in the app embed and open the browser console — the
widget logs every decision (offer parsed, eligible or not, add/remove, and
config mistakes like a wrong product handle).

**A gift product is sold out.**
Shopify shows it as sold out and won't discount it; the widget skips gifts with
no available variant and pauses that offer for the page view. Keep gift
inventory stocked — or untick "track quantity" for cheap gift items.

**Multi-currency stores.**
`minSpend` is compared against cart prices in whatever currency the shopper is
browsing. If you sell in several currencies via Shopify Markets, set
`minSpendByCurrency` per currency, and note native discounts convert
thresholds automatically at current rates (docs: help.shopify.com → discounts).

**Theme editor preview.**
In the theme editor the widget renders but never modifies the cart (so you can
style it without junk carts). Test real behavior on the storefront preview.

---

## What you're giving up vs BOGOS (be honest with yourself before cancelling)

This setup covers what most small stores actually use: free gift with
purchase, customer-choice slider, BOGO, and the progress nudge. BOGOS features
it does **not** replicate:

- **Customer targeting** — offers per customer tag/segment, country, or order
  history. Here, offers apply to everyone (scheduling via `startsAt`/`endsAt`
  is supported).
- **In-page placement** — the slider/nudge is a floating overlay, not embedded
  mid-page. If you run a chat bubble or cookie banner bottom-right, set the
  widget position to `top` (or vice versa) so they don't collide.
- **One slider at a time** — if several slider offers qualify at once, the
  first in your JSON shows. (Auto-gift offers all work simultaneously.)
- **A/B testing and a dedicated analytics dashboard** — use Shopify's discount
  reports instead (Analytics → Reports → "Sales by discount").

If one of these is load-bearing for you, keep that in mind — everything else
about the migration is reversible (reinstalling BOGOS takes minutes).

---

## Cost comparison

| | BOGOS | This setup |
|---|---|---|
| Monthly fee | ~$70 | **$0** |
| Widget hosting | Vendor servers | Shopify CDN (free) |
| Pricing engine | Vendor | Shopify native discounts (free) |
| Gift slider / auto-add / BOGO / progress nudge | ✔ | ✔ |
| Analytics dashboard | ✔ | Shopify Analytics on the discounts (free) |
| You maintain | nothing | your Offers JSON + matching discounts |
