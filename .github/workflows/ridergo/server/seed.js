'use strict';
const { q } = require('./db');
const { hashPassword } = require('./auth');

/** Base data every installation needs: subscription plans, promo codes, platform admin. */
function ensureBase() {
  const plans = [
    ['rider_solo', 'rider', 'Rider', 50, 1, 'Go online & accept rides and deliveries|Live GPS dispatch|Wallet & payouts'],
    ['driver_solo', 'driver', 'Driver', 80, 1, 'Accept car rides|Live GPS dispatch|Wallet & payouts'],
    ['vendor_starter', 'vendor', 'Vendor Starter', 100, 3, 'Your shop on the map|Unlimited menu items|Up to 3 of your own riders|Order dashboard & payouts'],
    ['vendor_pro', 'vendor', 'Vendor Pro', 200, 10, 'Everything in Starter|Up to 10 of your own riders|Priority in search'],
  ];
  for (const [code, type, name, amount, seats, features] of plans) {
    q.run('INSERT OR IGNORE INTO plans (code, tenant_type, name, amount, seats, features) VALUES (?,?,?,?,?,?)', code, type, name, amount, seats, features);
  }
  q.run("INSERT OR IGNORE INTO promos (code,label,percent,max_discount,scope,per_user_limit) VALUES ('EATS40','40% off your next 3 restaurant orders',40,20,'order',3)");
  q.run("INSERT OR IGNORE INTO promos (code,label,percent,max_discount,scope,per_user_limit) VALUES ('FIRSTRIDE','30% off your first ride',30,10,'ride',1)");
  const email = (process.env.ADMIN_EMAIL || 'admin@ridergo.app').toLowerCase();
  if (!q.get("SELECT 1 x FROM users WHERE role='admin'")) {
    q.insert('users', { name: 'RiderGo Admin', email, phone: '+233000000000', password_hash: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), role: 'admin', created_at: Date.now() });
    console.log(`Created platform admin ${email}${process.env.ADMIN_PASSWORD ? '' : ' (password: admin123 — change it!)'}`);
  }
}

