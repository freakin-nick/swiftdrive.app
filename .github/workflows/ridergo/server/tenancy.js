'use strict';
const { q } = require('./db');
const config = require('./config');
const { notify } = require('./notify');

const DAY = 86400000;
const MONTH = 30 * DAY;

/**
 * Tenant = a business account (independent rider, driver, or food vendor with their own fleet).
 * Every tenant-owned row carries tenant_id; routes derive it from the authenticated user,
 * never from the request body, which is what keeps tenants isolated from each other.
 */
function getTenant(id) {
  if (!id) return null;
  const t = q.get('SELECT t.*, p.name plan_name, p.amount plan_amount, p.seats, p.paystack_plan_code FROM tenants t LEFT JOIN plans p ON p.id=t.plan_id WHERE t.id=?', id);
  if (!t) return null;
  // lazy expiry: an active tenant whose paid period has lapsed becomes past_due
  if (t.status === 'active' && t.period_end && t.period_end < Date.now()) {
    q.run("UPDATE tenants SET status='past_due' WHERE id=?", t.id); t.status = 'past_due';
    const owner = q.get('SELECT id FROM users WHERE id=?', t.owner_id);
    if (owner) notify(owner.id, 'Subscription expired', 'Renew your RiderGo subscription to keep receiving jobs and orders.', 'subscription');
    q.run('UPDATE users SET online=0 WHERE tenant_id=?', t.id);
  }
  return t;
}
const isActive = (t) => !!t && t.status === 'active' && (!t.period_end || t.period_end > Date.now());

function defaultPlan(type) { return q.get('SELECT * FROM plans WHERE tenant_type=? AND active=1 ORDER BY amount LIMIT 1', type); }

/** Apply a successful subscription payment: extend 30 days from the later of now / current end. */
function activateSubscription(tenantId, { customerCode, subCode, emailToken, planId, paidAt = Date.now() } = {}) {
  const t = q.get('SELECT * FROM tenants WHERE id=?', tenantId);
  if (!t) return null;
  const base = t.period_end && t.period_end > paidAt ? t.period_end : paidAt;
  q.update('tenants', tenantId, {
    status: 'active', period_end: base + MONTH,
    ...(planId ? { plan_id: planId } : {}),
    ...(customerCode ? { paystack_customer_code: customerCode } : {}),
    ...(subCode ? { paystack_sub_code: subCode } : {}),
    ...(emailToken ? { paystack_email_token: emailToken } : {}),
  });
  notify(t.owner_id, 'Subscription active', 'Thank you! Your RiderGo subscription is active.', 'subscription', { tenantId });
  return getTenant(tenantId);
}

/** Starts the trial (if enabled) for brand-new tenants. */
function startTrial(tenantId) {
  if (config.trialDays > 0) q.update('tenants', tenantId, { status: 'active', period_end: Date.now() + config.trialDays * DAY });
}

module.exports = { getTenant, isActive, defaultPlan, activateSubscription, startTrial, MONTH, DAY };
