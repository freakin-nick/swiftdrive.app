'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const config = require('../config');
const geo = require('../geo');
const pricing = require('../pricing');
const tenancy = require('../tenancy');
const payments = require('../payments');
const { notify, push } = require('../notify');
const { code } = require('../auth');

const vendorRow = (id) => q.get('SELECT vp.*, t.name, t.owner_id FROM vendor_profiles vp JOIN tenants t ON t.id=vp.tenant_id WHERE vp.tenant_id=?', id);

/** Prices an order entirely on the server from the vendor's current menu. */
async function priceOrder(user, b) {
  const v = vendorRow(+b.vendor_id);
  if (!v || !tenancy.isActive(tenancy.getTenant(v.tenant_id))) fail(404, 'This vendor is not available');
  if (!v.is_open) fail(409, `${v.name} is closed right now`);
  const fulfilment = b.fulfilment === 'pickup' ? 'pickup' : 'delivery';
  if (!Array.isArray(b.items) || !b.items.length) fail(400, 'Your basket is empty');
  const lines = [];
  for (const it of b.items) {
    const qty = Math.floor(+it.qty);
    if (!(qty >= 1 && qty <= 50)) fail(400, 'Invalid quantity');
    const m = q.get('SELECT * FROM menu_items WHERE id=? AND tenant_id=? AND available=1', +it.id, v.tenant_id);
    if (!m) fail(400, 'An item in your basket is no longer available');
    lines.push({ item_id: m.id, name: m.name, price: m.price, qty });
  }
  const subtotal = pricing.r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  if (subtotal < v.min_order) fail(400, `Minimum order for ${v.name} is ${config.currency} ${v.min_order.toFixed(2)}`);
  let delivery_fee = 0, distance_km = null, duration_min = null, approx = false, dest = null, geometry = null;
  if (fulfilment === 'delivery') {
    if (!v.delivers) fail(400, `${v.name} does not offer delivery. Choose pickup.`);
    if (!geo.validPoint(b.dest)) fail(400, 'Choose where to deliver');
    dest = { lat: +b.dest.lat, lng: +b.dest.lng };
    const r = await geo.route({ lat: v.lat, lng: v.lng }, dest);
    if (r.km > v.max_delivery_km) fail(400, `${v.name} only delivers within ${v.max_delivery_km} km (you are ${r.km} km away)`);
    ({ km: distance_km, min: duration_min, approx, geometry } = r);
    delivery_fee = pricing.deliveryFee(distance_km);
  }
  let discount = 0, promo = null, promo_error;
  if (b.promo) { try { ({ discount, promo } = pricing.applyPromo(b.promo, user.id, 'order', subtotal)); } catch (e) { promo_error = e.message; } }
  return { vendor: v, lines, fulfilment, subtotal, delivery_fee, discount, promo, promo_error, total: pricing.r2(subtotal - discount + delivery_fee), distance_km, duration_min, approx, dest, geometry };
}
const quoteView = (p) => ({ subtotal: p.subtotal, delivery_fee: p.delivery_fee, discount: p.discount, total: p.total, distance_km: p.distance_km, duration_min: p.duration_min, approx: p.approx, promo_error: p.promo_error, geometry: p.geometry, fulfilment: p.fulfilment, lines: p.lines });

router.post('/api/orders/quote', async (c) => quoteView(await priceOrder(c.need('customer'), c.body)));

