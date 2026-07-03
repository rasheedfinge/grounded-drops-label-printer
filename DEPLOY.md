# Going live on groundeddrops.com

Three steps: **host the app**, **embed the form in a Shopify page**, and
**connect the orders webhook**. Budget ~30–45 minutes. Nothing here touches
your theme code permanently — the giveaway lives in one page section.

---

## 1. Host the app (Railway — free to start)

The app needs to run somewhere with a public URL. Railway is the quickest;
Render or Heroku work the same way (the repo already has a `Procfile`).

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project → Deploy from GitHub repo →** pick
   `rasheedfinge/grounded-drops-label-printer`.
3. Railway auto-detects Node and runs `npm start`. Wait for the first deploy.
4. Open the **Variables** tab and add:

   | Variable | Value | Why |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | *(a strong password)* | Protects `/admin`. **Required.** |
   | `SHOP_DOMAIN` | `groundeddrops.com` | Locks embedding + webhooks to your store. |
   | `SHOPIFY_WEBHOOK_SECRET` | *(from step 3 below)* | Verifies Shopify order webhooks. |
   | `PUBLIC_BASE_URL` | *(your app URL, e.g. `https://giveaways.groundeddrops.com`)* | Used in referral links + emails. |
   | `AUTO_DRAW` | `true` | Draws winners automatically each month. |

   Optional, to send the winner/announcement emails from the app instead of
   copy-pasting: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
   `MAIL_FROM`. (Any SMTP provider works — e.g. a Gmail app password, or
   SendGrid/Mailgun/Postmark.)

5. Under **Settings → Networking**, Railway gives you a URL like
   `grounded-drops-production.up.railway.app`. That already works. To use a
   nice subdomain, add a **custom domain** `giveaways.groundeddrops.com` and
   create the CNAME it shows you in your domain's DNS. Put whichever URL you
   end up with into `PUBLIC_BASE_URL`.

> ⚠️ **Data note:** the app stores entries in a SQLite file. On Railway, add a
> small **Volume** mounted at `/data` and set `DB_PATH=/data/giveaways.db` so
> entrants survive redeploys. (Without a volume, a redeploy wipes the entries.)

Visit `https://<your-app-url>/admin`, log in with `ADMIN_PASSWORD`, and create
your first giveaway (or let auto-draw open one for the current month).

---

## 2. Embed the entry form in a Shopify page

1. Shopify admin → **Online Store → Pages → Add page**. Title it "Giveaway".
2. Click the **`< >`** (Show HTML / code) button in the content editor and
   paste this, replacing the URL with your app URL:

   ```html
   <iframe id="gd-giveaway"
           src="https://giveaways.groundeddrops.com/?embed=1"
           style="width:100%;border:0;display:block;min-height:520px"
           scrolling="no"></iframe>
   <script>
     addEventListener('message', function (e) {
       if (e.data && e.data.type === 'gd-giveaway-height') {
         document.getElementById('gd-giveaway').style.height = (e.data.height + 8) + 'px';
       }
     });
   </script>
   ```

3. Save. The form appears inside your store page, matches the width, and
   auto-resizes (no inner scrollbar). Add "Giveaway" to your navigation menu
   (**Online Store → Navigation**) so customers can find it.

That's the whole customer-facing side. The `?embed=1` makes the background
transparent so it blends into the page.

---

## 3. Give entries for purchases (optional but recommended)

This auto-enters anyone who buys that month and grants them bonus entries.

1. Pick any strong random string as your webhook secret and set it as
   `SHOPIFY_WEBHOOK_SECRET` in Railway (step 1).
2. Shopify admin → **Settings → Notifications → Webhooks → Create webhook**:
   - Event: **Order creation**
   - Format: **JSON**
   - URL: `https://giveaways.groundeddrops.com/webhooks/shopify/orders`
3. Shopify signs each webhook; the app verifies it against your secret and
   ignores anything that doesn't match.

> Shopify's webhook signing key and your `SHOPIFY_WEBHOOK_SECRET` must be the
> same value. If you use Shopify's built-in webhook, use the signing secret
> Shopify shows you. If you build this into a custom app later, use that app's
> API secret.

---

## Done

- Customers enter at `groundeddrops.com/pages/giveaway`
- You manage everything at `giveaways.groundeddrops.com/admin`
- Winners draw themselves monthly; you review the two email drafts and send
- Past winners show on the page as "Alex R." to drive next month's entries
