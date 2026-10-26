'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const config = require('../config');
const paystack = require('../paystack');
const tenancy = require('../tenancy');
const payments = require('../payments');
const { notify, push } = require('../notify');

const admin = (c) => c.need('admin');
const audit = (u, action, detail) => q.insert('audit', { user_id: u.id, action, detail: JSON.stringify(detail), created_at: Date.now() });

router.get('/api/admin/overview', (c) => {
  admin(c);
  const n = (sql, ...p) => q.get(sql, ...p).n;
  const mrr = q.get("SELECT COALESCE(SUM(p.amount),0) s FROM tenants t JOIN plans p ON p.id=t.plan_id WHERE t.status='active'").s;
  return {
    currency: config.currency, mrr,
    tenants: { total: n('SELECT COUNT(*) n FROM tenants'), active: n("SELECT COUNT(*) n FROM tenants WHERE status='active'"), pending: n("SELECT COUNT(*) n FROM tenants WHERE status='pending_payment'"), past_due: n("SELECT COUNT(*) n FROM tenants WHERE status='past_due'"), suspended: n("SELECT COUNT(*) n FROM tenants WHERE status='suspended'") },
    by_type: q.all("SELECT type, COUNT(*) n, SUM(status='active') active FROM tenants GROUP BY type"),
    customers: n("SELECT COUNT(*) n FROM users WHERE role='customer'"),
    online_providers: n("SELECT COUNT(*) n FROM users WHERE online=1"),
    rides: { total: n('SELECT COUNT(*) n FROM rides'), completed: n("SELECT COUNT(*) n FROM rides WHERE status='completed'") },
    orders: { total: n('SELECT COUNT(*) n FROM orders'), completed: n("SELECT COUNT(*) n FROM orders WHERE status='completed'") },
    subscription_revenue: q.get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind='subscription' AND status='success'").s,
    gmv: q.get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind IN ('order','ride') AND status='success'").s,
    open_reports: n("SELECT COUNT(*) n FROM reports WHERE status='open'"), sos: n('SELECT COUNT(*) n FROM sos_events'),
    pending_payouts: n("SELECT COUNT(*) n FROM payouts WHERE status IN ('pending','processing')"),
    paystack_live: paystack.live(),
  };
});

router.get('/api/admin/tenants', (c) => {
  admin(c);
  const where = [], p = [];
  if (c.query.status) { where.push('t.status=?'); p.push(c.query.status); }
  if (c.query.type) { where.push('t.type=?'); p.push(c.query.type); }
  return q.all(`SELECT t.id, t.type, t.name, t.status, t.period_end, t.created_at, t.auto_renew, pl.name plan, pl.amount, u.name owner, u.email, u.phone
    FROM tenants t LEFT JOIN plans pl ON pl.id=t.plan_id LEFT JOIN users u ON u.id=t.owner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 200`, ...p);
});
router.patch('/api/admin/tenants/:id', (c) => {
  const a = admin(c); const t = tenancy.getTenant(+c.params.id); if (!t) fail(404, 'Tenant not found');
  const b = c.body;
  if (b.status === 'suspended') { q.update('tenants', t.id, { status: 'suspended' }); q.run('UPDATE users SET online=0 WHERE tenant_id=?', t.id); notify(t.owner_id, 'Account suspended', 'Your RiderGo business account was suspended. Contact support.', 'subscription'); }
  else if (b.status === 'active') { q.update('tenants', t.id, { status: 'active', period_end: Math.max(t.period_end || 0, Date.now()) + (+b.grant_days || 0) * 86400000 || Date.now() + 30 * 86400000 }); }
  audit(a, 'tenant.update', { id: t.id, ...b }); push(t.owner_id, 'sub:update', {});
  return { ok: true };
});

