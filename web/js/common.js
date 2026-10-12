// common.js - shared by every page: navbar, "acting as" guest switcher,
// API helper, loading / empty / error states, pagination, panel, toast.

const PAGES = [
  { href: 'index.html', label: 'Browse' },
  { href: 'book.html', label: 'Book a stay' },
  { href: 'audit.html', label: 'Wallet audit' },
  { href: 'analytics.html', label: 'Analytics' },
  { href: 'map.html', label: 'Search map' },
  { href: 'reviews.html', label: 'Reviews' },
];

// ---------- API ----------
// Calls the backend and returns JSON. On failure throws an Error whose
// message is the friendly text the server sent ({ error: "..." }).
async function api(path, options = {}) {
  const opts = { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (e) {
    throw new Error('Cannot reach the StaySpot server. Is it running (npm start)?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- formatting ----------
const money = (v) => (v === null || v === undefined ? '–' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const int = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-IN'));
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '–');
const dateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const badge = (s) => `<span class="badge badge-${s}">${s.replace('_', ' ')}</span>`;
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- loading / empty / error states ----------
// Every screen uses these so nothing is ever a blank page.
function showLoading(el, text = 'Loading…') { el.innerHTML = `<div class="state"><div class="spinner"></div>${esc(text)}</div>`; }
function showEmpty(el, text = 'Nothing to show yet.') { el.innerHTML = `<div class="state">${esc(text)}</div>`; }
function showError(el, err, retry) {
  el.innerHTML = `<div class="state error">⚠ ${esc(err.message || err)}${retry ? '<br><button class="btn btn-secondary btn-sm mt">Try again</button>' : ''}</div>`;
  if (retry) el.querySelector('button').onclick = retry;
}

// Runs an async loader with loading + error handling around it.
async function load(el, fn, loadingText) {
  showLoading(el, loadingText);
  try { await fn(); } catch (e) { showError(el, e, () => load(el, fn, loadingText)); }
}

// ---------- table + pagination ----------
// columns: [{ label, render(row) => html, num: true }]
function renderTable(el, rows, columns, { onRowClick, rowClass } = {}) {
  if (!rows.length) return showEmpty(el, 'No matching records.');
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}">
      ${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  if (onRowClick) el.querySelectorAll('tbody tr').forEach((tr) => { tr.onclick = () => onRowClick(rows[tr.dataset.i]); });
}

function renderPager(el, { page, limit, total }, goTo) {
  const pages = Math.max(1, Math.ceil(total / limit));
  el.innerHTML = `<span class="muted small">${int(total)} records · page ${page} of ${int(pages)}</span>
    <button class="btn btn-secondary btn-sm" data-p="1" ${page <= 1 ? 'disabled' : ''}>« First</button>
    <button class="btn btn-secondary btn-sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <button class="btn btn-secondary btn-sm" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next ›</button>
    <button class="btn btn-secondary btn-sm" data-p="${pages}" ${page >= pages ? 'disabled' : ''}>Last »</button>`;
  el.querySelectorAll('button').forEach((b) => { b.onclick = () => goTo(Number(b.dataset.p)); });
}

// ---------- slide-over panel ----------
function openPanel(html) {
  let panel = $('#panel');
  if (!panel) {
    document.body.insertAdjacentHTML('beforeend', '<div class="panel-backdrop" id="panel-backdrop"></div><aside class="panel" id="panel"></aside>');
    panel = $('#panel');
    $('#panel-backdrop').onclick = closePanel;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  }
  panel.innerHTML = `<div class="row"><div class="spacer"></div><button class="btn btn-secondary btn-sm" id="panel-close">Close ✕</button></div><div id="panel-body">${html}</div>`;
  $('#panel-close').onclick = closePanel;
  panel.classList.add('open');
  $('#panel-backdrop').classList.add('open');
  return $('#panel-body');
}
function closePanel() { $('#panel')?.classList.remove('open'); $('#panel-backdrop')?.classList.remove('open'); }

// ---------- toast ----------
function toast(msg) {
  let t = $('#toast');
  if (!t) { document.body.insertAdjacentHTML('beforeend', '<div id="toast"></div>'); t = $('#toast'); }
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ---------- "acting as" guest (demo actor switch, no real login) ----------
function getActor() {
  try { return JSON.parse(localStorage.getItem('stayspot.actor')) || { id: 1, name: 'Guest #1' }; } catch (e) { return { id: 1, name: 'Guest #1' }; }
}
function setActor(guest) {
  try { localStorage.setItem('stayspot.actor', JSON.stringify({ id: guest.id, name: guest.name })); } catch (e) { /* storage blocked */ }
  $('#actor-name').textContent = `${guest.name}`;
  closePanel();
  toast(`Now acting as ${guest.name}`);
  document.dispatchEvent(new CustomEvent('actorchange', { detail: guest }));
}

function openActorPicker() {
  const body = openPanel(`<h2>Switch guest</h2>
    <p class="muted small">There is no login in this demo - choose which guest you are acting as.</p>
    <label>Search by name, email, phone or id<input id="actor-search" placeholder="e.g. 42 or Sara"></label>
    <div id="actor-results" class="mt"></div>`);
  const results = $('#actor-results', body);
  let timer;
  const search = () => load(results, async () => {
    const q = $('#actor-search').value.trim();
    const data = await api(`/guests?limit=10&search=${encodeURIComponent(q)}`);
    renderTable(results, data.rows, [
      { label: 'Id', render: (g) => g.id },
      { label: 'Name', render: (g) => esc(g.name) },
      { label: 'Wallet', num: true, render: (g) => money(g.wallet_balance) },
    ], { onRowClick: setActor });
  });
  $('#actor-search').oninput = () => { clearTimeout(timer); timer = setTimeout(search, 300); };
  $('#actor-search').focus();
  search();
}

// ---------- navbar ----------
function renderNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const actor = getActor();
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="topbar"><div class="topbar-inner">
      <a class="logo" href="index.html">Stay<span>Spot</span></a>
      <nav class="nav">${PAGES.map((p) => `<a href="${p.href}" class="${p.href === here ? 'active' : ''}">${p.label}</a>`).join('')}</nav>
      <div class="actor">
        <span class="status-dot" id="db-dot" title="Database status"></span>
        <span class="muted">Acting as</span> <span class="actor-name" id="actor-name">${esc(actor.name)}</span>
        <button class="btn btn-secondary btn-sm" id="actor-switch">Switch</button>
      </div>
    </div></header>`);
  $('#actor-switch').onclick = openActorPicker;
  // show the real name of the default guest
  api(`/guests/${actor.id}`).then((g) => { $('#actor-name').textContent = g.name; }).catch(() => {});
  // small status dot: green = Postgres + Mongo up, red = something down
  api('/health').then((h) => {
    const dot = $('#db-dot');
    dot.classList.add(h.postgres && h.mongo ? 'up' : 'down');
    dot.title = `PostgreSQL: ${h.postgres ? 'up' : 'DOWN'} · MongoDB: ${h.mongo ? 'up' : 'DOWN'}`;
  }).catch(() => $('#db-dot').classList.add('down'));
}

document.addEventListener('DOMContentLoaded', renderNav);
