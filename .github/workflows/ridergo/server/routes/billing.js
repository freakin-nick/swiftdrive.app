'use strict';
const { router, fail } = require('../http');
const { q } = require('../db');
const config = require('../config');
const paystack = require('../paystack');
const tenancy = require('../tenancy');
const payments = require('../payments');
const { notify, push } = require('../notify');
const { code } = require('../auth');

const ownerTenant = (user) => {
  const t = user.tenant_id && tenancy.getTenant(user.tenant_id);
  if (!t) fail(403, 'Only business accounts have a subscription');
  if (t.owner_id !== user.id) fail(403, 'Only the account owner can manage billing');
  return t;
};

// ---------- Subscription ----------
router.get('/api/billing', (c) => {
  const u = c.need('rider', 'driver', 'vendor');
  const t = tenancy.getTenant(u.tenant_id);
  const owner = t.owner_id === u.id;
  return {
    tenant: { id: t.id, name: t.name, type: t.type, status: t.status, active: tenancy.isActive(t), period_end: t.period_end, auto_renew: !!t.auto_renew, recurring: !!t.paystack_sub_code, plan: { id: t.plan_id, name: t.plan_name, amount: t.plan_amount, seats: t.seats } },
    owner,
    plans: q.all('SELECT id, code, name, amount, seats, features FROM plans WHERE tenant_type=? AND active=1 ORDER BY amount', t.type),
    payments: owner ? q.all("SELECT reference, amount, currency, status, provider, channel, created_at, paid_at FROM payments WHERE tenant_id=? AND kind='subscription' ORDER BY id DESC LIMIT 20", t.id) : [],
    mock: !paystack.live(),
  };
});

/** Start monthly subscription checkout (Paystack hosted page; creates a recurring plan subscription when a Paystack plan exists). */
router.post('/api/billing/checkout', async (c) => {
  const u = c.need('rider', 'driver', 'vendor');
  const t = ownerTenant(u);
  let plan = q.get('SELECT * FROM plans WHERE id=? AND tenant_type=? AND active=1', +c.body.plan_id || t.plan_id, t.type);
  if (!plan) fail(400, 'Choose a valid plan');
  if (plan.id !== t.plan_id) q.update('tenants', t.id, { plan_id: plan.id });
  const out = await payments.createCheckout({
    kind: 'subscription', user: u, tenantId: t.id, amount: plan.amount, plan: plan.paystack_plan_code,
    metadata: { plan_id: plan.id }, label: `${plan.name} – monthly subscription`,
  });
  return out;
});

router.post('/api/billing/cancel', async (c) => {
  const u = c.need('rider', 'driver', 'vendor'); const t = ownerTenant(u);
  q.update('tenants', t.id, { auto_renew: 0 });
  if (paystack.live() && t.paystack_sub_code && t.paystack_email_token) {
    try { await paystack.disableSubscription({ code: t.paystack_sub_code, token: t.paystack_email_token }); } catch (e) { console.error('disable sub', e.message); }
  }
  return { ok: true, message: 'Auto-renewal is off. You keep access until the end of the paid period.' };
});

// ---------- Order / ride checkout ----------
router.post('/api/payments/init', async (c) => {
  const u = c.need('customer');
  const { kind } = c.body; const id = +c.body.id;
  if (kind === 'order') {
    const o = q.get('SELECT * FROM orders WHERE id=? AND customer_id=?', id, u.id);
    if (!o) fail(404, 'Order not found');
    if (o.payment_status === 'paid') fail(400, 'This order is already paid');
    if (['cancelled', 'rejected'].includes(o.status)) fail(400, 'This order is closed');
    q.update('orders', o.id, { payment_method: 'paystack' });
    return payments.createCheckout({ kind, user: u, tenantId: o.tenant_id, refId: o.id, amount: o.total, label: `Order ${o.code}` });
  }
  if (kind === 'ride') {
    const r = q.get('SELECT * FROM rides WHERE id=? AND customer_id=?', id, u.id);
    if (!r) fail(404, 'Ride not found');
    if (r.payment_status === 'paid') fail(400, 'This ride is already paid');
    if (['cancelled', 'no_riders'].includes(r.status)) fail(400, 'This ride is closed');
    q.update('rides', r.id, { payment_method: 'paystack' });
    return payments.createCheckout({ kind, user: u, tenantId: r.tenant_id, refId: r.id, amount: r.fare, label: `Ride #${r.id}` });
  }
  fail(400, 'Unknown payment type');
});

