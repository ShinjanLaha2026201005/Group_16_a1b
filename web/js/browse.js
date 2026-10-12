// browse.js - Browse screen: three tabs, server-side paging, search/filter, detail panel.

const state = { tab: 'guests', page: 1, filters: {} };

const TABS = {
  guests: {
    filters: `<label>Search<input id="f-search" placeholder="Name, email, phone or id"></label>`,
    read: () => ({ search: $('#f-search').value.trim() }),
    url: (f, page) => `/guests?page=${page}&search=${encodeURIComponent(f.search || '')}`,
    columns: [
      { label: 'Id', render: (g) => g.id },
      { label: 'Name', render: (g) => esc(g.name) },
      { label: 'Email', render: (g) => esc(g.email || '—') },
      { label: 'Phone', render: (g) => esc(g.phone_number) },
      { label: 'Wallet', num: true, render: (g) => money(g.wallet_balance) },
    ],
    detail: showGuest,
  },
  properties: {
    filters: `<label>Search<input id="f-search" placeholder="Title or id"></label>
      <label>Min price / night<input id="f-min" type="number" min="0" style="width:120px"></label>
      <label>Max price / night<input id="f-max" type="number" min="0" style="width:120px"></label>
      <label>Sort<select id="f-sort"><option value="id">Id</option><option value="price_asc">Price ↑</option>
        <option value="price_desc">Price ↓</option><option value="title">Title</option></select></label>`,
    read: () => ({ search: $('#f-search').value.trim(), minPrice: $('#f-min').value, maxPrice: $('#f-max').value, sort: $('#f-sort').value }),
    url: (f, page) => `/properties?page=${page}&search=${encodeURIComponent(f.search || '')}&minPrice=${f.minPrice || ''}&maxPrice=${f.maxPrice || ''}&sort=${f.sort || 'id'}`,
    columns: [
      { label: 'Id', render: (p) => p.id },
      { label: 'Title', render: (p) => esc(p.title) },
      { label: 'Price / night', num: true, render: (p) => money(p.base_price) },
      { label: 'Location', render: (p) => `${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)}` },
    ],
    detail: showProperty,
  },
  bookings: {
    filters: `<label>Status<select id="f-status"><option value="">Any</option><option>CONFIRMED</option>
        <option value="CHECKED_IN">CHECKED IN</option><option>COMPLETED</option></select></label>
      <label>Guest id<input id="f-guest" type="number" min="1" style="width:110px"></label>
      <label>Property id<input id="f-prop" type="number" min="1" style="width:110px"></label>`,
    read: () => ({ status: $('#f-status').value, guestId: $('#f-guest').value, propertyId: $('#f-prop').value }),
    url: (f, page) => `/bookings?page=${page}&status=${f.status || ''}&guestId=${f.guestId || ''}&propertyId=${f.propertyId || ''}`,
    columns: [
      { label: 'Id', render: (b) => b.id },
      { label: 'Guest', render: (b) => esc(b.guest_name) },
      { label: 'Property', render: (b) => esc(b.property_title) },
      { label: 'Stay', render: (b) => `${dateOnly(b.check_in)} → ${dateOnly(b.check_out)}` },
      { label: 'Total', num: true, render: (b) => money(b.total_cost) },
      { label: 'Status', render: (b) => badge(b.status) },
    ],
    detail: showBooking,
  },
};

function fetchPage() {
  const tab = TABS[state.tab];
  const results = $('#results');
  $('#pager').innerHTML = '';
  load(results, async () => {
    const data = await api(tab.url(state.filters, state.page));
    renderTable(results, data.rows, tab.columns, { onRowClick: tab.detail });
    if (data.total) renderPager($('#pager'), data, (p) => { state.page = p; fetchPage(); });
  });
}

