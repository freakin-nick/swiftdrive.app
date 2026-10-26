'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const config = require('../config');
const geo = require('../geo');
const pricing = require('../pricing');
const tenancy = require('../tenancy');
const paystack = require('../paystack');

router.get('/api/config', () => ({
  currency: config.currency, center: config.defaultCenter, demo: process.env.DEMO === '1', trialDays: config.trialDays, paystackLive: paystack.live(), paystackPublicKey: config.paystack.publicKey || null,
  rates: { ...pricing.RATES, delivery: pricing.DELIVERY },
  plans: q.all('SELECT id, code, tenant_type, name, amount, seats, features FROM plans WHERE active=1 ORDER BY amount'),
  promos: q.all("SELECT code, label, percent, max_discount, scope FROM promos WHERE active=1 AND (expires_at IS NULL OR expires_at>?)", Date.now()),
}));

router.get('/api/geo/search', async (c) => {
  const text = String(c.query.q || '').trim();
  if (text.length < 3) return [];
  try { return await geo.search(text, geo.validPoint({ lat: +c.query.lat, lng: +c.query.lng }) ? { lat: +c.query.lat, lng: +c.query.lng } : null); }
  catch { fail(503, 'Place search is unavailable right now. You can pick a point on the map instead.'); }
});
router.get('/api/geo/reverse', async (c) => {
  try { return await geo.reverse(+c.query.lat, +c.query.lng); }
  catch { return { address: `${(+c.query.lat).toFixed(4)}, ${(+c.query.lng).toFixed(4)}` }; }
});
router.post('/api/geo/route', async (c) => {
  const { from, to } = c.body;
  if (!geo.validPoint(from) || !geo.validPoint(to)) fail(400, 'Invalid coordinates');
  return geo.route(from, to);
});

/** Online riders/drivers around a point (anonymised) so customers can see availability on the map. */
router.get('/api/riders/nearby', (c) => {
  const p = { lat: +c.query.lat, lng: +c.query.lng };
  if (!geo.validPoint(p)) fail(400, 'Invalid coordinates');
  const fresh = Date.now() - config.dispatch.locFreshMs;
  return q.all("SELECT u.id, u.role, u.lat, u.lng, u.tenant_id FROM users u WHERE u.role IN ('rider','driver') AND u.online=1 AND u.loc_at>? AND u.lat IS NOT NULL", fresh)
    .filter((u) => tenancy.isActive(tenancy.getTenant(u.tenant_id)) && geo.haversine(p, u) <= 8)
    .map((u) => ({ type: u.role === 'driver' ? 'car' : 'motor', lat: u.lat, lng: u.lng, km: +geo.haversine(p, u).toFixed(1) }));
});

function vendorCard(v, from) {
  const km = from ? +geo.haversine(from, v).toFixed(1) : null;
  return {
    id: v.tenant_id, name: v.name, category: v.category, cuisine: v.cuisine, description: v.description, address: v.address, lat: v.lat, lng: v.lng,
    logo: v.logo, cover: v.cover, open: !!v.is_open, prep_minutes: v.prep_minutes, min_order: v.min_order, delivers: !!v.delivers, max_delivery_km: v.max_delivery_km,
    rating: +v.rating_avg.toFixed(1), rating_count: v.rating_count, orders: v.order_count, distance_km: km, phone: v.phone,
  };
}
const visibleVendors = () => q.all(
  `SELECT vp.*, t.name, t.status, t.period_end FROM vendor_profiles vp JOIN tenants t ON t.id=vp.tenant_id
   WHERE t.status='active' AND (t.period_end IS NULL OR t.period_end>?) AND vp.lat IS NOT NULL
     AND EXISTS (SELECT 1 FROM menu_items m WHERE m.tenant_id=t.id AND m.available=1)`, Date.now());

/** Vendors near you. Only subscribed (active) tenants appear. sort: rating (default) | distance | popular */
router.get('/api/vendors', (c) => {
  const from = geo.validPoint({ lat: +c.query.lat, lng: +c.query.lng }) ? { lat: +c.query.lat, lng: +c.query.lng } : null;
  const radius = Math.min(+c.query.radius || 15, 50);
  const text = String(c.query.q || '').trim().toLowerCase();
  let list = visibleVendors().map((v) => vendorCard(v, from));
  if (from) list = list.filter((v) => v.distance_km <= radius);
  if (c.query.category) list = list.filter((v) => v.category === c.query.category);
  if (text) {
    const hits = new Set(q.all("SELECT DISTINCT tenant_id FROM menu_items WHERE available=1 AND (lower(name) LIKE ? OR lower(description) LIKE ?)", `%${text}%`, `%${text}%`).map((r) => r.tenant_id));
    list = list.filter((v) => `${v.name} ${v.cuisine || ''} ${v.description || ''}`.toLowerCase().includes(text) || hits.has(v.id));
  }
  const sort = c.query.sort || 'rating';
  list.sort((a, b) => sort === 'distance' ? (a.distance_km ?? 0) - (b.distance_km ?? 0)
    : sort === 'popular' ? b.orders - a.orders
    : (b.rating * Math.log2(2 + b.rating_count)) - (a.rating * Math.log2(2 + a.rating_count)));
  if (c.query.favorites && c.user) { const f = new Set(q.all('SELECT tenant_id FROM favorites WHERE user_id=?', c.user.id).map((r) => r.tenant_id)); list = list.filter((v) => f.has(v.id)); }
  const favs = c.user ? new Set(q.all('SELECT tenant_id FROM favorites WHERE user_id=?', c.user.id).map((r) => r.tenant_id)) : new Set();
  return list.map((v) => ({ ...v, favorite: favs.has(v.id) }));
});

router.get('/api/vendors/:id', (c) => {
  const v = q.get('SELECT vp.*, t.name, t.status, t.period_end FROM vendor_profiles vp JOIN tenants t ON t.id=vp.tenant_id WHERE vp.tenant_id=?', +c.params.id);
  if (!v || !tenancy.isActive(tenancy.getTenant(v.tenant_id))) fail(404, 'Vendor not found');
  const from = geo.validPoint({ lat: +c.query.lat, lng: +c.query.lng }) ? { lat: +c.query.lat, lng: +c.query.lng } : null;
  const menu = q.all('SELECT id, name, description, price, section, image FROM menu_items WHERE tenant_id=? AND available=1 ORDER BY section, name', v.tenant_id);
  const reviews = q.all("SELECT r.rating, r.comment, r.created_at, u.name FROM reviews r JOIN users u ON u.id=r.from_user_id WHERE r.to_tenant_id=? AND r.kind='order' ORDER BY r.id DESC LIMIT 10", v.tenant_id);
  const fav = c.user ? !!q.get('SELECT 1 x FROM favorites WHERE user_id=? AND tenant_id=?', c.user.id, v.tenant_id) : false;
  return { vendor: { ...vendorCard(v, from), favorite: fav }, menu, reviews };
});

module.exports = { vendorCard };
