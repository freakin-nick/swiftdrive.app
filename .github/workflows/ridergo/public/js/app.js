// RiderGo web app: boot + hash router. Views are loaded on demand.
import { S, GET, $, html, mount, loadMe, runCleanups, homeFor, icon, openStream } from './core.js';
import { ensureRealtime } from './shell.js';
import { initPWA } from './pwa.js';

const routes = [];
const def = (pattern, mod, fn, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, mod, fn, ...opts });
};
const C = ['customer'], P = ['rider', 'driver'], V = ['vendor'], A = ['admin'], BIZ = ['rider', 'driver', 'vendor'];

def('/welcome', 'auth', 'welcome', { public: true });
def('/login', 'auth', 'login', { public: true });
def('/register', 'auth', 'register', { public: true });
def('/join', 'auth', 'join', { public: true });
def('/join/:type', 'auth', 'joinForm', { public: true });

def('/', 'customer', 'home', { roles: C });
def('/services', 'customer', 'services', { roles: C });
def('/activity', 'customer', 'activity', { roles: ['customer', 'rider', 'driver'] });
def('/ride', 'ride', 'book', { roles: C });
def('/trip/:id', 'ride', 'trip', { roles: C });
def('/eats', 'eats', 'list', { roles: C });
def('/vendor/:id', 'eats', 'vendorPage', { roles: C });
def('/checkout', 'eats', 'checkout', { roles: C });
def('/order/:id', 'eats', 'order', { roles: C });

def('/account', 'account', 'account');
def('/notifications', 'account', 'notifications');
def('/pay-return', 'billing', 'payReturn');
def('/billing', 'billing', 'billing', { roles: BIZ });
def('/wallet', 'billing', 'wallet', { roles: BIZ });

def('/drive', 'provider', 'dashboard', { roles: P });
def('/drive/ride/:id', 'provider', 'rideJob', { roles: P });
def('/drive/order/:id', 'provider', 'orderJob', { roles: P });

def('/shop', 'vendor', 'orders', { roles: V });
def('/shop/menu', 'vendor', 'menu', { roles: V });
def('/shop/team', 'vendor', 'team', { roles: V });
def('/shop/profile', 'vendor', 'profile', { roles: V });

def('/admin', 'admin', 'dashboard', { roles: A });

let seq = 0;
async function route() {
  const my = ++seq;
  runCleanups();
  document.querySelectorAll('.celebrate,.offer-card').forEach((e) => e.remove());
  const [p, qs] = (location.hash.slice(1) || '/').split('?');
  const path = p || '/';
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const r = routes.find((x) => x.re.test(path));
  if (!r) return void (location.hash = S.me ? '#' + homeFor(S.me.user.role) : '#/welcome');
  if (!r.public && !S.me) return void (location.hash = '#/welcome');
  const role = S.me?.user.role;
  if (S.me && r.public) return void (location.hash = '#' + homeFor(role));
  if (r.roles && !r.roles.includes(role)) return void (location.hash = '#' + homeFor(role));
  const m = path.match(r.re); const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  window.scrollTo(0, 0);
  try {
    const mod = await import(`./views/${r.mod}.js`);
    if (my !== seq) return;
    await mod[r.fn]({ params, query, path });
  } catch (e) {
    console.error(e);
    if (my !== seq) return;
    mount($('#app'), html`<div class="page"><div class="empty"><span class="art">⚠️</span><h3>That did not load</h3><p>${e.message || 'Something went wrong.'}</p><a class="btn" href="#/">Back to home</a></div></div>`);
  }
}

async function boot() {
  try { S.cfg = await GET('/config'); }
  catch { mount($('#app'), html`<div class="page"><div class="empty"><span class="art">📡</span><h3>You're offline</h3><p>RiderGo needs a connection to load.</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`); return; }
  if (S.token) { await loadMe(); if (S.me) { await ensureRealtime(); if (S.me.user.role === 'customer') { try { const c = await GET('/rides/current'); if (c.ride && ['searching', 'accepted', 'arrived', 'ongoing'].includes(c.ride.status)) S.activeTrip = '/trip/' + c.ride.id; } catch { /* ignore */ } } } }
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = S.me ? '#' + homeFor(S.me.user.role) : '#/welcome';
  else route();
}
initPWA();
boot();
