// audit.js - wallet audit trail for one guest, with date filter and running balance.

function loadAudit() {
  const guestId = $('#guest').value || getActor().id;
  const from = $('#from').value, to = $('#to').value;
  const rowsEl = $('#rows');
  const summaryEl = $('#summary');
  summaryEl.innerHTML = '';
  load(rowsEl, async () => {
    const data = await api(`/guests/${guestId}/audit?from=${from}&to=${to}`);
    const s = data.summary;
    $('#title').textContent = `Entries for ${data.guest.name} (current wallet ${money(data.guest.wallet_balance)})`;
    summaryEl.innerHTML = [
      ['Opening balance', money(s.opening_balance)],
      ['Total credits', money(s.total_credits)],
      ['Total debits', money(s.total_debits)],
      ['Closing balance', money(s.closing_balance)],
    ].map(([l, v]) => `<div class="card stat"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('');
    if (!data.rows.length) return showEmpty(rowsEl, 'No wallet changes in this date range.');
    renderTable(rowsEl, data.rows, [
      { label: 'Audit id', render: (r) => r.id },
      { label: 'When', render: (r) => dateTime(r.timestamp) },
      { label: 'Type', render: (r) => badge(r.action_type) },
      { label: 'Amount', num: true, render: (r) => (r.action_type === 'CREDIT' ? '+' : '−') + money(r.amount_changed) },
      { label: 'Balance before', num: true, render: (r) => money(r.balance_before) },
      { label: 'Running balance', num: true, render: (r) => `<b>${money(r.balance_after)}</b>` },
    ]);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  $('#guest').value = params.get('guest') || getActor().id;
  $('#filter-form').onsubmit = (e) => { e.preventDefault(); loadAudit(); };
  $('#clear').onclick = () => { $('#from').value = ''; $('#to').value = ''; loadAudit(); };
  loadAudit();
});
document.addEventListener('actorchange', () => { $('#guest').value = getActor().id; loadAudit(); });
