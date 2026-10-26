'use strict';
// DEMO=1: keeps seeded riders "alive" (fresh GPS, tiny drift) so the demo map stays populated
// even when nobody is logged into the rider apps. Never enable in production.
const { q } = require('./db');
if (process.env.DEMO === '1') {
  setInterval(() => {
    for (const u of q.all("SELECT id, lat, lng FROM users WHERE online=1 AND email LIKE '%@demo.com'")) {
      if (q.get("SELECT 1 x FROM rides WHERE rider_id=? AND status IN ('accepted','arrived','ongoing')", u.id)) continue;
      q.run('UPDATE users SET loc_at=?, lat=?, lng=? WHERE id=?', Date.now(), u.lat + (Math.random() - 0.5) * 0.0004, u.lng + (Math.random() - 0.5) * 0.0004, u.id);
    }
  }, 45000).unref();
  console.log('  DEMO mode: demo riders stay online');
}
