// Customer: home, services, activity.
import { S, GET, html, raw, $, $$, icon, money, km, actions, getPos, shortAddr, reverse, when, esc } from '../core.js';
import { layout, bell } from '../shell.js';
import { vendorCard, orderBadge, rideBadge, empty, skeletons } from '../components.js';

let homeTab = 'rides';

export async function home() {
  const u = S.me.user;
  const draw = () => {
    layout(html`<div class="page home">
      <header class="hello"><div class="grow"><h1>Hello, <em>${u.name.split(' ')[0]}</em></h1><span class="muted small">Your ride, your way</span></div>${bell()}</header>
      <div id="live"></div>
      <div class="seg" role="tablist"><button role="tab" class="${homeTab === 'rides' ? 'on' : ''}" data-act="tab" data-t="rides" aria-selected="${homeTab === 'rides'}">${icon('motor', 20)} Rides</button><button role="tab" class="${homeTab === 'eats' ? 'on' : ''}" data-act="tab" data-t="eats" aria-selected="${homeTab === 'eats'}">${icon('bag', 20)} Eats</button></div>
      ${homeTab === 'rides' ? html`
        <div class="card route-card mt">
          <a class="route-line" href="#/ride"><i class="dot"></i><span class="grow"><span class="lbl">From</span><span class="val" id="from">Current location</span></span>${icon('target', 22)}</a>
          <a class="route-line" href="#/ride?focus=drop"><i class="dot sq"></i><span class="grow"><span class="lbl">Where to?</span><span class="val ph">Search destination</span></span>${icon('search', 20)}</a>
          <div class="route-foot"><span class="row gap-s small">${icon('clock', 18)} Now</span><a class="go-btn" href="#/ride?focus=drop" aria-label="Book a ride">${icon('arrow', 22)}</a></div>
        </div>`
      : html`
        <div class="card route-card mt">
          <form id="eq" class="row gap" role="search"><label class="search-box grow">${icon('search', 18)}<input class="input" name="q" placeholder="Search food, shops or a vendor" aria-label="Search food and vendors"></label><button class="go-btn" type="submit" aria-label="Search">${icon('arrow', 22)}</button></form>
          <div class="chips mt-s"><a class="chip" href="#/eats?category=food">🍲 Food</a><a class="chip" href="#/eats?category=grocery">🥬 Groceries</a><a class="chip" href="#/eats?category=convenience">🛍️ Essentials</a><a class="chip" href="#/eats?sort=rating">⭐ Top rated</a></div>
        </div>`}

      <section class="section"><div class="section-h"><h3>Suggestions</h3><a href="#/services">View all →</a></div>
        <div class="tiles">
          <a class="tile" href="#/ride?vehicle=motor"><span class="promo">Fast</span><span class="art"><span class="mark sm"></span></span>Motor</a>
          <a class="tile" href="#/ride?vehicle=car"><span class="art">🚗</span>Car</a>
          <a class="tile" href="#/eats?category=food"><span class="art">🍲</span>Food</a>
          <a class="tile" href="#/eats?category=grocery"><span class="art">🥬</span>Grocery</a>
        </div></section>
      <section class="section" id="offer"></section>
      <section class="section"><div class="section-h"><h3>Around you</h3></div><div class="live-count" id="around"><div class="card flat grow"><span class="pulse-dot"></span> Looking for riders…</div></div></section>
      <section class="section"><div class="section-h"><h3>Top rated vendors</h3><a href="#/eats">See all →</a></div><div id="vlist">${skeletons(3)}</div></section>
    </div>`, { nav: 'home' });
    wire();
  };
  const el = $('#app');
  const wire = () => {
    actions($('#app'), { tab: (b) => { homeTab = b.dataset.t; draw(); } });
    const f = $('#eq'); if (f) f.addEventListener('submit', (e) => { e.preventDefault(); const q = new FormData(f).get('q'); location.hash = '#/eats?q=' + encodeURIComponent(q || ''); });
    fill();
  };
  const fill = async () => {
    const promo = S.cfg.promos.find((p) => p.scope === 'order') || S.cfg.promos[0];
    if (promo && $('#offer')) $('#offer').innerHTML = html`<a class="offer" href="#/eats"><span class="grow"><small>Special offer</small><h2>${promo.percent}% OFF</h2><p>${promo.label || 'Use code ' + promo.code}<br><b>Code: ${promo.code}</b></p><span class="btn sm">Order now ${icon('arrow', 16)}</span></span><span class="art" aria-hidden="true">🛍️</span></a>`.s;
    const pos = await getPos();
    reverse(pos.lat, pos.lng).then((a) => { const f = $('#from'); if (f) f.textContent = shortAddr(a) || 'Current location'; });
    const [riders, vendors, orders, ride] = await Promise.allSettled([
      GET(`/riders/nearby?lat=${pos.lat}&lng=${pos.lng}`), GET(`/vendors?lat=${pos.lat}&lng=${pos.lng}&sort=rating`), GET('/orders'), GET('/rides/current'),
    ]);
    if (riders.value && $('#around')) { const m = riders.value.filter((r) => r.type === 'motor').length, c = riders.value.filter((r) => r.type === 'car').length; $('#around').innerHTML = html`<div class="card flat"><span class="mark sm"></span><span><span class="num">${m}</span><small class="muted block">motor riders online</small></span></div><div class="card flat"><span class="art-s">🚗</span><span><span class="num">${c}</span><small class="muted block">car drivers online</small></span></div>`.s; }
    if ($('#vlist')) $('#vlist').innerHTML = (vendors.value?.length ? vendors.value.slice(0, 4).map((v) => vendorCard(v).s).join('') : empty('🍽️', 'No vendors near you yet', 'Vendors who join RiderGo around you will appear here.').s);
    // live activity strip
    const live = [];
    if (ride.value?.ride && ['searching', 'accepted', 'arrived', 'ongoing'].includes(ride.value.ride.status)) { S.activeTrip = '/trip/' + ride.value.ride.id; live.push(html`<a class="card flat live-card" href="#/trip/${ride.value.ride.id}"><span class="pulse-dot"></span><span class="grow"><b>Your ride</b><small class="muted block">${ride.value.ride.drop_addr ? shortAddr(ride.value.ride.drop_addr) : ''}</small></span>${rideBadge(ride.value.ride.status)}</a>`); } else S.activeTrip = null;
    for (const o of (orders.value || []).filter((o) => !['completed', 'cancelled', 'rejected'].includes(o.status)).slice(0, 2)) live.push(html`<a class="card flat live-card" href="#/order/${o.id}"><span class="pulse-dot"></span><span class="grow"><b>${o.vendor_name}</b><small class="muted block">Order ${o.code}</small></span>${orderBadge(o)}</a>`);
    if (live.length && $('#live')) $('#live').innerHTML = live.map((l) => l.s).join('');
  };
  draw();
}

