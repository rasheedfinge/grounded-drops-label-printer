'use strict';

/* Customer portal logic: look up an order, then edit address / swap / upsell. */

const $ = (sel) => document.querySelector(sel);
let creds = null; // { token } or { orderNumber, email }
let state = null; // last /lookup response
let countdownTimer = null;

// Hide broken product images (CSP forbids inline onerror handlers).
document.addEventListener('error', (e) => {
  if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
}, true);

/* ----------------------------------------------------------------- utils */

function money(n, cur) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'AUD' }).format(Number(n) || 0);
  } catch {
    return `${cur || ''} ${(Number(n) || 0).toFixed(2)}`;
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function img(url, cls) {
  return url ? `<img class="${cls || ''}" src="${esc(url)}" alt="" />` : `<span class="imgph ${cls || ''}"></span>`;
}

function toast(msg, type = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 6000);
}

function setLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner"></span>' + (label ? ` ${esc(label)}` : '');
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

async function api(path, body) {
  const res = await fetch('/api/portal/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(creds || {}), ...(body || {}) }),
  });
  const data = await res.json().catch(() => ({ error: 'Unexpected response from the server.' }));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/* --------------------------------------------------------------- rendering */

function renderStatus(data) {
  clearInterval(countdownTimer);
  const el = $('#statusCard');
  const { eligibility } = data;
  if (eligibility.editable) {
    el.innerHTML = `<div class="banner ok" id="statusBanner"></div>`;
    startCountdown(eligibility.closesAt);
  } else {
    const reasons = (eligibility.reasons || ['This order can no longer be edited.']).map((r) => `<li>${esc(r)}</li>`).join('');
    el.innerHTML = `<div class="banner warn"><strong>This order can't be self-edited right now.</strong><ul style="margin:6px 0 0 18px;padding:0">${reasons}</ul></div>`;
  }
}

function startCountdown(closesAt) {
  const banner = $('#statusBanner');
  if (!banner || !closesAt) return;
  const tick = () => {
    const ms = closesAt - Date.now();
    if (ms <= 0) {
      clearInterval(countdownTimer);
      // Re-render from the server so the editing sections disappear too.
      refresh().catch(() => {});
      return;
    }
    const mins = Math.floor(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const left = h > 0 ? `${h}h ${m}m` : `${m}m`;
    banner.innerHTML = `<strong>You can still edit this order.</strong> Changes are open for about <strong>${left}</strong> longer.`;
  };
  tick();
  countdownTimer = setInterval(tick, 30000);
}

function renderSummary(order) {
  const items = order.lineItems.map((li) => {
    const unit = li.paidUnitPrice != null ? li.paidUnitPrice : li.unitPrice;
    return `
    <div class="li">
      ${img(li.image)}
      <div class="li-body">
        <div class="li-title">${esc(li.title)}${li.isSubscription ? '<span class="pill">subscription</span>' : ''}</div>
        <div class="li-sub">${esc(li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : '')} ${li.quantity > 1 ? '× ' + li.quantity : ''}</div>
      </div>
      <div class="li-price">${money(unit * li.quantity, order.currency)}</div>
    </div>`;
  }).join('');
  $('#summaryCard').innerHTML = `
    <div class="order-meta">
      <span class="name">Order ${esc(order.name)}</span>
      <span class="muted">Total ${money(order.total, order.currency)}</span>
    </div>
    ${items}`;
}

function renderAddress(data) {
  const card = $('#addressCard');
  if (!data.permissions.address) { card.hidden = true; return; }
  card.hidden = false;
  const a = data.order.shippingAddress || {};
  const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
  set('#a_firstName', a.firstName);
  set('#a_lastName', a.lastName);
  set('#a_address1', a.address1);
  set('#a_address2', a.address2);
  set('#a_city', a.city);
  set('#a_province', a.province);
  set('#a_zip', a.zip);
  set('#a_country', a.country);
  set('#a_phone', a.phone);
  // Country is locked once set: shipping was priced for that destination.
  const country = $('#a_country');
  const locked = Boolean(a.country);
  country.readOnly = locked;
  country.classList.toggle('locked', locked);
  $('#countryHint').hidden = !locked;
  // Postcode requirement mirrors the original address.
  $('#a_zip').required = Boolean(a.zip);
}

/** Build the swap <select>, grouping by the first product option (e.g. Blend)
    so 100-variant products stay navigable. */
function fillSwapSelect(select, data) {
  const opts = data.options || [];
  if (!opts.length) {
    select.innerHTML = '<option value="">No other options available</option>';
    return false;
  }
  const placeholder = '<option value="">Choose an option…</option>';
  const grouped = opts.some((o) => (o.options || []).length > 1);
  if (!grouped) {
    select.innerHTML = placeholder + opts.map((o) =>
      `<option value="${esc(o.variantId)}">${esc(o.title)} — ${money(o.price, data.currency)}</option>`).join('');
    return true;
  }
  const groups = new Map();
  for (const o of opts) {
    const key = (o.options && o.options[0] && o.options[0].value) || 'Options';
    const label = (o.options || []).slice(1).map((x) => x.value).join(' / ') || o.title;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...o, label });
  }
  select.innerHTML = placeholder + [...groups.entries()].map(([key, list]) =>
    `<optgroup label="${esc(key)}">` +
    list.map((o) => `<option value="${esc(o.variantId)}">${esc(o.label)} — ${money(o.price, data.currency)}</option>`).join('') +
    '</optgroup>'
  ).join('');
  return true;
}

