/* RiderGo service worker: installable app shell + offline support.
   - App shell (HTML/JS/CSS/images): network-first, falls back to the cache, so deploys always reach users.
   - Never caches /api, /pay, uploads POSTs or the live event stream (rides, orders and money are always live).
   - Cross-origin libs/fonts/map tiles: stale-while-revalidate (tiles capped). */
const V = 'ridergo-v1';
const SHELL = ['/', '/offline.html', '/css/app.css', '/js/app.js', '/js/core.js', '/js/shell.js', '/js/components.js', '/js/map.js', '/js/picker.js',
  '/js/views/auth.js', '/js/views/customer.js', '/js/views/ride.js', '/js/views/eats.js', '/js/views/account.js', '/js/views/billing.js', '/js/views/provider.js', '/js/views/vendor.js', '/js/views/admin.js',
  '/img/logo-full.jpg', '/img/logo-mark.png', '/img/icon-192.png', '/img/favicon.png', '/manifest.webmanifest'];
const TILES = 'ridergo-tiles', MAX_TILES = 150;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function networkFirst(req, fallback) {
  const c = await caches.open(V);
  try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
  catch { return (await c.match(req)) || (fallback && (await c.match(fallback))) || Response.error(); }
}
async function swr(req, name, max) {
  const c = await caches.open(name); const hit = await c.match(req);
  const net = fetch(req).then(async (res) => { if (res.ok || res.type === 'opaque') { await c.put(req, res.clone()); if (max) trim(c, max); } return res; }).catch(() => hit);
  return hit || net;
}
async function trim(c, max) { const ks = await c.keys(); for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]); }

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/pay/') || url.pathname === '/sw.js') return; // always live
    if (req.mode === 'navigate') return e.respondWith(networkFirst('/', '/offline.html'));
    return e.respondWith(networkFirst(req));
  }
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) return e.respondWith(swr(req, TILES, MAX_TILES));
  if (/unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return e.respondWith(swr(req, V));
});
