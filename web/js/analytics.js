// analytics.js - materialized view summary, moving-average chart, DENSE_RANK table.

let chart = null;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- materialized view ----------
function loadSummary() {
  const el = $('#summary');
  return load(el, async () => {
    const d = await api('/analytics/summary');
    const t = d.totals;
    el.innerHTML = [
      ['Gross revenue', money(t.gross_revenue)],
      ['Completed stays', int(t.completed_bookings)],
      ['Nights booked', int(t.nights_booked)],
      ['Revenue per night', money(t.revenue_per_night)],
    ].map(([l, v]) => `<div class="card stat"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('');
    showRefreshed(d.last_refreshed);
    // fill the "top properties" picker for the chart
    $('#top-select').innerHTML = d.top_properties
      .map((p) => `<option value="${p.property_id}">#${p.property_id} ${esc(p.title)} (${money(p.gross_revenue)})</option>`).join('');
  });
}

function showRefreshed(last) {
  $('#refreshed').textContent = last
    ? `Last refreshed: ${dateTime(last.refreshed_at)} (took ${last.duration_ms} ms)`
    : 'Last refreshed: never';
}

async function refreshView() {
  const btn = $('#refresh');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const r = await api('/analytics/refresh', { method: 'POST' });
    toast(r.message);
    await loadSummary();
  } catch (e) { toast(e.message); } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh view';
  }
}

// ---------- moving average chart ----------
async function loadChart(propertyId) {
  const stateEl = $('#chart-state');
  showLoading(stateEl, 'Loading chart…');
  try {
    const d = await api(`/analytics/moving-average?propertyId=${propertyId}`);
    stateEl.innerHTML = '';
    $('#chart-title').textContent = `7-day moving average revenue · #${d.property.id} ${d.property.title}`;
    if (!d.rows.some((r) => r.daily_revenue > 0)) showEmpty(stateEl, 'This property has no bookings in the data range.');
    const labels = d.rows.map((r) => r.booking_date);
    const data = {
      labels,
      datasets: [
        { type: 'bar', label: 'Daily revenue', data: d.rows.map((r) => r.daily_revenue),
          backgroundColor: css('--series-1') + '55', borderRadius: 4, order: 2 },
        { type: 'line', label: '7-day moving average', data: d.rows.map((r) => r.moving_avg_7day),
          borderColor: css('--series-2'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, order: 1 },
      ],
    };
    if (chart) chart.destroy();
    chart = new Chart($('#chart'), {
      data,
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false }, // HTML legend above the chart
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10, color: css('--muted') } },
          y: { beginAtZero: true, grid: { color: css('--border') }, ticks: { color: css('--muted'), callback: (v) => '₹' + Number(v).toLocaleString('en-IN') } },
        },
      },
    });
    history.replaceState(null, '', `?property=${propertyId}`);
  } catch (e) {
    showError(stateEl, e, () => loadChart(propertyId));
  }
}

// ---------- DENSE_RANK table ----------
function loadRanking() {
  const el = $('#ranking');
  load(el, async () => {
    const d = await api(`/analytics/ranking?date=${$('#rank-date').value}&limit=20`);
    if (!$('#rank-date').value) $('#rank-date').value = d.date;
    $('#rank-date').min = d.min_date;
    $('#rank-date').max = d.max_date;
    renderTable(el, d.rows, [
      { label: 'Rank', render: (r) => `<b>${r.property_rank}</b>` },
      { label: 'Property', render: (r) => `#${r.property_id} ${esc(r.property_title)}` },
      { label: 'Revenue that day', num: true, render: (r) => money(r.revenue_on_date) },
      { label: '7-day moving avg', num: true, render: (r) => money(r.moving_avg_7day) },
    ], { onRowClick: (r) => { loadChart(r.property_id); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#refresh').onclick = refreshView;
  $('#rank-date').onchange = loadRanking;
  $('#top-select').onchange = () => loadChart($('#top-select').value);
  $('#prop-go').onclick = () => { if ($('#prop-id').value) loadChart($('#prop-id').value); };
  loadRanking();
  await loadSummary();
  const fromUrl = new URLSearchParams(location.search).get('property');
  const first = fromUrl || $('#top-select').value;
  if (first) loadChart(first); else showEmpty($('#chart-state'), 'Pick a property to see its revenue.');
});
