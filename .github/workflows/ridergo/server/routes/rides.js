'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const config = require('../config');
const geo = require('../geo');
const pricing = require('../pricing');
const tenancy = require('../tenancy');
const dispatch = require('../dispatch');
const payments = require('../payments');
const { notify, push } = require('../notify');
const { pin } = require('../auth');

const pt = (p, name) => { if (!geo.validPoint(p)) fail(400, `${name} location is invalid`); return { lat: +p.lat, lng: +p.lng }; };
const ACTIVE = "('searching','accepted','arrived','ongoing')";

async function quoteFor(userId, pickup, drop, promoCode) {
  const r = await geo.route(pickup, drop);
  if (r.km < 0.1) fail(400, 'Pickup and destination are too close');
  if (r.km > 150) fail(400, 'That trip is too long for RiderGo');
  const out = {};
  for (const v of ['motor', 'car']) {
    const base = pricing.rideFare(v, r.km, r.min);
    let discount = 0, promo = null;
    if (promoCode) { try { ({ discount, promo } = pricing.applyPromo(promoCode, userId, 'ride', base)); } catch (e) { if (v === 'motor') out.promo_error = e.message; } }
    out[v] = { base, discount, fare: pricing.r2(base - discount), eta_min: r.min };
  }
  return { distance_km: r.km, duration_min: r.min, geometry: r.geometry, approx: r.approx, ...out };
}

router.post('/api/rides/quote', async (c) => {
  const u = c.need('customer');
  return quoteFor(u.id, pt(c.body.pickup, 'Pickup'), pt(c.body.drop, 'Destination'), c.body.promo);
});

router.post('/api/rides', async (c) => {
  const u = c.need('customer'); const b = c.body;
  if (!['motor', 'car'].includes(b.vehicle_type)) fail(400, 'Choose a motorbike or a car');
  if (q.get(`SELECT 1 x FROM rides WHERE customer_id=? AND status IN ${ACTIVE}`, u.id)) fail(409, 'You already have a ride in progress');
  const pickup = pt(b.pickup, 'Pickup'), drop = pt(b.drop, 'Destination');
  const qt = await quoteFor(u.id, pickup, drop, b.promo); // price is ALWAYS computed here, never taken from the client
  const sel = qt[b.vehicle_type];
  const method = b.payment_method === 'paystack' ? 'paystack' : 'cash';
  const scheduled = b.scheduled_at && +b.scheduled_at > Date.now() + 10 * 60000 ? +b.scheduled_at : null;
  const id = q.tx(() => {
    const rid = q.insert('rides', {
      customer_id: u.id, vehicle_type: b.vehicle_type, status: scheduled ? 'scheduled' : 'searching',
      pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_addr: String(b.pickup_addr || 'Pinned location').slice(0, 200),
      drop_lat: drop.lat, drop_lng: drop.lng, drop_addr: String(b.drop_addr || 'Pinned location').slice(0, 200),
      distance_km: qt.distance_km, duration_min: qt.duration_min, base_fare: sel.base, discount: sel.discount, fare: sel.fare,
      promo_code: sel.discount > 0 ? String(b.promo).trim().toUpperCase() : null, payment_method: method, scheduled_at: scheduled, requested_at: Date.now(),
    });
    if (sel.discount > 0) pricing.recordPromo(String(b.promo).trim().toUpperCase(), u.id, `ride:${rid}`);
    return rid;
  });
  if (!scheduled) dispatch.start('ride', id);
  return { id, status: scheduled ? 'scheduled' : 'searching', fare: sel.fare, distance_km: qt.distance_km };
});

// Start scheduled rides when they fall due
setInterval(() => {
  for (const r of q.all("SELECT id FROM rides WHERE status='scheduled' AND scheduled_at<=?", Date.now() + 5 * 60000)) {
    q.run("UPDATE rides SET status='searching' WHERE id=? AND status='scheduled'", r.id);
    dispatch.start('ride', r.id);
  }
}, 30000).unref();