function switchTab(name) {
  state.tab = name;
  state.page = 1;
  state.filters = {};
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#filters').innerHTML = TABS[name].filters +
    '<button class="btn" id="f-apply">Search</button><button class="btn btn-secondary" id="f-clear">Clear</button>';
  const apply = () => { state.filters = TABS[name].read(); state.page = 1; fetchPage(); };
  $('#f-apply').onclick = apply;
  $('#f-clear').onclick = () => switchTab(name);
  $('#filters').querySelectorAll('input').forEach((i) => { i.onkeydown = (e) => { if (e.key === 'Enter') apply(); }; });
  $('#filters').querySelectorAll('select').forEach((s) => { s.onchange = apply; });
  fetchPage();
}

// ---------- detail views ----------
function showGuest(row) {
  const body = openPanel('');
  load(body, async () => {
    const g = await api(`/guests/${row.id}`);
    const c = g.booking_counts;
    body.innerHTML = `<h2>${esc(g.name)}</h2>
      <dl class="kv"><dt>Guest id</dt><dd>${g.id}</dd><dt>Email</dt><dd>${esc(g.email || '—')}</dd>
        <dt>Phone</dt><dd>${esc(g.phone_number)}</dd><dt>Wallet</dt><dd><b>${money(g.wallet_balance)}</b></dd>
        <dt>Bookings</dt><dd>${c.CONFIRMED || 0} confirmed · ${c.CHECKED_IN || 0} checked in · ${c.COMPLETED || 0} completed</dd></dl>
      <div class="row"><button class="btn" id="act">Act as this guest</button>
        <a class="btn btn-secondary" href="audit.html?guest=${g.id}">Wallet audit</a></div>
      <h3 class="mt">Latest bookings</h3><div id="g-recent"></div>`;
    $('#act').onclick = () => setActor(g);
    renderTable($('#g-recent'), g.recent_bookings, [
      { label: 'Property', render: (b) => esc(b.property_title) },
      { label: 'Check-in', render: (b) => dateOnly(b.check_in) },
      { label: 'Status', render: (b) => badge(b.status) },
    ]);
  });
}

function showProperty(row) {
  const body = openPanel('');
  load(body, async () => {
    const p = await api(`/properties/${row.id}`);
    const a = p.analytics || {};
    const c = p.booking_counts;
    body.innerHTML = `<h2>${esc(p.title)}</h2>
      <dl class="kv"><dt>Property id</dt><dd>${p.id}</dd><dt>Price / night</dt><dd><b>${money(p.base_price)}</b></dd>
        <dt>Location</dt><dd>${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}</dd>
        <dt>Completed stays</dt><dd>${int(a.total_completed_bookings)} (${int(a.total_nights_booked)} nights)</dd>
        <dt>Gross revenue</dt><dd>${money(a.gross_revenue)} <span class="muted small">(materialized view)</span></dd>
        <dt>Open bookings</dt><dd>${c.CONFIRMED || 0} confirmed · ${c.CHECKED_IN || 0} checked in</dd></dl>
      <div class="row"><a class="btn" href="book.html?property=${p.id}">Book this property</a>
        <a class="btn btn-secondary" href="reviews.html?property=${p.id}">Reviews & amenities</a>
        <a class="btn btn-secondary" href="analytics.html?property=${p.id}">Revenue chart</a></div>`;
  });
}

function showBooking(row) {
  const body = openPanel('');
  load(body, async () => {
    const b = await api(`/bookings/${row.id}`);
    body.innerHTML = `<h2>Booking #${b.id}</h2>
      <p>${badge(b.status)}</p>
      <dl class="kv"><dt>Guest</dt><dd>${esc(b.guest_name)} (#${b.guest_id})</dd>
        <dt>Property</dt><dd>${esc(b.property_title)} (#${b.property_id})</dd>
        <dt>Stay</dt><dd>${dateOnly(b.check_in)} → ${dateOnly(b.check_out)} (${b.nights} nights)</dd>
        <dt>Price</dt><dd>${b.nights} × ${money(b.base_price)} = <b>${money(b.total_cost)}</b></dd>
        <dt>Booked at</dt><dd>${dateTime(b.created_at)}</dd></dl>
      <a class="btn btn-secondary" href="book.html">Manage status on the Book a stay page</a>`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchTab(t.dataset.tab); });
  switchTab('guests');
});
