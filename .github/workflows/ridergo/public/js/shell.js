// App shell: page layout, role-based bottom navigation, realtime wiring shared by all views.
import { S, $, $$, html, mount, icon, on, banner, setSession, homeFor, raw, esc, beep } from './core.js';

const NAVS = {
  customer: [['home', '/', 'home', 'Home'], ['services', '/services', 'grid', 'Services'], 'mid', ['activity', '/activity', 'list', 'Activity'], ['account', '/account', 'user', 'Account']],
  rider: [['home', '/drive', 'home', 'Home'], ['wallet', '/wallet', 'wallet', 'Earnings'], ['billing', '/billing', 'shield', 'Plan'], ['account', '/account', 'user', 'Account']],
  driver: null,
  vendor: [['orders', '/shop', 'bag', 'Orders'], ['menu', '/shop/menu', 'list', 'Menu'], ['team', '/shop/team', 'users', 'Riders'], ['wallet', '/wallet', 'wallet', 'Wallet'], ['account', '/account', 'user', 'More']],
};
NAVS.driver = NAVS.rider;

export function navBar(active) {
  const items = NAVS[S.me?.user.role];
  if (!items) return '';
  return html`<nav class="nav" aria-label="Main">${items.map((it) => it === 'mid'
    ? html`<a class="mid ${S.activeTrip ? 'pulse' : ''}" href="#${S.activeTrip || '/ride'}" aria-label="${S.activeTrip ? 'Current trip' : 'Book a ride'}">${icon(S.activeTrip ? 'nav' : 'bolt', 28)}</a>`
    : html`<a href="#${it[1]}" class="${active === it[0] ? 'on' : ''}" ${active === it[0] ? raw('aria-current="page"') : ''}>${icon(it[2], 24)}<span>${it[3]}</span></a>`)}</nav>`;
}

/** Mounts a page into #app. opts: nav (active tab id), wide (desktop dashboard width). */
// #app is replaced (not reused) on every render so delegated listeners from the previous view can never leak into the next.
const freshApp = () => { const old = $('#app'); const n = old.cloneNode(false); old.replaceWith(n); n.removeAttribute('style'); return n; };
export function layout(tpl, { nav, wide = false } = {}) {
  const app = freshApp();
  app.className = wide ? 'wide' : '';
  if (!nav) app.style.paddingBottom = '24px';
  mount(app, html`${tpl}${nav ? navBar(nav) : ''}`);
  return app;
}
export function fullscreen(tpl) {
  const app = freshApp(); app.className = 'is-full'; app.style.paddingBottom = '0';
  mount(app, tpl); return app;
}

export const bell = () => html`<a class="icon-btn" href="#/notifications" aria-label="Notifications">${icon('bell')}<span class="dot ${S.unread ? '' : 'hide'}" data-bell></span></a>`;
export const updateBell = () => $$('[data-bell]').forEach((e) => e.classList.toggle('hide', !S.unread));

export const topbar = (title, { back = true, right = '' } = {}) => html`<div class="topbar">${back ? html`<a class="icon-btn" href="javascript:history.back()" aria-label="Back">${icon('back')}</a>` : ''}<h2>${title}</h2>${right}</div>`;

export function avatar(u, cls = '') {
  const n = u?.name || '?';
  const isRider = u && (u.role === 'rider' || u.vehicle_type === 'motor');
  if (u?.avatar) return html`<span class="avatar ${cls}"><img src="${u.avatar}" alt=""></span>`;
  if (isRider) return html`<span class="avatar logo ${cls}" role="img" aria-label="${n}"></span>`;
  return html`<span class="avatar ${cls}" aria-hidden="true">${n.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase()}</span>`;
}

let wired = false;
/** One-time wiring of global realtime banners + provider job offers. Safe to call repeatedly. */
export async function ensureRealtime() {
  if (!wired) {
    wired = true;
    on('notification', (n) => {
      S.unread = (S.unread || 0) + 1; updateBell();
      if (n.type === 'offer') return; // job offers have their own card
      const ic = { order: 'bag', ride: 'motor', payment: 'wallet', subscription: 'shield', sos: 'alert', report: 'alert' }[n.type] || 'bell';
      banner(n.title, n.body, ic);
    });
  }
  const role = S.me?.user.role;
  if (role === 'rider' || role === 'driver') (await import('./views/provider.js')).startRealtime();
}

export async function afterAuth(sess, to) {
  setSession(sess);
  await ensureRealtime();
  location.hash = '#' + (to || homeFor(sess.user.role));
}

export const statusBadge = (s) => {
  const m = { active: ['green', 'Active'], pending_payment: ['amber', 'Awaiting payment'], past_due: ['red', 'Expired'], suspended: ['gray', 'Suspended'], cancelled: ['gray', 'Cancelled'] }[s] || ['gray', s];
  return html`<span class="badge ${m[0]}">${m[1]}</span>`;
};