/** Called by the app after Paystack redirects back. Verifies with Paystack (never trusts the redirect). */
router.get('/api/payments/verify', async (c) => {
  const reference = String(c.query.reference || '');
  const p = q.get('SELECT * FROM payments WHERE reference=?', reference);
  if (!p) fail(404, 'Unknown payment reference');
  if (c.user && p.user_id !== c.user.id && c.user.role !== 'admin') fail(403, 'Not your payment');
  if (p.status !== 'success' && p.provider === 'paystack') {
    try {
      const d = await paystack.verify(reference);
      if (d.status === 'success') payments.settle(reference, d);
      else if (['failed', 'abandoned'].includes(d.status)) q.run("UPDATE payments SET status=? WHERE id=?", d.status, p.id);
    } catch (e) { fail(502, 'Could not reach Paystack to verify this payment. Please try again shortly.'); }
  }
  const fresh = q.get('SELECT reference, kind, status, amount, ref_id, tenant_id FROM payments WHERE reference=?', reference);
  return fresh;
});

// ---------- Paystack webhook ----------
router.post('/api/payments/webhook', (c) => {
  if (!paystack.verifySignature(c.raw, c.req.headers['x-paystack-signature'])) fail(401, 'Bad signature');
  const ev = JSON.parse(c.raw.toString() || '{}'); const d = ev.data || {};
  try {
    switch (ev.event) {
      case 'charge.success': {
        if (q.get('SELECT 1 x FROM payments WHERE reference=?', d.reference)) { payments.settle(d.reference, d); break; }
        // recurring renewal charged by Paystack for a plan subscription
        const planCode = d.plan?.plan_code;
        const t = q.get('SELECT * FROM tenants WHERE paystack_customer_code=?', d.customer?.customer_code)
          || q.get('SELECT t.* FROM tenants t JOIN users u ON u.id=t.owner_id WHERE lower(u.email)=?', String(d.customer?.email || '').toLowerCase());
        if (t && planCode) {
          const owner = q.get('SELECT id FROM users WHERE id=?', t.owner_id);
          q.insert('payments', { reference: d.reference, kind: 'subscription', user_id: owner.id, tenant_id: t.id, amount: d.amount / 100, currency: d.currency || config.currency, status: 'pending', provider: 'paystack', raw: '{}', created_at: Date.now() });
          payments.settle(d.reference, d);
        }
        break;
      }
      case 'subscription.create': {
        const t = q.get('SELECT * FROM tenants WHERE paystack_customer_code=?', d.customer?.customer_code)
          || q.get('SELECT t.* FROM tenants t JOIN users u ON u.id=t.owner_id WHERE lower(u.email)=?', String(d.customer?.email || '').toLowerCase());
        if (t) q.update('tenants', t.id, { paystack_sub_code: d.subscription_code, paystack_email_token: d.email_token, paystack_customer_code: d.customer?.customer_code, auto_renew: 1 });
        break;
      }
      case 'invoice.payment_failed': {
        const t = q.get('SELECT * FROM tenants WHERE paystack_customer_code=?', d.customer?.customer_code);
        if (t) notify(t.owner_id, 'Subscription payment failed', 'We could not charge your card. Update your payment method to stay online.', 'subscription');
        break;
      }
      case 'subscription.disable': case 'subscription.not_renew': {
        const t = q.get('SELECT * FROM tenants WHERE paystack_sub_code=?', d.subscription_code);
        if (t) q.update('tenants', t.id, { auto_renew: 0 });
        break;
      }
      case 'transfer.success': q.run("UPDATE payouts SET status='paid' WHERE paystack_ref=?", d.reference); break;
      case 'transfer.failed': case 'transfer.reversed': {
        const p = q.get("SELECT * FROM payouts WHERE paystack_ref=? AND status<>'failed'", d.reference);
        if (p) { q.update('payouts', p.id, { status: 'failed' }); payments.credit(p.tenant_id, 'refund', p.amount, `payout:${p.id}`, 'Payout failed – returned to wallet'); }
        break;
      }
    }
  } catch (e) { console.error('[webhook]', ev.event, e); }
  return { received: true }; // always 200 so Paystack stops retrying
});

