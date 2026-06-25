/*
 * Grounded Drops — Gift Offers
 * -----------------------------------------------------------------------------
 * A theme app extension that replaces the "auto-add free gift" and
 * "customer chooses their gift" behaviour of BOGOS.
 *
 * What this file DOES:
 *   - Watches the Shopify cart (/cart.js).
 *   - Auto-adds qualifying free gifts when a cart meets an offer's condition.
 *   - Renders a "pick your free gift" slider for customer-choice offers.
 *   - Removes gifts again when the cart no longer qualifies.
 *
 * What this file does NOT do:
 *   - It does NOT set the gift price to $0. That is handled — for free — by a
 *     native Shopify "Automatic discount" (see SETUP.md). This separation is
 *     deliberate: it keeps pricing authoritative on Shopify's side so a shopper
 *     can never keep a gift for free by editing the cart in devtools.
 *
 * Gift cart lines are tagged with a line item property `_gift: <offerId>` so we
 * can find and manage them.
 */
(function () {
  'use strict';

  var CONFIG = window.GroundedGiftOffers || {};
  var GIFT_PROP = '_gift';

  function log() {
    if (CONFIG.debug && window.console) {
      var args = ['[GiftOffers]'].concat([].slice.call(arguments));
      console.log.apply(console, args);
    }
  }

  // ---- Parse offers -------------------------------------------------------
  function parseOffers(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      log('Could not parse Offers JSON:', e.message);
      return [];
    }
  }

  var OFFERS = parseOffers(CONFIG.offersRaw).filter(function (o) {
    return o && o.id && o.type;
  });

  if (!OFFERS.length) {
    log('No valid offers configured. Nothing to do.');
    return;
  }

  // ---- Small helpers ------------------------------------------------------
  function toCents(n) { return typeof n === 'number' ? n : parseInt(n, 10) || 0; }

  function asIdList(value) {
    if (value == null) return [];
    var arr = Array.isArray(value) ? value : [value];
    return arr.map(function (v) { return String(v); });
  }

  function formatMoney(cents) {
    var amount = (toCents(cents) / 100).toFixed(2);
    var fmt = CONFIG.moneyFormat || '${{amount}}';
    return fmt.replace(/\{\{\s*amount[^}]*\}\}/, amount);
  }

  // ---- Cart operation queue (serialise writes to avoid races) -------------
  var internalOp = false;
  var queue = Promise.resolve();

  function enqueue(task) {
    queue = queue.then(task).catch(function (e) { log('Cart op failed:', e); });
    return queue;
  }

  function cartFetch(url, options) {
    internalOp = true;
    return fetch(url, options)
      .then(function (res) { return res.json(); })
      .finally(function () { internalOp = false; });
  }

  function getCart() {
    return fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); });
  }

  function addGift(variantId, quantity, offerId) {
    log('Adding gift', variantId, 'for offer', offerId);
    return cartFetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        items: [{
          id: Number(variantId),
          quantity: quantity || 1,
          properties: (function () { var p = {}; p[GIFT_PROP] = offerId; return p; })()
        }]
      })
    });
  }

  function removeLine(key) {
    log('Removing gift line', key);
    return cartFetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ id: key, quantity: 0 })
    });
  }

  // ---- Eligibility --------------------------------------------------------
  function giftLinesFor(cart, offerId) {
    return cart.items.filter(function (item) {
      return item.properties && String(item.properties[GIFT_PROP]) === String(offerId);
    });
  }

  function nonGiftItems(cart) {
    return cart.items.filter(function (item) {
      return !(item.properties && item.properties[GIFT_PROP]);
    });
  }

  // Subtotal of everything the customer is actually paying for (gifts excluded).
  function qualifyingSubtotal(cart) {
    return nonGiftItems(cart).reduce(function (sum, item) {
      return sum + (item.final_line_price || item.line_price || 0);
    }, 0);
  }

  function isEligible(offer, cart) {
    var items = nonGiftItems(cart);

    if (offer.minSubtotal && qualifyingSubtotal(cart) < toCents(offer.minSubtotal)) {
      return false;
    }

    if (offer.requiredVariantId || offer.requiredProductId) {
      var wantVariants = asIdList(offer.requiredVariantId);
      var wantProducts = asIdList(offer.requiredProductId);
      var qty = 0;
      items.forEach(function (item) {
        var matchVariant = wantVariants.length && wantVariants.indexOf(String(item.variant_id)) !== -1;
        var matchProduct = wantProducts.length && wantProducts.indexOf(String(item.product_id)) !== -1;
        if (matchVariant || matchProduct) qty += item.quantity;
      });
      var need = offer.requiredQuantity || 1;
      if (qty < need) return false;
    }

    return true;
  }

  // ---- Product info cache (for the slider UI) -----------------------------
  var productCache = {};
  function getProduct(handle) {
    if (productCache[handle]) return productCache[handle];
    productCache[handle] = fetch('/products/' + handle + '.js')
      .then(function (res) {
        if (!res.ok) throw new Error('product ' + handle + ' not found');
        return res.json();
      })
      .catch(function (e) { log(e.message); return null; });
    return productCache[handle];
  }

  function giftVariantId(giftDef, product) {
    if (giftDef.variantId) return Number(giftDef.variantId);
    if (product && product.variants) {
      var available = product.variants.filter(function (v) { return v.available; })[0];
      return (available || product.variants[0]).id;
    }
    return null;
  }

  // ---- Reconciliation: make the cart match the offers ---------------------
  // Returns true if it issued any cart writes (so we can refresh the theme UI).
  function reconcile() {
    return getCart().then(function (cart) {
      var changed = false;
      var chain = Promise.resolve();

      OFFERS.forEach(function (offer) {
        var eligible = isEligible(offer, cart);
        var existing = giftLinesFor(cart, offer.id);

        if (offer.type === 'slider') {
          // Slider gifts are chosen by the shopper; we only auto-REMOVE them
          // when the cart stops qualifying. Adding/switching happens on click.
          if (!eligible && existing.length) {
            existing.forEach(function (line) {
              chain = chain.then(function () { changed = true; return removeLine(line.key); });
            });
          }
          return;
        }

        // type === 'auto' or 'bogo': fully automatic.
        var variantId = offer.giftVariantId || offer.getVariantId;
        var quantity = offer.giftQuantity || offer.getQuantity || 1;

        if (eligible && variantId && !existing.length) {
          chain = chain.then(function () { changed = true; return addGift(variantId, quantity, offer.id); });
        } else if (!eligible && existing.length) {
          existing.forEach(function (line) {
            chain = chain.then(function () { changed = true; return removeLine(line.key); });
          });
        }
      });

      return chain.then(function () {
        renderSliders(cart);
        return changed;
      });
    });
  }

  // ---- Gift slider UI -----------------------------------------------------
  var sliderEl = null;

  function ensureSliderRoot() {
    if (sliderEl) return sliderEl;
    sliderEl = document.createElement('div');
    sliderEl.className = 'gd-gift-slider gd-gift-slider--' + (CONFIG.position === 'top' ? 'top' : 'bottom');
    sliderEl.setAttribute('hidden', '');
    sliderEl.innerHTML =
      '<button class="gd-gift-slider__close" aria-label="Close">×</button>' +
      '<div class="gd-gift-slider__head">' +
        '<span class="gd-gift-slider__title"></span>' +
        '<span class="gd-gift-slider__subtitle"></span>' +
      '</div>' +
      '<div class="gd-gift-slider__items"></div>';
    sliderEl.querySelector('.gd-gift-slider__close').addEventListener('click', function () {
      sliderEl.setAttribute('hidden', '');
    });
    document.body.appendChild(sliderEl);
    return sliderEl;
  }

  function renderSliders(cart) {
    var sliderOffers = OFFERS.filter(function (o) { return o.type === 'slider' && isEligible(o, cart); });
    if (!sliderOffers.length) {
      if (sliderEl) sliderEl.setAttribute('hidden', '');
      return;
    }

    var root = ensureSliderRoot();
    var offer = sliderOffers[0]; // show one slider at a time
    root.querySelector('.gd-gift-slider__title').textContent = offer.title || CONFIG.sliderTitle || 'Pick your free gift';
    root.querySelector('.gd-gift-slider__subtitle').textContent = CONFIG.sliderSubtitle || '';

    var itemsEl = root.querySelector('.gd-gift-slider__items');
    itemsEl.innerHTML = '';

    var chosen = giftLinesFor(cart, offer.id).map(function (l) { return String(l.variant_id); });
    var gifts = offer.gifts || [];

    gifts.forEach(function (giftDef) {
      var handle = giftDef.handle;
      var card = document.createElement('div');
      card.className = 'gd-gift-card';
      card.textContent = 'Loading…';
      itemsEl.appendChild(card);

      getProduct(handle).then(function (product) {
        if (!product) { card.remove(); return; }
        var vId = giftVariantId(giftDef, product);
        var img = (product.featured_image) ? product.featured_image : (product.images && product.images[0]);
        var isChosen = chosen.indexOf(String(vId)) !== -1;
        card.className = 'gd-gift-card' + (isChosen ? ' is-selected' : '');
        card.innerHTML =
          (img ? '<img class="gd-gift-card__img" src="' + img + '" alt="" loading="lazy">' : '') +
          '<div class="gd-gift-card__title">' + product.title + '</div>' +
          '<div class="gd-gift-card__price">' + (giftDef.label || 'FREE') + '</div>' +
          '<button class="gd-gift-card__btn">' + (isChosen ? '✓ Added' : 'Add free gift') + '</button>';
        card.querySelector('.gd-gift-card__btn').addEventListener('click', function () {
          chooseGift(offer, vId);
        });
      });
    });

    root.removeAttribute('hidden');
  }

  // Customer clicked a gift in the slider: enforce one gift per slider offer.
  function chooseGift(offer, variantId) {
    enqueue(function () {
      return getCart().then(function (cart) {
        var existing = giftLinesFor(cart, offer.id);
        var alreadyThis = existing.some(function (l) { return String(l.variant_id) === String(variantId); });
        var removeOthers = Promise.resolve();
        existing.forEach(function (line) {
          if (String(line.variant_id) !== String(variantId)) {
            removeOthers = removeOthers.then(function () { return removeLine(line.key); });
          }
        });
        return removeOthers.then(function () {
          if (alreadyThis) return null; // toggle off handled by re-render; keep it added
          return addGift(variantId, offer.giftQuantity || 1, offer.id);
        });
      });
    }).then(refreshThemeCart);
  }

  // ---- Refresh the theme's cart UI after we mutate the cart ---------------
  // Cart-drawer rendering is theme-specific. We dispatch the events the common
  // themes (Dawn and its derivatives) listen for, and reload on the cart page
  // as a guaranteed fallback. If your theme's drawer doesn't update, see the
  // "Theme refresh" section of SETUP.md.
  function refreshThemeCart() {
    try {
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      document.dispatchEvent(new CustomEvent('cart:build', { bubbles: true }));
      if (window.location.pathname === '/cart' || window.location.pathname.indexOf('/cart') === 0) {
        window.location.reload();
      }
    } catch (e) { log('refresh error', e); }
  }

  // ---- Detect external cart changes & re-evaluate -------------------------
  var pending = null;
  function scheduleReconcile() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      enqueue(reconcile).then(function (changed) {
        if (changed) refreshThemeCart();
      });
    }, 350);
  }

  // Patch fetch to notice when the THEME (not us) writes to the cart.
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var result = origFetch.apply(this, arguments);
      if (!internalOp && /\/cart\/(add|change|update|clear)/.test(url)) {
        result.then(function () { scheduleReconcile(); }).catch(function () {});
      }
      return result;
    };
  }

  // Patch XHR for older themes that still use it for cart writes.
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gdUrl = url;
    return origOpen.apply(this, arguments);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (!internalOp && /\/cart\/(add|change|update|clear)/.test(xhr.__gdUrl || '')) {
      xhr.addEventListener('load', function () { scheduleReconcile(); });
    }
    return origSend.apply(this, arguments);
  };

  // ---- Boot ---------------------------------------------------------------
  function boot() {
    log('Booting with', OFFERS.length, 'offer(s)');
    enqueue(reconcile).then(function (changed) {
      if (changed) refreshThemeCart();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
