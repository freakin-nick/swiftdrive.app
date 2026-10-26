'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { router, fail } = require('../http');
const { q } = require('../db');
const config = require('../config');
const tenancy = require('../tenancy');
const dispatch = require('../dispatch');
const payments = require('../payments');
const { notify, push } = require('../notify');
const { pin, hashPassword } = require('../auth');
const { orderView, completeOrder } = require('./orders');

/**
 * Every vendor route starts from vendorCtx(): the tenant id comes from the signed-in
 * user's record, never from the URL/body, and every query below filters by it.
 */
function vendorCtx(c) {
  const u = c.need('vendor');
  const t = tenancy.getTenant(u.tenant_id);
  return { u, t, tid: t.id };
}
const activeOrFail = (t) => { if (!tenancy.isActive(t)) fail(402, 'Your subscription is not active. Renew to keep taking orders.', { code: 'subscription_required' }); };
const ownOrder = (c, tid) => { const o = q.get('SELECT * FROM orders WHERE id=? AND tenant_id=?', +c.params.id, tid); if (!o) fail(404, 'Order not found'); return o; };

// ---- image upload (base64 data URL; png/jpg/webp, max 3 MB) ----
router.post('/api/upload', (c) => {
  c.need();
  const m = String(c.body.data || '').match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
  if (!m) fail(400, 'Upload a PNG, JPG or WebP image');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 3 * 1024 * 1024) fail(400, 'Image is too large (max 3 MB)');
  const name = crypto.randomBytes(12).toString('hex') + (m[2] === 'jpeg' ? '.jpg' : '.' + m[2]);
  fs.writeFileSync(path.join(config.uploadsDir, name), buf);
  return { url: '/uploads/' + name };
});

// ---- profile ----
router.get('/api/vendor/profile', (c) => {
  const { tid, t } = vendorCtx(c);
  return { name: t.name, ...q.get('SELECT * FROM vendor_profiles WHERE tenant_id=?', tid), subscription_active: tenancy.isActive(t) };
});
router.patch('/api/vendor/profile', (c) => {
  const { tid, t } = vendorCtx(c); const b = c.body; const p = {};
  for (const k of ['cuisine', 'description', 'address', 'phone', 'logo', 'cover']) if (b[k] !== undefined) p[k] = b[k] === null ? null : String(b[k]).slice(0, 400);
  if (['food', 'grocery', 'convenience'].includes(b.category)) p.category = b.category;
  for (const k of ['is_open', 'delivers']) if (b[k] !== undefined) p[k] = b[k] ? 1 : 0;
  for (const k of ['prep_minutes', 'min_order', 'max_delivery_km']) if (b[k] !== undefined) { if (!(+b[k] >= 0)) fail(400, `Invalid ${k}`); p[k] = +b[k]; }
  if (b.lat !== undefined || b.lng !== undefined) { if (!Number.isFinite(+b.lat) || !Number.isFinite(+b.lng)) fail(400, 'Invalid location'); p.lat = +b.lat; p.lng = +b.lng; }
  q.update('vendor_profiles', tid, p, 'tenant_id');
  if (b.name && String(b.name).trim().length >= 2) q.update('tenants', tid, { name: String(b.name).trim().slice(0, 80) });
  return { ok: true };
});