// ---------- Mock checkout (only when no Paystack keys are configured) ----------
const page = (body) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Mock checkout</title>
<style>body{font:16px system-ui;background:#fff1f2;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border-radius:20px;padding:28px;width:min(380px,92vw);box-sizing:border-box;box-shadow:0 10px 40px #e11d2e22}
h1{margin:0 0 4px;font-size:20px}p{color:#666}.amt{font-size:34px;font-weight:800;margin:12px 0}button{width:100%;padding:14px;border:0;border-radius:12px;font-weight:700;font-size:16px;cursor:pointer;margin-top:8px}
.ok{background:#e11d2e;color:#fff}.no{background:#f3f4f6}small{display:block;margin-top:14px;color:#999}</style><main><img src="/img/icon-192.png" alt="" width=56 height=56 style="border-radius:14px;margin-bottom:10px">${body}</main>`;

router.get('/pay/mock', (c) => {
  const p = q.get('SELECT * FROM payments WHERE reference=?', String(c.query.reference || ''));
  c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!p || p.provider !== 'mock') return c.res.end(page('<h1>Not available</h1><p>This checkout is only available in test mode.</p>'));
  c.res.end(page(`<h1>RiderGo test checkout</h1><p>Simulated Paystack payment (no real money)</p>
  <div class=amt>${p.currency} ${p.amount.toFixed(2)}</div><p>Ref: ${p.reference}</p>
  <form method=post action="/pay/mock/confirm"><input type=hidden name=reference value="${p.reference}">
  <button class=ok name=result value=success>Pay now</button><button class=no name=result value=failed>Cancel payment</button></form>
  <small>Add PAYSTACK_SECRET_KEY to .env to use the real Paystack checkout.</small>`));
});
router.post('/pay/mock/confirm', (c) => {
  const p = q.get('SELECT * FROM payments WHERE reference=?', String(c.body.reference || ''));
  if (!p || p.provider !== 'mock') fail(400, 'Not a test payment');
  if (c.body.result === 'success') payments.settle(p.reference, { channel: 'mock' }); else q.run("UPDATE payments SET status='failed' WHERE id=?", p.id);
  c.res.writeHead(302, { Location: `/#/pay-return?reference=${p.reference}` }); c.res.end();
});
router.get('/pay/return', (c) => {
  const ref = c.query.reference || c.query.trxref || '';
  c.res.writeHead(302, { Location: `/#/pay-return?reference=${encodeURIComponent(ref)}` }); c.res.end();
});

// ---------- Wallet & payouts ----------
router.get('/api/wallet', (c) => {
  const u = c.need('rider', 'driver', 'vendor'); const t = ownerTenant(u);
  return {
    balance: payments.walletBalance(t.id), currency: config.currency,
    ledger: q.all('SELECT kind, amount, note, created_at FROM ledger WHERE tenant_id=? ORDER BY id DESC LIMIT 50', t.id),
    payouts: q.all('SELECT id, amount, method, account_number, account_name, status, created_at FROM payouts WHERE tenant_id=? ORDER BY id DESC LIMIT 20', t.id),
  };
});
router.get('/api/banks', async (c) => {
  if (!paystack.live()) return [{ code: 'MTN', name: 'MTN Mobile Money', type: 'mobile_money' }, { code: 'VOD', name: 'Telecel Cash', type: 'mobile_money' }, { code: 'ATL', name: 'AirtelTigo Money', type: 'mobile_money' }, { code: 'GCB', name: 'GCB Bank', type: 'ghipss' }];
  try { return (await paystack.listBanks()).map((b) => ({ code: b.code, name: b.name, type: b.type })); } catch { return []; }
});
router.post('/api/wallet/withdraw', async (c) => {
  const u = c.need('rider', 'driver', 'vendor'); const t = ownerTenant(u);
  const amount = Math.round(+c.body.amount * 100) / 100;
  if (!(amount >= 10)) fail(400, `Minimum withdrawal is ${config.currency} 10`);
  const { bank_code, account_number, account_name } = c.body;
  if (!bank_code || !/^\d{6,20}$/.test(String(account_number || '')) || !account_name) fail(400, 'Enter your account name, number and bank / mobile money network');
  const type = c.body.method === 'bank' ? 'ghipss' : 'mobile_money';
  const payoutId = q.tx(() => {
    if (amount > payments.walletBalance(t.id)) fail(400, 'Insufficient wallet balance');
    const id = q.insert('payouts', { tenant_id: t.id, amount, method: type, bank_code, account_number, account_name, status: 'pending', created_at: Date.now() });
    payments.credit(t.id, 'payout', -amount, `payout:${id}`, 'Withdrawal');
    return id;
  });
  if (paystack.live()) {
    try {
      const rec = await paystack.createRecipient({ type, name: account_name, account_number, bank_code });
      const ref = `po_${payoutId}_${code(6)}`;
      const tr = await paystack.transfer({ amount, recipient: rec.recipient_code, reference: ref, reason: 'RiderGo payout' });
      q.update('payouts', payoutId, { status: tr.status === 'success' ? 'paid' : 'processing', paystack_ref: ref });
    } catch (e) {
      q.update('payouts', payoutId, { status: 'pending', note: e.message }); // admin can retry / pay manually
    }
  }
  return { id: payoutId, balance: payments.walletBalance(t.id), status: q.get('SELECT status FROM payouts WHERE id=?', payoutId).status };
});
