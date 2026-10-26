'use strict';
// End-to-end test: boots RiderGo on a temp DB in mock-Paystack mode and drives the real HTTP + SSE API.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const dbFile = path.join(os.tmpdir(), `ridergo-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbFile + s); } catch {}
Object.assign(process.env, { DB_FILE: dbFile, PORT: '4599', APP_URL: 'http://localhost:4599', DISPATCH_RING_SECONDS: '2', PAYSTACK_SECRET_KEY: '', JWT_SECRET: 'test-secret' });
const config = require('../server/config');
require('../server/seed').seedDemo();
const server = require('../server/index');
const { q } = require('../server/db');
const BASE = 'http://localhost:4599';

let pass = 0, failN = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { failN++; console.log('  ✗', name, extra); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, url, body, token) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email) => (await api('POST', '/api/auth/login', { identifier: email, password: 'demo123' })).data;
/** collect SSE events for a user */
function listen(token) {
  const events = []; const ctl = new AbortController();
  fetch(BASE + '/api/stream?token=' + token, { signal: ctl.signal }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value);
      let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (.+)/.exec(chunk), d = /data: (.+)/.exec(chunk); if (ev && d) events.push({ event: ev[1], data: JSON.parse(d[1]) }); } }
  }).catch(() => {});
  return { events, stop: () => ctl.abort(), has: (n) => events.some((e) => e.event === n) };
}
const mockPay = async (reference) => {
  const r = await fetch(BASE + '/pay/mock/confirm', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `reference=${reference}&result=success`, redirect: 'manual' });
  return r.status;
};