router.post('/api/orders', async (c) => {
  const u = c.need('customer'); const b = c.body;
  const p = await priceOrder(u, b);
  const method = b.payment_method === 'cash' ? 'cash' : 'paystack';
  const t = tenancy.getTenant(p.vendor.tenant_id);
  const id = q.tx(() => {
    const oid = q.insert('orders', {
      code: 'RG-' + code(5), customer_id: u.id, tenant_id: p.vendor.tenant_id, status: method === 'cash' ? 'placed' : 'pending_payment',
      fulfilment: p.fulfilment, subtotal: p.subtotal, delivery_fee: p.delivery_fee, discount: p.discount, total: p.total, promo_code: p.discount > 0 ? p.promo.code : null,
      dest_lat: p.dest?.lat, dest_lng: p.dest?.lng, dest_addr: p.dest ? String(b.dest_addr || 'Pinned location').slice(0, 200) : null,
      distance_km: p.distance_km, duration_min: p.duration_min, notes: String(b.notes || '').slice(0, 300), payment_method: method, created_at: Date.now(),
    });
    for (const l of p.lines) q.insert('order_items', { order_id: oid, ...l });
    if (p.discount > 0) pricing.recordPromo(p.promo.code, u.id, `order:${oid}`);
    return oid;
  });
  const o = q.get('SELECT * FROM orders WHERE id=?', id);
  if (method === 'cash') {
    notify(t.owner_id, `New order ${o.code}`, `${p.lines.length} item(s) · ${config.currency} ${o.total.toFixed(2)} · pay on ${p.fulfilment === 'delivery' ? 'delivery' : 'pickup'}`, 'order', { orderId: id });
    push(t.owner_id, 'order:update', { id });
    return { id, code: o.code, status: o.status };
  }
  const checkout = await payments.createCheckout({ kind: 'order', user: u, tenantId: t.id, refId: id, amount: o.total, label: `Order ${o.code}` });
  return { id, code: o.code, status: o.status, checkout };
});

function orderView(o, viewer) {
  const items = q.all('SELECT name, price, qty FROM order_items WHERE order_id=?', o.id);
  const v = q.get('SELECT t.id, t.name, vp.phone, vp.address, vp.lat, vp.lng, vp.logo, vp.prep_minutes FROM tenants t JOIN vendor_profiles vp ON vp.tenant_id=t.id WHERE t.id=?', o.tenant_id);
  const isCust = viewer.id === o.customer_id, isRider = viewer.id === o.rider_id;
  const isVendor = viewer.tenant_id === o.tenant_id && viewer.role === 'vendor';
  let rider = null;
  if (o.rider_id) {
    const r = q.get('SELECT id, name, phone, avatar, rating_avg, vehicle_make, plate, lat, lng FROM users WHERE id=?', o.rider_id);
    const live = ['picked_up', 'arrived'].includes(o.delivery_status); // location is only shared once the rider is on the way
    rider = r && { id: r.id, name: r.name, phone: r.phone, avatar: r.avatar, rating: +r.rating_avg.toFixed(2), vehicle_make: r.vehicle_make, plate: r.plate, lat: live || isRider || isVendor ? r.lat : undefined, lng: live || isRider || isVendor ? r.lng : undefined };
  }
  const cu = !isCust ? q.get('SELECT name, phone FROM users WHERE id=?', o.customer_id) : null;
  return {
    order: { ...o, delivery_pin: isCust || isVendor ? o.delivery_pin : undefined }, items, vendor: v, rider,
    customer: cu ? { name: cu.name, phone: cu.phone } : undefined,
    reviewed: !!q.get("SELECT 1 x FROM reviews WHERE kind='order' AND ref_id=? AND from_user_id=?", o.id, viewer.id),
  };
}
function loadOrder(id, user) {
  const o = q.get('SELECT * FROM orders WHERE id=?', +id);
  if (!o) fail(404, 'Order not found');
  const ok = user.role === 'admin' || o.customer_id === user.id || o.rider_id === user.id || (user.role === 'vendor' && user.tenant_id === o.tenant_id);
  if (!ok) fail(404, 'Order not found'); // other tenants never learn it exists
  return o;
}

router.get('/api/orders', (c) => {
  const u = c.need('customer');
  return q.all(`SELECT o.id, o.code, o.status, o.delivery_status, o.fulfilment, o.total, o.payment_status, o.created_at, t.name vendor_name, vp.logo
    FROM orders o JOIN tenants t ON t.id=o.tenant_id JOIN vendor_profiles vp ON vp.tenant_id=t.id WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 50`, u.id);
});
router.get('/api/orders/:id', (c) => { const u = c.need(); return orderView(loadOrder(c.params.id, u), u); });

