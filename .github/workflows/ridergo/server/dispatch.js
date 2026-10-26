'use strict';
const { q } = require('./db');
const config = require('./config');
const { haversine } = require('./geo');
const { notify, push } = require('./notify');
const { pin } = require('./auth');
const tenancy = require('./tenancy');

const timers = new Map(); // "kind:id" -> timeout
const key = (kind, id) => `${kind}:${id}`;

const ACTIVE_RIDE = "('accepted','arrived','ongoing')";
const ACTIVE_ORDER = "('assigned','picked_up','arrived')";

/** Online, fresh-GPS, subscribed, idle providers with the right vehicle, nearest first. */
function candidates(job, radiusKm) {
  const fresh = Date.now() - config.dispatch.locFreshMs;
  const vehicleRole = job.kind === 'ride' ? (job.vehicle_type === 'car' ? 'driver' : 'rider') : 'rider';
  const rows = q.all(
    `SELECT u.id, u.name, u.lat, u.lng, u.tenant_id FROM users u
     WHERE u.role=? AND u.online=1 AND u.blocked=0 AND u.loc_at>? AND u.lat IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.rider_id=u.id AND r.status IN ${ACTIVE_RIDE})
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.rider_id=u.id AND o.delivery_status IN ${ACTIVE_ORDER})`,
    vehicleRole, fresh);
  return rows
    .filter((u) => tenancy.isActive(tenancy.getTenant(u.tenant_id)))
    .map((u) => ({ ...u, dist: haversine({ lat: job.lat, lng: job.lng }, u) }))
    .filter((u) => u.dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist);
}

function loadJob(kind, id) {
  if (kind === 'ride') {
    const r = q.get('SELECT * FROM rides WHERE id=?', id);
    return r && { kind, id, row: r, open: r.status === 'searching', lat: r.pickup_lat, lng: r.pickup_lng, vehicle_type: r.vehicle_type };
  }
  const o = q.get('SELECT o.*, vp.lat v_lat, vp.lng v_lng FROM orders o JOIN vendor_profiles vp ON vp.tenant_id=o.tenant_id WHERE o.id=?', id);
  return o && { kind, id, row: o, open: o.delivery_status === 'finding', lat: o.v_lat, lng: o.v_lng, vehicle_type: 'motor' };
}

function offerPayload(job) {
  const r = job.row;
  if (job.kind === 'ride') {
    return { kind: 'ride', id: job.id, vehicle: r.vehicle_type, pickup: r.pickup_addr, drop: r.drop_addr, pickup_lat: r.pickup_lat, pickup_lng: r.pickup_lng,
      drop_lat: r.drop_lat, drop_lng: r.drop_lng, distance_km: r.distance_km, fare: r.fare, payment: r.payment_method, ttl: config.dispatch.ringSeconds };
  }
  const v = q.get('SELECT t.name, vp.address FROM tenants t JOIN vendor_profiles vp ON vp.tenant_id=t.id WHERE t.id=?', r.tenant_id);
  return { kind: 'order', id: job.id, vehicle: 'motor', pickup: `${v.name} · ${v.address || ''}`, drop: r.dest_addr, pickup_lat: job.lat, pickup_lng: job.lng,
    drop_lat: r.dest_lat, drop_lng: r.dest_lng, distance_km: r.distance_km, fare: r.delivery_fee, payment: r.payment_method, ttl: config.dispatch.ringSeconds, code: r.code };
}

/** Begin (or resume) broadcasting a job to riders, widening the radius ring by ring. */
function start(kind, id, ring = 0) {
  const k = key(kind, id);
  clearTimeout(timers.get(k));
  const job = loadJob(kind, id);
  if (!job || !job.open) return;
  const radii = config.dispatch.radii;
  if (ring >= radii.length) return exhaust(job);
  const alreadyOffered = new Set(q.all('SELECT user_id FROM offers WHERE kind=? AND ref_id=?', kind, id).map((o) => o.user_id));
  const fresh = candidates(job, radii[ring]).filter((c) => !alreadyOffered.has(c.id));
  for (const c of fresh) {
    q.run("INSERT OR IGNORE INTO offers (kind, ref_id, user_id, status, ring, distance_km, created_at) VALUES (?,?,?,?,?,?,?)", kind, id, c.id, 'offered', ring, +c.dist.toFixed(2), Date.now());
    push(c.id, 'job:offer', { ...offerPayload(job), away_km: +c.dist.toFixed(1), ring: radii[ring] });
    notify(c.id, kind === 'ride' ? 'New ride request' : 'New delivery request', `${job.row.pickup_addr || ''}`.slice(0, 80) || 'Tap to view', 'offer', { kind, id });
  }
  // Move to the next ring if nobody answers in time (or nobody was in range this time)
  // (earlier rings stay open: nearby riders can still accept while we reach further out)
  let delay = 800;
  if (fresh.length) delay = config.dispatch.ringSeconds * 1000;
  else {
    const last = q.get("SELECT MAX(created_at) t FROM offers WHERE kind=? AND ref_id=? AND status='offered'", kind, id).t;
    if (last) delay = Math.max(800, last + config.dispatch.ringSeconds * 1000 - Date.now());
  }
  timers.set(k, setTimeout(() => start(kind, id, ring + 1), delay));
}