export function services() {
  const promo = S.cfg.promos.find((p) => p.scope !== 'order') || S.cfg.promos[0];
  layout(html`<div class="page">
    <header class="hello"><div class="grow"><small class="eyebrow">All services</small><h1>Services</h1><span class="muted small">One app, endless possibilities</span></div>${bell()}</header>
    <section><h3>Go anywhere</h3><p class="muted small">Your journey, your way</p>
      <div class="svc-grid mt-s">
        <a class="card svc" href="#/ride?vehicle=motor"><span class="svc-art"><span class="mark lg"></span></span><b>Motor ride</b><small class="muted">Fast · beats traffic</small><span class="svc-go">${icon('arrow', 16)}</span></a>
        <a class="card svc" href="#/ride?vehicle=car"><span class="svc-art">🚗</span><b>Car ride</b><small class="muted">Comfort · AC · bags</small><span class="svc-go">${icon('arrow', 16)}</span></a>
      </div></section>
    ${promo ? html`<a class="offer mt" href="#/ride"><span class="grow"><small>Special offer</small><h2>${promo.percent}% OFF</h2><p>${promo.label}<br><b>Code: ${promo.code}</b></p><span class="btn sm">Book now ${icon('arrow', 16)}</span></span><span class="art" aria-hidden="true">🏍️</span></a>` : ''}
    <section class="section"><h3>Get anything delivered</h3><p class="muted small">From essentials to indulgences</p>
      <div class="svc-grid three mt-s">
        <a class="card svc" href="#/eats?category=food"><span class="promo">Promo</span><span class="svc-art">🍲</span><b>Food</b><small class="muted">Tasty &amp; fresh</small></a>
        <a class="card svc" href="#/eats?category=grocery"><span class="svc-art">🥬</span><b>Grocery</b><small class="muted">Fresh &amp; quality</small></a>
        <a class="card svc" href="#/eats?category=convenience"><span class="promo">Promo</span><span class="svc-art">🛍️</span><b>Essentials</b><small class="muted">Daily needs</small></a>
      </div></section>
    <section class="section"><a class="card partner" href="#/join"><span class="pl-ic big">${icon('bike2', 26)}</span><span class="grow"><b>Earn with RiderGo</b><small class="muted block">Ride, drive or sell — with your own workspace.</small></span>${icon('chev')}</a></section>
  </div>`, { nav: 'services' });
}

