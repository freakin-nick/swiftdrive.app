// Customer ride booking and live trip tracking (motor + car).
import { S, GET, POST, html, raw, $, $$, icon, money, km, actions, onSubmit, on, onLeave, toast, celebrate, sheet, confirmSheet, getPos, shortAddr, reverse, tel, esc, stars } from '../core.js';
import { fullscreen, avatar } from '../shell.js';
import { createMap } from '../map.js';
import { pickPlace, currentPlace } from '../picker.js';
import { rideBadge } from '../components.js';

const draft = { pickup: null, drop: null, vehicle: 'motor', payment: 'cash', promo: '', quote: null };

const VEH = {
  motor: { name: 'Motor', art: html`<span class="mark"></span>`, note: 'Fastest · helmet & gear provided' },
  car: { name: 'Car', art: raw('🚗'), note: 'Comfortable · up to 3 passengers' },
};
const pt = (p) => ({ lat: p.lat, lng: p.lng });

export async function book({ query }) {
  if (query.vehicle && VEH[query.vehicle]) draft.vehicle = query.vehicle;
  const el = fullscreen(html`<div class="full ride">
    <div class="mapbox" id="map"></div>
    <div class="float-top"><a class="icon-btn" href="#/" aria-label="Back">${icon('back')}</a><div class="card tight grow ride-title"><b>Book a ride</b></div></div>
    <div class="panel" id="panel"></div></div>`);
  const map = createMap($('#map', el), { center: S.pos || S.cfg.center, zoom: 14 });
  onLeave(() => map.destroy && map.destroy());
  let nearTimer;
  let busy = false;

  const drawMap = () => {
    map.clearMarkers('pt:');
    if (draft.pickup) map.marker('pt:pickup', { ...pt(draft.pickup), type: 'pickup' });
    if (draft.drop) map.marker('pt:drop', { ...pt(draft.drop), type: 'drop' });
    map.route(draft.quote?.geometry || null);
    const pts = [draft.pickup, draft.drop].filter(Boolean);
    if (pts.length) map.fit(pts, 80);
  };
  const loadNearby = async () => {
    if (!draft.pickup) return;
    try {
      const r = await GET(`/riders/nearby?lat=${draft.pickup.lat}&lng=${draft.pickup.lng}`);
      map.clearMarkers('rd:');
      r.forEach((x, i) => map.marker('rd:' + i, { lat: x.lat, lng: x.lng, type: x.type }));
      draft.nearby = { motor: r.filter((x) => x.type === 'motor').length, car: r.filter((x) => x.type === 'car').length };
      const n = $('#near'); if (n) n.innerHTML = nearText().s;
    } catch { /* optional */ }
  };
  const nearText = () => (draft.nearby ? html`<span class="pulse-dot"></span> ${draft.nearby[draft.vehicle]} ${draft.vehicle === 'motor' ? 'riders' : 'drivers'} nearby` : '');
  nearTimer = setInterval(loadNearby, 15000); onLeave(() => clearInterval(nearTimer));

  const quote = async () => {
    draft.quote = null; draw();
    if (!draft.pickup || !draft.drop) return;
    try {
      draft.quote = await POST('/rides/quote', { pickup: pt(draft.pickup), drop: pt(draft.drop), promo: draft.promo || undefined });
      if (draft.quote.promo_error) toast(draft.quote.promo_error, 'error');
    } catch (e) { toast(e.message, 'error', 4500); draft.drop = e.message.includes('too close') ? null : draft.drop; }
    draw(); drawMap();
  };
  const choose = async (which) => {
    const p = await pickPlace({ title: which === 'drop' ? 'Where to?' : 'Pickup location', near: draft.pickup ? pt(draft.pickup) : undefined });
    if (!p) return;
    draft[which] = p; if (which === 'pickup') loadNearby();
    await quote();
  };

  const draw = () => {
    const q = draft.quote;
    $('#panel', el).innerHTML = html`<div class="grab"></div>
      <div class="route-lines">
        <button class="route-line" data-act="pickup"><i class="dot"></i><span class="grow"><span class="lbl">From</span><span class="val ${draft.pickup ? '' : 'ph'}">${draft.pickup ? shortAddr(draft.pickup.address) : 'Finding your location…'}</span></span></button>
        <button class="route-line" data-act="drop"><i class="dot sq"></i><span class="grow"><span class="lbl">Where to?</span><span class="val ${draft.drop ? '' : 'ph'}">${draft.drop ? shortAddr(draft.drop.address) : 'Search destination'}</span></span>${icon('search', 20)}</button>
      </div>
      ${!draft.drop ? html`<p class="muted small center mt">Choose a destination to see exact prices. Fares are measured along real roads — never guessed.</p><p class="small center" id="near">${nearText()}</p>` : !q ? html`<div class="skeleton mt"></div><div class="skeleton"></div>` : html`
        <div class="trip-meta small muted center mt-s">${icon('map', 16)} ${km(q.distance_km)} · about ${q.motor.eta_min} min ${q.approx ? html`<span class="badge amber">estimated route</span>` : ''}</div>
        <div class="mt-s">${['motor', 'car'].map((v) => html`<button class="veh-opt ${draft.vehicle === v ? 'on' : ''}" data-act="veh" data-v="${v}" role="radio" aria-checked="${draft.vehicle === v}"><span class="art">${VEH[v].art}</span><span class="grow"><b>${VEH[v].name}</b><s>${VEH[v].note}</s></span><span class="price">${q[v].discount > 0 ? html`<small class="strike">${money(q[v].base)}</small>` : ''}${money(q[v].fare)}</span></button>`)}</div>
        <div class="row gap mt-s"><div class="seg grow tabs" role="radiogroup" aria-label="Payment"><button data-act="pay" data-m="cash" class="${draft.payment === 'cash' ? 'on' : ''}">${icon('wallet', 18)} Cash</button><button data-act="pay" data-m="paystack" class="${draft.payment === 'paystack' ? 'on' : ''}">${icon('card', 18)} Card / MoMo</button></div></div>
        <form id="pf" class="promo-row mt-s"><input class="input" name="promo" placeholder="Promo code" value="${draft.promo}" autocomplete="off" aria-label="Promo code"><button class="btn ghost sm" type="submit">Apply</button></form>
        ${draft.payment === 'paystack' ? html`<p class="xs muted mt-s">You'll pay securely with Paystack when your trip ends.</p>` : ''}
        <button class="btn block mt" data-act="book">Book ${VEH[draft.vehicle].name} · ${money(q[draft.vehicle].fare)}</button>
        <p class="center xs muted mt-s" id="near">${nearText()}</p>`}`.s;
    const pf = $('#pf', el);
    if (pf) onSubmit(el, pf, async (d) => { draft.promo = String(d.promo || '').trim().toUpperCase(); await quote(); if (draft.promo && draft.quote && !draft.quote.promo_error) toast('Promo applied', 'ok'); });
  };

  actions(el, {
    pickup: () => choose('pickup'), drop: () => choose('drop'),
    veh: (b) => { draft.vehicle = b.dataset.v; draw(); },
    pay: (b) => { draft.payment = b.dataset.m; draw(); },
    book: async () => {
      if (busy) return; busy = true;
      try {
        const r = await POST('/rides', { pickup: pt(draft.pickup), drop: pt(draft.drop), pickup_addr: draft.pickup.address, drop_addr: draft.drop.address, vehicle_type: draft.vehicle, payment_method: draft.payment, promo: draft.promo || undefined });
        S.activeTrip = '/trip/' + r.id; draft.drop = null; draft.quote = null; draft.promo = '';
        location.hash = '#/trip/' + r.id;
      } finally { busy = false; }
    },
  });

  draw();
  if (!draft.pickup) {
    const pos = await getPos();
    draft.pickup = { lat: pos.lat, lng: pos.lng, address: 'Current location', current: true };
    map.setView(pos, 15); map.marker('me', { ...pos, type: 'me' });
    draw(); loadNearby();
    reverse(pos.lat, pos.lng).then((a) => { if (draft.pickup?.current) { draft.pickup.address = a; draw(); } });
  } else { loadNearby(); }
  if (draft.drop && !draft.quote) quote(); else drawMap();
  if (query.focus === 'drop' && !draft.drop) choose('drop');
}