function riderView(r) {
  if (!r.rider_id) return null;
  const u = q.get('SELECT id, name, phone, avatar, rating_avg, rating_count, vehicle_type, vehicle_make, plate, lat, lng, loc_at FROM users WHERE id=?', r.rider_id);
  return u && { id: u.id, name: u.name, phone: u.phone, avatar: u.avatar, rating: +u.rating_avg.toFixed(2), rating_count: u.rating_count, vehicle_type: u.vehicle_type, vehicle_make: u.vehicle_make, plate: u.plate, lat: u.lat, lng: u.lng, loc_at: u.loc_at };
}
function rideDetail(r, viewer) {
  const isCustomer = viewer.id === r.customer_id;
  const out = { ride: { ...r, start_pin: undefined }, rider: isCustomer || viewer.role === 'admin' ? riderView(r) : undefined };
  if (isCustomer && ['accepted', 'arrived'].includes(r.status)) out.ride.start_pin = r.start_pin; // customer reads this out to the rider
  if (!isCustomer) { const cu = q.get('SELECT name, phone, rating_avg FROM users WHERE id=?', r.customer_id); out.customer = { name: cu.name, phone: cu.phone, rating: +cu.rating_avg.toFixed(2) }; }
  out.reviewed = !!q.get("SELECT 1 x FROM reviews WHERE kind='ride' AND ref_id=? AND from_user_id=?", r.id, viewer.id);
  return out;
}
function loadRide(id, user, who = 'any') {
  const r = q.get('SELECT * FROM rides WHERE id=?', +id);
  if (!r) fail(404, 'Ride not found');
  const ok = user.role === 'admin' || r.customer_id === user.id || r.rider_id === user.id;
  if (!ok || (who === 'rider' && r.rider_id !== user.id) || (who === 'customer' && r.customer_id !== user.id)) fail(404, 'Ride not found');
  return r;
}

router.get('/api/rides', (c) => {
  const u = c.need('customer', 'rider', 'driver');
  const col = u.role === 'customer' ? 'customer_id' : 'rider_id';
  return q.all(`SELECT id, vehicle_type, status, pickup_addr, drop_addr, fare, distance_km, payment_method, payment_status, requested_at, ended_at FROM rides WHERE ${col}=? ORDER BY id DESC LIMIT 50`, u.id);
});
router.get('/api/rides/current', (c) => {
  const u = c.need('customer');
  const r = q.get(`SELECT * FROM rides WHERE customer_id=? AND (status IN ${ACTIVE} OR (status='completed' AND ended_at>? AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.kind='ride' AND v.ref_id=rides.id AND v.from_user_id=?))) ORDER BY id DESC LIMIT 1`, u.id, Date.now() - 6 * 3600000, u.id);
  return r ? rideDetail(r, u) : { ride: null };
});
router.get('/api/rides/:id', (c) => { const u = c.need(); return rideDetail(loadRide(c.params.id, u), u); });

router.post('/api/rides/:id/cancel', (c) => {
  const u = c.need('customer', 'rider', 'driver'); const r = loadRide(c.params.id, u);
  const reason = String(c.body.reason || '').slice(0, 200);
  if (u.id === r.customer_id) {
    if (!['searching', 'accepted', 'arrived', 'scheduled'].includes(r.status)) fail(409, 'This ride can no longer be cancelled');
    q.run("UPDATE rides SET status='cancelled', cancelled_by='customer', cancel_reason=? WHERE id=?", reason, r.id);
    dispatch.stop('ride', r.id); q.run("UPDATE offers SET status='expired' WHERE kind='ride' AND ref_id=? AND status='offered'", r.id);
    if (r.rider_id) { notify(r.rider_id, 'Ride cancelled', 'The customer cancelled this ride.', 'ride', { rideId: r.id }); push(r.rider_id, 'ride:update', { id: r.id, status: 'cancelled' }); }
    for (const o of q.all("SELECT user_id FROM offers WHERE kind='ride' AND ref_id=?", r.id)) push(o.user_id, 'job:taken', { kind: 'ride', id: r.id, reason: 'cancelled' });
  } else {
    if (!['accepted', 'arrived'].includes(r.status)) fail(409, 'You can only cancel before the trip starts');
    // put the ride back in the queue for other riders
    q.run("UPDATE offers SET status='declined' WHERE kind='ride' AND ref_id=? AND user_id=?", r.id, u.id);
    q.run("UPDATE rides SET status='searching', rider_id=NULL, tenant_id=NULL, start_pin=NULL, accepted_at=NULL, arrived_at=NULL, gear_confirmed=0 WHERE id=?", r.id);
    notify(r.customer_id, 'Rider cancelled', 'Your rider cancelled. We are finding you another one…', 'ride', { rideId: r.id });
    dispatch.start('ride', r.id);
  }
  push(r.customer_id, 'ride:update', { id: r.id, status: u.id === r.customer_id ? 'cancelled' : 'searching' });
  return { ok: true };
});