function expireOffers(kind, id) {
  const open = q.all("SELECT user_id FROM offers WHERE kind=? AND ref_id=? AND status='offered'", kind, id);
  q.run("UPDATE offers SET status='expired' WHERE kind=? AND ref_id=? AND status='offered'", kind, id);
  for (const o of open) push(o.user_id, 'job:taken', { kind, id, reason: 'expired' });
}

function exhaust(job) {
  expireOffers(job.kind, job.id);
  clearTimeout(timers.get(key(job.kind, job.id))); timers.delete(key(job.kind, job.id));
  if (job.kind === 'ride') {
    q.run("UPDATE rides SET status='no_riders' WHERE id=? AND status='searching'", job.id);
    notify(job.row.customer_id, 'No riders nearby', 'We could not find a rider right now. Please try again.', 'ride', { rideId: job.id });
    push(job.row.customer_id, 'ride:update', { id: job.id });
  } else {
    q.run("UPDATE orders SET delivery_status='no_riders' WHERE id=? AND delivery_status='finding'", job.id);
    const t = tenancy.getTenant(job.row.tenant_id);
    notify(t.owner_id, `No rider for ${job.row.code}`, 'No riders accepted. Assign one of your own riders or try again.', 'order', { orderId: job.id });
    push(t.owner_id, 'order:update', { id: job.id });
  }
}

function stop(kind, id) { clearTimeout(timers.get(key(kind, id))); timers.delete(key(kind, id)); }

/** First rider to accept wins; everyone else's offer disappears instantly. Returns job or null. */
function accept(kind, id, riderId) {
  const rider = q.get('SELECT * FROM users WHERE id=?', riderId);
  if (!tenancy.isActive(tenancy.getTenant(rider.tenant_id))) throw Object.assign(new Error('Your subscription is not active'), { status: 402 });
  const offered = q.get("SELECT 1 x FROM offers WHERE kind=? AND ref_id=? AND user_id=? AND status='offered'", kind, id, riderId);
  if (!offered) throw Object.assign(new Error('This request is no longer available'), { status: 409 });
  const won = q.tx(() => {
    if (kind === 'ride') {
      if (q.get("SELECT 1 x FROM rides WHERE rider_id=? AND status IN ('accepted','arrived','ongoing')", riderId)) throw Object.assign(new Error('Finish your current trip first'), { status: 409 });
      return q.run("UPDATE rides SET rider_id=?, tenant_id=?, status='accepted', accepted_at=?, start_pin=? WHERE id=? AND status='searching'", riderId, rider.tenant_id, Date.now(), pin(4), id).changes === 1;
    }
    if (q.get("SELECT 1 x FROM orders WHERE rider_id=? AND delivery_status IN ('assigned','picked_up','arrived')", riderId)) throw Object.assign(new Error('Finish your current delivery first'), { status: 409 });
    return q.run("UPDATE orders SET rider_id=?, delivery_status='assigned', delivery_pin=COALESCE(delivery_pin,?) WHERE id=? AND delivery_status='finding'", riderId, pin(4), id).changes === 1;
  });
  if (!won) return null;
  stop(kind, id);
  q.run("UPDATE offers SET status='accepted' WHERE kind=? AND ref_id=? AND user_id=?", kind, id, riderId);
  for (const o of q.all("SELECT user_id FROM offers WHERE kind=? AND ref_id=? AND status='offered'", kind, id)) {
    push(o.user_id, 'job:taken', { kind, id, reason: 'taken' }); // disappears from other riders' screens
  }
  q.run("UPDATE offers SET status='lost' WHERE kind=? AND ref_id=? AND status='offered'", kind, id);
  return loadJob(kind, id);
}

function decline(kind, id, riderId) {
  q.run("UPDATE offers SET status='declined' WHERE kind=? AND ref_id=? AND user_id=? AND status='offered'", kind, id, riderId);
}

/** After a server restart, resume any job that was still searching. */
function resume() {
  for (const r of q.all("SELECT id FROM rides WHERE status='searching'")) start('ride', r.id);
  for (const o of q.all("SELECT id FROM orders WHERE delivery_status='finding'")) start('order', o.id);
}

module.exports = { start, stop, accept, decline, resume, candidates };
