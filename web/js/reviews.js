// reviews.js - Workflow 4: $facet review charts + PropertyAmenities catalog card.

const charts = {};
let reviewPage = 1;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const pretty = (s) => String(s).replace(/_/g, ' ');

function currentProperty() { return $('#property').value.trim(); }

function barChart(id, labels, values, label, horizontal) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(`#${id}`), {
    type: 'bar',
    data: { labels, datasets: [{ label, data: values, backgroundColor: css('--series-1'), borderRadius: 4, maxBarThickness: 36 }] },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${int(c.raw)} reviews` } } },
      scales: {
        x: { grid: { display: horizontal }, ticks: { color: css('--muted') }, beginAtZero: true },
        y: { grid: { display: !horizontal, color: css('--border') }, ticks: { color: css('--muted') }, beginAtZero: true },
      },
    },
  });
}

async function loadFacets() {
  const pid = currentProperty();
  const statsEl = $('#stats');
  showLoading(statsEl);
  showLoading($('#dist-state'));
  showLoading($('#tags-state'));
  try {
    const d = await api(`/reviews/facets?propertyId=${pid}`);
    const s = d.overallStats;
    statsEl.innerHTML = [
      ['Average rating', s.averageRating ? `${s.averageRating} / 5` : '–'],
      ['Total reviews', int(s.totalReviews)],
      ['Scope', pid ? `Property #${esc(pid)}` : 'All properties'],
    ].map(([l, v]) => `<div class="card stat"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('');
    $('#dist-state').innerHTML = '';
    $('#tags-state').innerHTML = '';
    if (!s.totalReviews) {
      showEmpty($('#dist-state'), 'No reviews for this property yet.');
      showEmpty($('#tags-state'), 'No tags yet.');
    }
    barChart('dist-chart', d.ratingDistribution.map((r) => `${r.rating} ★`), d.ratingDistribution.map((r) => r.count), 'Reviews', false);
    barChart('tags-chart', d.topTags.map((t) => pretty(t.tag)), d.topTags.map((t) => t.frequency), 'Mentions', true);
  } catch (e) {
    showError(statsEl, e, loadFacets);
    $('#dist-state').innerHTML = '';
    $('#tags-state').innerHTML = '';
  }
}

// Shows one flexible PropertyAmenities document in a readable way.
function loadAmenities() {
  const el = $('#amenities');
  const pid = currentProperty() || '1';
  $('#amen-title').textContent = `Amenities · property #${pid}`;
  load(el, async () => {
    const a = await api(`/amenities/${pid}`);
    const dyn = Object.entries(a.dynamic_amenities || {});
    el.innerHTML = `
      <h3>Amenities</h3>
      <div>${dyn.length ? dyn.map(([k, v]) => `<span class="chip ${v ? '' : 'no'}">${v ? '✓' : '✕'} ${esc(pretty(k))}</span>`).join('') : '<span class="muted">None listed</span>'}</div>
      <h3 class="mt">House rules</h3>
      <ul>${(a.house_rules || []).map((r) => `<li>${esc(r)}</li>`).join('') || '<li class="muted">None</li>'}</ul>
      <h3>Accessibility</h3>
      <div>${(a.accessibility_features || []).map((f) => `<span class="chip">♿ ${esc(f)}</span>`).join('') || '<span class="muted">No accessibility features listed</span>'}</div>
      <p class="muted small mt">Listed ${dateOnly(a.created_at)} · updated ${dateOnly(a.updated_at)}.
        Each property's document can have different keys - that is why this lives in MongoDB.</p>`;
  });
}

function loadReviews() {
  const el = $('#reviews');
  $('#pager').innerHTML = '';
  load(el, async () => {
    const d = await api(`/reviews?propertyId=${currentProperty()}&page=${reviewPage}&limit=5`);
    if (!d.rows.length) return showEmpty(el, 'No reviews yet.');
    el.innerHTML = d.rows.map((r) => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div><span style="color:var(--warn)">${stars(r.rating)}</span>
          <span class="muted small">· property #${r.property_id} · ${dateOnly(r.created_at)}</span></div>
        <div class="small">${esc(r.comment || '')}</div>
        <div>${(r.tags || []).map((t) => `<span class="chip">${esc(pretty(t))}</span>`).join('')}</div></div>`).join('');
    renderPager($('#pager'), d, (p) => { reviewPage = p; loadReviews(); });
  });
}

function loadAll() {
  reviewPage = 1;
  const pid = currentProperty();
  history.replaceState(null, '', pid ? `?property=${pid}` : location.pathname);
  loadFacets();
  loadAmenities();
  loadReviews();
}

document.addEventListener('DOMContentLoaded', () => {
  $('#property').value = new URLSearchParams(location.search).get('property') || '';
  $('#filter-form').onsubmit = (e) => { e.preventDefault(); loadAll(); };
  $('#all').onclick = () => { $('#property').value = ''; loadAll(); };
  loadAll();
});