router.post('/api/rides/:id/retry', (c) => {
  const u = c.need('customer'); const r = loadRide(c.params.id, u, 'customer');
  if (r.status !== 'no_riders') fail(409, 'Nothing to retry');
  q.run("UPDATE rides SET status='searching' WHERE id=?", r.id); q.run('DELETE FROM offers WHERE kind=? AND ref_id=?', 'ride', r.id);
  dispatch.start('ride', r.id); return { ok: true };
});

// ---------- Provider (rider/driver) side ----------
const provider = (c) => c.need('rider', 'driver');

router.post('/api/provider/status', (c) => {
  const u = provider(c); const b = c.body;
  const online = !!b.online;
  if (online) {
    const t = tenancy.getTenant(u.tenant_id);
    if (!tenancy.isActive(t)) fail(402, 'Your subscription is not active. Subscribe to start earning.', { code: 'subscription_required' });
    if (!geo.validPoint(b)) fail(400, 'We need your location to go online');
    q.update('users', u.id, { online: 1, lat: +b.lat, lng: +b.lng, loc_at: Date.now() });
    // pick up requests that were already waiting nearby
    for (const r of q.all("SELECT id FROM rides WHERE status='searching'")) dispatch.start('ride', r.id, 0);
    for (const o of q.all("SELECT id FROM orders WHERE delivery_status='finding'")) dispatch.start('order', o.id, 0);
  } else q.update('users', u.id, { online: 0 });
  return { online };
});

router.post('/api/provider/location', (c) => {
  const u = provider(c);
  if (!geo.validPoint(c.body)) fail(400, 'Invalid location');
  const lat = +c.body.lat, lng = +c.body.lng, now = Date.now();
  q.update('users', u.id, { lat, lng, loc_at: now });
  const ride = q.get("SELECT id, customer_id, status FROM rides WHERE rider_id=? AND status IN ('accepted','arrived','ongoing')", u.id);
  if (ride) {
    push(ride.customer_id, 'track', { kind: 'ride', id: ride.id, lat, lng, heading: c.body.heading ?? null });
    if (ride.status === 'ongoing') q.insert('ride_points', { ride_id: ride.id, lat, lng, at: now });
  }
  const ord = q.get("SELECT id, customer_id FROM orders WHERE rider_id=? AND delivery_status IN ('picked_up','arrived')", u.id);
  if (ord) push(ord.customer_id, 'track', { kind: 'order', id: ord.id, lat, lng, heading: c.body.heading ?? null });
  return { ok: true };
});

router.get('/api/provider/offers', (c) => {
  const u = provider(c);
  const out = [];
  for (const o of q.all("SELECT * FROM offers WHERE user_id=? AND status='offered' AND created_at>?", u.id, Date.now() - config.dispatch.ringSeconds * 1000 * 3)) {
    if (o.kind === 'ride') {
      const r = q.get("SELECT * FROM rides WHERE id=? AND status='searching'", o.ref_id);
      if (r) out.push({ kind: 'ride', id: r.id, vehicle: r.vehicle_type, pickup: r.pickup_addr, drop: r.drop_addr, pickup_lat: r.pickup_lat, pickup_lng: r.pickup_lng, drop_lat: r.drop_lat, drop_lng: r.drop_lng, distance_km: r.distance_km, fare: r.fare, payment: r.payment_method, away_km: o.distance_km, ttl: Math.max(5, Math.round(config.dispatch.ringSeconds - (Date.now() - o.created_at) / 1000)) });
    } else {
      const r = q.get("SELECT o.*, vp.lat vlat, vp.lng vlng, vp.address vaddr, t.name vname FROM orders o JOIN vendor_profiles vp ON vp.tenant_id=o.tenant_id JOIN tenants t ON t.id=o.tenant_id WHERE o.id=? AND o.delivery_status='finding'", o.ref_id);
      if (r) out.push({ kind: 'order', id: r.id, vehicle: 'motor', pickup: `${r.vname} · ${r.vaddr || ''}`, drop: r.dest_addr, pickup_lat: r.vlat, pickup_lng: r.vlng, drop_lat: r.dest_lat, drop_lng: r.dest_lng, distance_km: r.distance_km, fare: r.delivery_fee, payment: r.payment_method, away_km: o.distance_km, code: r.code, ttl: Math.max(5, Math.round(config.dispatch.ringSeconds - (Date.now() - o.created_at) / 1000)) });
    }
  }
  return out;
});

