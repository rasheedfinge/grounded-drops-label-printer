/*
 * Grounded Drops — Gift Offers
 * ---------------------------------------------------------------------------
 * Theme app extension that replaces the "auto-add free gift", BOGO auto-add,
 * and "customer chooses their gift" behaviour of paid apps like BOGOS.
 *
 * What this file DOES:
 *   - Watches the Shopify cart (AJAX API) and reconciles it against the
 *     configured offers: auto-adds qualifying gifts, removes gifts that no
 *     longer qualify, and enforces one gift per customer-choice offer.
 *   - Renders a "pick your free gift" slider, a "spend $X more" progress
 *     teaser, and a reopen chip when the slider is dismissed.
 *   - Refreshes the theme's cart drawer via the Section Rendering API after
 *     mutating the cart, so no page reload is needed.
 *
 * What this file does NOT do:
 *   - It does NOT make the gift free. Pricing is enforced by a native Shopify
 *     automatic discount (see SETUP.md). That keeps pricing authoritative on
 *     Shopify's side: a shopper can never keep a gift for free by editing the
 *     cart in devtools, because the discount stops applying the moment the
 *     cart stops qualifying.
 *
 * Gift cart lines are tagged with the line item property `_gift: <offerId>`.
 * Underscore-prefixed properties are hidden by Dawn-family themes and at
 * checkout, so customers never see the tag.
 */
