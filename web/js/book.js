// book.js - Workflow 1: booking form, wallet + top-up, booking status changes.

let bookingsPage = 1;

const isoDay = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

// ---------- wallet ----------
function loadWallet() {
  const el = $('#wallet');
  return load(el, async () => {
    const g = await api(`/guests/${getActor().id}`);
    el.innerHTML = `<div class="stat"><span class="label">${esc(g.name)}</span>
      <span class="value">${money(g.wallet_balance)}</span></div>`;
  });
}

async function topUp(e) {
  e.preventDefault();
  try {
    const r = await api(`/guests/${getActor().id}/topup`, { method: 'POST', body: { amount: Number($('#topup').value) } });
    toast(`Added money. New balance ${money(r.wallet_balance)} (audit row #${r.audit_entry.id} ${r.audit_entry.action_type})`);
    loadWallet();
  } catch (err) { toast(err.message); }
}

// ---------- price preview ----------
let quoteTimer;
function updateQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(async () => {
    const pid = $('#property').value, ci = $('#check-in').value, co = $('#check-out').value;
    const el = $('#quote');
    if (!pid || !ci || !co) { el.textContent = 'Enter a property and dates to see the price.'; return; }
    if (co <= ci) { el.innerHTML = '<span style="color:var(--err)">Check-out must be after check-in.</span>'; return; }
    try {
      const q = await api(`/quote?propertyId=${pid}&checkIn=${ci}&checkOut=${co}`);
      el.innerHTML = `<b>${esc(q.title)}</b> · ${q.nights} night(s) × ${money(q.base_price)} = <b>${money(q.total_cost)}</b>`;
    } catch (err) { el.innerHTML = `<span style="color:var(--err)">${esc(err.message)}</span>`; }
  }, 300);
}

// ---------- submit booking ----------
async function submitBooking(e) {
  e.preventDefault();
  const btn = $('#submit');
  const result = $('#result');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    const r = await api('/bookings', {
      method: 'POST',
      body: { guestId: getActor().id, propertyId: Number($('#property').value), checkIn: $('#check-in').value, checkOut: $('#check-out').value },
    });
    const b = r.booking;
    result.innerHTML = `<div class="alert alert-ok"><b>Booking #${b.id} confirmed.</b> ${esc(b.property_title)},
        ${dateOnly(b.check_in)} → ${dateOnly(b.check_out)} (${b.nights} nights) for ${money(b.total_cost)}.</div>
      <div class="grid grid-2">
        <div class="card stat"><span class="label">Balance before</span><span class="value">${money(r.balance_before)}</span></div>
        <div class="card stat"><span class="label">Balance after</span><span class="value">${money(r.balance_after)}</span></div>
      </div>
      <h3 class="mt">New row in wallet_audit_logs (written by the trigger)</h3><div id="audit-new"></div>`;
    renderTable($('#audit-new'), r.audit_entries, [
      { label: 'Audit id', render: (a) => a.id },
      { label: 'Type', render: (a) => badge(a.action_type) },
      { label: 'Amount', num: true, render: (a) => money(a.amount_changed) },
      { label: 'Balance after', num: true, render: (a) => money(a.balance_after) },
      { label: 'Time', render: (a) => dateTime(a.timestamp) },
    ], { rowClass: () => 'highlight' });
    loadWallet();
    bookingsPage = 1;
    loadBookings();
  } catch (err) {
    const d = err.data || {};
    result.innerHTML = `<div class="alert alert-err"><b>Booking failed.</b> ${esc(err.message)}
      ${d.balance_before !== undefined ? `<br>Your wallet was not touched: balance is still ${money(d.balance_before)}.` : ''}
      ${d.db_error ? `<br><span class="small">Database said: <code>${esc(d.db_error)}</code></span>` : ''}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Book now';
  }
}

// ---------- my bookings + status buttons ----------
function loadBookings() {
  const el = $('#my-bookings');
  $('#pager').innerHTML = '';
  load(el, async () => {
    const status = $('#status-filter').value;
    const data = await api(`/bookings?guestId=${getActor().id}&status=${status}&page=${bookingsPage}&limit=10`);
    if (!data.rows.length) return showEmpty(el, 'This guest has no bookings with that status. Make one above!');
    renderTable(el, data.rows, [
      { label: 'Id', render: (b) => b.id },
      { label: 'Property', render: (b) => esc(b.property_title) },
      { label: 'Stay', render: (b) => `${dateOnly(b.check_in)} → ${dateOnly(b.check_out)}` },
      { label: 'Total', num: true, render: (b) => money(b.total_cost) },
      { label: 'Status', render: (b) => badge(b.status) },
      { label: 'Action', render: (b) => b.status === 'CONFIRMED'
          ? `<button class="btn btn-sm" data-id="${b.id}" data-to="CHECKED_IN">Check in</button>`
          : b.status === 'CHECKED_IN'
            ? `<button class="btn btn-sm" data-id="${b.id}" data-to="COMPLETED">Complete</button>`
            : '<span class="muted small">done</span>' },
    ]);
    el.querySelectorAll('button[data-id]').forEach((btn) => { btn.onclick = () => changeStatus(btn.dataset.id, btn.dataset.to); });
    renderPager($('#pager'), data, (p) => { bookingsPage = p; loadBookings(); });
  });
}

async function changeStatus(id, status) {
  const result = $('#status-result') || (() => {
    $('#my-bookings').insertAdjacentHTML('beforebegin', '<div id="status-result"></div>');
    return $('#status-result');
  })();
  try {
    const r = await api(`/bookings/${id}/status`, { method: 'PATCH', body: { status } });
    result.innerHTML = `<div class="alert alert-ok">${esc(r.message)}</div>`;
    loadBookings();
  } catch (err) {
    const d = err.data || {};
    result.innerHTML = `<div class="alert alert-err"><b>Could not change status.</b> ${esc(err.message)}
      ${d.constraint ? `<br><span class="small">Blocked by index <code>${esc(d.constraint)}</code>: <code>${esc(d.db_error)}</code></span>` : ''}</div>`;
  }
}

function refreshAll() {
  $('#result').innerHTML = '';
  const s = $('#status-result'); if (s) s.innerHTML = '';
  bookingsPage = 1;
  loadWallet();
  loadBookings();
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  if (params.get('property')) $('#property').value = params.get('property');
  $('#check-in').value = isoDay(7);
  $('#check-out').value = isoDay(9);
  ['#property', '#check-in', '#check-out'].forEach((s) => { $(s).oninput = updateQuote; });
  $('#book-form').onsubmit = submitBooking;
  $('#topup-form').onsubmit = topUp;
  $('#status-filter').onchange = () => { bookingsPage = 1; loadBookings(); };
  updateQuote();
  refreshAll();
});
document.addEventListener('actorchange', refreshAll);
