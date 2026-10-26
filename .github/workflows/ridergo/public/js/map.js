// Map wrapper. Uses Leaflet + OpenStreetMap tiles; if Leaflet can't load (offline/blocked) it falls back to a
// simple built-in schematic map so routes, riders and pins are still visible.
import { esc } from './core.js';

const ICONS = {
  me: '<div class="mk me"><i></i></div>', pickup: '<div class="mk dot"></div>', drop: '<div class="mk pin">📍</div>',
  motor: '<div class="mk veh logo"></div>', car: '<div class="mk veh">🚗</div>', vendor: '<div class="mk shop">🍽️</div>', grocery: '<div class="mk shop">🥬</div>', convenience: '<div class="mk shop">🛍️</div>',
  food: '<div class="mk shop">🍽️</div>',
};

export function createMap(el, { center, zoom = 14, onTap } = {}) {
  el.classList.add('map');
  return window.L && !window.__noLeaflet ? leafletMap(el, center, zoom, onTap) : fallbackMap(el, center, onTap);
}

function leafletMap(el, center, zoom, onTap) {
  const L = window.L;
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const markers = new Map(); let line = null;
  if (onTap) map.on('click', (e) => onTap({ lat: e.latlng.lat, lng: e.latlng.lng }));
  setTimeout(() => map.invalidateSize(), 60);
  return {
    kind: 'leaflet',
    setView: (p, z) => map.setView([p.lat, p.lng], z || map.getZoom()),
    marker(id, { lat, lng, type = 'pickup', label, onClick }) {
      const html = (ICONS[type] || ICONS.pickup) + (label ? `<span class="mk-label">${esc(label)}</span>` : '');
      let m = markers.get(id);
      if (m) { m.setLatLng([lat, lng]); m.setIcon(L.divIcon({ html, className: 'mk-wrap', iconSize: [36, 36], iconAnchor: [18, 18] })); }
      else { m = L.marker([lat, lng], { icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(map); markers.set(id, m); }
      m.off('click'); if (onClick) m.on('click', onClick);
    },
    remove(id) { const m = markers.get(id); if (m) { map.removeLayer(m); markers.delete(id); } },
    clearMarkers(prefix) { for (const [id, m] of [...markers]) if (!prefix || id.startsWith(prefix)) { map.removeLayer(m); markers.delete(id); } },
    route(coords, color = '#e11d2e') { if (line) map.removeLayer(line); line = coords?.length ? L.polyline(coords, { color, weight: 5, opacity: 0.85 }).addTo(map) : null; },
    fit(points, pad = 50) { const pts = points.filter(Boolean).map((p) => [p.lat, p.lng]); if (pts.length > 1) map.fitBounds(pts, { padding: [pad, pad], maxZoom: 17 }); else if (pts.length) map.setView(pts[0], 16); },
    resize: () => map.invalidateSize(), destroy: () => map.remove(),
  };
}

function fallbackMap(el, center, onTap) {
  const markers = new Map(); let coords = []; let view = { minLat: center.lat - 0.02, maxLat: center.lat + 0.02, minLng: center.lng - 0.02, maxLng: center.lng + 0.02 };
  el.classList.add('fallback');
  el.innerHTML = '<div class="fb-layer"></div><div class="fb-note">Map tiles unavailable – showing a simple view</div>';
  const layer = el.firstChild;
  const proj = (p) => { const w = el.clientWidth || 360, h = el.clientHeight || 300; return { x: ((p.lng - view.minLng) / (view.maxLng - view.minLng)) * w, y: (1 - (p.lat - view.minLat) / (view.maxLat - view.minLat)) * h }; };
  function draw() {
    const w = el.clientWidth || 360, h = el.clientHeight || 300;
    let svg = `<svg width="${w}" height="${h}" class="fb-svg">`;
    if (coords.length) svg += `<polyline fill="none" stroke="#e11d2e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".85" points="${coords.map((c) => { const q = proj({ lat: c[0], lng: c[1] }); return q.x + ',' + q.y; }).join(' ')}"/>`;
    svg += '</svg>';
    layer.innerHTML = svg;
    for (const [id, m] of markers) { const q = proj(m); let d = layer.querySelector(`[data-mk="${CSS.escape(id)}"]`); if (!d) { d = document.createElement('div'); d.dataset.mk = id; d.className = 'mk-wrap'; layer.appendChild(d); } d.innerHTML = (ICONS[m.type] || ICONS.pickup) + (m.label ? `<span class="mk-label">${esc(m.label)}</span>` : ''); d.style.cssText = `position:absolute;left:${q.x - 18}px;top:${q.y - 18}px`; d.onclick = m.onClick || null; }
  }
  const ro = new ResizeObserver(draw); ro.observe(el);
  if (onTap) el.addEventListener('click', (e) => { if (e.target.closest('.mk-wrap')) return; const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; onTap({ lat: view.maxLat - y * (view.maxLat - view.minLat), lng: view.minLng + x * (view.maxLng - view.minLng) }); });
  const fit = (pts, pad = 0.15) => { pts = pts.filter(Boolean); if (!pts.length) return; const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng); let a = Math.min(...lats), b = Math.max(...lats), c = Math.min(...lngs), d = Math.max(...lngs); const dl = Math.max(b - a, 0.008), dg = Math.max(d - c, 0.008); const ar = (el.clientWidth || 360) / (el.clientHeight || 300); let H = dl * (1 + pad * 2), W = dg * (1 + pad * 2); if (W / H < ar) W = H * ar; else H = W / ar; const mLat = (a + b) / 2, mLng = (c + d) / 2; view = { minLat: mLat - H / 2, maxLat: mLat + H / 2, minLng: mLng - W / 2, maxLng: mLng + W / 2 }; draw(); };
  return {
    kind: 'fallback',
    setView: (p) => { const hl = (view.maxLat - view.minLat) / 2, hg = (view.maxLng - view.minLng) / 2; view = { minLat: p.lat - hl, maxLat: p.lat + hl, minLng: p.lng - hg, maxLng: p.lng + hg }; draw(); },
    marker(id, o) { markers.set(id, o); draw(); }, remove(id) { markers.delete(id); layer.querySelector(`[data-mk="${CSS.escape(id)}"]`)?.remove(); },
    clearMarkers(prefix) { for (const id of [...markers.keys()]) if (!prefix || id.startsWith(prefix)) this.remove(id); },
    route(c) { coords = c || []; draw(); }, fit, resize: draw, destroy: () => ro.disconnect(),
  };
}