// ---- menu ----
router.get('/api/vendor/menu', (c) => { const { tid } = vendorCtx(c); return q.all('SELECT * FROM menu_items WHERE tenant_id=? ORDER BY section, name', tid); });
const menuFields = (b, full) => {
  const o = {};
  if (full || b.name !== undefined) { if (!b.name || String(b.name).trim().length < 2) fail(400, 'Enter an item name'); o.name = String(b.name).trim().slice(0, 80); }
  if (full || b.price !== undefined) { if (!(+b.price > 0) || +b.price > 100000) fail(400, 'Enter a valid price'); o.price = Math.round(+b.price * 100) / 100; }
  if (b.description !== undefined) o.description = String(b.description || '').slice(0, 300);
  if (b.section !== undefined) o.section = String(b.section || 'Menu').slice(0, 40);
  if (b.image !== undefined) o.image = b.image;
  if (b.available !== undefined) o.available = b.available ? 1 : 0;
  return o;
};
router.post('/api/vendor/menu', (c) => {
  const { tid } = vendorCtx(c);
  const id = q.insert('menu_items', { tenant_id: tid, created_at: Date.now(), ...menuFields(c.body, true) });
  return q.get('SELECT * FROM menu_items WHERE id=?', id);
});
router.patch('/api/vendor/menu/:id', (c) => {
  const { tid } = vendorCtx(c);
  if (!q.get('SELECT 1 x FROM menu_items WHERE id=? AND tenant_id=?', +c.params.id, tid)) fail(404, 'Item not found');
  q.run(`UPDATE menu_items SET ${Object.keys(menuFields(c.body, false)).map((k) => k + '=?').join(',') || 'id=id'} WHERE id=? AND tenant_id=?`, ...Object.values(menuFields(c.body, false)), +c.params.id, tid);
  return q.get('SELECT * FROM menu_items WHERE id=?', +c.params.id);
});
router.delete('/api/vendor/menu/:id', (c) => {
  const { tid } = vendorCtx(c);
  if (!q.run('DELETE FROM menu_items WHERE id=? AND tenant_id=?', +c.params.id, tid).changes) fail(404, 'Item not found');
});

// ---- orders ----
router.get('/api/vendor/orders', (c) => {
  const { tid } = vendorCtx(c);
  const open = c.query.scope !== 'history';
  const rows = q.all(`SELECT o.*, u.name customer_name, u.phone customer_phone, r.name rider_name FROM orders o JOIN users u ON u.id=o.customer_id LEFT JOIN users r ON r.id=o.rider_id
    WHERE o.tenant_id=? AND o.status ${open ? "NOT IN ('completed','cancelled','rejected','pending_payment')" : "IN ('completed','cancelled','rejected')"} ORDER BY o.id DESC LIMIT 60`, tid);
  return rows.map((o) => ({ ...o, items: q.all('SELECT name, qty FROM order_items WHERE order_id=?', o.id) }));
});
router.get('/api/vendor/orders/:id', (c) => { const { u, tid } = vendorCtx(c); return orderView(ownOrder(c, tid), u); });

const step = (from, to, msgFn) => (c) => {
  const { tid, t } = vendorCtx(c); activeOrFail(t);
  const o = ownOrder(c, tid);
  if (!from.includes(o.status)) fail(409, `This order is ${o.status.replace(/_/g, ' ')}`);
  if (o.payment_status !== 'paid' && o.payment_method !== 'cash') fail(409, 'Waiting for the customer to pay');
  const patch = { status: to };
  if (to === 'accepted') patch.accepted_at = Date.now();
  if (to === 'ready') { patch.ready_at = Date.now(); if (o.fulfilment === 'pickup') patch.delivery_pin = o.delivery_pin || pin(4); }
  q.update('orders', o.id, patch);
  const [title, body] = msgFn(o, t);
  notify(o.customer_id, title, body, 'order', { orderId: o.id });
  push(o.customer_id, 'order:update', { id: o.id, status: to, delivery_status: o.delivery_status });
  if (to === 'ready' && o.rider_id) { notify(o.rider_id, `Order ${o.code} is ready`, 'You can pick it up now.', 'order', { orderId: o.id }); push(o.rider_id, 'order:update', { id: o.id }); }
  return { ok: true };
};
router.post('/api/vendor/orders/:id/accept', step(['placed'], 'accepted', (o, t) => ['Order accepted 👨‍🍳', `${t.name} accepted ${o.code} and will start preparing it.`]));
router.post('/api/vendor/orders/:id/preparing', step(['accepted'], 'preparing', (o, t) => ['Preparing your order', `${t.name} is preparing ${o.code}.`]));
router.post('/api/vendor/orders/:id/ready', step(['accepted', 'preparing'], 'ready', (o, t) => o.fulfilment === 'pickup'
  ? ['Ready for pickup 🛍️', `${o.code} is ready. Show your pickup code at ${t.name}.`] : ['Order ready', `${o.code} is packed and waiting for the rider.`]));

