'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const cache = new Map();
const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const clean = (r) => (r ? { ...r } : undefined);

const q = {
  get: (sql, ...p) => clean(stmt(sql).get(...p.map(norm))),
  all: (sql, ...p) => stmt(sql).all(...p.map(norm)).map(clean),
  run: (sql, ...p) => { const r = stmt(sql).run(...p.map(norm)); return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }; },
  tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  /** insert helper: q.insert('users', {a:1}) -> id */
  insert(table, obj) {
    const keys = Object.keys(obj);
    return q.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k])).id;
  },
  /** update helper: only whitelisted columns */
  update(table, id, obj, idCol = 'id') {
    const keys = Object.keys(obj);
    if (!keys.length) return 0;
    return q.run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE ${idCol}=?`, ...keys.map((k) => obj[k]), id).changes;
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, tenant_type TEXT NOT NULL,
  name TEXT NOT NULL, amount REAL NOT NULL, seats INTEGER NOT NULL DEFAULT 1,
  features TEXT, paystack_plan_code TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('rider','driver','vendor')),
  name TEXT NOT NULL, slug TEXT UNIQUE, owner_id INTEGER, plan_id INTEGER REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'pending_payment',  -- pending_payment|active|past_due|suspended|cancelled
  period_end INTEGER, auto_renew INTEGER NOT NULL DEFAULT 1,
  paystack_customer_code TEXT, paystack_sub_code TEXT, paystack_email_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','rider','driver','vendor','admin')),
  tenant_id INTEGER REFERENCES tenants(id), is_staff INTEGER NOT NULL DEFAULT 0,
  avatar TEXT, rating_avg REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  vehicle_type TEXT, vehicle_make TEXT, plate TEXT, license_no TEXT, has_gear INTEGER NOT NULL DEFAULT 1,
  online INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL, loc_at INTEGER,
  blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE TABLE IF NOT EXISTS vendor_profiles (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id), category TEXT NOT NULL DEFAULT 'food',
  cuisine TEXT, description TEXT, address TEXT, lat REAL, lng REAL, phone TEXT,
  logo TEXT, cover TEXT, is_open INTEGER NOT NULL DEFAULT 1, prep_minutes INTEGER NOT NULL DEFAULT 20,
  min_order REAL NOT NULL DEFAULT 0, delivers INTEGER NOT NULL DEFAULT 1, max_delivery_km REAL NOT NULL DEFAULT 10,
  rating_avg REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0, order_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL, description TEXT, price REAL NOT NULL, section TEXT DEFAULT 'Menu',
  image TEXT, available INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_tenant ON menu_items(tenant_id);
CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES users(id), rider_id INTEGER REFERENCES users(id),
  tenant_id INTEGER REFERENCES tenants(id), vehicle_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'searching', -- searching|accepted|arrived|ongoing|completed|cancelled|no_riders|scheduled
  pickup_lat REAL, pickup_lng REAL, pickup_addr TEXT, drop_lat REAL, drop_lng REAL, drop_addr TEXT,
  distance_km REAL, duration_min REAL, base_fare REAL, discount REAL NOT NULL DEFAULT 0, fare REAL NOT NULL,
  promo_code TEXT, payment_method TEXT NOT NULL DEFAULT 'cash', payment_status TEXT NOT NULL DEFAULT 'unpaid',
  start_pin TEXT, gear_confirmed INTEGER NOT NULL DEFAULT 0, scheduled_at INTEGER,
  actual_km REAL, cancel_reason TEXT, cancelled_by TEXT,
  requested_at INTEGER NOT NULL, accepted_at INTEGER, arrived_at INTEGER, started_at INTEGER, ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rides_cust ON rides(customer_id); CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides(rider_id);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL REFERENCES users(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id), rider_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'placed', -- pending_payment|placed|accepted|preparing|ready|out_for_delivery|completed|cancelled|rejected
  delivery_status TEXT NOT NULL DEFAULT 'none', -- none|finding|assigned|picked_up|arrived|no_riders
  fulfilment TEXT NOT NULL DEFAULT 'delivery', subtotal REAL NOT NULL, delivery_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL, promo_code TEXT,
  dest_lat REAL, dest_lng REAL, dest_addr TEXT, distance_km REAL, duration_min REAL, notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'paystack', payment_status TEXT NOT NULL DEFAULT 'unpaid',
  delivery_pin TEXT, settled INTEGER NOT NULL DEFAULT 0, cancel_reason TEXT,
  created_at INTEGER NOT NULL, accepted_at INTEGER, ready_at INTEGER, picked_at INTEGER, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_cust ON orders(customer_id); CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), item_id INTEGER,
  name TEXT NOT NULL, price REAL NOT NULL, qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered', ring INTEGER, distance_km REAL, created_at INTEGER NOT NULL,
  UNIQUE(kind, ref_id, user_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, reference TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, user_id INTEGER, tenant_id INTEGER,
  ref_id INTEGER, amount REAL NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL, authorization_url TEXT, access_code TEXT, channel TEXT, raw TEXT,
  created_at INTEGER NOT NULL, paid_at INTEGER
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL,
  ref TEXT, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON ledger(tenant_id);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL,
  bank_code TEXT, account_number TEXT, account_name TEXT, status TEXT NOT NULL DEFAULT 'pending',
  paystack_ref TEXT, note TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, from_user_id INTEGER NOT NULL,
  to_user_id INTEGER, to_tenant_id INTEGER, rating INTEGER NOT NULL, comment TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews ON reviews(kind, ref_id, from_user_id, COALESCE(to_user_id,0), COALESCE(to_tenant_id,0));
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL, against_user_id INTEGER, kind TEXT, ref_id INTEGER,
  reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, type TEXT, data TEXT,
  read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY, label TEXT, percent REAL NOT NULL, max_discount REAL NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'all', per_user_limit INTEGER NOT NULL DEFAULT 1, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS promo_uses (id INTEGER PRIMARY KEY, code TEXT NOT NULL, user_id INTEGER NOT NULL, ref TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (user_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, PRIMARY KEY(user_id, tenant_id));
CREATE TABLE IF NOT EXISTS saved_places (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, label TEXT NOT NULL, address TEXT, lat REAL NOT NULL, lng REAL NOT NULL);
CREATE TABLE IF NOT EXISTS ride_points (id INTEGER PRIMARY KEY, ride_id INTEGER NOT NULL, lat REAL, lng REAL, at INTEGER);
CREATE TABLE IF NOT EXISTS sos_events (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, ride_id INTEGER, lat REAL, lng REAL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT, created_at INTEGER NOT NULL);
`);

module.exports = { db, q };
