'use strict';

/* Merchant settings screen. All /api/admin/* calls reuse the HTTP Basic auth
   the browser already holds from loading /admin. */

const $ = (sel) => document.querySelector(sel);
let settings = null;
let upsellIds = [];
const titles = new Map(); // variantId -> { title, variantTitle, price }

// Hide broken product images (CSP forbids inline onerror handlers).
document.addEventListener('error', (e) => {
  if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
}, true);

function toast(msg, type = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function img(url, cls) {
  return url ? `<img class="${cls || ''}" src="${esc(url)}" alt="" />` : `<span class="imgph ${cls || ''}"></span>`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

/* ------------------------------------------------------------------- load */

async function load() {
  try {
    const [s, shopInfo, activity] = await Promise.all([
      getJSON('/api/admin/settings'),
      getJSON('/api/admin/shop').catch(() => null),
      getJSON('/api/admin/activity').catch(() => null),
    ]);
    settings = s;
    if (shopInfo && shopInfo.shop) $('#shopName').textContent = `${shopInfo.shop.name} · ${shopInfo.shop.myshopifyDomain}`;
    applySettings(s);
    renderActivity(activity);
    renderSnippets((shopInfo && shopInfo.publicUrl) || location.origin);
    upsellIds = Array.isArray(s.upsellVariantIds) ? s.upsellVariantIds.slice() : [];
    if (upsellIds.length) {
      const data = await getJSON('/api/admin/resolve-variants?ids=' + encodeURIComponent(upsellIds.join(',')));
      data.variants.forEach((v) => titles.set(v.id, v));
    }
    renderChips();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderActivity(a) {
  const tiles = $('#activityTiles');
  const recent = $('#activityRecent');
  if (!a) { tiles.innerHTML = '<p class="muted small">Could not load activity.</p>'; return; }
  const by = a.byType || {};
  const tile = (num, lbl) => `<div class="tile"><div class="num">${esc(num)}</div><div class="lbl">${esc(lbl)}</div></div>`;
  tiles.innerHTML =
    tile(by.address || 0, 'Address fixes') +
    tile((by.swap || 0) + (by.quantity || 0), 'Item changes') +
    tile(by.upsell || 0, 'Items added') +
    tile(money(a.upsellInvoiced + a.balancesInvoiced), 'Revenue invoiced') +
    tile(by.cancel || 0, 'Cancellations');
  const rows = (a.recent || []).map((e) => {
    const when = new Date(e.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const extra = e.value ? ` · ${money(e.value)}` : '';
    return `<div class="evt"><span>${esc(when)}</span><span class="etype">${esc(e.type)}</span><span>${esc(e.orderName || '')}${esc(extra)}</span></div>`;
  }).join('');
  recent.innerHTML = rows || '<p class="muted small">No portal activity yet.</p>';
}

function renderSnippets(base) {
  const clean = String(base).replace(/\/$/, '');
  $('#snippetStatus').textContent =
`<div style="margin:16px 0;text-align:center">
  <a href="${clean}/?order={{ checkout.order_number }}&email={{ checkout.email | url_encode }}"
     style="display:inline-block;padding:12px 22px;background:#6f4e37;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
    Need to change your order?
  </a>
  <p style="color:#8a7d72;font-size:13px;margin-top:8px">Fix your address, swap an item, or add to your order before it ships.</p>
</div>`;
  $('#snippetEmail').textContent =
`<table role="presentation" width="100%"><tr><td align="center" style="padding:18px 0">
  <a href="${clean}/?order={{ order.order_number }}&email={{ order.email | url_encode }}"
     style="display:inline-block;padding:12px 22px;background:#6f4e37;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
    Need to change your order?
  </a>
</td></tr></table>`;
}

function applySettings(s) {
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v; };
  const check = (id, v) => { const el = $('#' + id); if (el) el.checked = Boolean(v); };
  check('allowAddressEdit', s.allowAddressEdit);
  check('allowVariantSwap', s.allowVariantSwap);
  check('allowUpsell', s.allowUpsell);
  check('allowQuantityEdit', s.allowQuantityEdit);
  check('allowItemRemoval', s.allowItemRemoval);
  check('allowCancel', s.allowCancel);
  check('allowPricedSwaps', s.allowPricedSwaps);
  check('notifyCustomerOnEdit', s.notifyCustomerOnEdit);
  check('invoiceForBalance', s.invoiceForBalance);
  set('editWindowMinutes', s.editWindowMinutes);
  set('upsellDiscountPercent', s.upsellDiscountPercent);
  set('swapPriceTolerance', s.swapPriceTolerance ?? 0);
  set('upsellHeading', s.upsellHeading || '');
  set('upsellSubheading', s.upsellSubheading || '');
  set('excludeProductTags', (s.excludeProductTags || []).join(', '));
}

function renderChips() {
  $('#upsellChips').innerHTML = upsellIds.length
    ? upsellIds.map((id) => {
        const t = titles.get(id);
        const label = t ? `${t.title}${t.variantTitle ? ' · ' + t.variantTitle : ''} (${money(t.price)})` : id;
        const stock = t && t.availableForSale === false ? ' — out of stock' : '';
        return `<span class="chip">${esc(label + stock)}<button data-id="${esc(id)}" title="Remove" aria-label="Remove ${esc(label)}">✕</button></span>`;
      }).join('')
    : '<p class="muted small">No upsell products yet — search below to add some.</p>';
}

/* ------------------------------------------------------------------ events */

$('#upsellChips').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  upsellIds = upsellIds.filter((id) => id !== e.target.dataset.id);
  renderChips();
});

let searchTimer = null;
$('#productSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => runSearch(q), 300);
});

async function runSearch(q) {
  const box = $('#searchResults');
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  try {
    const data = await getJSON('/api/admin/search-products?q=' + encodeURIComponent(q));
    box.hidden = false;
    box.innerHTML = data.products.map((p) => `
      <div class="presult">
        ${img(p.image)}
        <div style="flex:1">
          <div><strong>${esc(p.title)}</strong> ${p.status !== 'ACTIVE' ? '<span class="pill">' + esc(p.status) + '</span>' : ''}</div>
          <div>${p.variants.map((v) => `<button class="btn ghost vbtn add-variant" data-id="${esc(v.id)}" data-title="${esc(p.title)}" data-vt="${esc(v.title)}" data-price="${v.price}"${v.availableForSale ? '' : ' disabled title="Out of stock"'}>${esc(v.title === 'Default Title' ? 'Add' : v.title)} · ${money(v.price)}</button>`).join(' ')}</div>
        </div>
      </div>`).join('') || '<div class="presult muted">No products found.</div>';
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#searchResults').addEventListener('click', (e) => {
  const btn = e.target.closest('.add-variant');
  if (!btn) return;
  const id = btn.dataset.id;
  if (upsellIds.includes(id)) { toast('Already added.', 'ok'); return; }
  if (upsellIds.length >= 8) { toast('Maximum of 8 upsell products.', 'err'); return; }
  upsellIds.push(id);
  titles.set(id, { title: btn.dataset.title, variantTitle: btn.dataset.vt !== 'Default Title' ? btn.dataset.vt : null, price: Number(btn.dataset.price), availableForSale: true });
  renderChips();
  toast('Added.', 'ok');
});

$('#saveBtn').addEventListener('click', async () => {
  const payload = {
    allowAddressEdit: $('#allowAddressEdit').checked,
    allowVariantSwap: $('#allowVariantSwap').checked,
    allowUpsell: $('#allowUpsell').checked,
    allowQuantityEdit: $('#allowQuantityEdit').checked,
    allowItemRemoval: $('#allowItemRemoval').checked,
    allowCancel: $('#allowCancel').checked,
    allowPricedSwaps: $('#allowPricedSwaps').checked,
    notifyCustomerOnEdit: $('#notifyCustomerOnEdit').checked,
    invoiceForBalance: $('#invoiceForBalance').checked,
    editWindowMinutes: Number($('#editWindowMinutes').value),
    upsellDiscountPercent: Number($('#upsellDiscountPercent').value),
    swapPriceTolerance: Number($('#swapPriceTolerance').value),
    upsellHeading: $('#upsellHeading').value,
    upsellSubheading: $('#upsellSubheading').value,
    excludeProductTags: $('#excludeProductTags').value.split(',').map((s) => s.trim()).filter(Boolean),
    upsellVariantIds: upsellIds,
  };
  const btn = $('#saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
    settings = await res.json();
    toast('Settings saved.', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Save settings';
  }
});

function wireCopy(btnId, preId) {
  $(btnId).addEventListener('click', () => {
    navigator.clipboard.writeText($(preId).textContent);
    toast('Copied!', 'ok');
  });
}
wireCopy('#copyStatus', '#snippetStatus');
wireCopy('#copyEmail', '#snippetEmail');

$('#linkBtn').addEventListener('click', async () => {
  const order = $('#linkOrder').value.trim();
  const email = $('#linkEmail').value.trim();
  if (!order || !email) { toast('Enter an order number and email.', 'err'); return; }
  try {
    const data = await getJSON(`/api/admin/link?order=${encodeURIComponent(order)}&email=${encodeURIComponent(email)}`);
    $('#linkOut').innerHTML = `<code>${esc(data.url)}</code> <button class="btn ghost vbtn" id="copyLink">Copy</button>`;
    $('#copyLink').onclick = () => { navigator.clipboard.writeText(data.url); toast('Copied!', 'ok'); };
  } catch (err) {
    $('#linkOut').textContent = '';
    toast(err.message, 'err');
  }
});

load();
