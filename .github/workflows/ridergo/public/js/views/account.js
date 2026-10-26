import { S, GET, POST, PATCH, DEL, html, raw, $, $$, icon, actions, onSubmit, setSession, loadMe, toast, sheet, confirmSheet, ago, shortAddr, closeStream, homeFor } from '../core.js';
import { layout, bell, avatar, topbar, statusBadge, updateBell } from '../shell.js';
import { pickPlace } from '../picker.js';
import { fmtDate, daysLeft, empty } from '../components.js';

const ROLE = { customer: 'Customer', rider: 'Motorbike rider', driver: 'Car driver', vendor: 'Food vendor', admin: 'Administrator' };

export async function account() {
  await loadMe();
  const { user: u, tenant: t } = S.me; const cust = u.role === 'customer'; const prov = ['rider', 'driver'].includes(u.role);
  let places = []; if (cust) { try { places = await GET('/places'); } catch { /* ignore */ } }
  const nav = ['customer', 'rider', 'driver', 'vendor'].includes(u.role) ? (cust ? 'account' : 'account') : null;
  const el = layout(html`<div class="page">
    <header class="hello"><div class="grow"><h1>${u.role === 'vendor' ? 'More' : 'Account'}</h1></div>${bell()}</header>
    <div class="card profile-card"><div class="row gap">${avatar(u, 'big')}<div class="grow"><h3>${u.name}</h3><small class="muted block">${u.email}</small><small class="muted">${u.phone || ''}</small></div></div>
      <div class="row gap-s wrap mt-s"><span class="badge navy">${ROLE[u.role]}</span>${prov ? html`<span class="badge">${icon('star', 12)} ${u.rating_count ? u.rating.toFixed(1) : 'New'}</span>` : ''}${t ? statusBadge(t.status) : ''}</div>
      ${t ? html`<p class="small muted mt-s">${t.is_owner ? html`<b>${t.name}</b> · ${t.plan || ''} plan${t.period_end ? html` · renews ${fmtDate(t.period_end)}` : ''}` : html`You work under <b>${t.name}</b>. Your subscription is covered by them.`}</p>` : ''}</div>

    ${t && t.is_owner ? html`<div class="menu-list mt">${u.role === 'vendor' ? html`<a href="#/shop/profile">${icon('store', 20)}<span>Shop profile &amp; location</span>${icon('chev', 16)}</a>` : ''}<a href="#/billing">${icon('shield', 20)}<span>Subscription &amp; billing</span>${icon('chev', 16)}</a><a href="#/wallet">${icon('wallet', 20)}<span>Earnings &amp; withdrawals</span>${icon('chev', 16)}</a></div>` : ''}

    ${cust ? html`<section class="section"><div class="section-h"><h3>Saved places</h3><a href="#" data-act="addplace">+ Add</a></div>
      ${places.length ? places.map((p) => html`<div class="card flat row gap mt-s"><span class="pl-ic">${icon('heart', 18)}</span><span class="grow"><b>${p.label}</b><small class="muted block">${shortAddr(p.address)}</small></span><button class="icon-btn sm" data-act="delplace" data-id="${p.id}" aria-label="Remove ${p.label}">${icon('trash', 18)}</button></div>`) : html`<p class="muted small">Save home or work for one-tap booking.</p>`}</section>
      <div class="menu-list mt"><a href="#/eats?favorites=1">${icon('heart', 20)}<span>Favourite vendors</span>${icon('chev', 16)}</a><a href="#/notifications">${icon('bell', 20)}<span>Notifications</span>${icon('chev', 16)}</a><a href="#/join">${icon('bike2', 20)}<span>Earn with RiderGo</span>${icon('chev', 16)}</a></div>` : ''}

    <section class="section"><h3>Profile</h3>
      <form id="pf" class="card mt-s">
        <label class="field"><span>Name</span><input class="input" name="name" value="${u.name}" required></label>
        <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${u.phone || ''}" required></label>
        ${prov ? html`<label class="field"><span>Vehicle make &amp; model</span><input class="input" name="vehicle_make" value="${u.vehicle_make || ''}"></label>
          <label class="field"><span>Registration number</span><input class="input" name="plate" value="${u.plate || ''}"></label>
          <label class="field"><span>Driving licence</span><input class="input" name="license_no" value="${u.license_no || ''}"></label>
          ${u.role === 'rider' ? html`<label class="row between gap field"><span class="grow">I provide a helmet &amp; protective gear to passengers</span><span class="switch"><input type="checkbox" name="has_gear" ${u.has_gear ? raw('checked') : ''}><i></i></span></label>` : ''}` : ''}
        <button class="btn block" type="submit">Save changes</button></form></section>
    <section class="section"><div class="menu-list"><a href="#" data-act="pw">${icon('lock', 20)}<span>Change password</span>${icon('chev', 16)}</a><a href="#" data-act="logout" class="danger-t">${icon('logout', 20)}<span>Log out</span></a></div></section>
    <p class="center xs muted mt">RiderGo · Riders for riders</p></div>`, { nav: ['customer', 'rider', 'driver', 'vendor'].includes(u.role) ? 'account' : null });
  onSubmit(el, '#pf', async (d) => { const r = await PATCH('/me', { ...d, has_gear: u.role === 'rider' ? !!d.has_gear : undefined }); setSession({ ...r, token: S.token }); toast('Profile saved', 'ok'); });
  actions(el, {
    logout: async () => { setSession(null); S.basket = null; S.activeTrip = null; location.hash = '#/welcome'; },
    addplace: async () => {
      const p = await pickPlace({ title: 'Save a place' }); if (!p) return;
      sheet(html`<h3>Name this place</h3><form id="nf"><input class="input" name="label" placeholder="Home, Work, Mum's…" maxlength="30" required autofocus><div class="chips mt-s">${['Home', 'Work', 'Church', 'School'].map((x) => html`<button type="button" class="chip" data-fill="${x}">${x}</button>`)}</div><p class="small muted mt-s">${shortAddr(p.address)}</p><button class="btn block mt-s" type="submit">Save place</button></form>`, {
        onMount: (w, close) => { w.addEventListener('click', (e) => { const c = e.target.closest('[data-fill]'); if (c) $('[name=label]', w).value = c.dataset.fill; }); onSubmit(w, '#nf', async (f) => { await POST('/places', { label: f.label, address: p.address, lat: p.lat, lng: p.lng }); close(); toast('Place saved', 'ok'); account(); }); } });
    },
    delplace: async (b) => { await DEL('/places/' + b.dataset.id); account(); },
    pw: () => sheet(html`<h3>Change password</h3><form id="pw"><label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password" required></label><label class="field"><span>New password</span><input class="input" type="password" name="next" minlength="6" autocomplete="new-password" required></label><button class="btn block" type="submit">Update password</button></form>`, {
      onMount: (w, close) => onSubmit(w, '#pw', async (f) => { await POST('/me/password', f); close(); toast('Password updated', 'ok'); }) }),
  });
}