router.get('/api/provider/active', (c) => {
  const u = provider(c);
  const ride = q.get("SELECT * FROM rides WHERE rider_id=? AND status IN ('accepted','arrived','ongoing') ORDER BY id DESC LIMIT 1", u.id);
  const order = q.get("SELECT id FROM orders WHERE rider_id=? AND delivery_status IN ('assigned','picked_up','arrived') ORDER BY id DESC LIMIT 1", u.id);
  return { ride: ride ? rideDetail(ride, u) : null, order_id: order?.id || null };
});

router.post('/api/jobs/:kind/:id/accept', (c) => {
  const u = provider(c); const kind = c.params.kind, id = +c.params.id;
  if (!['ride', 'order'].includes(kind)) fail(400, 'Bad job');
  const job = dispatch.accept(kind, id, u.id);
  if (!job) fail(409, 'Another rider already accepted this request');
  if (kind === 'ride') {
    const r = q.get('SELECT * FROM rides WHERE id=?', id);
    notify(r.customer_id, 'Rider on the way 🏍️', `${u.name} accepted your ride${u.vehicle_make ? ' · ' + u.vehicle_make : ''}${u.plate ? ' · ' + u.plate : ''}`, 'ride', { rideId: id });
    push(r.customer_id, 'ride:update', { id, status: 'accepted' });
    return rideDetail(r, u);
  }
  const o = q.get('SELECT * FROM orders WHERE id=?', id);
  const t = tenancy.getTenant(o.tenant_id);
  notify(o.customer_id, 'Rider assigned', `${u.name} will deliver order ${o.code}. Your delivery code is ${o.delivery_pin}.`, 'order', { orderId: id });
  notify(t.owner_id, `Rider found for ${o.code}`, `${u.name} accepted the delivery.`, 'order', { orderId: id });
  push(o.customer_id, 'order:update', { id, status: o.status, delivery_status: 'assigned' }); push(t.owner_id, 'order:update', { id });
  return { order_id: id };
});
router.post('/api/jobs/:kind/:id/decline', (c) => { const u = provider(c); dispatch.decline(c.params.kind, +c.params.id, u.id); });

