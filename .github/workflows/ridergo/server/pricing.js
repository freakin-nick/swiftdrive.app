'use strict';
const { q } = require('./db');
const config = require('./config');

// Server-side fare engine. Clients never send prices: the server measures the route and
// computes the fare, so neither riders nor customers can be cheated. Tune via env.
const n = (k, d) => +(process.env[k] ?? d);
const RATES = {
  motor: { base: n('FARE_MOTOR_BASE', 3), perKm: n('FARE_MOTOR_KM', 1.6), perMin: n('FARE_MOTOR_MIN', 0.15), min: n('FARE_MOTOR_MINFARE', 6) },
  car:   { base: n('FARE_CAR_BASE', 5),   perKm: n('FARE_CAR_KM', 2.6),   perMin: n('FARE_CAR_MIN', 0.3),   min: n('FARE_CAR_MINFARE', 10) },
};
const DELIVERY = { base: n('DELIVERY_BASE', 3), perKm: n('DELIVERY_KM', 1.4), min: n('DELIVERY_MIN', 5) };
const r2 = (x) => Math.round(x * 100) / 100;

function rideFare(vehicle, km, min) {
  const r = RATES[vehicle]; if (!r) throw new Error('bad vehicle');
  return r2(Math.max(r.min, r.base + r.perKm * km + r.perMin * min));
}
function deliveryFee(km) { return r2(Math.max(DELIVERY.min, DELIVERY.base + DELIVERY.perKm * km)); }

/** Validate + price a promo code for a user. Returns {discount, promo} or throws message. */
function applyPromo(code, userId, scope, amount) {
  if (!code) return { discount: 0, promo: null };
  const p = q.get('SELECT * FROM promos WHERE code=? AND active=1', String(code).trim().toUpperCase());
  if (!p) throw new Error('Promo code is not valid');
  if (p.expires_at && p.expires_at < Date.now()) throw new Error('Promo code has expired');
  if (p.scope !== 'all' && p.scope !== scope) throw new Error(`This code only works for ${p.scope}s`);
  const used = q.get('SELECT COUNT(*) c FROM promo_uses WHERE code=? AND user_id=?', p.code, userId).c;
  if (used >= p.per_user_limit) throw new Error('You have already used this promo code');
  let d = r2(amount * p.percent / 100);
  if (p.max_discount > 0) d = Math.min(d, p.max_discount);
  return { discount: Math.min(d, amount), promo: p };
}
const recordPromo = (code, userId, ref) => code && q.insert('promo_uses', { code, user_id: userId, ref, created_at: Date.now() });

module.exports = { RATES, DELIVERY, rideFare, deliveryFee, applyPromo, recordPromo, r2, currency: config.currency };