router.post('/api/vendor/orders/:id/reject', async (c) => {
  const { tid, t } = vendorCtx(c); const o = ownOrder(c, tid);
  if (!['placed', 'accepted', 'preparing'].includes(o.status)) fail(409, 'This order can no longer be rejected');
  q.run("UPDATE orders SET status='rejected', delivery_status='none', cancel_reason=? WHERE id=?", String(c.body.reason || 'Rejected by vendor').slice(0, 200), o.id);
  dispatch.stop('order', o.id);
  if (o.rider_id) { notify(o.rider_id, `Delivery ${o.code} cancelled`, 'The vendor cancelled this order.', 'order'); push(o.rider_id, 'order:update', { id: o.id }); }
  await payments.refundOrder(o.id);
  notify(o.customer_id, 'Order declined', `${t.name} could not take ${o.code}${o.payment_status === 'refunded' ? '. You have been refunded.' : '.'}`, 'order', { orderId: o.id });
  push(o.customer_id, 'order:update', { id: o.id, status: 'rejected' });
});

/** Give the delivery to one of THIS vendor's own riders. Generates the secret delivery code. */
router.post('/api/vendor/orders/:id/assign', (c) => {
  const { tid, t } = vendorCtx(c); activeOrFail(t);
  const o = ownOrder(c, tid);
  if (o.fulfilment !== 'delivery') fail(400, 'This is a pickup order');
  if (!['accepted', 'preparing', 'ready'].includes(o.status)) fail(409, 'Accept the order before assigning a rider');
  if (['picked_up', 'arrived'].includes(o.delivery_status)) fail(409, 'The rider has already left with this order');
  const rider = q.get("SELECT * FROM users WHERE id=? AND tenant_id=? AND role='rider' AND blocked=0", +c.body.rider_id, tid); // only own team
  if (!rider) fail(404, 'Rider not found in your team');
  if (q.get("SELECT 1 x FROM orders WHERE rider_id=? AND delivery_status IN ('assigned','picked_up','arrived') AND id<>?", rider.id, o.id)) fail(409, `${rider.name} is on another delivery`);
  dispatch.stop('order', o.id);
  q.run("UPDATE offers SET status='expired' WHERE kind='order' AND ref_id=? AND status='offered'", o.id);
  for (const of of q.all("SELECT user_id FROM offers WHERE kind='order' AND ref_id=?", o.id)) push(of.user_id, 'job:taken', { kind: 'order', id: o.id, reason: 'assigned' });
  const prev = o.rider_id;
  q.run("UPDATE orders SET rider_id=?, delivery_status='assigned', delivery_pin=COALESCE(delivery_pin,?) WHERE id=?", rider.id, pin(4), o.id);
  if (prev && prev !== rider.id) { notify(prev, `Delivery ${o.code} reassigned`, 'This delivery was given to another rider.', 'order'); push(prev, 'order:update', { id: o.id }); }
  notify(rider.id, `New delivery ${o.code}`, `${t.name} assigned you a delivery to ${o.dest_addr || 'the customer'}.`, 'order', { orderId: o.id });
  push(rider.id, 'order:update', { id: o.id }); push(rider.id, 'job:assigned', { kind: 'order', id: o.id });
  const fresh = q.get('SELECT delivery_pin FROM orders WHERE id=?', o.id);
  notify(o.customer_id, 'Rider assigned 🏍️', `${rider.name} will deliver ${o.code}. Your delivery code is ${fresh.delivery_pin} — give it to the rider on arrival.`, 'order', { orderId: o.id });
  push(o.customer_id, 'order:update', { id: o.id, status: o.status, delivery_status: 'assigned' });
  return { ok: true, delivery_pin: fresh.delivery_pin };
});