(async () => {
  await sleep(300);
  console.log('\n[1] Multi-tenant registration + subscription gate');
  const reg = await api('POST', '/api/auth/register-provider', { type: 'vendor', name: 'Esi Quaye', email: 'esi@test.com', phone: '+233244000001', password: 'secret1', business_name: 'Esi Bites', address: 'Osu', lat: 5.558, lng: -0.19, category: 'food' });
  ok(reg.status === 200 && reg.data.tenant.status === 'pending_payment', 'vendor registers into a NEW tenant awaiting payment', JSON.stringify(reg.data));
  const esi = reg.data.token; const esiTenant = reg.data.tenant.id;
  const item = await api('POST', '/api/vendor/menu', { name: 'Red Red', price: 30, section: 'Mains' }, esi);
  ok(item.status === 200, 'vendor can build a menu before paying');
  let vend = await api('GET', '/api/vendors?lat=5.558&lng=-0.19');
  ok(!vend.data.some((v) => v.name === 'Esi Bites'), 'unsubscribed vendor is hidden from customers');
  const co = await api('POST', '/api/billing/checkout', {}, esi);
  ok(co.status === 200 && co.data.provider === 'mock' && co.data.authorization_url.includes('/pay/mock'), 'subscription checkout created (mock Paystack)');
  ok(await mockPay(co.data.reference) === 302, 'payment confirmed');
  const me = await api('GET', '/api/me', null, esi);
  ok(me.data.tenant.active && me.data.tenant.period_end > Date.now() + 29 * 86400000, 'tenant is active for ~30 days');
  vend = await api('GET', '/api/vendors?lat=5.558&lng=-0.19');
  ok(vend.data.some((v) => v.name === 'Esi Bites'), 'subscribed vendor now appears on the map/search');
  const regR = await api('POST', '/api/auth/register-provider', { type: 'rider', name: 'Newbie Rider', email: 'newbie@test.com', phone: '+233244000002', password: 'secret1', plate: 'GR-1-25', license_no: 'DL123456' });
  const off = await api('POST', '/api/provider/status', { online: true, lat: 5.55, lng: -0.18 }, regR.data.token);
  ok(off.status === 402, 'unsubscribed rider cannot go online (402)', JSON.stringify(off.data));

  console.log('\n[2] Webhook signature (Paystack)');
  const co2 = await api('POST', '/api/billing/checkout', {}, regR.data.token);
  const body = JSON.stringify({ event: 'charge.success', data: { reference: co2.data.reference, amount: 5000, currency: 'GHS', status: 'success', customer: { email: 'newbie@test.com', customer_code: 'CUS_x' } } });
  let w = await api('POST', '/api/payments/webhook', JSON.parse(body));
  ok(w.status === 401, 'webhook without a valid signature is rejected');
  config.paystack.secret = 'sk_test_unit';
  const sig = crypto.createHmac('sha512', 'sk_test_unit').update(body).digest('hex');
  const wr = await fetch(BASE + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig }, body });
  config.paystack.secret = '';
  ok(wr.status === 200, 'webhook with valid HMAC-SHA512 signature accepted');
  const me2 = await api('GET', '/api/me', null, regR.data.token);
  ok(me2.data.tenant.active, 'webhook activated the rider subscription');
  q.run("UPDATE tenants SET period_end=? WHERE id=?", Date.now() - 1000, regR.data.tenant.id);
  const off2 = await api('POST', '/api/provider/status', { online: true, lat: 5.55, lng: -0.18 }, regR.data.token);
  ok(off2.status === 402, 'when the month lapses the rider is locked out again');

  console.log('\n[3] Tenant isolation');
  const mama = await login('mama@demo.com'); const spice = await login('spice@demo.com');
  const mamaItem = (await api('GET', '/api/vendor/menu', null, mama.token)).data[0];
  ok((await api('PATCH', `/api/vendor/menu/${mamaItem.id}`, { price: 1 }, spice.token)).status === 404, "vendor B cannot edit vendor A's menu");
  ok((await api('DELETE', `/api/vendor/menu/${mamaItem.id}`, null, spice.token)).status === 404, "vendor B cannot delete vendor A's menu");
  const menuB = (await api('GET', '/api/vendor/menu', null, spice.token)).data;
  ok(menuB.length && menuB.every((m) => m.tenant_id === spice.tenant.id), 'vendor menu listing only returns own tenant rows');

  console.log('\n[4] Food order: pay online, assign own rider, delivery code');
  const alex = await login('alex@demo.com'); const kojo = await login('kojo@demo.com');
  const menu = (await api('GET', `/api/vendors/${mama.tenant.id}`)).data.menu;
  const dest = { lat: 5.5640, lng: -0.1740 };
  const qt = await api('POST', '/api/orders/quote', { vendor_id: mama.tenant.id, items: [{ id: menu[0].id, qty: 2 }], fulfilment: 'delivery', dest, promo: 'EATS40' }, alex.token);
  ok(qt.status === 200 && qt.data.delivery_fee >= 5 && qt.data.discount > 0, `server computed delivery fee ${qt.data.delivery_fee} (+distance ${qt.data.distance_km}km) and promo discount ${qt.data.discount}`, JSON.stringify(qt.data));
  const ord = await api('POST', '/api/orders', { vendor_id: mama.tenant.id, items: [{ id: menu[0].id, qty: 2, price: 0.01 }], fulfilment: 'delivery', dest, dest_addr: 'Labone', payment_method: 'paystack', total: 1, promo: 'EATS40' }, alex.token);
  const oid = ord.data.id;
  const full = (await api('GET', `/api/orders/${oid}`, null, alex.token)).data.order;
  ok(Math.abs(full.total - qt.data.total) < 0.01 && full.status === 'pending_payment', 'client-sent prices/total are ignored; server total used', `${full.total} vs ${qt.data.total}`);
  ok((await api('POST', `/api/vendor/orders/${oid}/accept`, {}, mama.token)).status === 409, 'vendor cannot accept before the customer pays');
  const vSse = listen(mama.token);
  await mockPay(ord.data.checkout.reference); await sleep(200);
  ok(vSse.has('notification'), 'vendor received a live notification of the paid order');
  ok((await api('POST', `/api/vendor/orders/${oid}/accept`, {}, mama.token)).status === 200, 'vendor accepts');
  ok((await api('POST', `/api/vendor/orders/${oid}/assign`, { rider_id: 999 }, mama.token)).status === 404, 'cannot assign a rider outside own team');
  const aSse = listen(alex.token); await sleep(100);
  const asg = await api('POST', `/api/vendor/orders/${oid}/assign`, { rider_id: kojo.user.id }, mama.token);
  ok(asg.status === 200 && /^\d{4}$/.test(asg.data.delivery_pin), 'vendor assigns own rider; 4-digit delivery code generated');
  await sleep(200);
  ok(aSse.events.some((e) => e.event === 'order:update' && e.data.delivery_status === 'assigned'), 'customer gets live "rider assigned" event');
  const custView = (await api('GET', `/api/orders/${oid}`, null, alex.token)).data;
  ok(custView.order.delivery_pin === asg.data.delivery_pin, 'customer sees the same code');
  const kView = (await api('GET', `/api/orders/${oid}`, null, kojo.token)).data;
  ok(kView.order.delivery_pin === undefined, 'rider does NOT see the code (customer must read it out)');
  ok(custView.rider.lat === undefined, 'rider location withheld from customer before pickup');
  ok((await api('POST', `/api/orders/${oid}/pickup`, {}, kojo.token)).status === 409, 'rider cannot pick up before vendor marks ready');
  await api('POST', `/api/vendor/orders/${oid}/ready`, {}, mama.token);
  ok((await api('POST', `/api/orders/${oid}/pickup`, {}, kojo.token)).status === 200, 'rider picks up -> out for delivery');
  await api('POST', '/api/provider/location', { lat: 5.5600, lng: -0.1780 }, kojo.token); await sleep(200);
  ok(aSse.events.some((e) => e.event === 'track' && e.data.kind === 'order'), 'customer receives live rider location');
  await api('POST', `/api/orders/${oid}/arrived`, {}, kojo.token); await sleep(100);
  ok(aSse.events.some((e) => e.data.delivery_status === 'arrived'), 'customer notified the order has arrived');
  ok((await api('POST', `/api/orders/${oid}/deliver`, { pin: '0000' === asg.data.delivery_pin ? '1111' : '0000' }, kojo.token)).status === 400, 'wrong delivery code is rejected');
  ok((await api('POST', `/api/orders/${oid}/deliver`, { pin: asg.data.delivery_pin }, kojo.token)).status === 200, 'correct code completes delivery');
  const wal = await api('GET', '/api/wallet', null, mama.token);
  const expectFood = (full.subtotal - full.discount) * (1 - config.commissionPct / 100);
  ok(wal.data.ledger.some((l) => Math.abs(l.amount - expectFood) < 0.02), `vendor wallet credited ${expectFood.toFixed(2)} (after commission)`, JSON.stringify(wal.data.ledger));
  ok((await api('POST', '/api/reviews', { kind: 'order', ref_id: oid, rating: 5, rider_rating: 5, comment: 'Great' }, alex.token)).status === 200, 'customer rates vendor & rider');
  ok((await api('POST', '/api/reviews', { kind: 'order', ref_id: oid, rating: 5 }, alex.token)).status === 409, 'cannot rate the same order twice');
  ok((await api('POST', `/api/orders/${oid}/cancel`, {}, alex.token)).status === 409, 'completed order cannot be cancelled');

  console.log('\n[5] Ride dispatch: broadcast, first-accept-wins, PIN + helmet gate');
  const kwame = await login('kwame@demo.com'), ama = await login('ama@demo.com');
  await api('POST', '/api/provider/status', { online: true, lat: 5.557, lng: -0.183 }, kwame.token);
  await api('POST', '/api/provider/status', { online: true, lat: 5.570, lng: -0.19 }, ama.token);
  const kS = listen(kwame.token), amS = listen(ama.token), cS = listen(alex.token); await sleep(150);
  const pickup = { lat: 5.5560, lng: -0.1818 }, drop = { lat: 5.6050, lng: -0.1760 };
  const rq = await api('POST', '/api/rides/quote', { pickup, drop, promo: 'FIRSTRIDE' }, alex.token);
  ok(rq.status === 200 && rq.data.motor.fare < rq.data.car.fare && rq.data.motor.discount > 0, `quote motor ${rq.data.motor.fare} < car ${rq.data.car.fare}, promo applied`);
  const ride = await api('POST', '/api/rides', { pickup, drop, pickup_addr: 'Osu', drop_addr: 'Airport', vehicle_type: 'motor', payment_method: 'cash', fare: 0.5, promo: 'FIRSTRIDE' }, alex.token);
  ok(ride.status === 200 && Math.abs(ride.data.fare - rq.data.motor.fare) < 0.01, 'ride fare locked server-side (client "fare":0.5 ignored)');
  await sleep(400);
  ok(kS.has('job:offer') && amS.has('job:offer'), 'both nearby riders receive the broadcast');
  const car = await login('yaw@demo.com'); const yS = listen(car.token);
  const acc1 = await api('POST', `/api/jobs/ride/${ride.data.id}/accept`, {}, kwame.token);
  ok(acc1.status === 200, 'first rider accepts');
  const acc2 = await api('POST', `/api/jobs/ride/${ride.data.id}/accept`, {}, ama.token);
  ok(acc2.status === 409, 'second rider is told it is already taken');
  await sleep(200);
  ok(amS.events.some((e) => e.event === 'job:taken'), 'request vanished from the other rider\'s screen');
  ok(!yS.has('job:offer'), 'car driver is not offered a motorbike ride');
  ok(cS.events.some((e) => e.event === 'ride:update' && e.data.status === 'accepted'), 'customer notified instantly');
  const cDet = (await api('GET', `/api/rides/${ride.data.id}`, null, alex.token)).data;
  const rDet = (await api('GET', `/api/rides/${ride.data.id}`, null, kwame.token)).data;
  ok(/^\d{4}$/.test(cDet.ride.start_pin) && rDet.ride.start_pin === undefined, 'customer sees ride PIN, rider does not');
  ok((await api('POST', `/api/rides/${ride.data.id}/start`, { pin: cDet.ride.start_pin }, kwame.token)).status === 409, 'cannot start before arriving');
  await api('POST', `/api/rides/${ride.data.id}/arrived`, {}, kwame.token);
  const noGear = await api('POST', `/api/rides/${ride.data.id}/start`, { pin: cDet.ride.start_pin }, kwame.token);
  ok(noGear.status === 400 && /helmet/i.test(noGear.data.error), 'motor trip blocked until helmet/gear confirmed');
  await api('POST', `/api/rides/${ride.data.id}/gear`, {}, kwame.token);
  ok((await api('POST', `/api/rides/${ride.data.id}/start`, { pin: '----' }, kwame.token)).status === 400, 'wrong PIN rejected');
  ok((await api('POST', `/api/rides/${ride.data.id}/start`, { pin: cDet.ride.start_pin }, kwame.token)).status === 200, 'right PIN starts the trip');
  await api('POST', '/api/provider/location', { lat: 5.58, lng: -0.18 }, kwame.token); await sleep(150);
  ok(cS.events.some((e) => e.event === 'track' && e.data.kind === 'ride'), 'customer sees rider location live');
  ok((await api('POST', `/api/rides/${ride.data.id}/complete`, {}, kwame.token)).status === 200, 'rider ends the trip');
  ok((await api('POST', '/api/reviews', { kind: 'ride', ref_id: ride.data.id, rating: 4, comment: 'ok' }, alex.token)).status === 200, 'customer rates rider');
  ok((await api('GET', '/api/me', null, kwame.token)).data.user.rating === 4, 'rider rating updated');
  ok((await api('POST', '/api/reports', { kind: 'ride', ref_id: ride.data.id, reason: 'Unsafe riding' }, alex.token)).status === 200, 'customer can report the rider');
  ok((await api('POST', '/api/rides', { pickup, drop, vehicle_type: 'motor' }, rq.data && ama.token)).status === 403, 'riders cannot book customer rides');

  console.log('\n[6] No riders / widening search');
  q.run("UPDATE users SET online=0 WHERE role IN ('rider','driver')");
  const lost = await api('POST', '/api/rides', { pickup, drop, vehicle_type: 'car', payment_method: 'cash' }, alex.token);
  await sleep(3200);
  ok((await api('GET', `/api/rides/${lost.data.id}`, null, alex.token)).data.ride.status === 'no_riders', 'with nobody online the ride ends as no_riders after all rings');

  console.log('\n[7] Admin');
  const adm = (await api('POST', '/api/auth/login', { identifier: 'admin@ridergo.app', password: 'admin123' })).data;
  const ov = await api('GET', '/api/admin/overview', null, adm.token);
  ok(ov.status === 200 && ov.data.mrr > 0 && ov.data.rides.completed >= 1, `admin overview (MRR ${ov.data.mrr})`);
  ok((await api('GET', '/api/admin/overview', null, alex.token)).status === 403, 'customers cannot open admin');

  console.log(`\n${pass} passed, ${failN} failed`);
  server.close(); for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbFile + s); } catch {}
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
