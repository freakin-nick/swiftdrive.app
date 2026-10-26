'use strict';
const crypto = require('crypto');
const config = require('./config');

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');

function signToken(payload, ttlSec = 60 * 60 * 24 * 14) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return `${head}.${body}.${sign(head + '.' + body)}`;
}
function verifyToken(token) {
  try {
    const [h, b, s] = String(token).split('.');
    if (!h || !b || !s) return null;
    const exp = Buffer.from(sign(h + '.' + b)); const got = Buffer.from(s);
    if (exp.length !== got.length || !crypto.timingSafeEqual(exp, got)) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  const s = Buffer.from(hash, 'hex');
  return h.length === s.length && crypto.timingSafeEqual(h, s);
}
const pin = (n = 4) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
const code = (len = 6) => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < len; i++) s += a[crypto.randomInt(a.length)]; return s; };
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = { signToken, verifyToken, hashPassword, verifyPassword, pin, code, safeEq };
