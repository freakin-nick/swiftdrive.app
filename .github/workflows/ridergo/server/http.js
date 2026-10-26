'use strict';
const fs = require('fs');
const path = require('path');
const { q } = require('./db');
const { verifyToken } = require('./auth');
const config = require('./config');

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, msg, extra) => { throw new HttpError(status, msg, extra); };

const routes = [];
function add(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}
const router = { get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h), patch: (p, h) => add('PATCH', p, h), put: (p, h) => add('PUT', p, h), delete: (p, h) => add('DELETE', p, h) };

function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// very small in-memory rate limiter
const hits = new Map();
function limited(ip, bucket, max, windowMs) {
  const k = bucket + ip, now = Date.now();
  const h = (hits.get(k) || []).filter((t) => now - t < windowMs);
  h.push(now); hits.set(k, h);
  return h.length > max;
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serveFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache', ...(ext === '.js' && file.endsWith('sw.js') ? { 'Service-Worker-Allowed': '/' } : {}) });
  fs.createReadStream(file).pipe(res);
}
function serveStatic(req, res, pathname) {
  let base = config.publicDir, rel = pathname;
  if (pathname.startsWith('/uploads/')) { base = config.uploadsDir; rel = pathname.slice(8); }
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) return false;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) { serveFile(res, file, pathname.startsWith('/uploads/') ? 'public, max-age=86400' : 'no-cache'); return true; }
  return false;
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function userFromReq(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  const p = token && verifyToken(token);
  if (!p) return null;
  const u = q.get('SELECT * FROM users WHERE id=?', p.uid);
  return u && !u.blocked ? u : null;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  try {
    const isApi = pathname.startsWith('/api/') || pathname.startsWith('/pay/');
    if (!isApi) {
      if (req.method === 'GET' && (serveStatic(req, res, pathname === '/' ? '/index.html' : pathname))) return;
      if (req.method === 'GET' && !path.extname(pathname)) return serveFile(res, path.join(config.publicDir, 'index.html'));
      return json(res, 404, { error: 'Not found' });
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => (params[k] = m[i + 1]));
      const raw = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
      let body = {};
      if (raw.length && (req.headers['content-type'] || '').includes('json')) { try { body = JSON.parse(raw.toString()); } catch { fail(400, 'Invalid JSON'); } }
      else if (raw.length && (req.headers['content-type'] || '').includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw.toString()));
      const ip = req.socket.remoteAddress;
      const ctx = {
        req, res, params, body, raw, url, ip, query: Object.fromEntries(url.searchParams),
        user: userFromReq(req, url),
        need(...roles) {
          if (!this.user) fail(401, 'Please sign in');
          if (roles.length && !roles.includes(this.user.role)) fail(403, 'You do not have access to this');
          return this.user;
        },
      };
      if (pathname.startsWith('/api/auth/') && req.method === 'POST' && limited(ip, 'auth', 30, 60000)) fail(429, 'Too many attempts. Try again in a minute.');
      const out = await r.handler(ctx);
      if (res.writableEnded || res.headersSent) return; // handler streamed (SSE / html)
      return json(res, 200, out === undefined ? { ok: true } : out);
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!(e instanceof HttpError) && !(e.status < 500)) console.error('[error]', req.method, req.url, e);
    if (res.headersSent) return res.end();
    json(res, e.status || 500, { error: e instanceof HttpError || e.status ? e.message : 'Something went wrong', ...(e.extra || {}) });
  }
}

module.exports = { router, handler, fail, HttpError, json };
