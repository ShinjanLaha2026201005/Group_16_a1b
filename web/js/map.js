// map.js - Workflow 3: $geoNear hotspots on a Leaflet map with polling.

let map, originMarker, radiusCircle, layer;
let origin = null;
let pollTimer = null;
let busy = false;

function setOrigin(lat, lng, zoom) {
  origin = { lat, lng };
  originMarker.setLatLng([lat, lng]);
  radiusCircle.setLatLng([lat, lng]);
  if (zoom) map.setView([lat, lng], zoom);
  refresh();
}

async function refresh() {
  if (!origin || busy) return;
  busy = true;
  const listEl = $('#hotspots');
  if (!listEl.children.length) listEl.innerHTML = '<li><div class="state"><div class="spinner"></div>Loading…</div></li>';
  try {
    const d = await api(`/hotspots?lat=${origin.lat}&lng=${origin.lng}&minutes=${$('#minutes').value}`);
    $('#map-state').innerHTML = '';
    layer.clearLayers();
    const max = Math.max(1, ...d.hotspots.map((h) => h.search_count));
    // one circle per hotspot; bigger + darker = more searches
    d.hotspots.forEach((h) => {
      L.circleMarker([h.lat, h.lng], {
        radius: 6 + 18 * (h.search_count / max),
        color: '#ffffff', weight: 2,
        fillColor: getComputedStyle(document.documentElement).getPropertyValue('--series-2').trim(),
        fillOpacity: 0.35 + 0.5 * (h.search_count / max),
      }).bindTooltip(`<b>${h.search_count} searches</b><br>${(h.avg_distance_m / 1000).toFixed(2)} km from origin<br>avg search radius ${h.avg_radius_km} km`)
        .addTo(layer);
    });
    // newest individual pings as small dots
    d.nearest.forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 3, color: '#2a78d6', weight: 1, fillOpacity: 0.9 })
        .bindTooltip(`${p.user_id} · ${(p.distance_meters / 1000).toFixed(2)} km`).addTo(layer);
    });

    $('#count').textContent = `${d.hotspots.length} hotspots · ${int(d.total_searches)} searches`;
    const sorted = [...d.hotspots].sort((a, b) => a.avg_distance_m - b.avg_distance_m);
    listEl.innerHTML = sorted.length
      ? sorted.map((h, i) => `<li><b>${(h.avg_distance_m / 1000).toFixed(2)} km</b> away ·
          ${h.search_count} searches<br><span class="muted small">hotspot ${i + 1} at ${h.lat.toFixed(3)}, ${h.lng.toFixed(3)}
          · avg radius ${h.avg_radius_km} km</span></li>`).join('')
      : '<li><div class="state">No searches within 5 km in this time window. Seeded pings expire after 2 hours (TTL) - press "Simulate 20 new searches" or re-run the seeder.</div></li>';
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    listEl.innerHTML = '';
    showError($('#map-state'), e, refresh);
  } finally {
    busy = false;
  }
}

async function simulate() {
  if (!origin) return;
  try {
    const r = await api('/hotspots/simulate', { method: 'POST', body: { lat: origin.lat, lng: origin.lng, count: 20 } });
    toast(`${r.inserted} new search pings inserted`);
    refresh();
  } catch (e) { toast(e.message); }
}

function startPolling() {
  clearInterval(pollTimer);
  if ($('#auto').checked) pollTimer = setInterval(refresh, 5000);
}

document.addEventListener('DOMContentLoaded', async () => {
  map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  originMarker = L.marker([0, 0]).addTo(map).bindTooltip('Origin');
  radiusCircle = L.circle([0, 0], { radius: 5000, color: '#0f766e', weight: 2, fill: false, dashArray: '6 6' }).addTo(map);
  map.on('click', (e) => setOrigin(e.latlng.lat, e.latlng.lng));

  $('#simulate').onclick = simulate;
  $('#minutes').onchange = refresh;
  $('#auto').onchange = startPolling;

  try {
    const presets = await api('/hotspots/presets');
    $('#preset').innerHTML = presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
    $('#preset').onchange = () => { const p = presets[$('#preset').value]; setOrigin(p.lat, p.lng, 12); };
    setOrigin(presets[0].lat, presets[0].lng, 12);
  } catch (e) {
    showError($('#map-state'), e);
    map.setView([20.6, 78.9], 5);
  }
  startPolling();
});