function renderSwap(data) {
  const card = $('#swapCard');
  const swappable = data.order.lineItems.filter((li) => li.swappable);
  if (!data.permissions.swap || swappable.length === 0) { card.hidden = true; return; }
  card.hidden = false;
  $('#swapList').innerHTML = swappable.map((li) => `
    <div class="swap-row" data-line="${esc(li.id)}">
      <div class="swap-head">
        <div>
          <div class="li-title">${esc(li.title)}</div>
          <div class="li-sub">Currently: ${esc(li.variantTitle || '—')}</div>
        </div>
        <button type="button" class="btn ghost swap-toggle">Change</button>
      </div>
      <div class="swap-controls">
        <label>New option
          <select class="swap-select"><option>Loading…</option></select>
        </label>
        <button type="button" class="btn primary swap-save" disabled>Save change</button>
      </div>
    </div>`).join('');
}

function renderUpsell(data) {
  const card = $('#upsellCard');
  const offers = (data.upsell && data.upsell.offers) || [];
  if (!data.permissions.upsell || offers.length === 0) { card.hidden = true; return; }
  card.hidden = false;
  $('#upsellHeading').textContent = data.upsell.heading || 'Add to your order';
  $('#upsellSubheading').textContent = data.upsell.subheading || '';
  const cur = data.order.currency;
  $('#upsellGrid').innerHTML = offers.map((o) => `
    <div class="offer" data-variant="${esc(o.variantId)}">
      ${img(o.image, 'offer-img')}
      <div class="offer-title">${esc(o.title)}</div>
      <div class="offer-sub">${esc(o.variantTitle || '')}</div>
      <div class="offer-price">
        ${o.discountPercent > 0 ? `<span class="was">${money(o.price, cur)}</span>` : ''}
        <span class="now">${money(o.discountedPrice, cur)}</span>
        ${o.discountPercent > 0 ? `<span class="pill">${o.discountPercent}% off</span>` : ''}
      </div>
      <button type="button" class="btn primary upsell-add">Add to order</button>
    </div>`).join('');
}

function render(data) {
  $('#brand').textContent = (data.store && data.store.storeName) || 'Order editor';
  $('#lookupCard').hidden = true;
  $('#orderView').hidden = false;
  renderStatus(data);
  renderSummary(data.order);
  renderAddress(data);
  renderSwap(data);
  renderUpsell(data);
}

async function refresh() {
  const data = await api('lookup', {});
  // Once ownership is proven, switch to the signed session token so later
  // calls skip the order search (and survive typos in re-entered details).
  if (data.sessionToken) creds = { token: data.sessionToken };
  state = data;
  render(data);
}

/* ----------------------------------------------------------------- events */

$('#lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#lookupBtn');
  creds = { orderNumber: $('#orderNumber').value.trim(), email: $('#email').value.trim() };
  setLoading(btn, true, 'Finding…');
  try {
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setLoading(btn, false);
  }
});

$('#addressForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#addressBtn');
  const address = {
    firstName: $('#a_firstName').value, lastName: $('#a_lastName').value,
    address1: $('#a_address1').value, address2: $('#a_address2').value,
    city: $('#a_city').value, province: $('#a_province').value,
    zip: $('#a_zip').value, country: $('#a_country').value, phone: $('#a_phone').value,
  };
  setLoading(btn, true, 'Saving…');
  try {
    const data = await api('address', { address });
    toast(data.message || 'Address updated.', 'ok');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setLoading(btn, false);
  }
});

// Swap: expand a row, load options on demand, then save.
$('#swapList').addEventListener('click', async (e) => {
  const row = e.target.closest('.swap-row');
  if (!row) return;
  const lineItemId = row.dataset.line;

  if (e.target.classList.contains('swap-toggle')) {
    const controls = row.querySelector('.swap-controls');
    if (controls.classList.contains('open')) { controls.classList.remove('open'); return; }
    controls.classList.add('open');
    const select = row.querySelector('.swap-select');
    const save = row.querySelector('.swap-save');
    try {
      const data = await api('swap-options', { lineItemId });
      const hasOptions = fillSwapSelect(select, data);
      if (hasOptions) {
        select.onchange = () => { save.disabled = !select.value; };
      }
    } catch (err) {
      select.innerHTML = '<option>Could not load options</option>';
      toast(err.message, 'err');
    }
  }

  if (e.target.classList.contains('swap-save')) {
    const select = row.querySelector('.swap-select');
    const newVariantId = select.value;
    if (!newVariantId) return;
    setLoading(e.target, true, 'Saving…');
    try {
      const data = await api('swap', { lineItemId, newVariantId });
      toast(data.message || 'Item updated.', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'err');
      setLoading(e.target, false);
    }
  }
});

// Upsell: add a configured offer.
$('#upsellGrid').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('upsell-add')) return;
  const card = e.target.closest('.offer');
  const variantId = card.dataset.variant;
  setLoading(e.target, true, 'Adding…');
  try {
    const data = await api('upsell', { variantId, quantity: 1 });
    toast(data.message || 'Added to your order.', 'ok');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
    setLoading(e.target, false);
  }
});

/* ------------------------------------------------------------------- init */

(function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    creds = { token };
    refresh().catch((err) => {
      $('#lookupCard').hidden = false;
      toast(err.message, 'err');
    });
  }
})();
