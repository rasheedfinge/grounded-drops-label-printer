# Grounded Drops Gift Offers (BOGOS replacement)

Replaces the BOGOS Shopify app for **$0/month**: auto-added free gifts, a
"pick your free gift" slider, BOGO, and a "spend $X more to unlock" progress
nudge.

| Path | What it is |
|---|---|
| [`SETUP.md`](./SETUP.md) | **Start here** — deploy, create the discounts, configure, test, cut over from BOGOS |
| [`offer-builder.html`](./offer-builder.html) | Form that generates your Offers JSON (no coding) |
| [`extensions/gift-offers/`](./extensions/gift-offers/) | The theme app extension (widget) |
| [`test/`](./test/) | Headless-browser test suite against a mock Shopify storefront |

## Architecture in one paragraph

The widget (client-side JS served from Shopify's CDN via a theme app extension)
watches the cart and adds/removes gift lines tagged with a hidden `_gift` line
item property, renders the slider/nudge UI, and refreshes the theme's cart
drawer through the Section Rendering API. It never touches prices: native
**Buy X Get Y automatic discounts** make the gift free, so pricing is enforced
server-side by Shopify and can't be gamed from the browser.

## Tests

```bash
cd test && npm install && npm test
```

13 scenarios run the real widget in headless Chromium against a mock Shopify
storefront: auto-add/remove, slider choose/switch/toggle, dismissal + reopen
chip, BOGO, duplicate-prevention, out-of-stock gifts, theme-editor safety,
XHR-based themes, legacy config compatibility, and threshold self-counting.