export async function notifications() {
  const el = layout(html`<div class="page">${topbar('Notifications')}<div id="nl"><div class="skeleton"></div><div class="skeleton"></div></div></div>`, { nav: ['customer', 'rider', 'driver', 'vendor'].includes(S.me.user.role) ? 'account' : null });
  const role = S.me.user.role;
  const target = (n) => {
    const d = n.data || {};
    if (d.orderId) return role === 'customer' ? '#/order/' + d.orderId : role === 'vendor' ? '#/shop' : '#/drive/order/' + d.orderId;
    if (d.rideId) return role === 'customer' ? '#/trip/' + d.rideId : '#/drive/ride/' + d.rideId;
    if (n.type === 'subscription') return '#/billing';
    return null;
  };
  const icn = { order: 'bag', ride: 'motor', payment: 'wallet', subscription: 'shield', sos: 'alert', report: 'alert', offer: 'bolt' };
  try {
    const rows = await GET('/notifications');
    $('#nl', el).innerHTML = rows.length ? rows.map((n) => { const t = target(n); return html`<a class="card flat note ${n.read ? '' : 'unread'}" href="${t || '#/notifications'}"><span class="pl-ic">${icon(icn[n.type] || 'bell', 18)}</span><span class="grow"><b>${n.title}</b><small class="muted block">${n.body || ''}</small><small class="xs muted">${ago(n.created_at)}</small></span></a>`.s; }).join('') : empty('🔔', 'All caught up', 'Order, ride and payment updates appear here.').s;
    await POST('/notifications/read'); S.unread = 0; updateBell();
  } catch (e) { $('#nl', el).innerHTML = html`<div class="alert red">${e.message}</div>`.s; }
}