router.get('/api/admin/plans', (c) => { admin(c); return q.all('SELECT * FROM plans ORDER BY tenant_type, amount'); });
router.patch('/api/admin/plans/:id', (c) => {
  const a = admin(c); const b = c.body; const p = {};
  if (b.amount !== undefined) { if (!(+b.amount > 0)) fail(400, 'Invalid amount'); p.amount = +b.amount; p.paystack_plan_code = null; } // price change => needs a new Paystack plan
  if (b.name) p.name = String(b.name); if (b.seats !== undefined) p.seats = Math.max(1, +b.seats | 0); if (b.active !== undefined) p.active = b.active ? 1 : 0;
  if (b.features !== undefined) p.features = String(b.features);
  q.update('plans', +c.params.id, p); audit(a, 'plan.update', { id: c.params.id, ...b });
  return q.get('SELECT * FROM plans WHERE id=?', +c.params.id);
});
/** Creates the monthly plan on Paystack so subscriptions renew automatically. */
router.post('/api/admin/plans/:id/sync', async (c) => {
  const a = admin(c); const pl = q.get('SELECT * FROM plans WHERE id=?', +c.params.id); if (!pl) fail(404, 'Plan not found');
  if (!paystack.live()) fail(400, 'Add PAYSTACK_SECRET_KEY to .env first. Without it RiderGo runs in test mode.');
  const d = await paystack.createPlan({ name: `RiderGo ${pl.name}`, amount: pl.amount });
  q.update('plans', pl.id, { paystack_plan_code: d.plan_code }); audit(a, 'plan.sync', { id: pl.id, code: d.plan_code });
  return { plan_code: d.plan_code };
});

router.get('/api/admin/reports', (c) => { admin(c); return q.all(`SELECT r.*, a.name reporter, b.name against, b.id against_id, b.blocked against_blocked FROM reports r JOIN users a ON a.id=r.reporter_id LEFT JOIN users b ON b.id=r.against_user_id ORDER BY (r.status='open') DESC, r.id DESC LIMIT 100`); });
router.patch('/api/admin/reports/:id', (c) => {
  const a = admin(c); const r = q.get('SELECT * FROM reports WHERE id=?', +c.params.id); if (!r) fail(404, 'Report not found');
  q.update('reports', r.id, { status: c.body.status === 'dismissed' ? 'dismissed' : 'resolved' });
  if (c.body.block_user && r.against_user_id) { q.run('UPDATE users SET blocked=1, online=0 WHERE id=?', r.against_user_id); audit(a, 'user.block', { id: r.against_user_id }); }
});
router.get('/api/admin/sos', (c) => { admin(c); return q.all('SELECT s.*, u.name, u.phone FROM sos_events s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 50'); });

router.get('/api/admin/payouts', (c) => { admin(c); return q.all('SELECT p.*, t.name tenant FROM payouts p JOIN tenants t ON t.id=p.tenant_id ORDER BY p.id DESC LIMIT 100'); });
router.patch('/api/admin/payouts/:id', (c) => {
  const a = admin(c); const p = q.get('SELECT * FROM payouts WHERE id=?', +c.params.id); if (!p) fail(404, 'Payout not found');
  const status = c.body.status === 'failed' ? 'failed' : 'paid';
  if (['paid', 'failed'].includes(p.status)) fail(409, 'Already finalised');
  q.update('payouts', p.id, { status });
  if (status === 'failed') payments.credit(p.tenant_id, 'refund', p.amount, `payout:${p.id}`, 'Payout failed – returned to wallet');
  audit(a, 'payout.update', { id: p.id, status });
});
router.get('/api/admin/payments', (c) => { admin(c); return q.all('SELECT p.reference, p.kind, p.amount, p.currency, p.status, p.provider, p.created_at, u.name FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 100'); });
router.get('/api/admin/promos', (c) => { admin(c); return q.all('SELECT * FROM promos ORDER BY code'); });
router.post('/api/admin/promos', (c) => {
  const a = admin(c); const b = c.body; const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code) || !(+b.percent > 0 && +b.percent <= 100)) fail(400, 'Code must be 3-20 letters/numbers and percent 1-100');
  q.run('INSERT OR REPLACE INTO promos (code,label,percent,max_discount,scope,per_user_limit,active) VALUES (?,?,?,?,?,?,1)', code, b.label || null, +b.percent, +b.max_discount || 0, ['ride', 'order', 'all'].includes(b.scope) ? b.scope : 'all', Math.max(1, +b.per_user_limit | 0 || 1));
  audit(a, 'promo.save', { code });
});