function seedDemo() {
  ensureBase();
  if (q.get("SELECT 1 x FROM users WHERE email='alex@demo.com'")) { console.log('Demo data already present.'); return; }
  const now = Date.now(), pw = hashPassword('demo123'), plan = (c) => q.get('SELECT id FROM plans WHERE code=?', c).id;
  q.insert('users', { name: 'Alex Mensah', email: 'alex@demo.com', phone: '+233200000001', password_hash: pw, role: 'customer', created_at: now });

  const mk = (type, name, email, phone, extra = {}, planCode) => {
    const tid = q.insert('tenants', { type, name: extra.business || `${name} (${type})`, slug: email.split('@')[0], plan_id: plan(planCode), status: 'active', period_end: now + 30 * 86400000, created_at: now });
    const uid = q.insert('users', { name, email, phone, password_hash: pw, role: type, tenant_id: tid, created_at: now, vehicle_type: type === 'rider' ? 'motor' : type === 'driver' ? 'car' : null, vehicle_make: extra.make || null, plate: extra.plate || null, license_no: extra.plate ? 'DL-' + extra.plate : null, online: extra.pos ? 1 : 0, lat: extra.pos?.[0] ?? null, lng: extra.pos?.[1] ?? null, loc_at: extra.pos ? now : null });
    q.update('tenants', tid, { owner_id: uid });
    return { tid, uid };
  };
  mk('rider', 'Kwame Boateng', 'kwame@demo.com', '+233200000011', { make: 'Haojue 150', plate: 'GR-1234-24', pos: [5.5570, -0.1830] }, 'rider_solo');
  mk('rider', 'Ama Serwaa', 'ama@demo.com', '+233200000012', { make: 'TVS Apache', plate: 'GT-5521-24', pos: [5.5700, -0.1900] }, 'rider_solo');
  mk('driver', 'Yaw Owusu', 'yaw@demo.com', '+233200000021', { make: 'Toyota Corolla', plate: 'GX-9087-23', pos: [5.5600, -0.1790] }, 'driver_solo');

  const vendors = [
    ['Mama Put Kitchen', 'mama@demo.com', 'food', 'Ghanaian', 'Osu, Oxford Street', 5.5560, -0.1818, 4.7, 128, [['Jollof Rice & Chicken', 45, 'Mains', 'Smoky party jollof with grilled chicken'], ['Waakye Special', 38, 'Mains', 'Waakye, gari, egg, fish & shito'], ['Banku & Tilapia', 70, 'Mains', 'Grilled tilapia, hot pepper, banku'], ['Fried Plantain', 12, 'Sides', 'Sweet kelewele'], ['Sobolo (500ml)', 10, 'Drinks', 'Chilled hibiscus drink']]],
    ['Spice Route Chop Bar', 'spice@demo.com', 'food', 'Ghanaian · Grill', 'Airport Residential', 5.6050, -0.1760, 4.4, 61, [['Fufu & Light Soup', 55, 'Mains', 'Goat meat light soup'], ['Grilled Chicken Wrap', 32, 'Mains', 'Wrap with slaw & garlic sauce'], ['Kebab Platter', 48, 'Mains', 'Four beef skewers'], ['Zobo', 8, 'Drinks', 'Ginger zobo']]],
    ['Kenkey & Fish Hub', 'kenkey@demo.com', 'food', 'Ga cuisine', 'Labone', 5.5645, -0.1740, 4.9, 203, [['Ga Kenkey & Fried Fish', 35, 'Mains', 'With shito & pepper'], ['Fried Yam & Pepper', 25, 'Mains', 'Crispy yam, kpakpo shito'], ['Coconut Water', 9, 'Drinks', 'Fresh']]],
    ['FreshMart Grocery', 'fresh@demo.com', 'grocery', 'Groceries', 'East Legon', 5.6350, -0.1560, 4.5, 77, [['Tomatoes (1kg)', 18, 'Fresh', 'Farm fresh'], ['Rice 5kg', 95, 'Pantry', 'Long grain'], ['Eggs (tray)', 52, 'Fresh', '30 eggs'], ['Cooking Oil 1L', 38, 'Pantry', 'Vegetable oil']]],
    ['QuickStop Convenience', 'quick@demo.com', 'convenience', 'Daily essentials', 'Adabraka', 5.5640, -0.2110, 4.2, 39, [['Bottled Water (6 pack)', 20, 'Essentials', ''], ['Paracetamol 500mg', 8, 'Health', ''], ['Phone Credit GH₵10', 10, 'Essentials', '']]],
  ];
  vendors.forEach(([name, email, cat, cuisine, addr, lat, lng, rating, count, menu], i) => {
    const { tid } = mk('vendor', name, email, '+23320000003' + i, { business: name }, i === 0 ? 'vendor_pro' : 'vendor_starter');
    q.insert('vendor_profiles', { tenant_id: tid, category: cat, cuisine, description: `${name} — fresh, fast, and made with love.`, address: addr, lat, lng, phone: '+23320000003' + i, rating_avg: rating, rating_count: count, order_count: count * 3, prep_minutes: 15 + i * 5 });
    for (const [n, p, s, d] of menu) q.insert('menu_items', { tenant_id: tid, name: n, price: p, section: s, description: d, created_at: now });
    if (i === 0) { // Mama Put has her own delivery team
      q.insert('users', { name: 'Kojo (Mama Put rider)', email: 'kojo@demo.com', phone: '+233200000041', password_hash: pw, role: 'rider', tenant_id: tid, is_staff: 1, vehicle_type: 'motor', vehicle_make: 'Honda Ace', plate: 'GN-8812-24', online: 1, lat: 5.5565, lng: -0.1810, loc_at: now, created_at: now });
    }
  });
  console.log('Demo data created. Logins (password demo123): alex@demo.com (customer), kwame@demo.com / ama@demo.com (riders), yaw@demo.com (driver), mama@demo.com (vendor + own rider kojo@demo.com)');
}

module.exports = { ensureBase, seedDemo };
if (require.main === module) { seedDemo(); process.exit(0); }