/** No team rider free? Broadcast to nearby RiderGo riders (nearest ring first, then wider). */
router.post('/api/vendor/orders/:id/broadcast', (c) => {
  const { tid, t } = vendorCtx(c); activeOrFail(t);
  const o = ownOrder(c, tid);
  if (o.fulfilment !== 'delivery') fail(400, 'This is a pickup order');
  if (!['accepted', 'preparing', 'ready'].includes(o.status)) fail(409, 'Accept the order first');
  if (['assigned', 'picked_up', 'arrived'].includes(o.delivery_status)) fail(409, 'A rider is already assigned');
  q.run("DELETE FROM offers WHERE kind='order' AND ref_id=?", o.id);
  q.run("UPDATE orders SET delivery_status='finding', delivery_pin=COALESCE(delivery_pin,?) WHERE id=?", pin(4), o.id);
  dispatch.start('order', o.id);
  push(o.customer_id, 'order:update', { id: o.id, status: o.status, delivery_status: 'finding' });
  return { ok: true };
});

router.post('/api/vendor/orders/:id/handover', (c) => {
  const { tid } = vendorCtx(c); const o = ownOrder(c, tid);
  if (o.fulfilment !== 'pickup' || o.status !== 'ready') fail(409, 'This order is not waiting for pickup');
  if (String(c.body.pin || '') !== o.delivery_pin) fail(400, 'Wrong pickup code. Ask the customer to show the code in their app.');
  completeOrder(o.id);
});

// ---- team (the vendor's own riders; consume plan seats) ----
router.get('/api/vendor/team', (c) => {
  const { tid, t } = vendorCtx(c);
  const members = q.all("SELECT id, name, phone, email, plate, vehicle_make, online, lat, lng, loc_at, rating_avg FROM users WHERE tenant_id=? AND role='rider'", tid)
    .map((m) => ({ ...m, busy: !!q.get("SELECT 1 x FROM orders WHERE rider_id=? AND delivery_status IN ('assigned','picked_up','arrived')", m.id) }));
  return { seats: t.seats, used: members.length, members };
});
router.post('/api/vendor/team', (c) => {
  const { tid, t } = vendorCtx(c); const b = c.body;
  activeOrFail(t);
  const used = q.get("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND role='rider'", tid).n;
  if (used >= t.seats) fail(402, `Your ${t.plan_name} plan includes ${t.seats} rider seat(s). Upgrade your plan to add more.`);
  const email = String(b.email || '').trim().toLowerCase(), phone = String(b.phone || '').replace(/[\s()-]/g, '');
  if (!b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^\+?\d{7,15}$/.test(phone) || String(b.password || '').length < 6) fail(400, 'Enter name, valid email, phone and a password of 6+ characters');
  if (q.get('SELECT 1 x FROM users WHERE email=? OR phone=?', email, phone)) fail(409, 'That email or phone is already registered');
  const id = q.insert('users', { name: b.name.trim(), email, phone, password_hash: hashPassword(b.password), role: 'rider', tenant_id: tid, is_staff: 1, vehicle_type: 'motor', vehicle_make: b.vehicle_make || null, plate: (b.plate || '').toUpperCase() || null, created_at: Date.now() });
  return { id };
});
router.delete('/api/vendor/team/:id', (c) => {
  const { tid } = vendorCtx(c);
  const m = q.get("SELECT id FROM users WHERE id=? AND tenant_id=? AND role='rider' AND is_staff=1", +c.params.id, tid);
  if (!m) fail(404, 'Rider not found');
  if (q.get("SELECT 1 x FROM orders WHERE rider_id=? AND delivery_status IN ('assigned','picked_up','arrived')", m.id)) fail(409, 'This rider is on a delivery');
  q.run('UPDATE users SET blocked=1, online=0 WHERE id=?', m.id);
});

router.get('/api/vendor/stats', (c) => {
  const { tid } = vendorCtx(c);
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const t = q.get("SELECT COUNT(*) n, COALESCE(SUM(subtotal-discount),0) s FROM orders WHERE tenant_id=? AND status='completed' AND completed_at>=?", tid, +day);
  const vp = q.get('SELECT rating_avg, rating_count, order_count FROM vendor_profiles WHERE tenant_id=?', tid);
  return { today_orders: t.n, today_sales: +t.s.toFixed(2), pending: q.get("SELECT COUNT(*) n FROM orders WHERE tenant_id=? AND status='placed'", tid).n, rating: +vp.rating_avg.toFixed(1), rating_count: vp.rating_count, total_orders: vp.order_count, wallet: payments.walletBalance(tid) };
});
