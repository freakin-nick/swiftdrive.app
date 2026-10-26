// Rider / driver app: online toggle + GPS, live job offers, ride job, delivery job.
import { S, GET, POST, html, raw, $, $$, icon, money, km, actions, onSubmit, on, onLeave, toast, celebrate, sheet, confirmSheet, getPos, shortAddr, tel, navLink, when, setSession, loadMe, beep } from '../core.js';
import { layout, fullscreen, bell, avatar, statusBadge } from '../shell.js';
import { createMap } from '../map.js';
import { rideBadge, orderBadge, empty, skeletons } from '../components.js';

// ------------------------------------------------------------------ realtime: GPS + offers (lives across screens)
let started = false, watchId = null, lastPost = 0, beat = null;
const offers = []; const expiry = new Map();

export function startRealtime() {
  if (started) return; started = true;
  on('job:offer', addOffer);
  on('job:taken', (t) => { removeOffer(t.kind, t.id); if (t.reason === 'taken') toast('That request was taken by another rider', 'info', 2500); });
  on('job:assigned', (a) => { celebrate('New delivery assigned', 'Open it to see the pickup details.', 'bag'); });
  on('sub:update', async () => { await loadMe(); });
  GET('/provider/offers').then((l) => l.forEach(addOffer)).catch(() => {});
  if (S.me.user.online) startGps();
}
function startGps() {
  if (!watchId && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition((p) => {
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, approx: false, at: Date.now() };
      const now = Date.now(); if (now - lastPost < 4000) return; lastPost = now;
      POST('/provider/location', { lat: S.pos.lat, lng: S.pos.lng, heading: p.coords.heading }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  // heartbeat keeps you "online" for dispatch if GPS updates are slow (phone idle, tunnel…)
  if (!beat) beat = setInterval(() => { if (S.pos && S.me?.user.online && Date.now() - lastPost > 25000) { lastPost = Date.now(); POST('/provider/location', { lat: S.pos.lat, lng: S.pos.lng }).catch(() => {}); } }, 15000);
}
function stopGps() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; clearInterval(beat); beat = null; }

function addOffer(o) {
  if (offers.some((x) => x.kind === o.kind && x.id === o.id)) return;
  const ttl = Math.max(5, o.ttl || 25); const off = { ...o, ttl };
  offers.push(off); beep(988, 160); setTimeout(() => beep(1318, 200), 200);
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
  expiry.set(o.kind + o.id, setTimeout(() => removeOffer(o.kind, o.id), ttl * 1000));
  drawOffer();
}
function removeOffer(kind, id) {
  const i = offers.findIndex((x) => x.kind === kind && x.id === id); if (i < 0) return;
  offers.splice(i, 1); clearTimeout(expiry.get(kind + id)); expiry.delete(kind + id); drawOffer();
}
function drawOffer() {
  let card = $('#offer-card');
  const o = offers[0];
  if (!o) { card && card.remove(); return; }
  if (!card) { card = document.createElement('div'); card.id = 'offer-card'; card.className = 'offer-card'; card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-label', 'New job request'); document.body.appendChild(card); }
  const del = o.kind === 'order';
  card.innerHTML = html`<div class="row between"><span class="badge red">${del ? 'Food delivery' : o.vehicle === 'car' ? 'Car ride' : 'Motor ride'}</span><small class="muted">${offers.length > 1 ? `+${offers.length - 1} more · ` : ''}${km(o.away_km)} away</small></div>
    <div class="route-lines compact mt-s"><div class="route-line"><i class="dot"></i><span class="grow"><span class="lbl">Pickup</span><span class="val">${shortAddr(o.pickup)}</span></span></div><div class="route-line"><i class="dot sq"></i><span class="grow"><span class="lbl">Drop-off</span><span class="val">${shortAddr(o.drop)}</span></span></div></div>
    <div class="row between mt-s"><span class="muted small">${km(o.distance_km)} trip · ${o.payment === 'cash' ? 'Cash' : 'Paid online'}</span><b class="offer-fare">${money(o.fare)}</b></div>
    <div class="countdown" aria-hidden="true"><i style="animation-duration:${o.ttl}s"></i></div>
    <div class="row gap"><button class="btn ghost grow" data-d>Decline</button><button class="btn grow" data-a>Accept</button></div>`.s;
  $('[data-d]', card).onclick = async () => { removeOffer(o.kind, o.id); POST(`/jobs/${o.kind}/${o.id}/decline`).catch(() => {}); };
  $('[data-a]', card).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.classList.add('loading');
    try {
      const r = await POST(`/jobs/${o.kind}/${o.id}/accept`); removeOffer(o.kind, o.id); offers.length = 0; drawOffer();
      location.hash = o.kind === 'ride' ? '#/drive/ride/' + o.id : '#/drive/order/' + (r.order_id || o.id);
    } catch (err) { toast(err.message, 'error', 4000); removeOffer(o.kind, o.id); }
  };
}

// ------------------------------------------------------------------ dashboard
export async function dashboard() {
  startRealtime();
  const u = S.me.user; const t = S.me.tenant; const motor = u.role === 'rider';
  const el = layout(html`<div class="page">
    <header class="hello"><span class="mark"></span><div class="grow"><h1>Hi, <em>${u.name.split(' ')[0]}</em></h1><span class="muted small">${motor ? 'Motorbike rider' : 'Car driver'}${t && !t.is_owner ? ' · ' + t.name : ''}</span></div>${bell()}</header>
    <div id="subb"></div>
    <div class="card big-toggle"><div class="grow"><div class="state" id="state">${u.online ? 'You are online' : 'You are offline'}</div><small class="muted" id="hint">${u.online ? 'Waiting for ride requests near you…' : 'Go online to receive requests'}</small></div><label class="switch lg"><input type="checkbox" id="onl" ${u.online ? raw('checked') : ''} aria-label="Go online"><i></i></label></div>
    <div id="active"></div>
    <section class="section"><div class="stats" id="stats"><div class="stat"><div class="n">–</div><div class="l">Today</div></div></div></section>
    <section class="section"><div id="mapc" class="card flat nopad-c"><div id="pm" class="mapbox short"></div></div></section>
    <section class="section"><div class="section-h"><h3>Recent trips</h3><a href="#/activity">All →</a></div><div id="recent">${skeletons(2)}</div></section>
  </div>`, { nav: 'home' });
  const map = createMap($('#pm', el), { center: S.pos || S.cfg.center, zoom: 14 }); onLeave(() => map.destroy && map.destroy());
  getPos().then((p) => { map.setView(p, 15); map.marker('me', { ...p, type: u.online ? (motor ? 'motor' : 'car') : 'me' }); });

  if (t && !t.active) $('#subb', el).innerHTML = html`<div class="alert red mb">${icon('shield', 22)}<span><b>${t.status === 'pending_payment' ? 'Subscribe to start earning' : 'Your subscription has expired'}</b><br>${t.is_owner ? 'Pay your monthly plan with Paystack to go online and receive requests.' : 'Ask ' + t.name + ' to renew.'}${t.is_owner ? html`<br><a class="btn sm" href="#/billing">Choose a plan</a>` : ''}</span></div>`.s;

  const setOnline = async (on_) => {
    const chk = $('#onl', el);
    try {
      if (on_) { const p = await getPos(true); await POST('/provider/status', { online: true, lat: p.lat, lng: p.lng }); startGps(); if (p.approx) toast('Using approximate location. Allow GPS for accurate dispatch.', 'info', 5000); }
      else { await POST('/provider/status', { online: false }); stopGps(); }
      S.me.user.online = on_;
      $('#state', el).textContent = on_ ? 'You are online' : 'You are offline';
      $('#hint', el).textContent = on_ ? 'Waiting for ride requests near you…' : 'Go online to receive requests';
    } catch (e) {
      chk.checked = !on_;
      if (e.status === 402) sheet(html`<h3>Subscription needed</h3><p class="muted">${e.message}</p><a class="btn block" href="#/billing" data-close>Choose a plan</a>`);
      else toast(e.message, 'error', 4500);
    }
  };
  $('#onl', el).addEventListener('change', (e) => setOnline(e.target.checked));

  GET('/provider/active').then((a) => {
    const box = $('#active', el); if (!box) return;
    if (a.ride) { const r = a.ride.ride; box.innerHTML = html`<a class="card active-job mt" href="#/drive/ride/${r.id}"><span class="pulse-dot"></span><span class="grow"><b>Trip in progress</b><small class="muted block">${shortAddr(r.drop_addr)}</small></span>${rideBadge(r.status)}${icon('chev')}</a>`.s; }
    else if (a.order_id) box.innerHTML = html`<a class="card active-job mt" href="#/drive/order/${a.order_id}"><span class="pulse-dot"></span><span class="grow"><b>Delivery in progress</b><small class="muted block">Tap to continue</small></span>${icon('chev')}</a>`.s;
  }).catch(() => {});
  GET('/provider/earnings').then((e) => {
    $('#stats', el).innerHTML = html`<div class="stat"><div class="n">${money(e.today.earned)}</div><div class="l">Today · ${e.today.trips} job${e.today.trips === 1 ? '' : 's'}</div></div><div class="stat"><div class="n">${money(e.week.earned)}</div><div class="l">7 days · ${e.week.trips} jobs</div></div><div class="stat"><div class="n">${e.rating_count ? (+e.rating).toFixed(1) : '–'} <small>★</small></div><div class="l">${e.rating_count} rating${e.rating_count === 1 ? '' : 's'}</div></div>`.s;
  }).catch(() => {});
  GET('/rides').then((rows) => {
    $('#recent', el).innerHTML = rows.length ? rows.slice(0, 4).map((r) => html`<a class="card flat act-row" href="#/drive/ride/${r.id}"><span class="act-ic">${r.vehicle_type === 'car' ? '🚗' : html`<span class="mark sm"></span>`}</span><span class="grow"><b>${shortAddr(r.drop_addr)}</b><small class="muted block">${when(r.requested_at)}</small></span><span class="right"><b>${money(r.fare)}</b><br>${rideBadge(r.status)}</span></a>`.s).join('') : empty('🛵', 'No trips yet', 'Go online to get your first request.').s;
  }).catch(() => {});
}

// ------------------------------------------------------------------ job helpers
/** DEMO helper: drive along a route so live tracking can be tried without a phone. */
function driveAlong(geometry, onStep, ms = 1500) {
  let i = 0; const pts = geometry.filter((_, k) => k % Math.max(1, Math.floor(geometry.length / 40)) === 0);
  const t = setInterval(() => { const p = pts[i++]; if (!p) return clearInterval(t); S.pos = { lat: p[0], lng: p[1], at: Date.now() }; POST('/provider/location', { lat: p[0], lng: p[1] }).catch(() => {}); onStep && onStep(S.pos); }, ms);
  onLeave(() => clearInterval(t)); return t;
}
const pinBox = () => html`<input class="pin-single" id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="••••" aria-label="4-digit code">`;
const custCard = (c) => html`<div class="card flat row gap"><span class="avatar">${(c.name || '?')[0]}</span><div class="grow"><b>${c.name}</b><small class="muted block">Customer${c.rating ? ' · ★ ' + c.rating : ''}</small></div><a class="icon-btn" href="${tel(c.phone)}" aria-label="Call ${c.name}">${icon('phone', 20)}</a></div>`;

// ------------------------------------------------------------------ ride job
export async function rideJob({ params }) {
  startRealtime();
  const id = +params.id;
  const el = fullscreen(html`<div class="full ride"><div class="mapbox" id="map"></div>
    <div class="float-top"><a class="icon-btn" href="#/drive" aria-label="Back">${icon('back')}</a><div class="grow"></div><button class="sos hide" id="sosb" data-act="sos">${icon('alert', 18)} SOS</button></div>
    <div class="panel" id="panel"><div class="skeleton"></div></div></div>`);
  const map = createMap($('#map', el), { center: S.pos || S.cfg.center, zoom: 15 }); onLeave(() => map.destroy && map.destroy());
  let d = null, last = null, lastSig = '', routeAt = 0, routeKey = '', geom = null, gear = false;

  const target = () => (d.ride.status === 'ongoing' ? { lat: d.ride.drop_lat, lng: d.ride.drop_lng, addr: d.ride.drop_addr, label: 'Destination' } : { lat: d.ride.pickup_lat, lng: d.ride.pickup_lng, addr: d.ride.pickup_addr, label: 'Pickup' });
  const drawMap = async () => {
    const r = d.ride; const me = S.pos;
    map.marker('pickup', { lat: r.pickup_lat, lng: r.pickup_lng, type: 'pickup' }); map.marker('drop', { lat: r.drop_lat, lng: r.drop_lng, type: 'drop' });
    if (me) map.marker('me', { lat: me.lat, lng: me.lng, type: r.vehicle_type });
    if (!['accepted', 'arrived', 'ongoing'].includes(r.status)) { map.route(null); return; }
    const tg = target(); const key = r.status;
    if (me && (key !== routeKey || Date.now() - routeAt > 30000)) {
      routeKey = key; routeAt = Date.now();
      try { const g = await POST('/geo/route', { from: me, to: tg }); geom = g.geometry; map.route(geom); const e = $('#eta', el); if (e) e.textContent = `${km(g.km)} · ${g.min} min`; } catch { /* ignore */ }
    }
    if (key !== last) map.fit([me, tg].filter(Boolean), 70);
  };
  const draw = () => {
    const r = d.ride; const tg = target(); const motor = r.vehicle_type === 'motor';
    $('#sosb', el).classList.toggle('hide', !['accepted', 'arrived', 'ongoing'].includes(r.status));
    let body;
    if (r.status === 'accepted') body = html`<div class="row between"><h3>Go to pickup</h3><span class="badge navy" id="eta">…</span></div>${custCard(d.customer)}
      <div class="route-line"><i class="dot"></i><span class="grow"><span class="lbl">Pickup</span><span class="val">${r.pickup_addr}</span></span></div>
      <div class="row gap mt-s"><a class="btn ghost grow" target="_blank" rel="noopener" href="${navLink(tg.lat, tg.lng)}">${icon('nav', 18)} Navigate</a><button class="btn grow" data-act="arrived">I've arrived</button></div>
      <p class="row between small muted mt-s"><span>Trip ${km(r.distance_km)} · ${r.payment_method === 'cash' ? 'Collect cash' : 'Paid via Paystack'}</span><b>${money(r.fare)}</b></p>
      <button class="btn link block" data-act="cancel">Cancel this trip</button>${S.cfg.demo ? html`<button class="btn ghost sm block" data-act="sim">Demo: drive to pickup</button>` : ''}`;
    else if (r.status === 'arrived') body = html`<h3>Start the trip</h3>${custCard(d.customer)}
      ${motor ? html`<label class="gear-check ${r.gear_confirmed ? 'ok' : ''}"><input type="checkbox" id="gearc" ${r.gear_confirmed ? raw('checked disabled') : ''}><span>${icon('helmet', 22)}</span><span class="grow"><b>Helmet &amp; protective gear given</b><small class="block">Required for every motorbike trip. Confirm the passenger is wearing them.</small></span></label>` : ''}
      <div class="mt-s"><b class="small">Passenger's 4-digit PIN</b>${pinBox()}</div>
      <button class="btn block mt-s" data-act="start">Start trip</button>`;
    else if (r.status === 'ongoing') body = html`<div class="row between"><h3>Trip in progress</h3><span class="badge navy" id="eta">…</span></div>
      <div class="route-line"><i class="dot sq"></i><span class="grow"><span class="lbl">Destination</span><span class="val">${r.drop_addr}</span></span></div>
      <div class="row gap mt-s"><a class="btn ghost grow" target="_blank" rel="noopener" href="${navLink(tg.lat, tg.lng)}">${icon('nav', 18)} Navigate</a><button class="btn grow" data-act="complete">Complete trip</button></div>
      <p class="small muted mt-s center">${r.payment_method === 'cash' ? html`Collect <b>${money(r.fare)}</b> in cash` : html`Fare ${money(r.fare)} — paid via Paystack`}</p>${S.cfg.demo ? html`<button class="btn ghost sm block" data-act="sim">Demo: drive to destination</button>` : ''}`;
    else if (r.status === 'completed') body = html`<div class="center"><div class="done-ic">${icon('check', 36)}</div><h2>Trip complete</h2><div class="big-fare">${money(r.fare)}</div><small class="muted">${r.payment_method === 'cash' ? 'Collect this in cash from the passenger' : r.payment_status === 'paid' ? 'Paid online · added to your earnings' : 'Passenger is paying with Paystack'}</small></div><a class="btn block mt" href="#/drive">Back to dashboard</a>`;
    else body = html`<div class="empty"><span class="art">🚫</span><h3>Trip ${r.status === 'searching' ? 'was cancelled by the passenger' : r.status}</h3></div><a class="btn block" href="#/drive">Back to dashboard</a>`;
    $('#panel', el).innerHTML = html`<div class="grab"></div>${body}`.s;
    const gc = $('#gearc', el); if (gc) gc.addEventListener('change', async () => { gc.disabled = true; try { await POST(`/rides/${id}/gear`); gc.parentElement.classList.add('ok'); } catch (e) { gc.checked = false; gc.disabled = false; toast(e.message, 'error'); } });
  };
  const load = async () => {
    const prev = last; d = await GET('/rides/' + id); const st = d.ride.status;
    if (!d.customer) { location.hash = '#/drive'; return; }
    if (prev && prev !== st && st === 'cancelled') celebrate('Trip cancelled', 'The passenger cancelled this trip.', 'x');
    const sig = JSON.stringify([st, d.ride.gear_confirmed, d.ride.payment_status]);
    if (sig !== lastSig) { lastSig = sig; draw(); }
    await drawMap(); last = st;
  };
  on('ride:update', (e) => { if (!e.id || e.id === id) load().catch(() => {}); });
  const poll = setInterval(() => load().catch(() => {}), 6000); onLeave(() => clearInterval(poll));
  const mv = setInterval(() => { if (S.pos && d) map.marker('me', { lat: S.pos.lat, lng: S.pos.lng, type: d.ride.vehicle_type }); }, 3000); onLeave(() => clearInterval(mv));

  actions(el, {
    arrived: async () => { await POST(`/rides/${id}/arrived`); await load(); },
    start: async () => { const pin = $('#pin', el).value.trim(); if (pin.length !== 4) throw new Error('Enter the 4-digit PIN from the passenger'); await POST(`/rides/${id}/start`, { pin }); await load(); },
    complete: async () => { if (!(await confirmSheet('Complete this trip?', 'Only finish once the passenger is at their destination.', 'Complete trip'))) return; await POST(`/rides/${id}/complete`); await load(); },
    cancel: async () => { if (await confirmSheet('Cancel this trip?', 'The passenger will be matched with another rider.', 'Cancel trip', true)) { await POST(`/rides/${id}/cancel`, { reason: 'Rider cancelled' }); location.hash = '#/drive'; } },
    sos: async () => { if (!(await confirmSheet('Send an SOS alert?', 'RiderGo safety will be alerted with your location. In immediate danger call 112.', 'Send SOS', true))) return; const r = await POST(`/rides/${id}/sos`, { lat: S.pos?.lat, lng: S.pos?.lng }); toast(r.message, 'ok', 7000); },
    sim: () => { if (geom) { toast('Simulating drive…', 'info'); driveAlong(geom, () => drawMap()); } else toast('Route not ready yet', 'info'); },
  });
  try { await load(); } catch (e) { $('#panel', el).innerHTML = html`<div class="empty"><span class="art">⚠️</span><h3>Could not open trip</h3><p>${e.message}</p><a class="btn" href="#/drive">Back</a></div>`.s; }
}

// ------------------------------------------------------------------ delivery job
export async function orderJob({ params }) {
  startRealtime();
  const id = +params.id;
  const el = fullscreen(html`<div class="full ride"><div class="mapbox" id="map"></div>
    <div class="float-top"><a class="icon-btn" href="#/drive" aria-label="Back">${icon('back')}</a><div class="grow"></div></div>
    <div class="panel" id="panel"><div class="skeleton"></div></div></div>`);
  const map = createMap($('#map', el), { center: S.pos || S.cfg.center, zoom: 15 }); onLeave(() => map.destroy && map.destroy());
  let d = null, lastSig = '', routeKey = '', routeAt = 0, geom = null, fitted = '';

  const phase = () => { const o = d.order; if (o.status === 'completed') return 'done'; if (['cancelled', 'rejected'].includes(o.status)) return 'void'; return o.delivery_status === 'arrived' ? 'arrived' : o.delivery_status === 'picked_up' ? 'enroute' : 'pickup'; };
  const drawMap = async () => {
    const o = d.order, v = d.vendor, ph = phase();
    map.marker('v', { lat: v.lat, lng: v.lng, type: 'food', label: v.name }); if (o.dest_lat != null) map.marker('d', { lat: o.dest_lat, lng: o.dest_lng, type: 'drop' });
    if (S.pos) map.marker('me', { lat: S.pos.lat, lng: S.pos.lng, type: 'motor' });
    if (!['pickup', 'enroute', 'arrived'].includes(ph)) { map.route(null); return; }
    const tg = ph === 'pickup' ? { lat: v.lat, lng: v.lng } : { lat: o.dest_lat, lng: o.dest_lng };
    if (S.pos && (ph !== routeKey || Date.now() - routeAt > 30000)) { routeKey = ph; routeAt = Date.now(); try { const g = await POST('/geo/route', { from: S.pos, to: tg }); geom = g.geometry; map.route(geom); const e = $('#eta', el); if (e) e.textContent = `${km(g.km)} · ${g.min} min`; } catch { /* ignore */ } }
    if (fitted !== ph) { fitted = ph; map.fit([S.pos, tg].filter(Boolean), 70); }
  };
  const draw = () => {
    const o = d.order, v = d.vendor, ph = phase(); let body;
    const cash = o.payment_method === 'cash';
    if (ph === 'pickup') { const ready = o.status === 'ready'; body = html`<div class="row between"><h3>Pick up from ${v.name}</h3><span class="badge navy" id="eta">…</span></div>
      <div class="route-line"><i class="dot"></i><span class="grow"><span class="lbl">Vendor</span><span class="val">${v.address}</span></span><a class="icon-btn sm" href="${tel(v.phone)}" aria-label="Call vendor">${icon('phone', 18)}</a></div>
      <div class="card flat mt-s"><b class="small">Order ${o.code}</b>${d.items.map((i) => html`<div class="small muted">${i.qty} × ${i.name}</div>`)}</div>
      ${ready ? '' : html`<div class="alert mt-s">${icon('clock', 18)}<span>The vendor is still preparing this order. You can pick it up once it's marked ready.</span></div>`}
      <div class="row gap mt-s"><a class="btn ghost grow" target="_blank" rel="noopener" href="${navLink(v.lat, v.lng)}">${icon('nav', 18)} Navigate</a><button class="btn grow" data-act="pickup" ${ready ? '' : raw('disabled')}>Picked up</button></div>${S.cfg.demo ? html`<button class="btn ghost sm block mt-s" data-act="sim">Demo: drive to vendor</button>` : ''}`; }
    else if (ph === 'enroute') body = html`<div class="row between"><h3>Deliver to ${d.customer.name.split(' ')[0]}</h3><span class="badge navy" id="eta">…</span></div>${custCard(d.customer)}
      <div class="route-line mt-s"><i class="dot sq"></i><span class="grow"><span class="lbl">Deliver to</span><span class="val">${o.dest_addr}</span></span></div>
      <div class="row gap mt-s"><a class="btn ghost grow" target="_blank" rel="noopener" href="${navLink(o.dest_lat, o.dest_lng)}">${icon('nav', 18)} Navigate</a><button class="btn grow" data-act="arrived">I've arrived</button></div>
      ${cash ? html`<p class="small center mt-s">${icon('wallet', 16)} Collect <b>${money(o.total)}</b> cash from the customer</p>` : ''}${S.cfg.demo ? html`<button class="btn ghost sm block mt-s" data-act="sim">Demo: drive to customer</button>` : ''}`;
    else if (ph === 'arrived') body = html`<h3>Hand over the order</h3>${custCard(d.customer)}
      <div class="alert mt-s">${icon('lock', 18)}<span>Ask the customer to <b>tell you their 4-digit delivery code</b>. Only hand over the order once it matches.</span></div>
      <div class="mt-s">${pinBox()}</div>${cash ? html`<p class="small center mt-s">${icon('wallet', 16)} Collect <b>${money(o.total)}</b> cash</p>` : ''}
      <button class="btn block mt-s" data-act="deliver">Confirm delivery</button>`;
    else if (ph === 'done') body = html`<div class="center"><div class="done-ic">${icon('check', 36)}</div><h2>Delivered!</h2><div class="big-fare">${money(o.delivery_fee)}</div><small class="muted">Delivery fee ${cash ? '(customer paid cash)' : 'added to your earnings'}</small></div><a class="btn block mt" href="#/drive">Back to dashboard</a>`;
    else body = html`<div class="empty"><span class="art">🚫</span><h3>This delivery was cancelled</h3></div><a class="btn block" href="#/drive">Back to dashboard</a>`;
    $('#panel', el).innerHTML = html`<div class="grab"></div>${body}`.s;
  };
  const load = async () => {
    d = await GET('/orders/' + id); if (!d.customer) { location.hash = '#/drive'; return; }
    const sig = JSON.stringify([d.order.status, d.order.delivery_status]); if (sig !== lastSig) { if (lastSig && d.order.status === 'ready') celebrate('Order is ready', 'You can pick it up now.', 'bag'); lastSig = sig; draw(); }
    await drawMap();
  };
  on('order:update', (e) => { if (!e.id || e.id === id) load().catch(() => {}); });
  const poll = setInterval(() => load().catch(() => {}), 6000); onLeave(() => clearInterval(poll));
  const mv = setInterval(() => { if (S.pos) map.marker('me', { lat: S.pos.lat, lng: S.pos.lng, type: 'motor' }); }, 3000); onLeave(() => clearInterval(mv));
  actions(el, {
    pickup: async () => { await POST(`/orders/${id}/pickup`); await load(); },
    arrived: async () => { await POST(`/orders/${id}/arrived`); await load(); },
    deliver: async () => { const pin = $('#pin', el).value.trim(); if (pin.length !== 4) throw new Error("Enter the customer's 4-digit code"); await POST(`/orders/${id}/deliver`, { pin }); celebrate('Delivered!', 'Great job.', 'check'); await load(); },
    sim: () => { if (geom) { toast('Simulating drive…', 'info'); driveAlong(geom, () => drawMap()); } else toast('Route not ready yet', 'info'); },
  });
  try { await load(); } catch (e) { $('#panel', el).innerHTML = html`<div class="empty"><span class="art">⚠️</span><h3>Could not open delivery</h3><p>${e.message}</p><a class="btn" href="#/drive">Back</a></div>`.s; }
}
