'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const { signToken, hashPassword, verifyPassword } = require('../auth');
const tenancy = require('../tenancy');
const sse = require('../sse');
const config = require('../config');
const { walletBalance } = require('../payments');

const normEmail = (e) => String(e || '').trim().toLowerCase();
const normPhone = (p) => String(p || '').replace(/[\s()-]/g, '');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tenant';

function checkBasics({ name, email, phone, password }) {
  if (!name || String(name).trim().length < 2) fail(400, 'Please enter your name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(email))) fail(400, 'Enter a valid email address');
  if (!/^\+?\d{7,15}$/.test(normPhone(phone))) fail(400, 'Enter a valid phone number');
  if (String(password || '').length < 6) fail(400, 'Password must be at least 6 characters');
  if (q.get('SELECT 1 x FROM users WHERE email=?', normEmail(email))) fail(409, 'An account with this email already exists');
  if (q.get('SELECT 1 x FROM users WHERE phone=?', normPhone(phone))) fail(409, 'An account with this phone number already exists');
}

const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, tenant_id: u.tenant_id, is_staff: !!u.is_staff, avatar: u.avatar,
  rating: +u.rating_avg.toFixed(2), rating_count: u.rating_count, vehicle_type: u.vehicle_type, vehicle_make: u.vehicle_make, plate: u.plate,
  license_no: u.license_no, has_gear: !!u.has_gear, online: !!u.online,
});

function meView(u) {
  const t = tenancy.getTenant(u.tenant_id);
  return {
    user: publicUser(u),
    tenant: t && {
      id: t.id, type: t.type, name: t.name, status: t.status, active: tenancy.isActive(t), period_end: t.period_end,
      plan: t.plan_name, plan_amount: t.plan_amount, seats: t.seats, is_owner: t.owner_id === u.id, auto_renew: !!t.auto_renew,
    },
    wallet: t && t.owner_id === u.id ? walletBalance(t.id) : undefined,
    unread: q.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0', u.id).c,
  };
}
const session = (u) => ({ token: signToken({ uid: u.id }), ...meView(u) });

router.post('/api/auth/register', (c) => {
  checkBasics(c.body);
  const id = q.insert('users', { name: c.body.name.trim(), email: normEmail(c.body.email), phone: normPhone(c.body.phone), password_hash: hashPassword(c.body.password), role: 'customer', created_at: Date.now() });
  return session(q.get('SELECT * FROM users WHERE id=?', id));
});

/** Providers (riders, drivers, vendors) each get their own tenant + a subscription to pay. */
router.post('/api/auth/register-provider', (c) => {
  const b = c.body;
  if (!['rider', 'driver', 'vendor'].includes(b.type)) fail(400, 'Choose rider, driver or food vendor');
  checkBasics(b);
  if (b.type !== 'vendor') {
    if (!b.plate || String(b.plate).trim().length < 3) fail(400, 'Enter your vehicle registration number');
    if (!b.license_no || String(b.license_no).trim().length < 4) fail(400, 'Enter your driving licence number');
  } else {
    if (!b.business_name || b.business_name.trim().length < 2) fail(400, 'Enter your business name');
    if (!Number.isFinite(+b.lat) || !Number.isFinite(+b.lng)) fail(400, 'Pin your business location on the map');
    if (!b.address) fail(400, 'Enter your business address');
  }
  const plan = tenancy.defaultPlan(b.type);
  if (!plan) fail(500, 'No subscription plan is configured for this account type');
  const result = q.tx(() => {
    const tName = b.type === 'vendor' ? b.business_name.trim() : `${b.name.trim()} (${b.type})`;
    const tid = q.insert('tenants', { type: b.type, name: tName, slug: slugify(tName) + '-' + Math.random().toString(36).slice(2, 6), plan_id: plan.id, status: 'pending_payment', created_at: Date.now() });
    const uid = q.insert('users', {
      name: b.name.trim(), email: normEmail(b.email), phone: normPhone(b.phone), password_hash: hashPassword(b.password), role: b.type, tenant_id: tid,
      vehicle_type: b.type === 'rider' ? 'motor' : b.type === 'driver' ? 'car' : null, vehicle_make: b.vehicle_make || null,
      plate: b.plate ? String(b.plate).trim().toUpperCase() : null, license_no: b.license_no || null, created_at: Date.now(),
    });
    q.update('tenants', tid, { owner_id: uid });
    if (b.type === 'vendor') {
      q.insert('vendor_profiles', {
        tenant_id: tid, category: ['food', 'grocery', 'convenience'].includes(b.category) ? b.category : 'food', cuisine: b.cuisine || null, description: b.description || null,
        address: b.address, lat: +b.lat, lng: +b.lng, phone: normPhone(b.business_phone || b.phone), prep_minutes: +b.prep_minutes || 20,
      });
    }
    tenancy.startTrial(tid);
    return uid;
  });
  return session(q.get('SELECT * FROM users WHERE id=?', result));
});

router.post('/api/auth/login', (c) => {
  const id = String(c.body.identifier || c.body.email || '').trim();
  const u = q.get('SELECT * FROM users WHERE email=? OR phone=?', id.toLowerCase(), normPhone(id));
  if (!u || !verifyPassword(String(c.body.password || ''), u.password_hash)) fail(401, 'Incorrect email/phone or password');
  if (u.blocked) fail(403, 'This account has been suspended. Contact support.');
  return session(u);
});

router.get('/api/me', (c) => meView(c.need()));

router.patch('/api/me', (c) => {
  const u = c.need(); const b = c.body; const patch = {};
  if (b.name) patch.name = String(b.name).trim().slice(0, 80);
  if (b.phone) {
    const p = normPhone(b.phone);
    if (!/^\+?\d{7,15}$/.test(p)) fail(400, 'Enter a valid phone number');
    if (q.get('SELECT 1 x FROM users WHERE phone=? AND id<>?', p, u.id)) fail(409, 'That phone number is already in use');
    patch.phone = p;
  }
  if (b.avatar !== undefined) patch.avatar = b.avatar;
  if (['rider', 'driver'].includes(u.role)) {
    for (const k of ['vehicle_make', 'plate', 'license_no']) if (b[k] !== undefined) patch[k] = String(b[k]).trim();
    if (b.has_gear !== undefined) patch.has_gear = b.has_gear ? 1 : 0;
  }
  q.update('users', u.id, patch);
  return meView(q.get('SELECT * FROM users WHERE id=?', u.id));
});

router.post('/api/me/password', (c) => {
  const u = c.need();
  if (!verifyPassword(String(c.body.current || ''), u.password_hash)) fail(400, 'Current password is incorrect');
  if (String(c.body.next || '').length < 6) fail(400, 'New password must be at least 6 characters');
  q.update('users', u.id, { password_hash: hashPassword(c.body.next) });
});

// Realtime stream (Server-Sent Events)
router.get('/api/stream', (c) => {
  const u = c.need();
  c.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  c.res.write(`retry: 3000\nevent: hello\ndata: {"uid":${u.id}}\n\n`);
  sse.add(u.id, c.res);
});

module.exports = { publicUser, meView };