router.post('/api/rides/:id/arrived', (c) => {
  const u = provider(c); const r = loadRide(c.params.id, u, 'rider');
  if (r.status !== 'accepted') fail(409, 'Not at the right step yet');
  q.run("UPDATE rides SET status='arrived', arrived_at=? WHERE id=?", Date.now(), r.id);
  notify(r.customer_id, 'Your rider has arrived', r.vehicle_type === 'motor' ? 'Please collect the helmet from your rider and share your ride PIN.' : 'Share your ride PIN to start.', 'ride', { rideId: r.id });
  push(r.customer_id, 'ride:update', { id: r.id, status: 'arrived' });
});
/** Safety: motorbike riders must confirm they handed over a helmet + protective gear before the trip can start. */
router.post('/api/rides/:id/gear', (c) => {
  const u = provider(c); const r = loadRide(c.params.id, u, 'rider');
  if (r.vehicle_type !== 'motor') fail(400, 'Only motorbike rides need gear');
  q.run('UPDATE rides SET gear_confirmed=1 WHERE id=?', r.id);
  push(r.customer_id, 'ride:update', { id: r.id });
});
router.post('/api/rides/:id/start', (c) => {
  const u = provider(c); const r = loadRide(c.params.id, u, 'rider');
  if (r.status !== 'arrived') fail(409, 'Tap "I\'ve arrived" first');
  if (r.vehicle_type === 'motor' && !r.gear_confirmed) fail(400, 'Confirm you have given the passenger a helmet and protective gear');
  if (String(c.body.pin || '') !== r.start_pin) fail(400, 'Wrong PIN. Ask the passenger for the 4-digit code in their app.');
  q.run("UPDATE rides SET status='ongoing', started_at=? WHERE id=?", Date.now(), r.id);
  notify(r.customer_id, 'Trip started', 'Enjoy your ride. Share your trip with a friend from the app.', 'ride', { rideId: r.id });
  push(r.customer_id, 'ride:update', { id: r.id, status: 'ongoing' });
});
router.post('/api/rides/:id/complete', (c) => {
  const u = provider(c); const r = loadRide(c.params.id, u, 'rider');
  if (r.status !== 'ongoing') fail(409, 'Trip has not started');
  // measured distance from the GPS trail (for auditing; fare was locked at quote time)
  const pts = q.all('SELECT lat, lng FROM ride_points WHERE ride_id=? ORDER BY id', r.id);
  let km = 0; for (let i = 1; i < pts.length; i++) km += geo.haversine(pts[i - 1], pts[i]);
  q.run("UPDATE rides SET status='completed', ended_at=?, actual_km=? WHERE id=?", Date.now(), +km.toFixed(2), r.id);
  payments.settleRide(r.id);
  notify(r.customer_id, 'You have arrived 🎉', r.payment_method === 'paystack' && r.payment_status !== 'paid' ? `Pay ${config.currency} ${r.fare.toFixed(2)} to finish, then rate your rider.` : `Trip total ${config.currency} ${r.fare.toFixed(2)}. Rate your rider.`, 'ride', { rideId: r.id });
  push(r.customer_id, 'ride:update', { id: r.id, status: 'completed' });
  return { fare: r.fare, cash: r.payment_method === 'cash' };
});

router.post('/api/rides/:id/sos', (c) => {
  const u = c.need(); const r = loadRide(c.params.id, u);
  q.insert('sos_events', { user_id: u.id, ride_id: r.id, lat: +c.body.lat || null, lng: +c.body.lng || null, created_at: Date.now() });
  for (const a of q.all("SELECT id FROM users WHERE role='admin'")) notify(a.id, '🚨 SOS alert', `${u.name} triggered SOS on ride #${r.id}`, 'sos', { rideId: r.id, lat: c.body.lat, lng: c.body.lng });
  const other = u.id === r.customer_id ? r.rider_id : r.customer_id;
  if (other) notify(other, 'Safety alert', 'An SOS was raised on this trip. Support has been notified.', 'sos', { rideId: r.id });
  return { ok: true, message: 'Support has been alerted with your location. If you are in danger, call your local emergency number (112).' };
});

router.get('/api/provider/earnings', (c) => {
  const u = provider(c); const t = tenancy.getTenant(u.tenant_id);
  const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
  const rows = (since) => q.get("SELECT COUNT(*) n, COALESCE(SUM(fare),0) s FROM rides WHERE rider_id=? AND status='completed' AND ended_at>=?", u.id, since);
  const del = (since) => q.get("SELECT COUNT(*) n, COALESCE(SUM(delivery_fee),0) s FROM orders WHERE rider_id=? AND status='completed' AND completed_at>=?", u.id, since);
  const week = Date.now() - 7 * 86400000;
  return {
    today: { trips: rows(+startDay).n + del(+startDay).n, earned: +(rows(+startDay).s + del(+startDay).s).toFixed(2) },
    week: { trips: rows(week).n + del(week).n, earned: +(rows(week).s + del(week).s).toFixed(2) },
    rating: u.rating_avg, rating_count: u.rating_count, subscription: { status: t.status, period_end: t.period_end, active: tenancy.isActive(t) },
  };
});
module.exports = { rideDetail, loadRide };