(function () {
  'use strict';

  var CONFIG = window.GroundedGiftOffers || {};
  var GIFT_PROP = '_gift';
  var SHOPIFY = window.Shopify || {};
  // Locale-aware base for AJAX calls (/fr/cart/add.js etc.). Prefer the value
  // our Liquid emits from routes.root_url — window.Shopify.routes is only set
  // by Dawn-family themes. Always ends in '/'.
  var ROOT = CONFIG.routesRoot || (SHOPIFY.routes && SHOPIFY.routes.root) || '/';
  if (ROOT.charAt(ROOT.length - 1) !== '/') ROOT += '/';
  var DESIGN_MODE = !!SHOPIFY.designMode;
  var DISMISS_KEY = 'gdGiftsDismissed';
  var MAX_SECTIONS = 5; // Section Rendering API limit per request

  var STRINGS = assign({
    sliderTitle: 'Pick your free gift',
    sliderSubtitle: 'Added free at checkout',
    teaserText: 'Spend {amount} more to unlock a free gift 🎁',
    unlockedText: '🎁 Free gift unlocked!',
    addLabel: 'Add free gift',
    addedLabel: '✓ Added',
    chipLabel: '🎁 Free gift available',
    freeLabel: 'FREE',
    dismissLabel: 'Dismiss gift offer',
    editorNote: 'Preview — gifts are added for real customers'
  }, CONFIG.strings || {});

  function assign(target, src) {
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null && src[k] !== '') {
        target[k] = src[k];
      }
    }
    return target;
  }

  function log() {
    if (CONFIG.debug && window.console) {
      console.log.apply(console, ['[GiftOffers]'].concat([].slice.call(arguments)));
    }
  }
  function warn() {
    if (window.console) {
      console.warn.apply(console, ['[GiftOffers]'].concat([].slice.call(arguments)));
    }
  }

  // --------------------------------------------------------------------------
  // Offer parsing & normalisation
  // --------------------------------------------------------------------------
  // Public schema (v2, see SETUP.md) with v1 compatibility. Normalised shape:
  //   { id, type: 'auto'|'slider', title, minSpendCents, minSpendByCurrency,
  //     buy: { handles[], productIds[], variantIds[], quantity } | null,
  //     gifts: [{ handle, variantId, quantity, label }],
  //     startsAt, endsAt, showTeaser }
  function parseRaw(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      warn('Offers JSON is not valid JSON — no offers active.', e.message);
      return [];
    }
  }

  function idList(value) {
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value]).map(String);
  }

  function dollarsToCents(value) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) ? Math.round(n * 100) : null;
  }

  function normalizeGift(g) {
    if (!g || typeof g !== 'object') return null;
    return {
      handle: g.product || g.handle || null,
      variantId: g.variantId != null ? Number(g.variantId) : null,
      quantity: Number(g.quantity) > 0 ? Number(g.quantity) : 1,
      label: g.label || null
    };
  }

  function normalizeOffer(raw, issues) {
    if (!raw || typeof raw !== 'object' || !raw.id || !raw.type) {
      issues.push({ offer: raw && raw.id, problem: 'Offer needs at least "id" and "type".' });
      return null;
    }
    var o = {
      id: String(raw.id),
      type: raw.type === 'bogo' ? 'auto' : String(raw.type),
      title: raw.title || null,
      minSpendCents: null,
      minSpendByCurrency: null,
      buy: null,
      gifts: [],
      startsAt: raw.startsAt ? Date.parse(raw.startsAt) : null,
      endsAt: raw.endsAt ? Date.parse(raw.endsAt) : null,
      showTeaser: raw.showTeaser !== false,
      _disabled: false
    };

    if (o.type !== 'auto' && o.type !== 'slider') {
      issues.push({ offer: o.id, problem: 'Unknown type "' + raw.type + '" (use auto, slider, or bogo).' });
      return null;
    }

    // Spend threshold: v2 `minSpend` is in dollars; v1 `minSubtotal` was cents.
    if (raw.minSpend != null) o.minSpendCents = dollarsToCents(raw.minSpend);
    else if (raw.minSubtotal != null) o.minSpendCents = parseInt(raw.minSubtotal, 10) || null;
    if (raw.minSpendByCurrency && typeof raw.minSpendByCurrency === 'object') {
      o.minSpendByCurrency = {};
      for (var cur in raw.minSpendByCurrency) {
        o.minSpendByCurrency[cur.toUpperCase()] = dollarsToCents(raw.minSpendByCurrency[cur]);
      }
    }

    // "Buy" condition: v2 `buy` object; v1 required* fields.
    var buySrc = raw.buy || {};
    var buyHandles = idList(buySrc.product || buySrc.products);
    var buyProductIds = idList(buySrc.productId || raw.requiredProductId);
    var buyVariantIds = idList(buySrc.variantId || raw.requiredVariantId);
    if (buyHandles.length || buyProductIds.length || buyVariantIds.length) {
      o.buy = {
        handles: buyHandles,
        productIds: buyProductIds,
        variantIds: buyVariantIds,
        quantity: Number(buySrc.quantity || raw.requiredQuantity) > 0
          ? Number(buySrc.quantity || raw.requiredQuantity) : 1
      };
    }

    // Gifts: v2 `gift`/`get`/`gifts`; v1 giftVariantId/getVariantId/gifts.
    if (raw.gifts && Array.isArray(raw.gifts)) {
      o.gifts = raw.gifts.map(normalizeGift).filter(Boolean);
    } else if (raw.gift || raw.get) {
      var g = normalizeGift(raw.gift || raw.get);
      if (g) o.gifts = [g];
    } else if (raw.giftVariantId || raw.getVariantId) {
      o.gifts = [{
        handle: null,
        variantId: Number(raw.giftVariantId || raw.getVariantId),
        quantity: Number(raw.giftQuantity || raw.getQuantity) > 0
          ? Number(raw.giftQuantity || raw.getQuantity) : 1,
        label: null
      }];
    }

    // Sanity checks (debug mode surfaces these loudly).
    if (!o.minSpendCents && !o.buy) {
      issues.push({ offer: o.id, problem: 'No condition — add "minSpend" (dollars) or a "buy" rule.' });
      return null;
    }
    if (!o.gifts.length) {
      issues.push({ offer: o.id, problem: 'No gift — add "gift", "get", or "gifts".' });
      return null;
    }
    if (o.minSpendCents != null && o.minSpendCents >= 1000 * 100 && raw.minSpend != null && raw.minSpend >= 1000) {
      issues.push({
        offer: o.id,
        problem: 'minSpend is ' + raw.minSpend + ' — note minSpend is in DOLLARS (50 = $50), not cents.',
        warningOnly: true
      });
    }
    return o;
  }

  var ISSUES = [];
  var OFFERS = parseRaw(CONFIG.offersRaw).map(function (raw) {
    return normalizeOffer(raw, ISSUES);
  }).filter(Boolean);

  (function reportIssues() {
    var ids = {};
    OFFERS.forEach(function (o) {
      if (ids[o.id]) ISSUES.push({ offer: o.id, problem: 'Duplicate offer id — ids must be unique.' });
      ids[o.id] = true;
    });
    if (ISSUES.length) {
      ISSUES.forEach(function (i) {
        (i.warningOnly ? log : warn)('Offer "' + (i.offer || '?') + '": ' + i.problem);
      });
    }
    if (CONFIG.debug && OFFERS.length && console.table) console.table(OFFERS.map(function (o) {
      return { id: o.id, type: o.type, minSpendCents: o.minSpendCents, buy: o.buy ? JSON.stringify(o.buy) : '', gifts: o.gifts.length };
    }));
  })();

  if (!OFFERS.length) { log('No valid offers configured — widget idle.'); return; }

  // --------------------------------------------------------------------------
  // Money formatting (money_format may contain HTML — strip it)
  // --------------------------------------------------------------------------
  function formatMoney(cents) {
    var format = String(CONFIG.moneyFormat || '${{amount}}').replace(/<[^>]*>/g, '');
    var value = (cents || 0) / 100;
    function withSeparators(num, decimals, thousands, decimal) {
      var parts = num.toFixed(decimals).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return parts.join(decimal);
    }
    return format.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, key) {
      switch (key) {
        case 'amount': return withSeparators(value, 2, ',', '.');
        case 'amount_no_decimals': return withSeparators(value, 0, ',', '.');
        case 'amount_with_comma_separator': return withSeparators(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return withSeparators(value, 0, '.', ',');
        case 'amount_with_apostrophe_separator': return withSeparators(value, 2, "'", '.');
        default: return withSeparators(value, 2, ',', '.');
      }
    });
  }

  // --------------------------------------------------------------------------
  // Cart + product API
  // --------------------------------------------------------------------------
  function getCart() {
    return fetch(ROOT + 'cart.js', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('cart.js returned ' + res.status);
        return res.json();
      });
  }

  function cartWrite(path, payload) {
    return fetch(ROOT + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error(body.description || body.message || ('Cart request failed (' + res.status + ')'));
          err.status = res.status;
          throw err;
        });
      }
      return res.json();
    });
  }

  function addGift(variantId, quantity, offerId) {
    var properties = {};
    properties[GIFT_PROP] = offerId;
    log('add gift', variantId, 'x' + quantity, 'for', offerId);
    return cartWrite('cart/add.js', {
      items: [{ id: Number(variantId), quantity: quantity || 1, properties: properties }]
    });
  }

  function removeLine(key) {
    log('remove gift line', key);
    return cartWrite('cart/change.js', { id: key, quantity: 0 });
  }

  function setLineQuantity(key, quantity) {
    log('set gift line', key, 'quantity to', quantity);
    return cartWrite('cart/change.js', { id: key, quantity: quantity });
  }

  var productCache = {};
  function getProduct(handle) {
    if (!handle) return Promise.resolve(null);
    if (!productCache[handle]) {
      productCache[handle] = fetch(ROOT + 'products/' + handle + '.js', { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (res.status === 404) {
            warn('Product "' + handle + '" not found — check the handle in your Offers JSON.');
            return null; // real 404s stay cached; retrying won't help
          }
          if (!res.ok) throw new Error('products/' + handle + '.js returned ' + res.status);
          return res.json();
        })
        .catch(function (e) {
          // Transient failure (network blip, throttle): forget it so the next
          // reconcile retries instead of treating the product as missing.
          warn(e.message);
          delete productCache[handle];
          return null;
        });
    }
    return productCache[handle];
  }

  // Resolve a gift definition to a concrete purchasable variant id.
  // Memoised on the gift def so sync code paths can use it once known.
  function resolveGiftVariant(gift) {
    if (gift.variantId) return Promise.resolve(gift.variantId);
    if (gift._resolvedVariantId) return Promise.resolve(gift._resolvedVariantId);
    return getProduct(gift.handle).then(function (product) {
      if (!product || !product.variants || !product.variants.length) return null;
      var available = null;
      for (var i = 0; i < product.variants.length; i++) {
        if (product.variants[i].available) { available = product.variants[i]; break; }
      }
      gift._resolvedVariantId = (available || product.variants[0]).id;
      return gift._resolvedVariantId;
    });
  }

  // Resolve buy.handles → product ids (retried until all handles resolve).
  function resolveBuyProducts(offer) {
    if (!offer.buy || !offer.buy.handles.length ||
        (offer.buy._resolvedIds && offer.buy._resolvedIds.length === offer.buy.handles.length)) {
      return Promise.resolve();
    }
    return Promise.all(offer.buy.handles.map(getProduct)).then(function (products) {
      offer.buy._resolvedIds = products.filter(Boolean).map(function (p) { return String(p.id); });
    });
  }

  // --------------------------------------------------------------------------
  // Eligibility
  // --------------------------------------------------------------------------
  function isGiftLine(item) {
    return !!(item.properties && item.properties[GIFT_PROP]);
  }
  function giftLinesFor(cart, offerId) {
    return cart.items.filter(function (item) {
      return item.properties && String(item.properties[GIFT_PROP]) === String(offerId);
    });
  }
  function paidItems(cart) {
    return cart.items.filter(function (item) { return !isGiftLine(item); });
  }
  // Subtotal of what the customer actually pays for — gift lines excluded, so a
  // gift's own price can never keep its offer qualified (no add/remove loops).
  function qualifyingSubtotalCents(cart) {
    return paidItems(cart).reduce(function (sum, item) {
      var line = item.final_line_price != null ? item.final_line_price : item.line_price;
      return sum + (line || 0);
    }, 0);
  }

  var currencyWarned = false;
  function thresholdFor(offer) {
    var active = (SHOPIFY.currency && SHOPIFY.currency.active) || CONFIG.currency;
    if (offer.minSpendByCurrency && active && offer.minSpendByCurrency[active] != null) {
      return offer.minSpendByCurrency[active];
    }
    // Cart prices arrive in the shopper's presentment currency; minSpend is a
    // shop-currency number. Flag the mismatch instead of silently comparing
    // dollars to euros — merchants on Shopify Markets should set
    // minSpendByCurrency for each currency they sell in.
    if (!currencyWarned && CONFIG.shopCurrency && active && active !== CONFIG.shopCurrency &&
        offer.minSpendCents != null) {
      currencyWarned = true;
      warn('Shopper is browsing in ' + active + ' but minSpend is configured in ' +
        CONFIG.shopCurrency + '. Add "minSpendByCurrency": {"' + active +
        '": ...} to the offer for accurate thresholds.');
    }
    return offer.minSpendCents;
  }

  function withinSchedule(offer) {
    var now = Date.now();
    if (offer.startsAt && now < offer.startsAt) return false;
    if (offer.endsAt && now > offer.endsAt) return false;
    return true;
  }

  function buyCount(offer, cart) {
    var b = offer.buy;
    var productIds = b.productIds.concat(b._resolvedIds || []);
    var count = 0;
    paidItems(cart).forEach(function (item) {
      if (b.variantIds.indexOf(String(item.variant_id)) !== -1 ||
          productIds.indexOf(String(item.product_id)) !== -1) {
        count += item.quantity;
      }
    });
    return count;
  }

  function isEligible(offer, cart) {
    if (offer._disabled || !withinSchedule(offer)) return false;
    var threshold = thresholdFor(offer);
    if (threshold != null && qualifyingSubtotalCents(cart) < threshold) return false;
    if (offer.buy && buyCount(offer, cart) < offer.buy.quantity) return false;
    return true;
  }

  // --------------------------------------------------------------------------
  // Reconciliation — single-flight with rerun flag (no overlapping runs)
  // --------------------------------------------------------------------------
  var reconciling = false;
  var rerunWanted = false;
  var debounceTimer = null;

  function scheduleReconcile() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(requestReconcile, 250);
  }

  function requestReconcile() {
    if (reconciling) { rerunWanted = true; return; }
    reconciling = true;
    reconcile().catch(function (e) {
      warn('reconcile failed:', e.message);
    }).then(function () {
      reconciling = false;
      if (rerunWanted) { rerunWanted = false; requestReconcile(); }
    });
  }

  function reconcile() {
    return getCart().then(function (cart) {
      return Promise.all(OFFERS.map(resolveBuyProducts)).then(function () {
        return applyOffers(cart);
      });
    }).then(function (result) {
      if (result.changed) {
        // Re-fetch so the UI renders from post-mutation truth, then repaint
        // the theme's cart sections.
        return getCart().then(function (freshCart) {
          refreshThemeUI();
          renderUI(freshCart);
        });
      }
      renderUI(result.cart);
    });
  }

  // Configured quantity for a gift cart line (used to undo shopper edits to
  // the FREE line's quantity — extras would ring up at full price).
  function configuredGiftQuantity(offer, line) {
    for (var i = 0; i < offer.gifts.length; i++) {
      var g = offer.gifts[i];
      var vid = g.variantId || g._resolvedVariantId;
      if (vid && String(vid) === String(line.variant_id)) return g.quantity;
    }
    return 1;
  }

  function applyOffers(cart) {
    var mutations = []; // executed sequentially; failures logged, not fatal

    // Gift lines whose offer no longer exists (renamed/deleted in the JSON)
    // would sit in returning customers' carts at full price — clean them up.
    var knownIds = {};
    OFFERS.forEach(function (o) { knownIds[o.id] = true; });
    cart.items.forEach(function (item) {
      if (isGiftLine(item) && !knownIds[String(item.properties[GIFT_PROP])]) {
        log('removing orphaned gift line for retired offer', item.properties[GIFT_PROP]);
        mutations.push(function () { return removeLine(item.key); });
      }
    });

    OFFERS.forEach(function (offer) {
      var eligible = isEligible(offer, cart);
      var existing = giftLinesFor(cart, offer.id);

      if (!eligible) {
        existing.forEach(function (line) {
          mutations.push(function () { return removeLine(line.key); });
        });
        return;
      }

      // One gift line per offer: trim any extras (kept line = first).
      existing.slice(1).forEach(function (line) {
        mutations.push(function () { return removeLine(line.key); });
      });

      if (existing.length) {
        // Enforce the configured quantity (shoppers can edit the free line,
        // or two tabs may have merged adds into a double-quantity line).
        var line = existing[0];
        var wantQty = configuredGiftQuantity(offer, line);
        if (line.quantity !== wantQty) {
          mutations.push(function () { return setLineQuantity(line.key, wantQty); });
        }
        return;
      }

      if (offer.type === 'slider') return; // shopper hasn't picked yet — fine

      // type === 'auto' with no gift line yet: add it.
      var gift = offer.gifts[0];
      mutations.push(function () {
        return resolveGiftVariant(gift).then(function (variantId) {
          if (!variantId) {
            warn('Offer "' + offer.id + '": gift has no purchasable variant — offer paused.');
            offer._disabled = true;
            return null;
          }
          return addGift(variantId, gift.quantity, offer.id).catch(function (e) {
            // Sold-out gift or other cart rejection: pause the offer for this
            // page view instead of hammering the endpoint.
            warn('Offer "' + offer.id + '": could not add gift (' + e.message + ') — offer paused.');
            offer._disabled = true;
          });
        });
      });
    });

    if (!mutations.length || DESIGN_MODE) {
      if (mutations.length && DESIGN_MODE) log('design mode: skipping', mutations.length, 'cart change(s)');
      return Promise.resolve({ changed: false, cart: cart });
    }

    var chain = Promise.resolve();
    mutations.forEach(function (m) {
      // Per-mutation catch: a stale line key (theme removed it concurrently)
      // must not abort the rest of the pass — the follow-up reconcile converges.
      chain = chain.then(m).catch(function (e) { warn('cart change failed:', e.message); });
    });
    return chain.then(function () { return { changed: true, cart: cart }; });
  }

  // --------------------------------------------------------------------------
  // Theme UI refresh — Section Rendering API + events (no page reload)
  // --------------------------------------------------------------------------
  // Find the theme's cart-related targets to re-render. Two shapes:
  //  - generic OS 2.0: statically rendered sections whose wrapper id contains
  //    "cart" (or that contain a cart drawer/form) → replace wrapper innerHTML
  //  - Dawn's header count badge: a bare `#cart-icon-bubble` element that Dawn
  //    itself refreshes from the "cart-icon-bubble" section → mimic Dawn
  function findCartSectionTargets() {
    var targets = [];
    var nodes = document.querySelectorAll('[id^="shopify-section-"]');
    for (var i = 0; i < nodes.length && targets.length < MAX_SECTIONS; i++) {
      var el = nodes[i];
      var id = el.id.replace(/^shopify-section-/, '');
      var looksCartish = /cart/i.test(id) ||
        el.querySelector('cart-drawer, cart-notification, cart-items, cart-drawer-items, form[action$="/cart"]');
      if (looksCartish) targets.push({ sectionId: id, el: el, wrapped: true });
    }
    var bubble = document.getElementById('cart-icon-bubble');
    if (bubble && targets.length < MAX_SECTIONS &&
        !targets.some(function (t) { return t.el.contains(bubble); })) {
      targets.push({ sectionId: 'cart-icon-bubble', el: bubble, wrapped: false });
    }
    return targets;
  }

  function dispatchCartEvents(detail) {
    ['cart:refresh', 'cart:build', 'cart:change', 'gd:cart:updated'].forEach(function (name) {
      try {
        document.documentElement.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
      } catch (e) { /* very old browsers */ }
    });
  }

  function refreshThemeUI() {
    var strategy = CONFIG.refresh || 'auto';
    if (strategy === 'none') return;
    if (strategy === 'reload') { window.location.reload(); return; }

    dispatchCartEvents();
    if (strategy === 'events') return;

    // strategy === 'auto': re-render the theme's own cart sections in place.
    var targets = findCartSectionTargets();
    if (!targets.length) return;
    var ids = targets.map(function (t) { return t.sectionId; });
    fetch(ROOT + '?sections=' + ids.join(','), { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (sections) {
        if (!sections) return;
        targets.forEach(function (t) {
          var html = sections[t.sectionId];
          if (!html || !document.body.contains(t.el)) return;
          var holder = document.createElement('template');
          holder.innerHTML = html;
          var source = t.wrapped && holder.content.getElementById
            ? holder.content.getElementById('shopify-section-' + t.sectionId)
            : null;
          if (!source) source = holder.content.querySelector('.shopify-section');
          if (!source) source = holder.content.firstElementChild;
          if (!source) return;

          // A freshly rendered drawer comes back in its closed state. If the
          // shopper has it open right now, preserve the stateful bits (classes
          // + [open]) across the swap so it doesn't snap shut in their face.
          var stateful = t.el.querySelectorAll('cart-drawer, cart-notification');
          var savedState = [];
          for (var s = 0; s < stateful.length; s++) {
            savedState.push({
              tag: stateful[s].tagName.toLowerCase(),
              className: stateful[s].className,
              open: stateful[s].hasAttribute('open')
            });
          }
          t.el.innerHTML = source.innerHTML;
          savedState.forEach(function (state) {
            var node = t.el.querySelector(state.tag);
            if (!node) return;
            if (state.className) node.className = state.className;
            if (state.open) node.setAttribute('open', '');
          });
        });
        dispatchCartEvents({ sectionsRefreshed: ids });
        log('refreshed theme sections:', ids.join(', '));
      })
      .catch(function (e) { log('section refresh failed (events already sent):', e.message); });
  }

  // --------------------------------------------------------------------------
  // Widget UI: teaser, slider, chip
  // --------------------------------------------------------------------------
  var ui = null;
  var lastSliderKey = null;
  var unlockedTimer = null;
  var wasEverIneligible = {}; // offerId -> true once seen ineligible (for "unlocked" flash)

  function getDismissed() {
    try { return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setDismissed(map) {
    try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify(map)); } catch (e) { /* private mode */ }
  }

  function ensureUI() {
    if (ui) return ui;
    var rootEl = document.createElement('div');
    rootEl.id = 'gd-gift-widget';
    rootEl.setAttribute('data-position', CONFIG.position === 'top' ? 'top' : 'bottom');
    rootEl.innerHTML =
      '<div class="gd-teaser" hidden>' +
        '<div class="gd-teaser__track"><div class="gd-teaser__fill"></div></div>' +
        '<span class="gd-teaser__text"></span>' +
      '</div>' +
      '<button type="button" class="gd-chip" hidden></button>' +
      '<section class="gd-slider" hidden role="region" aria-label="Free gift offer">' +
        '<button type="button" class="gd-slider__close" aria-label="' + STRINGS.dismissLabel + '">&times;</button>' +
        '<div class="gd-slider__head">' +
          '<span class="gd-slider__title"></span>' +
          '<span class="gd-slider__subtitle"></span>' +
        '</div>' +
        '<div class="gd-slider__items"></div>' +
        (DESIGN_MODE ? '<div class="gd-slider__note">' + STRINGS.editorNote + '</div>' : '') +
      '</section>' +
      '<span class="gd-live" aria-live="polite"></span>';
    document.body.appendChild(rootEl);

    ui = {
      root: rootEl,
      teaser: rootEl.querySelector('.gd-teaser'),
      teaserFill: rootEl.querySelector('.gd-teaser__fill'),
      teaserText: rootEl.querySelector('.gd-teaser__text'),
      chip: rootEl.querySelector('.gd-chip'),
      slider: rootEl.querySelector('.gd-slider'),
      sliderTitle: rootEl.querySelector('.gd-slider__title'),
      sliderSubtitle: rootEl.querySelector('.gd-slider__subtitle'),
      sliderItems: rootEl.querySelector('.gd-slider__items'),
      live: rootEl.querySelector('.gd-live')
    };
    ui.chip.textContent = STRINGS.chipLabel;

    ui.slider.querySelector('.gd-slider__close').addEventListener('click', function () {
      var sliderOffer = ui.slider.getAttribute('data-offer-id');
      if (sliderOffer) {
        var dismissed = getDismissed();
        dismissed[sliderOffer] = true;
        setDismissed(dismissed);
        ui.chip.setAttribute('data-offer-id', sliderOffer);
      }
      ui.slider.setAttribute('hidden', '');
      ui.chip.removeAttribute('hidden');
      lastSliderKey = null;
    });
    ui.chip.addEventListener('click', function () {
      // Un-dismiss only the offer this chip represents, not every offer.
      var offerId = ui.chip.getAttribute('data-offer-id');
      var dismissed = getDismissed();
      if (offerId) delete dismissed[offerId];
      else dismissed = {};
      setDismissed(dismissed);
      ui.chip.setAttribute('hidden', '');
      lastSliderKey = null;
      requestReconcile();
    });
    return ui;
  }

  function announce(text) {
    if (ui && ui.live) { ui.live.textContent = ''; ui.live.textContent = text; }
  }

  function renderUI(cart) {
    ensureUI();
    var dismissed = getDismissed();

    // Track ineligible→eligible transitions for the "unlocked" flash.
    OFFERS.forEach(function (o) {
      if (!isEligible(o, cart)) wasEverIneligible[o.id] = true;
    });

    // --- Slider -------------------------------------------------------------
    // In the theme editor, show the slider regardless of the preview cart's
    // eligibility so the merchant can see and style what they're configuring.
    var sliderOffer = null;
    for (var i = 0; i < OFFERS.length; i++) {
      if (OFFERS[i].type === 'slider' && (DESIGN_MODE || isEligible(OFFERS[i], cart))) { sliderOffer = OFFERS[i]; break; }
    }

    if (sliderOffer && dismissed[sliderOffer.id]) {
      ui.slider.setAttribute('hidden', '');
      ui.chip.setAttribute('data-offer-id', sliderOffer.id);
      ui.chip.removeAttribute('hidden');
    } else if (sliderOffer) {
      ui.chip.setAttribute('hidden', '');
      renderSlider(sliderOffer, cart);
    } else {
      ui.slider.setAttribute('hidden', '');
      ui.chip.setAttribute('hidden', '');
      lastSliderKey = null;
    }

    // --- Teaser / unlocked flash ---------------------------------------------
    renderTeaser(cart, !!sliderOffer && !dismissed[sliderOffer && sliderOffer.id]);
  }

  function renderTeaser(cart, sliderVisible) {
    var subtotal = qualifyingSubtotalCents(cart);
    var hasPaidItems = paidItems(cart).length > 0;
    var teaserEnabled = CONFIG.showTeaser !== false;

    // Closest not-yet-met spend threshold across teaser-enabled offers.
    var best = null;
    OFFERS.forEach(function (offer) {
      if (!offer.showTeaser || offer._disabled || !withinSchedule(offer)) return;
      var threshold = thresholdFor(offer);
      if (threshold == null || subtotal >= threshold) return;
      if (offer.buy && buyCount(offer, cart) < offer.buy.quantity) return; // buy rule unmet: teaser would mislead
      var remaining = threshold - subtotal;
      if (!best || remaining < best.remaining) best = { offer: offer, remaining: remaining, threshold: threshold };
    });

    // "Unlocked" flash: a spend offer just became eligible this page view.
    var justUnlocked = OFFERS.some(function (o) {
      return wasEverIneligible[o.id] && isEligible(o, cart) && thresholdFor(o) != null && o.showTeaser;
    });

    if (!teaserEnabled || sliderVisible || !hasPaidItems || (!best && !justUnlocked)) {
      ui.teaser.setAttribute('hidden', '');
      ui.teaser.classList.remove('is-unlocked');
      return;
    }

    if (best) {
      ui.teaser.classList.remove('is-unlocked');
      ui.teaserText.textContent = STRINGS.teaserText.replace('{amount}', formatMoney(best.remaining));
      ui.teaserFill.style.width = Math.min(100, Math.round((subtotal / best.threshold) * 100)) + '%';
      ui.teaser.removeAttribute('hidden');
    } else if (justUnlocked) {
      ui.teaser.classList.add('is-unlocked');
      ui.teaserText.textContent = STRINGS.unlockedText;
      ui.teaserFill.style.width = '100%';
      ui.teaser.removeAttribute('hidden');
      announce(STRINGS.unlockedText);
      if (unlockedTimer) clearTimeout(unlockedTimer);
      unlockedTimer = setTimeout(function () {
        ui.teaser.setAttribute('hidden', '');
        ui.teaser.classList.remove('is-unlocked');
        OFFERS.forEach(function (o) { delete wasEverIneligible[o.id]; });
      }, 4000);
    }
  }

  function renderSlider(offer, cart) {
    var chosen = giftLinesFor(cart, offer.id).map(function (l) { return String(l.variant_id); });
    var key = offer.id + '|' + chosen.join(',');
    ui.slider.setAttribute('data-offer-id', offer.id);
    ui.sliderTitle.textContent = offer.title || STRINGS.sliderTitle;
    ui.sliderSubtitle.textContent = STRINGS.sliderSubtitle;
    ui.slider.removeAttribute('hidden');
    if (key === lastSliderKey) return; // avoid re-render flicker
    lastSliderKey = key;

    ui.sliderItems.innerHTML = '';
    offer.gifts.forEach(function (gift) {
      var card = document.createElement('div');
      card.className = 'gd-card';
      card.innerHTML = '<div class="gd-card__skeleton"></div>';
      ui.sliderItems.appendChild(card);

      Promise.all([getProduct(gift.handle), resolveGiftVariant(gift)]).then(function (results) {
        var product = results[0];
        var variantId = results[1];
        if (!variantId) { card.remove(); return; }
        var title = (product && product.title) || 'Free gift';
        var img = product && (product.featured_image || (product.images && product.images[0]));
        var isChosen = chosen.indexOf(String(variantId)) !== -1;

        card.setAttribute('data-variant-id', String(variantId));
        card.className = 'gd-card' + (isChosen ? ' is-selected' : '');
        card.innerHTML =
          (img ? '<img class="gd-card__img" src="' + img + '" alt="" loading="lazy">' : '') +
          '<div class="gd-card__title"></div>' +
          '<div class="gd-card__price">' + (gift.label || STRINGS.freeLabel) + '</div>' +
          '<button type="button" class="gd-card__btn"' + (DESIGN_MODE ? ' disabled' : '') + '>' +
            (isChosen ? STRINGS.addedLabel : STRINGS.addLabel) +
          '</button>';
        card.querySelector('.gd-card__title').textContent = title; // textContent: titles may contain HTML chars
        card.querySelector('.gd-card__btn').addEventListener('click', function () {
          chooseGift(offer, gift, variantId, title);
        });
      });
    });
  }

  var choosing = false; // one selection at a time — blocks races between cards

  function setCardButtonsDisabled(disabled) {
    var buttons = ui.sliderItems.querySelectorAll('.gd-card__btn');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = disabled;
  }

  function chooseGift(offer, gift, variantId, title) {
    if (DESIGN_MODE || choosing) return;
    choosing = true;
    setCardButtonsDisabled(true);
    getCart().then(function (cart) {
      if (!isEligible(offer, cart)) return null; // cart changed under us
      var existing = giftLinesFor(cart, offer.id);
      var hadThis = existing.some(function (l) { return String(l.variant_id) === String(variantId); });
      var chain = Promise.resolve();
      existing.forEach(function (line) {
        chain = chain.then(function () { return removeLine(line.key); });
      });
      return chain.then(function () {
        if (hadThis) {
          announce(title + ' removed');
          return null; // toggle off
        }
        return addGift(variantId, gift.quantity, offer.id).then(function () {
          announce(title + ' added as your free gift');
        }).catch(function (e) {
          warn('Could not add gift: ' + e.message);
        });
      });
    }).catch(function (e) {
      warn('gift selection failed:', e.message);
    }).then(function () {
      choosing = false;
      setCardButtonsDisabled(false);
      lastSliderKey = null; // force selection-state re-render
      refreshThemeUI();
      requestReconcile();
    });
  }

  // --------------------------------------------------------------------------
  // Detect cart writes (fetch + XHR) and re-evaluate
  // --------------------------------------------------------------------------
  // Deliberately including OUR OWN writes: the follow-up reconcile re-validates
  // against the true post-mutation cart, closing races with theme writes that
  // land while ours are in flight. Reconcile is idempotent, so a converged cart
  // costs one extra GET /cart.js and no further mutations — no loops.
  var CART_WRITE_RE = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      // input may be a string, a Request (.url), or a URL (.href)
      var url = typeof input === 'string' ? input : ((input && (input.url || input.href)) || '');
      var result = origFetch.apply(this, arguments);
      if (CART_WRITE_RE.test(url)) {
        result.then(scheduleReconcile, function () {});
      }
      return result;
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gdCartWrite = CART_WRITE_RE.test(String(url));
    return origOpen.apply(this, arguments);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__gdCartWrite) {
      this.addEventListener('loadend', scheduleReconcile);
    }
    return origSend.apply(this, arguments);
  };

  // Re-check when the tab becomes visible again (cart may have changed in
  // another tab) and on bfcache restores.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleReconcile();
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) scheduleReconcile();
  });

  // --------------------------------------------------------------------------
  // Boot
  // --------------------------------------------------------------------------
  function boot() {
    log('boot:', OFFERS.length, 'offer(s)', DESIGN_MODE ? '(theme editor: read-only)' : '');
    requestReconcile();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
