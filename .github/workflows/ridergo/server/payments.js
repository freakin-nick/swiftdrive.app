'use strict';
const { q } = require('./db');
const config = require('./config');
const paystack = require('./paystack');
const tenancy = require('./tenancy');
const { notify, push } = require('./notify');
const { code } = require('./auth');

const ref = (prefix) => `${prefix}_${Date.now().toString(36)}_${code(6)}`;

/**
 * Create a payment record and obtain a checkout URL.
 * Live mode -> Paystack hosted checkout. No keys configured -> built-in MOCK checkout page.
 */
async function createCheckout({ kind, user, tenantId = null, refId = null, amount, plan = null, metadata = {}, label }) {
  if (!(amount > 0)) throw Object.assign(new Error('Nothing to pay'), { status: 400 });
  const reference = ref(kind.slice(0, 3));
  const live = paystack.live();
  let authorization_url, access_code;
  if (live) {
    const d = await paystack.initialize({
      email: user.email, amount, reference, plan: plan || undefined,
      metadata: { kind, user_id: user.id, tenant_id: tenantId, ref_id: refId, custom_fields: [{ display_name: 'Payment for', variable_name: 'label', value: label || kind }], ...metadata },
    });
    authorization_url = d.authorization_url; access_code = d.access_code;
  } else {
    authorization_url = `${config.appUrl}/pay/mock?reference=${reference}`;
  }
  q.insert('payments', {
    reference, kind, user_id: user.id, tenant_id: tenantId, ref_id: refId, amount, currency: config.currency,
    status: 'pending', provider: live ? 'paystack' : 'mock', authorization_url, access_code,
    raw: JSON.stringify({ label, plan, metadata }), created_at: Date.now(),
  });
  return { reference, authorization_url, provider: live ? 'paystack' : 'mock' };
}

/**
 * Idempotently settle a payment. Called from: webhook, /payments/verify, and mock confirm.
 * `data` is Paystack's transaction object (amount in minor units) when live.
 */
function settle(reference, data = {}) {
  const p = q.get('SELECT * FROM payments WHERE reference=?', reference);
  if (!p) return null;
  if (p.status === 'success') return p;
  if (data.amount !== undefined && Math.round(p.amount * 100) !== Number(data.amount)) {
    q.run("UPDATE payments SET status='amount_mismatch', raw=? WHERE id=?", JSON.stringify(data), p.id);
    return q.get('SELECT * FROM payments WHERE id=?', p.id);
  }
  q.run("UPDATE payments SET status='success', paid_at=?, channel=?, raw=? WHERE id=?", Date.now(), data.channel || p.provider, JSON.stringify(data), p.id);
  const fresh = q.get('SELECT * FROM payments WHERE id=?', p.id);
  applyPayment(fresh, data);
  return fresh;
}

function applyPayment(p, data = {}) {
  if (p.kind === 'subscription') {
    const meta = JSON.parse(p.raw || '{}');
    const plan = q.get('SELECT * FROM plans WHERE paystack_plan_code=?', data.plan?.plan_code || data.plan_object?.plan_code || '___');
    tenancy.activateSubscription(p.tenant_id, {
      customerCode: data.customer?.customer_code, planId: plan?.id || meta.metadata?.plan_id,
      subCode: data.subscription?.subscription_code,
    });
    const t = tenancy.getTenant(p.tenant_id);
    if (t) push(t.owner_id, 'sub:update', { status: 'active', period_end: t.period_end });
  } else if (p.kind === 'order') {
    const o = q.get('SELECT * FROM orders WHERE id=?', p.ref_id);
    if (o && o.payment_status !== 'paid') {
      q.run("UPDATE orders SET payment_status='paid', status=CASE WHEN status='pending_payment' THEN 'placed' ELSE status END WHERE id=?", o.id);
      const t = tenancy.getTenant(o.tenant_id);
      notify(t.owner_id, `New order ${o.code}`, `Paid online · ${config.currency} ${o.total.toFixed(2)}`, 'order', { orderId: o.id });
      notify(o.customer_id, 'Payment received', `Your payment for order ${o.code} was successful.`, 'payment', { orderId: o.id });
      push(o.customer_id, 'order:update', { id: o.id }); push(t.owner_id, 'order:update', { id: o.id });
    }
  } else if (p.kind === 'ride') {
    const r = q.get('SELECT * FROM rides WHERE id=?', p.ref_id);
    if (r && r.payment_status !== 'paid') {
      q.run("UPDATE rides SET payment_status='paid' WHERE id=?", r.id);
      push(r.customer_id, 'ride:update', { id: r.id }); push(r.rider_id, 'ride:update', { id: r.id });
      if (r.status === 'completed') settleRide(r.id);
    }
  }
}

const credit = (tenantId, kind, amount, refStr, note) =>
  amount > 0 && q.insert('ledger', { tenant_id: tenantId, kind, amount: +amount.toFixed(2), ref: refStr, note, created_at: Date.now() });

/** Release earnings to tenant wallets once a PAID job is completed (escrow-style). */
function settleOrder(orderId) {
  const o = q.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.settled || o.payment_status !== 'paid' || o.status !== 'completed') return;
  q.run('UPDATE orders SET settled=1 WHERE id=?', o.id);
  const pct = config.commissionPct / 100;
  const food = o.subtotal - o.discount > 0 ? o.subtotal - o.discount : 0;
  credit(o.tenant_id, 'order', food * (1 - pct), `order:${o.code}`, `Order ${o.code} (after ${config.commissionPct}% fee)`);
  if (o.delivery_fee > 0 && o.rider_id) {
    const rider = q.get('SELECT tenant_id FROM users WHERE id=?', o.rider_id);
    if (rider?.tenant_id) credit(rider.tenant_id, 'delivery', o.delivery_fee * (1 - pct), `order:${o.code}`, `Delivery for ${o.code}`);
  }
}
function settleRide(rideId) {
  const r = q.get('SELECT * FROM rides WHERE id=?', rideId);
  if (!r || r.payment_status !== 'paid' || r.status !== 'completed' || !r.tenant_id) return;
  if (q.get("SELECT 1 x FROM ledger WHERE ref=? AND kind='ride'", `ride:${r.id}`)) return;
  credit(r.tenant_id, 'ride', r.fare * (1 - config.commissionPct / 100), `ride:${r.id}`, `Ride #${r.id}`);
}
/** Refund an online-paid order (rejected/cancelled before delivery). Safe to call repeatedly. */
async function refundOrder(orderId) {
  const o = q.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.payment_status !== 'paid') return false;
  const p = q.get("SELECT * FROM payments WHERE kind='order' AND ref_id=? AND status='success' ORDER BY id DESC LIMIT 1", o.id);
  if (!p) return false;
  q.run("UPDATE orders SET payment_status='refunding' WHERE id=?", o.id);
  try { if (p.provider === 'paystack') await paystack.refund({ transaction: p.reference }); q.run("UPDATE orders SET payment_status='refunded' WHERE id=?", o.id); q.run("UPDATE payments SET status='refunded' WHERE id=?", p.id); notify(o.customer_id, 'Refund issued', `Your payment for ${o.code} is being refunded.`, 'payment', { orderId: o.id }); return true; }
  catch (e) { console.error('[refund]', e.message); q.run("UPDATE orders SET payment_status='refund_failed' WHERE id=?", o.id); return false; }
}
const walletBalance = (tenantId) => +(q.get('SELECT COALESCE(SUM(amount),0) b FROM ledger WHERE tenant_id=?', tenantId).b).toFixed(2);

module.exports = { refundOrder, createCheckout, settle, settleOrder, settleRide, walletBalance, credit };