const REPORT_REASONS = ['Unsafe riding or driving', 'Rude or abusive behaviour', 'Asked for extra money', 'Wrong route / took longer', 'Vehicle did not match', 'Other'];

export async function trip({ params }) {
  const id = +params.id;
  const el = fullscreen(html`<div class="full ride">
    <div class="mapbox" id="map"></div>
    <div class="float-top"><a class="icon-btn" href="#/" aria-label="Home">${icon('back')}</a><div class="grow"></div><button class="sos hide" id="sosb" data-act="sos">${icon('alert', 18)} SOS</button></div>
    <div class="panel" id="panel"><div class="skeleton"></div></div></div>`);
  const map = createMap($('#map', el), { center: S.pos || S.cfg.center, zoom: 15 });
  onLeave(() => map.destroy && map.destroy());
  let d = null, last = null, lastSig = '', routeAt = 0, routeKey = '', rating = 5, pollT;

  const celebrateChange = (prev, now) => {
    if (!prev || prev === now) return;
    const n = d.rider?.name || 'Your rider';
    if (now === 'accepted') celebrate('Rider found!', `${n} is on the way to you.`, 'motor');
    else if (now === 'arrived') celebrate('Your rider has arrived', 'Share your 4-digit PIN to start the trip.', 'pin');
    else if (now === 'completed') celebrate('You have arrived!', `Trip total ${money(d.ride.fare)}. Please rate your ride.`, 'check');
  };

  const drawRoute = async () => {
    const r = d.ride, rd = d.rider;
    if (!['accepted', 'arrived', 'ongoing'].includes(r.status)) { map.route(null); return; }
    const from = rd?.lat != null ? { lat: rd.lat, lng: rd.lng } : { lat: r.pickup_lat, lng: r.pickup_lng };
    const to = r.status === 'ongoing' ? { lat: r.drop_lat, lng: r.drop_lng } : { lat: r.pickup_lat, lng: r.pickup_lng };
    const key = `${r.status}`;
    if (key === routeKey && Date.now() - routeAt < 25000) return;
    routeKey = key; routeAt = Date.now();
    try { const g = await POST('/geo/route', { from, to }); map.route(g.geometry); d.eta = g.min; const e = $('#eta'); if (e) e.textContent = `${g.min} min`; } catch { /* ignore */ }
  };

  const drawMapMarkers = () => {
    const r = d.ride;
    map.marker('pickup', { lat: r.pickup_lat, lng: r.pickup_lng, type: 'pickup' });
    map.marker('drop', { lat: r.drop_lat, lng: r.drop_lng, type: 'drop' });
    if (d.rider?.lat != null) map.marker('rider', { lat: d.rider.lat, lng: d.rider.lng, type: r.vehicle_type });
    const pts = [{ lat: r.pickup_lat, lng: r.pickup_lng }, { lat: r.drop_lat, lng: r.drop_lng }];
    if (d.rider?.lat != null && ['accepted', 'arrived', 'ongoing'].includes(r.status)) pts.push({ lat: d.rider.lat, lng: d.rider.lng });
    map.fit(pts, 70);
  };

  const riderCard = () => { const rd = d.rider; if (!rd) return ''; return html`<div class="card flat rider-card row gap">
    ${avatar({ name: rd.name, role: d.ride.vehicle_type === 'motor' ? 'rider' : 'driver', vehicle_type: d.ride.vehicle_type, avatar: rd.avatar })}
    <div class="grow"><b>${rd.name}</b> <span class="rate">${icon('star', 13)} ${rd.rating_count ? rd.rating.toFixed(1) : 'New'}</span><small class="muted block">${rd.vehicle_make || (d.ride.vehicle_type === 'motor' ? 'Motorbike' : 'Car')}</small></div>
    <div class="plate">${rd.plate || '—'}</div><a class="icon-btn" href="${tel(rd.phone)}" aria-label="Call ${rd.name}">${icon('phone', 20)}</a></div>`; };

  const draw = () => {
    const r = d.ride; const panel = $('#panel', el);
    $('#sosb', el).classList.toggle('hide', !['accepted', 'arrived', 'ongoing'].includes(r.status));
    const route = html`<div class="route-lines compact"><div class="route-line"><i class="dot"></i><span class="grow"><span class="lbl">Pickup</span><span class="val">${shortAddr(r.pickup_addr)}</span></span></div><div class="route-line"><i class="dot sq"></i><span class="grow"><span class="lbl">Destination</span><span class="val">${shortAddr(r.drop_addr)}</span></span></div></div>`;
    let body;
    if (r.status === 'searching' || r.status === 'scheduled') {
      body = html`<div class="searching"><div class="radar"><i></i><i></i><i></i><span>${r.vehicle_type === 'motor' ? html`<span class="mark sm"></span>` : '🚗'}</span></div></div>
        <h3 class="center">${r.status === 'scheduled' ? 'Ride scheduled' : `Finding your ${r.vehicle_type === 'motor' ? 'rider' : 'driver'}…`}</h3>
        <p class="muted center small">${r.status === 'scheduled' ? 'We will start looking shortly before pickup time.' : 'We ask the closest riders first, then widen the search. The first to accept gets your trip.'}</p>
        ${route}<div class="row between mt-s"><span class="muted">Fare</span><b>${money(r.fare)}</b></div>
        <button class="btn danger block mt" data-act="cancel">Cancel request</button>`;
    } else if (r.status === 'no_riders') {
      body = html`<div class="empty"><span class="art">😕</span><h3>No riders available right now</h3><p>We searched wide around you. Try again in a moment.</p></div>
        <button class="btn block" data-act="retry">Search again</button><a class="btn ghost block mt-s" href="#/">Back home</a>`;
    } else if (['accepted', 'arrived'].includes(r.status)) {
      const motor = r.vehicle_type === 'motor';
      body = html`<div class="row between"><h3>${r.status === 'arrived' ? 'Your rider has arrived' : 'Your rider is on the way'}</h3><span class="badge navy" id="etab">${r.status === 'accepted' ? html`ETA <span id="eta">${d.eta ? d.eta + ' min' : '…'}</span>` : 'Here now'}</span></div>
        ${riderCard()}
        <div class="pin-card mt-s"><small>Your ride PIN</small><div class="digits" aria-label="PIN ${r.start_pin}">${r.start_pin}</div><small>Tell this to your ${motor ? 'rider' : 'driver'} only when you meet. They need it to start the trip.</small></div>
        ${motor ? html`<div class="gear ${r.gear_confirmed ? 'ok' : ''} mt-s">${icon('helmet', 22)}<span class="grow">${r.gear_confirmed ? html`<b>Helmet &amp; protective gear handed over</b>` : html`<b>Helmet &amp; gear</b><small class="block">Your rider must give you a helmet and protective gear before the trip starts. Do not ride without them.</small>`}</span>${r.gear_confirmed ? icon('check', 20) : ''}</div>` : ''}
        ${route}
        <div class="row gap mt-s"><button class="btn danger grow" data-act="cancel">Cancel ride</button><button class="btn ghost grow" data-act="share">${icon('share', 18)} Share trip</button></div>`;
    } else if (r.status === 'ongoing') {
      body = html`<div class="row between"><h3>On your way</h3><span class="badge green"><span class="pulse-dot"></span> Live</span></div>
        ${riderCard()}${route}
        <div class="row gap mt-s"><button class="btn ghost grow" data-act="share">${icon('share', 18)} Share trip</button><button class="btn danger grow" data-act="report">Report a problem</button></div>
        <p class="xs muted mt-s center">You'll pay <b>${money(r.fare)}</b> ${r.payment_method === 'cash' ? 'in cash to your rider when you arrive' : 'with Paystack when you arrive'}.</p>`;
    } else if (r.status === 'completed') {
      const needsPay = r.payment_method === 'paystack' && r.payment_status !== 'paid';
      body = html`<div class="center"><div class="done-ic">${icon('check', 36)}</div><h2>You've arrived</h2><p class="muted">${shortAddr(r.drop_addr)}</p>
        <div class="big-fare">${money(r.fare)}</div><small class="muted">${km(r.distance_km)} · ${r.payment_method === 'cash' ? 'Pay your rider in cash' : r.payment_status === 'paid' ? 'Paid with Paystack ✓' : 'Pay with Paystack'}</small></div>
        ${needsPay ? html`<button class="btn block mt" data-act="pay">${icon('card', 20)} Pay ${money(r.fare)} with Paystack</button>` : ''}
        ${d.reviewed ? html`<div class="alert green mt">Thanks for rating your ride.</div><a class="btn block mt" href="#/">Done</a>` : html`<hr class="hr"><h4 class="center">Rate ${d.rider?.name || 'your rider'}</h4>
          <div class="star-input" id="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => html`<button data-act="star" data-n="${n}" class="${n <= rating ? 'on' : ''}" role="radio" aria-checked="${n === rating}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star', 34)}</button>`)}</div>
          <textarea class="input" id="cm" placeholder="Anything to add? (optional)" maxlength="300"></textarea>
          <button class="btn block mt-s" data-act="rate">Submit rating</button><button class="btn link block" data-act="report">Report a problem</button>`}`;
    } else {
      body = html`<div class="empty"><span class="art">🚫</span><h3>Ride cancelled</h3><p>${r.cancel_reason || ''}</p></div><a class="btn block" href="#/ride">Book another ride</a><a class="btn ghost block mt-s" href="#/">Back home</a>`;
    }
    panel.innerHTML = html`<div class="grab"></div>${body}`.s;
  };

  const load = async () => {
    const prev = last;
    d = await GET('/rides/' + id);
    const st = d.ride.status;
    if (['searching', 'accepted', 'arrived', 'ongoing'].includes(st)) S.activeTrip = '/trip/' + id; else if (S.activeTrip === '/trip/' + id) S.activeTrip = null;
    last = st; celebrateChange(prev, st);
    // only repaint the panel when something visible changed (polling must never wipe a half-typed review)
    const sig = JSON.stringify([st, d.ride.payment_status, d.ride.gear_confirmed, d.reviewed, d.rider?.id, d.ride.start_pin]);
    if (sig !== lastSig) { lastSig = sig; draw(); }
    drawMapMarkers(); drawRoute();
  };

  on('ride:update', (e) => { if (!e.id || e.id === id) load().catch(() => {}); });
  const un = on('track', (t) => {
    if (t.kind !== 'ride' || t.id !== id || !d) return;
    d.rider = { ...(d.rider || {}), lat: t.lat, lng: t.lng };
    map.marker('rider', { lat: t.lat, lng: t.lng, type: d.ride.vehicle_type });
    drawRoute();
  });
  onLeave(un);
  pollT = setInterval(() => load().catch(() => {}), 9000); onLeave(() => clearInterval(pollT));

  actions(el, {
    cancel: async () => { if (await confirmSheet('Cancel this ride?', 'Your rider will be told straight away.', 'Yes, cancel', true)) { await POST(`/rides/${id}/cancel`, { reason: 'Cancelled by customer' }); S.activeTrip = null; await load(); } },
    retry: async () => { await POST(`/rides/${id}/retry`); await load(); },
    star: (b) => { rating = +b.dataset.n; $$('#stars button', el).forEach((x) => { const on = +x.dataset.n <= rating; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(+x.dataset.n === rating)); }); },
    rate: async () => { await POST('/reviews', { kind: 'ride', ref_id: id, rating, comment: $('#cm', el).value }); toast('Thanks for your feedback!', 'ok'); await load(); },
    pay: async () => { const c = await POST('/payments/init', { kind: 'ride', id }); location.href = c.authorization_url; },
    share: async () => {
      const rd = d.rider; const text = `I'm on a RiderGo ${d.ride.vehicle_type === 'motor' ? 'motorbike' : 'car'} ride with ${rd?.name || 'my rider'}${rd?.plate ? ' (' + rd.plate + ')' : ''} to ${shortAddr(d.ride.drop_addr)}.`;
      try { if (navigator.share) await navigator.share({ title: 'My RiderGo trip', text }); else { await navigator.clipboard.writeText(text); toast('Trip details copied', 'ok'); } } catch { /* cancelled */ }
    },
    sos: async () => {
      if (!(await confirmSheet('Send an SOS alert?', 'We will alert RiderGo safety with your live location. In immediate danger, call 112.', 'Send SOS', true))) return;
      const p = S.pos || {}; const r = await POST(`/rides/${id}/sos`, { lat: p.lat, lng: p.lng }); toast(r.message, 'ok', 7000);
    },
    report: () => {
      sheet(html`<h3>Report a problem</h3><p class="muted small">Our safety team reviews every report.</p>
        <form id="rf"><div class="col gap-s">${REPORT_REASONS.map((x, i) => html`<label class="opt"><input type="radio" name="reason" value="${x}" ${i === 0 ? raw('checked') : ''}> ${x}</label>`)}</div>
        <textarea class="input mt-s" name="details" placeholder="Tell us more (optional)" maxlength="400"></textarea><button class="btn block mt-s" type="submit">Send report</button></form>`, {
        onMount: (w, close) => onSubmit(w, '#rf', async (f) => { const r = await POST('/reports', { kind: 'ride', ref_id: id, reason: f.reason, details: f.details }); toast(r.message, 'ok', 5000); close(); }) });
    },
  });

  try { await load(); } catch (e) { $('#panel', el).innerHTML = html`<div class="empty"><span class="art">⚠️</span><h3>Could not open this trip</h3><p>${e.message}</p><a class="btn" href="#/">Back home</a></div>`.s; }
}