router.post('/api/orders/:id/cancel', async (c) => {
  const u = c.need('customer'); const o = loadOrder(c.params.id, u);
  if (o.customer_id !== u.id) fail(404, 'Order not found');
  if (!['pending_payment', 'placed'].includes(o.status)) fail(409, 'The vendor has already started this order. Contact them to cancel.');
  q.run("UPDATE orders SET status='cancelled', cancel_reason=? WHERE id=?", String(c.body.reason || 'Cancelled by customer').slice(0, 200), o.id);
  await payments.refundOrder(o.id);
  const t = tenancy.getTenant(o.tenant_id);
  notify(t.owner_id, `Order ${o.code} cancelled`, 'The customer cancelled before you accepted.', 'order', { orderId: o.id }); push(t.owner_id, 'order:update', { id: o.id });
});

// ---------- Rider delivery steps ----------
const myOrder = (c) => { const u = c.need('rider'); const o = q.get('SELECT * FROM orders WHERE id=? AND rider_id=?', +c.params.id, u.id); if (!o) fail(404, 'Delivery not found'); return [u, o]; };

router.post('/api/orders/:id/pickup', (c) => {
  const [u, o] = myOrder(c);
  if (o.delivery_status !== 'assigned') fail(409, 'Not at the right step');
  if (o.status !== 'ready') fail(409, 'The vendor has not marked this order as ready yet');
  q.run("UPDATE orders SET delivery_status='picked_up', status='out_for_delivery', picked_at=? WHERE id=?", Date.now(), o.id);
  notify(o.customer_id, 'Your order is on the way 🏍️', `${u.name} picked up ${o.code}. Track your rider live in the app.`, 'order', { orderId: o.id });
  push(o.customer_id, 'order:update', { id: o.id, status: 'out_for_delivery', delivery_status: 'picked_up' });
  const t = tenancy.getTenant(o.tenant_id); push(t.owner_id, 'order:update', { id: o.id });
});
router.post('/api/orders/:id/arrived', (c) => {
  const [u, o] = myOrder(c);
  if (o.delivery_status !== 'picked_up') fail(409, 'Pick up the order first');
  q.run("UPDATE orders SET delivery_status='arrived' WHERE id=?", o.id);
  notify(o.customer_id, 'Your order has arrived 📦', `Please come and collect it. Tell the rider your delivery code.`, 'order', { orderId: o.id });
  push(o.customer_id, 'order:update', { id: o.id, status: 'out_for_delivery', delivery_status: 'arrived' });
});
/** The customer reads their code to the rider, who types it in. Only the right code completes the delivery. */
router.post('/api/orders/:id/deliver', (c) => {
  const [u, o] = myOrder(c);
  if (o.delivery_status !== 'arrived') fail(409, 'Tap "I\'ve arrived" first');
  if (String(c.body.pin || '') !== o.delivery_pin) fail(400, 'Wrong code. Ask the customer for the 4-digit delivery code.');
  completeOrder(o.id);
  return { ok: true, cash: o.payment_method === 'cash' ? o.total : 0 };
});

function completeOrder(id) {
  q.run("UPDATE orders SET status='completed', completed_at=? WHERE id=? AND status<>'completed'", Date.now(), id);
  const o = q.get('SELECT * FROM orders WHERE id=?', id);
  q.run('UPDATE vendor_profiles SET order_count=order_count+1 WHERE tenant_id=?', o.tenant_id);
  if (o.payment_method === 'cash') q.run("UPDATE orders SET payment_status='paid_cash' WHERE id=?", id);
  payments.settleOrder(id);
  const t = tenancy.getTenant(o.tenant_id);
  notify(o.customer_id, 'Order delivered ✅', `Enjoy your meal! Rate ${t.name}.`, 'order', { orderId: id });
  push(o.customer_id, 'order:update', { id, status: 'completed', delivery_status: o.delivery_status });
  push(t.owner_id, 'order:update', { id });
}

router.get('/api/rider/orders', (c) => {
  const u = c.need('rider');
  return q.all(`SELECT o.id, o.code, o.status, o.delivery_status, o.delivery_fee, o.dest_addr, o.created_at, t.name vendor FROM orders o JOIN tenants t ON t.id=o.tenant_id WHERE o.rider_id=? ORDER BY o.id DESC LIMIT 30`, u.id);
});

module.exports = { orderView, loadOrder, completeOrder };
