# Grounded Drops — Zero-Ad-Spend Revenue Playbook

**Every legal avenue to grow revenue without paid ads — prioritised by impact-to-effort for a
one-person Australian coffee brand that needs cash flow now.**

Compiled July 2026 from a fact-checked research sweep (106 research agents, claims adversarially
verified against ACCC/ACMA primary sources and industry data — refuted claims excluded) plus an
audit of the giveaway/referral app and label system in this repo.

---

## 0. The honest frame

Two things the research made unambiguous:

1. **In Australia there is almost no legal "grey zone" in the two places people usually look for
   it: reviews and cold email/SMS.** Fake or seeded reviews and unsolicited electronic marketing
   are simply illegal, with active enforcement (details in §1). The genuinely aggressive-but-legal
   space is elsewhere: seeding, partnerships, B2B outreach, distribution, conversion, and your own
   viral loop.
2. **Your biggest untapped revenue is traffic and customers you already have.** Average Shopify
   conversion sits around 1.4–1.8%; lifting it toward 3% (still below the top-20% threshold of
   ~3.2%) roughly doubles revenue from existing traffic — before a single new visitor
   ([Littledata benchmark](https://www.littledata.io/)). Same logic for your list, your parcels,
   and your giveaway entrants.

---

## 1. The hard legal walls (know these before anything else)

These look like "grey hacks" but are illegal in Australia. Everything else in this playbook is
built to stay on the right side of these lines.

| Illegal tactic | Law | Enforcement reality |
| --- | --- | --- |
| Fake reviews, or asking mates/family to review without disclosing the relationship | ACL ss 18, 29(1)(e) | Meriton fined $3M; Electrodry $215K; penalties now up to $50M for corporations ([ACCC](https://www.accc.gov.au/business/advertising-and-promotions/online-reviews-for-product-and-services)) |
| Rewarding only **positive** reviews, or hiding that a review was incentivised | ACL | ACCC's Dec 2023 sweep called undisclosed incentivised reviews the most common breach |
| Selectively deleting genuine negative reviews | ACL | Same ACCC guidance |
| Cold email/SMS blasts to purchased or scraped lists | Spam Act 2003 ss 16, 20–22 | $15M+ in ACMA penalties in ~18 months. **Outdoor Supacentre — a 4WD/camping retailer in your exact niche — was fined $302K over SMS breaches** ([ACMA](https://www.acma.gov.au/avoid-sending-spam)) |
| Marketing emails without a working unsubscribe (actioned ≤ 5 business days, no login required) | Spam Act | Same enforcement wave (CBA $11M total, Pizza Hut $2.5M) |
| Unsubstantiable claims ("Australia's freshest", fake "was $X" prices, countdown timers that reset) | ACL s 29; s 219 substantiation notices | ACCC can demand proof within 21 days |
| Prize draws above state thresholds without a permit | State gaming law | You run monthly draws — see §10 for your specific compliance position |

**Burden of proof for consent sits on you** — keep records of when/how every email address opted
in. One narrow, defensible B2B exception exists ("conspicuous publication" — §7).

⚠️ Two compliance gaps in the current app (fix before scaling sends): the announcement email
drafts have **no unsubscribe link**, and BCC-blasting 50-at-a-time from raw SMTP will wreck
deliverability at scale. Move list sends to a proper ESP (Klaviyo/Mailchimp/Brevo free tiers) and
keep the app for entry mechanics.

---

## 2. Fix the machine you already own (highest ROI of anything here)

From auditing this repo — each of these is a buildable change to systems already running:

1. **Referral links die every month.** Referral codes are scoped to a single giveaway
   (`UNIQUE(giveaway_id, email)` in `db.js`), so when auto-draw opens the new month, every link and
   QR your fans shared stops crediting them. Make codes global per person and auto-enrol into the
   current giveaway. Your viral loop currently resets to zero monthly — this is the single biggest
   leak.
2. **No email after entry.** Entrants see their share link once on-screen, then lose it. Send an
   instant "You're in — here's your link, every mate = bonus entry" email (SMTP is already wired).
   Referral programs live on re-exposure of the link.
3. **Make the referral two-sided.** Right now the referrer gets a ticket and the friend gets
   nothing. "Your mate gets 10% off their first order, you get an entry" converts far better and
   produces *revenue*, not just entries.
4. **Post-entry upsell page.** After someone enters, they're maximally engaged and get… nothing.
   Show: "Every order = 5 bonus entries" + a first-order code + your best bundle. This converts
   prize-hunters into customers at the exact moment of peak intent.
5. **"Everyone wins" consolation code.** The monthly announcement email tells losers to try again.
   Add a 72-hour 15% code for all entrants → the draw becomes a predictable monthly revenue spike.
6. **Milestone referral tiers** (the Harry's model): 3 friends = free drip-bag 3-pack, 10 = travel
   pack, 25 = a month of coffee. The `tickets` table already tracks per-person referrals; tiers
   beat linear +1 entries because each reward unlocks a new goal.
7. **Winner codes are fictional.** `genDiscountCode()` makes a random string that never exists in
   Shopify. Create it via the Shopify Admin API (or manually) or winners bounce at checkout — the
   worst possible moment to disappoint your most-engaged customer.
8. **Upgrade the label insert.** One static reusable 15% code (`GDmdxxmf3zdP7468`) has no
   attribution, no per-customer urgency, and will leak to coupon aggregators. Better: unique codes,
   and make the QR point at the **giveaway page** ("Scan → win a year of coffee") — a giveaway
   entry costs you $0 vs 15% margin, captures the email, and feeds the referral loop from every
   parcel you ship.
9. **Add optional SMS opt-in** (explicit checkbox = express consent under the Spam Act) to the
   entry form — an owned channel with very high open rates, used sparingly (draw results, flash
   windows).
10. **Beef up the winners page**: entrant counts, prize photos, winner quotes (with permission).
    Social proof raises entry conversion, which feeds everything above.

---

## 3. Revenue THIS month (pure hustle, ~$0 cost)

- **Mine your own list first.** Your entrants + past customers are consented (keep records).
  Send: a founder-voice email ("small roaster, big month — here's 48 hours of X"), a win-back to
  anyone 60+ days quiet, and the consolation-code draw email (§2.5). A genuine, non-designed,
  plain-text founder email routinely outperforms polished campaigns.
- **AOV mechanics on Shopify (all free/native):**
  - Free-shipping threshold set ~20–30% above current AOV, with a progress bar in cart.
  - Bundles: "Site Box" (one of everything), "Trip Pack", "Smoko Pack" for tradies. Bundling
    drip bags with beans raises ticket size with zero new product.
  - Post-purchase one-click upsell at checkout (Shopify native or free-tier app) — "add a sample
    box for $X, ships in the same parcel."
  - A "grab a second bag half price" cart cross-sell.
- **Gift cards** — turn them on if they aren't; free money and float.
- **Subscribe & Save** on drip bags (§4) — pitch it in every parcel insert.
- **Flash windows, done legally:** genuine deadlines only ("48 hours, ends Sunday 9pm, because
  the roast batch ships Monday"). Never fake timers or fake "was" prices — that's the ACL wall.
- **Ask for the review, correctly:** post-delivery email asking every customer for an honest
  review. You MAY offer an incentive (giveaway entry fits perfectly) **only if** it's given for
  any review, positive or negative, and disclosed. That's the exact ACCC-compliant wiring.

---

## 4. The retention engine (where DTC coffee margin actually lives)

Coffee is consumable — the whole business model is the second purchase and the subscription.

- **Instrument three numbers** (verified as the health metrics that matter:
  [Mailchimp Ecommerce Playbook](https://mailchimp.com/marketing-glossary/ecommerce-playbook/)):
  **repeat purchase rate, LTV, and time from first to second purchase.** Every tactic — the 15%
  insert, post-purchase flow, subscription pitch — gets measured against second-purchase speed.
- **Email flows to stand up (one weekend in a free-tier ESP):** welcome series (with brand story +
  first-order code), abandoned checkout, post-purchase ("how to brew it better" content, then the
  review ask, then the reorder nudge timed to when the bag runs out — you know consumption rates:
  a 10-pack ≈ 2 weeks for a daily drinker), win-back at 60/90 days.
- **Subscription mechanics that reduce churn:** easy skip/pause/swap (never make cancelling the
  only option), flexible cadence, a small perpetual discount, and a "founder's batch" surprise
  now and then. Anchor the subscription as the default on product pages (one-time purchase as the
  alternative).
- **Timed replenishment SMS/email**: "About to run out? Reorder in one tap." Consumable + known
  consumption rate = the easiest retention win in ecommerce.

---

## 5. B2B: the fastest path to chunky, recurring, zero-ad revenue

### 5a. Office coffee (verified playbook)

Offices are a subscription with one buyer and many drinkers. The verified acquisition motion
([source](https://pureearthcoffee.com/blogs/cafe-buildout/office-coffee-b2b-program-roasters-opportunity),
cross-checked):

- **Who:** office managers / HR at 20–150-person companies; co-working spaces (one contract
  reaches dozens of member companies); professional associations and networking events.
- **How:** LinkedIn direct outreach (DMs are outside the Spam Act's email/SMS scope; platform
  rules still apply) with a **free week's supply** offer. Phone calls and walk-ins with samples
  work too and are completely unregulated by the Spam Act.
- **The pitch:** you're not selling coffee, you're selling employee satisfaction — frame the price
  per employee per workday (at a ~40-person office, good coffee ≈ cents per person per day).
  Re-base the US figures to AU pricing before quoting.
- **Drip bags are a cheat code here:** no machine, no grinder, no cleaning — offices without
  espresso machines are your perfect customer, and no OCS incumbent competes for them.

### 5b. Wholesale / stockists (verified playbook)

- **Start small and local, not with chains** — independent camping stores, 4WD accessory shops,
  tradie tool suppliers, servos near job sites, gift shops, IGA-style grocers. Local buyers are
  accessible, like stocking local products, and give you the sell-through data bigger buyers
  demand later ([Bellwether](https://bellwethercoffee.com/blog/how-to-start-selling-wholesale-coffee-to-grocery-stores),
  corroborated by Perfect Daily Grind and MTPak).
- **The verified motion:** call the store, ask for the buyer, **deliver fresh samples in person
  with a one-page sell sheet** (logo, photos, wholesale + RRP pricing, margin %, barcode, your
  story). Repeat weekly. This is a numbers game a solo founder can run in dead time.
- **Where drip bags win retail:** camping stores' counter displays (impulse buy next to the
  register), caravan-park kiosks, tour operators, tackle shops. Nobody else owns "specialty coffee
  for the bush" shelf space yet.
- **Build the prospect list the grey-but-legal way:** competitor and adjacent brands publish their
  stockist lists (e.g. store-locator pages). Researching those is legal. Contact by **phone,
  in-person, post, or LinkedIn** — don't bulk-email scraped addresses (Spam Act, §1). One-to-one
  emails to a published business address about something relevant to that role can qualify as
  "conspicuous publication" inferred consent — keep records, personalise each one, no blasts.

### 5c. Accommodation & hospitality (uniquely good fit, low competition)

Airbnb hosts, BnBs, glamping operators, caravan parks, farm-stays: a drip bag on the pillow is a
five-star-review amenity that costs the host ~$2. Sell "guest packs" wholesale, with a discount
QR on each sachet so **guests become DTC customers** — the host literally distributes your
sampling for you. Pitch via host Facebook groups (as a host-services vendor, follow group rules),
property managers, and cleaning/turnover companies (they restock consumables).

### 5d. Corporate gifting (seasonal spikes)

EOFY, Christmas, client thank-yous, conference swag, "site crew" gifts. One corporate order =
hundreds of retail units. Create a "Corporate & Crew Gifting" page, then LinkedIn-founder-post
your way into it (§8) and directly approach local firms, builders, and event organisers by phone.
**Father's Day (first Sunday of September in AU) is your single biggest gift moment** — tradie +
camping + coffee is a bullseye; pitch gift guides 6–8 weeks out (§9).

---

## 6. Community & organic social (your niche is an unfair advantage)

You're not "a coffee brand" — you're **coffee for the bush, the ute, and the campsite**. That
niche has organised, passionate, findable communities:

- **Forums:** [MySwag](https://www.myswag.org/) (camper-trailer forum with dedicated food/drink
  boards), 4WD and touring forums. Join as a person, be useful for weeks, have your brand in the
  signature/profile. Never spam; forum bans are permanent and these communities are small worlds.
- **Facebook groups:** Australia has huge camping/caravanning groups (Camplify maintains a list of
  the top 21). Most ban business posts but allow value posts and answers to "what coffee do you
  take camping?" threads — which get asked constantly. Also: **partner with group admins** — a
  monthly "member giveaway" run by admins is usually welcomed and puts you in front of 50–300k
  members for the cost of a prize pack. (Your giveaway app is purpose-built for this.)
- **Reddit:** r/overlanding, r/4x4Australia, r/CampingAndHiking, r/coffee — value-first, follow
  flair/self-promo rules, founder transparency ("I roast coffee for camping, AMA") outperforms
  stealth marketing and stays within rules.
- **Content formats that fit you** (film on a phone at real sites/campsites):
  - POV: "smoko coffee on a job site" / sunrise brew at camp — the product IS the content.
  - The drip-bag "reveal" mechanic is inherently satisfying — brew ASMR loops.
  - "Instant vs drip bag" blind taste tests with tradies — natural share bait.
  - Founder story: garage roaster feeding the family — people buy from people; say it plainly.
  - Post natively to Reels + TikTok + Shorts (same clip, three surfaces).
- **Instagram Collab posts** with camping/vanlife micro-accounts — both audiences see one post;
  costs a product pack.

---

## 7. Seeding, ambassadors & affiliates (the verified WOM model)

The Hydro Flask path — free product seeded at outdoor events plus an ambassador program — took
them to $1M revenue by 2011 and is directly transferable
([Demand Curve](https://www.demandcurve.com/blog/viral-marketing)):

- **Seed drip bags where your customers already are:** 4WD shows, camping expos, fishing comps,
  farmers markets, job-site smoko runs, trailhead car parks on Saturday mornings. A single sachet
  + QR card is a ~$1.50 CAC with perfect targeting. (Handing samples to humans is legal; letterbox
  drops are fine subject to "No Junk Mail" markings and council rules — the Spam Act does not
  cover post.)
- **Micro-influencer gifting, no ad spend:** 10–50k-follower camping/4WD/vanlife creators. Send a
  travel pack + personal note, no strings. Hit rate won't be 100% — it doesn't need to be. Give
  each a **personal discount code** (their audience gets 10%, you attribute sales) — that's an
  affiliate program without software. Disclosure of gifted product is the *creator's* obligation
  (AANA code) — ask them to tag #gifted; it protects you both.
- **Ambassador tier:** your top referrers (your app literally ranks them — `giveawayStats` sorts
  by tickets) get free monthly coffee for content + codes. Formalise what's already happening.
- **Caveat the research flagged:** referral mechanics don't rescue an unremarkable product. Your
  remarkable angle is the *context* (real coffee where there's no kettle-and-plunger) — every
  seed should demonstrate that moment, not just hand over coffee.

---

## 8. Founder-brand on LinkedIn (B2B lead gen in disguise)

One post a week: garage-roastery photos, wholesale wins, "what shipping 400 parcels a month from
a garage looks like." LinkedIn's organic reach for small founders is the best of any platform in
2026, and it feeds §5 (office coffee + corporate gifting) directly. DMs to office managers are
outside the Spam Act. This costs time, not money, and compounds.

---

## 9. SEO / AEO & PR (slow but free and compounding)

- **The verified opportunity:** Google has demoted affiliate "best coffee" roundup sites, and
  brand product/category pages now rank where affiliate listicles used to
  ([MobiLoud](https://www.mobiloud.com/blog/organic-traffic-ecommerce), corroborated by Search
  Engine Land). Caveat: AI Overviews are compressing ecommerce search clicks, so write pages that
  *answer the question outright* (AEO) — be the quoted answer, not just a blue link.
- **Pages to build (each maps to a real search):** "best coffee for camping [Australia]", "how to
  make good coffee while camping", "drip coffee bags vs instant", "coffee for FIFO workers",
  "4WD touring coffee setup", "coffee without a kettle". One good page per week.
- **Google Business Profile** for the roastery (even home-based service-area) — free local pack
  presence, review surface, and posts.
- **PR / earned media:** sign up to **SourceBottle** (free AU journalist call-outs); pitch the
  founder story to local news and AU small-business press; enter awards (local business awards,
  delicious. Produce Awards); pitch **Father's Day gift guides in July** (i.e. NOW — guides for
  the first-Sunday-September date are being written 6–8 weeks out); offer yourself to camping/4WD
  and small-business podcasts. Every placement is a backlink that feeds the SEO above.
- **Comparison pages** ("Grounded Drops vs [instant brand]") are legal in Australia **if every
  claim is accurate and substantiable** (ACL, §1) — aggressive, effective, rarely done properly.

---

## 10. Your giveaway: viral-loop optimisation + the permit question

- **Permit position (game of chance, purchase-linked entries are fine at normal retail price):**
  NSW requires an authority only when the total prize pool exceeds **$10,000**; SA **$5,001+**;
  ACT **$3,001+**; VIC/QLD/WA/TAS need no permit but have conditions
  ([NSW Gov](https://www.nsw.gov.au/money-and-taxes/community-gaming/trade-promotions),
  [state guide](https://lawpath.com.au/blog/competition-permits-a-state-by-state-breakdown)).
  A monthly bag-of-coffee prize is comfortably under every threshold — **but publish proper T&Cs**
  (draw date, method, publication of winner, permit lines when applicable). If you ever run a big
  headline prize ("Win a year of coffee" ≈ value it carefully), check the SA/ACT thresholds first.
- **Scale the same app into partner draws:** co-branded giveaways with camping brands (jerky,
  gear, torches) — both brands email their lists, prize pool is shared, everyone's list grows.
  Your app already supports import + referral attribution; you're sitting on collab
  infrastructure most brands pay VYPER/Gleam for. (VYPER's flagship case study: one contest,
  41k emails.)
- **Headline-prize math:** "Win a year of coffee" costs you COGS (~a few hundred dollars) but
  reads as $700+ of value — the best prize-value-to-cost ratio available, and it only attracts
  coffee people (no gift-card freebie hunters polluting the list).
- Then plug the §2 fixes in so every entrant compounds instead of evaporating monthly.

---

## 11. Marketplaces (incremental, margin-aware)

- **Amazon AU:** grocery referral fee ~8% under $15 / 15% over $15, FBA fulfilment ~$3.50–6.50 for
  drip-bag-weight parcels, $49.95/mo professional plan
  ([fee guide](https://ecomcalctools.com/blog/fees-amazon/amazon-fees-australia-2026/)). Listing
  the sample box + a hero drip-bag pack captures buy-ready searches you'll never win on your own
  site. Keep DTC primary — you don't own marketplace traffic, so use inserts in marketplace
  parcels (allowed: brand/QR inserts must not solicit off-Amazon purchases — keep it to the
  giveaway QR, not "buy direct next time" wording; that line matters, don't cross it).
- **eBay AU / Catch:** low-effort secondary shelf space; fine for bundles and gift packs.
- **TikTok Shop:** **not available in Australia** as of mid-2026 (no announced launch; TikTok ANZ
  has said no current plans). Park it; revisit if it launches — commission elsewhere runs ~6%.

---

## 12. Partnerships & cross-promos (fastest audience borrowing there is)

- **Parcel-insert swaps:** you put a jerky brand's card in your parcels, they put yours in theirs.
  Free distribution into a perfectly-matched customer base. Do it with 3–5 non-competing
  camping-adjacent brands (jerky, hot sauce, camp gear, socks, fishing tackle).
- **Newsletter swaps:** trade a mention in each other's email (each brand mails its own consented
  list — fully Spam Act-clean).
- **Bundle collabs:** "Camp Breakfast Box" with another AU maker — both promote, split revenue,
  each brand reaches the other's audience with a *product*, not an ad.
- **Joint giveaways** (§10) are the highest-leverage version of all of the above.

---

## 13. Events & markets

Farmers markets and camping/4WD shows are triple-purpose: same-day cash, wholesale leads walking
past, and content. Brew samples — the aroma is your billboard. Collect emails on the spot via
giveaway QR (express consent, provable). MTPak's market guidance: the stand pays for itself when
you treat it as recruitment (subscriptions, wholesale cards, QR sign-ups), not just bag sales.

---

## 14. The genuinely grey (but legal) drawer

Everything here is legal in Australia today; each has its edge noted.

- **Coupon-site seeding:** publish your *own* controlled codes (small %, min spend) to Honey/
  cashback/coupon sites so checkout code-hunters convert instead of bouncing. Edge: attracts
  discount-sensitive buyers; use minimum-spend floors.
- **Competitor comparison SEO** (§9): legal if truthful and substantiable; keep receipts for every
  claim.
- **Prospecting from public stockist lists** (§5b): researching is legal; contact channel is the
  compliance question (phone/post/LinkedIn/in-person = clean; bulk email = not).
- **One-to-one B2B email under "conspicuous publication":** a personally-written, role-relevant
  email to a published business address with no "no marketing" notice can rest on inferred
  consent. Keep records of where you found the address; no automation, no lists, no blasts.
- **Direct mail & letterbox drops:** the Spam Act covers electronic messages only. Postcards with
  a QR to smoko rooms, trade counters, caravan parks (get permission on private property; respect
  "No Junk Mail"). Nobody in your niche is doing physical mail — inboxes are saturated,
  letterboxes aren't.
- **Guerrilla sampling** (§7): sachet + card on car windscreens at trailheads/boat ramps is legal
  in most councils (check local by-laws); handing them to humans is always cleaner and converts
  better anyway.
- **"Free + shipping" tripwire:** free sample 2-pack, customer pays ~$5 shipping. Costs you a
  couple of dollars to acquire a *paying customer with a card on file* who enters your §4 flows.
- **Public referral leaderboard with monthly prize:** gamifies your existing referral data
  (already in the DB); prize value counts toward the §10 permit thresholds.
- **Newsjacking:** fuel prices, camping-season stories, "smoko" culture moments — founder
  hot-takes ride existing attention for free.
- **Aggressive-but-honest scarcity:** small-batch roasting is *genuinely* limited — "82 bags in
  this roast, gone when they're gone" is legal because it's true, and it converts like fake
  scarcity without the ACL risk.

**Not grey — just illegal (don't):** fake/seeded/undisclosed-incentive reviews; buying followers
or engagement to imply popularity (misleading conduct territory + platform fraud); scraped-list
email/SMS; fake timers, fake RRPs, drip pricing; unsubstantiated origin/health claims; big prize
draws without permits.

---

## 15. If I were you: the first 14 days

| Day | Move | Why first |
| --- | --- | --- |
| 1–2 | Consolation-code email to all entrants + founder flash email to customer list | Cash this week from consented contacts you already own |
| 2–3 | Turn on: free-shipping threshold + one bundle + post-purchase upsell + gift cards | AOV up on every order from existing traffic |
| 3–5 | Fix referral loop persistence + post-entry upsell + entry email (§2.1–2.4) | Stops the monthly viral-loop reset; converts entrants to buyers |
| 5–7 | Stand up welcome/abandoned/post-purchase flows in a free ESP; wire the compliant review ask | The retention engine everything else feeds |
| 7–10 | Sell sheet (one page) + list of 30 local camping/4WD/tradie stores + start the call-drop-in circuit, 5/day | First wholesale accounts inside a fortnight |
| 7–10 | LinkedIn outreach: 10 office managers + 3 co-working spaces, free-week offer | One office account = recurring monthly revenue |
| 10–14 | Pitch 10 Father's Day gift guides (it's July — the window is open NOW); join SourceBottle | Earned media compounds into September's biggest gift moment |
| ongoing | 3 phone-shot videos/week (smoko/camp POV) + 1 founder LinkedIn post + 1 SEO/AEO page + 5 seeding packs to micro-creators | The compounding layer |

Then next month: partner giveaway with a camping brand (§10), insert swaps (§12), a market stall
(§13), Amazon AU listing (§11), Airbnb host packs (§5c).

---

## Sources (key)

- [ACCC — online reviews rules](https://www.accc.gov.au/business/advertising-and-promotions/online-reviews-for-product-and-services) · [ACCC — false or misleading claims](https://www.accc.gov.au/business/advertising-and-promotions/false-or-misleading-claims)
- [ACMA — avoiding sending spam (Spam Act 2003)](https://www.acma.gov.au/avoid-sending-spam) · [ACMA consent expectations analysis](https://addisons.com/article/the-acma-has-issued-a-statement-about-its-expectations-for-using-consent-to-conduct-e-marketing-and-telemarketing/)
- [NSW trade promotions](https://www.nsw.gov.au/money-and-taxes/community-gaming/trade-promotions) · [State-by-state permit breakdown](https://lawpath.com.au/blog/competition-permits-a-state-by-state-breakdown) · [Gleam AU permits guide](https://gleam.io/guides/australia-permits)
- [Littledata Shopify conversion benchmarks](https://www.littledata.io/) · [Mailchimp Ecommerce Playbook (retention KPIs)](https://mailchimp.com/marketing-glossary/ecommerce-playbook/)
- [Bellwether — selling wholesale to grocery](https://bellwethercoffee.com/blog/how-to-start-selling-wholesale-coffee-to-grocery-stores) · [MTPak — supermarkets](https://mtpak.coffee/2021/03/guide-to-selling-coffee-in-supermarkets/) · [MTPak — farmers markets](https://mtpak.coffee/2021/07/secret-selling-coffee-farmers-markets/)
- [Pure Earth — office coffee B2B playbook](https://pureearthcoffee.com/blogs/cafe-buildout/office-coffee-b2b-program-roasters-opportunity) (US pricing — re-base for AU)
- [Demand Curve — viral marketing / WOM](https://www.demandcurve.com/blog/viral-marketing) · [MobiLoud — organic ecommerce traffic 2026](https://www.mobiloud.com/blog/organic-traffic-ecommerce)
- [Amazon AU fees 2026](https://ecomcalctools.com/blog/fees-amazon/amazon-fees-australia-2026/) · [TikTok Shop AU status](https://www.z.media/insights/tiktok-shop-australia-2026-launch)
- [Camplify — top AU camping Facebook groups](https://www.camplify.com.au/blog/top-21-facebook-groups-for-camping-and-caravanning-in-australia) · [MySwag forum](https://www.myswag.org/)

*Research method: 5-angle search fan-out → 24 sources → 115 claims extracted → 25 adversarially
verified by independent 3-voter panels → 6 refuted claims excluded from this document. Legal notes
are summaries of Australian regulator guidance, not legal advice.*