export async function activity() {
  const role = S.me.user.role; const cust = role === 'customer';
  let tab = 'rides';
  const el = layout(html`<div class="page"><header class="hello"><div class="grow"><h1>Activity</h1><span class="muted small">Your trips and orders</span></div>${bell()}</header>
    <div class="seg tabs"><button class="on" data-act="t" data-t="rides">Rides</button><button data-act="t" data-t="orders">${cust ? 'Orders' : 'Deliveries'}</button></div>
    <div id="list" class="mt">${skeletons(4)}</div></div>`, { nav: cust ? 'activity' : null });
  const load = async () => {
    const box = $('#list'); box.innerHTML = skeletons(3).s;
    try {
      if (tab === 'rides') {
        const rows = await GET('/rides');
        box.innerHTML = rows.length ? rows.map((r) => html`<a class="card flat act-row" href="${cust ? '#/trip/' + r.id : '#/drive/ride/' + r.id}"><span class="act-ic">${r.vehicle_type === 'car' ? '🚗' : html`<span class="mark sm"></span>`}</span><span class="grow"><b>${shortAddr(r.drop_addr) || 'Ride'}</b><small class="muted block">${when(r.requested_at)} · ${km(r.distance_km)} · ${r.payment_method === 'cash' ? 'Cash' : 'Paystack'}</small></span><span class="right"><b>${money(r.fare)}</b><br>${rideBadge(r.status)}</span></a>`.s).join('') : empty('🏍️', 'No rides yet', 'Your trips will show up here.', html`<a class="btn mt" href="#/ride">Book a ride</a>`).s;
      } else {
        const rows = await GET(cust ? '/orders' : '/rider/orders');
        box.innerHTML = rows.length ? rows.map((o) => (cust
          ? html`<a class="card flat act-row" href="#/order/${o.id}"><span class="act-ic">🍲</span><span class="grow"><b>${o.vendor_name}</b><small class="muted block">${o.code} · ${when(o.created_at)}</small></span><span class="right"><b>${money(o.total)}</b><br>${orderBadge(o)}</span></a>`
          : html`<a class="card flat act-row" href="#/drive/order/${o.id}"><span class="act-ic">🍲</span><span class="grow"><b>${o.vendor}</b><small class="muted block">${o.code} · ${when(o.created_at)}</small></span><span class="right"><b>${money(o.delivery_fee)}</b><br>${orderBadge(o)}</span></a>`).s).join('') : empty('🍲', cust ? 'No orders yet' : 'No deliveries yet', cust ? 'Order from vendors near you.' : '', cust ? html`<a class="btn mt" href="#/eats">Browse food</a>` : '').s;
      }
    } catch (e) { box.innerHTML = html`<div class="alert red">${e.message}</div>`.s; }
  };
  actions(el, { t: (b) => { tab = b.dataset.t; $$('.seg button', el).forEach((x) => x.classList.toggle('on', x === b)); load(); } });
  load();
}
