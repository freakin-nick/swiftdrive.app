'use strict';
const crypto = require('crypto');
const config = require('./config');

const BASE = 'https://api.paystack.co';
const minor = (amount) => Math.round(Number(amount) * 100); // GHS -> pesewas, NGN -> kobo

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${config.paystack.secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.status === false) {
    const e = new Error(j.message || `Paystack error ${res.status}`); e.status = 502; e.paystack = j; throw e;
  }
  return j.data;
}

/** Start a hosted checkout. `plan` (optional) turns a payment into a recurring Paystack subscription. */
const initialize = ({ email, amount, reference, currency = config.currency, metadata = {}, plan, channels, callbackUrl }) =>
  call('POST', '/transaction/initialize', {
    email, amount: minor(amount), currency, reference, metadata,
    callback_url: callbackUrl || `${config.appUrl}/pay/return`,
    ...(plan ? { plan } : {}), ...(channels ? { channels } : {}),
  });

const verify = (reference) => call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
const refund = ({ transaction, amount }) => call('POST', '/refund', { transaction, ...(amount ? { amount: minor(amount) } : {}) });
const createPlan = ({ name, amount, interval = 'monthly', currency = config.currency }) =>
  call('POST', '/plan', { name, amount: minor(amount), interval, currency });
const disableSubscription = ({ code, token }) => call('POST', '/subscription/disable', { code, token });
const getSubscription = (idOrCode) => call('GET', `/subscription/${encodeURIComponent(idOrCode)}`);
const listBanks = (currency = config.currency, type) =>
  call('GET', `/bank?currency=${currency}${type ? `&type=${type}` : ''}&perPage=100`);
const createRecipient = ({ type, name, account_number, bank_code, currency = config.currency }) =>
  call('POST', '/transferrecipient', { type, name, account_number, bank_code, currency });
const transfer = ({ amount, recipient, reference, reason, currency = config.currency }) =>
  call('POST', '/transfer', { source: 'balance', amount: minor(amount), recipient, reference, reason, currency });

/** Verify the x-paystack-signature header (HMAC-SHA512 of the raw body with your secret key). */
function verifySignature(rawBody, signature) {
  if (!signature || !config.paystack.secret) return false;
  const hash = crypto.createHmac('sha512', config.paystack.secret).update(rawBody).digest('hex');
  const a = Buffer.from(hash), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { refund, live: () => config.paystack.live, minor, initialize, verify, createPlan, disableSubscription, getSubscription, listBanks, createRecipient, transfer, verifySignature };
