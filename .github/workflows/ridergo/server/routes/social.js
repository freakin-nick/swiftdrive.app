'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const { notify } = require('../notify');
const tenancy = require('../tenancy');

// ---- notifications ----
router.get('/api/notifications', (c) => {
  const u = c.need();
  return q.all('SELECT id, title, body, type, data, read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60', u.id).map((n) => ({ ...n, data: JSON.parse(n.data || '{}'), read: !!n.read }));
});
router.post('/api/notifications/read', (c) => { const u = c.need(); q.run('UPDATE notifications SET read=1 WHERE user_id=?', u.id); });

// ---- ratings ----
function recomputeUser(userId) {
  const r = q.get('SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE to_user_id=?', userId);
  q.update('users', userId, { rating_avg: r.a || 0, rating_count: r.n });
}
function recomputeVendor(tenantId) {
  const r = q.get("SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE to_tenant_id=? AND kind='order'", tenantId);
  q.update('vendor_profiles', tenantId, { rating_avg: r.a || 0, rating_count: r.n }, 'tenant_id');
}
const stars = (v) => { const n = Math.round(+v); if (!(n >= 1 && n <= 5)) fail(400, 'Choose 1 to 5 stars'); return n; };
const comment = (s) => String(s || '').trim().slice(0, 400) || null;

router.post('/api/reviews', (c) => {
  const u = c.need(); const b = c.body; const id = +b.ref_id;
  if (b.kind === 'ride') {
    const r = q.get("SELECT * FROM rides WHERE id=? AND status='completed' AND (customer_id=? OR rider_id=?)", id, u.id, u.id);
    if (!r) fail(404, 'Ride not found or not finished');
    const to = u.id === r.customer_id ? r.rider_id : r.customer_id;
    try { q.insert('reviews', { kind: 'ride', ref_id: id, from_user_id: u.id, to_user_id: to, rating: stars(b.rating), comment: comment(b.comment), created_at: Date.now() }); }
    catch { fail(409, 'You already rated this ride'); }
    recomputeUser(to);
  } else if (b.kind === 'order') {
    const o = q.get("SELECT * FROM orders WHERE id=? AND customer_id=? AND status='completed'", id, u.id);
    if (!o) fail(404, 'Order not found or not delivered yet');
    try {
      q.insert('reviews', { kind: 'order', ref_id: id, from_user_id: u.id, to_tenant_id: o.tenant_id, rating: stars(b.rating), comment: comment(b.comment), created_at: Date.now() });
      if (b.rider_rating && o.rider_id) q.insert('reviews', { kind: 'order', ref_id: id, from_user_id: u.id, to_user_id: o.rider_id, rating: stars(b.rider_rating), created_at: Date.now() });
    } catch { fail(409, 'You already rated this order'); }
    recomputeVendor(o.tenant_id); if (o.rider_id) recomputeUser(o.rider_id);
  } else fail(400, 'Unknown review type');
});

// ---- reports (safety) ----
router.post('/api/reports', (c) => {
  const u = c.need(); const b = c.body;
  if (!b.reason || String(b.reason).length < 3) fail(400, 'Tell us what went wrong');
  let against = null;
  if (b.kind === 'ride') {
    const r = q.get('SELECT * FROM rides WHERE id=? AND (customer_id=? OR rider_id=?)', +b.ref_id, u.id, u.id);
    if (!r) fail(404, 'Ride not found'); against = u.id === r.customer_id ? r.rider_id : r.customer_id;
  } else if (b.kind === 'order') {
    const o = q.get('SELECT * FROM orders WHERE id=? AND (customer_id=? OR rider_id=?)', +b.ref_id, u.id, u.id);
    if (!o) fail(404, 'Order not found'); against = u.id === o.customer_id ? o.rider_id : o.customer_id;
  } else fail(400, 'Unknown report type');
  q.insert('reports', { reporter_id: u.id, against_user_id: against, kind: b.kind, ref_id: +b.ref_id, reason: String(b.reason).slice(0, 100), details: comment(b.details), created_at: Date.now() });
  for (const a of q.all("SELECT id FROM users WHERE role='admin'")) notify(a.id, 'New safety report', `${u.name} reported: ${b.reason}`, 'report');
  return { ok: true, message: 'Thanks. Our safety team will review this.' };
});

// ---- favourites & saved places ----
router.post('/api/favorites/:id', (c) => {
  const u = c.need('customer'); const tid = +c.params.id;
  if (q.get('SELECT 1 x FROM favorites WHERE user_id=? AND tenant_id=?', u.id, tid)) { q.run('DELETE FROM favorites WHERE user_id=? AND tenant_id=?', u.id, tid); return { favorite: false }; }
  if (!q.get("SELECT 1 x FROM tenants WHERE id=? AND type='vendor'", tid)) fail(404, 'Vendor not found');
  q.run('INSERT INTO favorites (user_id, tenant_id) VALUES (?,?)', u.id, tid); return { favorite: true };
});
router.get('/api/places', (c) => q.all('SELECT id, label, address, lat, lng FROM saved_places WHERE user_id=?', c.need('customer').id));
router.post('/api/places', (c) => {
  const u = c.need('customer'); const b = c.body;
  if (!b.label || !Number.isFinite(+b.lat) || !Number.isFinite(+b.lng)) fail(400, 'Name the place and pick a location');
  if (q.get('SELECT COUNT(*) n FROM saved_places WHERE user_id=?', u.id).n >= 20) fail(400, 'You can save up to 20 places');
  return { id: q.insert('saved_places', { user_id: u.id, label: String(b.label).slice(0, 30), address: String(b.address || '').slice(0, 200), lat: +b.lat, lng: +b.lng }) };
});
router.delete('/api/places/:id', (c) => { q.run('DELETE FROM saved_places WHERE id=? AND user_id=?', +c.params.id, c.need('customer').id); });
