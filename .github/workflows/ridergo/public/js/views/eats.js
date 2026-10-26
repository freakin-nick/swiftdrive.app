// Customer food / shop flow: discover vendors, menu + basket, checkout, live order tracking.
import { S, GET, POST, DEL, html, raw, $, $$, icon, money, km, emoji, actions, onSubmit, on, onLeave, toast, celebrate, sheet, confirmSheet, getPos, shortAddr, tel, saveBasket, debounce, when, stars } from '../core.js';
import { layout, bell, avatar, topbar } from '../shell.js';
import { createMap } from '../map.js';
import { pickPlace, currentPlace } from '../picker.js';
import { vendorCard, ratingBadge, orderBadge, orderLabel, empty, skeletons } from '../components.js';

const CATS = [['', 'All'], ['food', '🍲 Food'], ['grocery', '🥬 Grocery'], ['convenience', '🛍️ Essentials']];
const basketCount = () => (S.basket ? Object.values(S.basket.items).reduce((n, i) => n + i.qty, 0) : 0);
const basketTotal = () => (S.basket ? Object.values(S.basket.items).reduce((n, i) => n + i.qty * i.price, 0) : 0);

// ---------------------------------------------------------------- discover
export async function list({ query }) {
  const st = { q: query.q || '', category: query.category || '', sort: query.sort || 'rating', view: 'list', favorites: false };
  const el = layout(html`<div class="page">
    ${topbar('Food & shops', { right: bell() })}
    <label class="search-box">${icon('search', 18)}<input class="input" id="q" type="search" value="${st.q}" placeholder="Search vendors or dishes (e.g. jollof)" aria-label="Search vendors or dishes" autocomplete="off"></label>
    <div class="chips mt-s" id="cats"></div>
    <div class="row gap mt-s"><div class="seg tabs grow" id="sorts"></div><button class="icon-btn" id="vt" data-act="view" aria-label="Toggle map view">${icon('map')}</button></div>
    <div id="mapwrap" class="hide mt-s"><div id="vm" class="mapbox short"></div></div>
    <div id="res" class="mt">${skeletons(4)}</div></div>`, { nav: 'services' });
  let map = null, pos = await getPos(), seq = 0;
  const drawChips = () => {
    $('#cats', el).innerHTML = CATS.map(([v, l]) => html`<button class="chip ${st.category === v ? 'on' : ''}" data-act="cat" data-v="${v}">${l}</button>`).join('') + html`<button class="chip ${st.favorites ? 'on' : ''}" data-act="favs">${icon('heart', 14)} Favourites</button>`.s;
    $('#sorts', el).innerHTML = [['rating', 'Top rated'], ['distance', 'Nearest'], ['popular', 'Popular']].map(([v, l]) => html`<button class="${st.sort === v ? 'on' : ''}" data-act="sort" data-v="${v}">${l}</button>`.s).join('');
  };
  const load = async () => {
    const my = ++seq; drawChips();
    const p = new URLSearchParams({ lat: pos.lat, lng: pos.lng, sort: st.sort, radius: 25 });
    if (st.q) p.set('q', st.q); if (st.category) p.set('category', st.category); if (st.favorites) p.set('favorites', '1');
    let rows;
    try { rows = await GET('/vendors?' + p); } catch (e) { $('#res', el).innerHTML = html`<div class="alert red">${e.message}</div>`.s; return; }
    if (my !== seq) return;
    $('#res', el).innerHTML = rows.length
      ? (st.sort === 'rating' && !st.q ? html`<p class="muted small mb">Best rated near you first</p>` : '').s + rows.map((v) => vendorCard(v).s).join('')
      : empty('🔍', st.q ? `No results for “${st.q}”` : 'No vendors here yet', st.q ? 'Try another dish or vendor name.' : 'Vendors who join RiderGo around you will appear here.').s;
    if (st.view === 'map') drawMap(rows);
  };
  const drawMap = (rows) => {
    if (!map) { map = createMap($('#vm', el), { center: pos, zoom: 13 }); onLeave(() => map.destroy && map.destroy()); }
    map.clearMarkers('v:'); map.marker('me', { ...pos, type: 'me' });
    rows.forEach((v) => map.marker('v:' + v.id, { lat: v.lat, lng: v.lng, type: v.category, label: v.name, onClick: () => { location.hash = '#/vendor/' + v.id; } }));
    map.fit([pos, ...rows.map((v) => ({ lat: v.lat, lng: v.lng }))], 40); setTimeout(() => map.resize(), 100);
  };
  const search = debounce(() => { st.q = $('#q', el).value.trim(); load(); }, 320);
  $('#q', el).addEventListener('input', search);
  actions(el, {
    cat: (b) => { st.category = b.dataset.v; load(); }, sort: (b) => { st.sort = b.dataset.v; load(); }, favs: () => { st.favorites = !st.favorites; load(); },
    view: () => { st.view = st.view === 'list' ? 'map' : 'list'; $('#mapwrap', el).classList.toggle('hide', st.view !== 'map'); if (st.view === 'map') load(); },
  });
  load();
}

// ---------------------------------------------------------------- vendor page + basket
export async function vendorPage({ params }) {
  const id = +params.id; const pos = await getPos();
  const el = layout(html`<div class="page nopad"><div class="skeleton" style="margin:18px"></div></div>`);
  let data;
  try { data = await GET(`/vendors/${id}?lat=${pos.lat}&lng=${pos.lng}`); } catch (e) { layout(html`<div class="page">${topbar('Vendor')}<div class="alert red">${e.message}</div></div>`); return; }
  const v = data.vendor; const sections = {};
  data.menu.forEach((m) => (sections[m.section || 'Menu'] ||= []).push(m));
  const qty = (mid) => S.basket?.vendor_id === id ? (S.basket.items[mid]?.qty || 0) : 0;

  const drawBar = () => {
    const n = basketCount(); const bar = $('#bbar');
    if (S.basket?.vendor_id === id && n) bar.innerHTML = html`<a class="btn" href="#/checkout"><span>${icon('bag', 20)} View basket · ${n} item${n > 1 ? 's' : ''}</span><b>${money(basketTotal())}</b></a>`.s; else bar.innerHTML = '';
  };
  const dishRow = (m) => { const q = qty(m.id); return html`<div class="dish" data-m="${m.id}"><span class="img">${m.image ? html`<img src="${m.image}" alt="" loading="lazy">` : emoji(v.category)}</span><span class="grow"><b>${m.name}</b><small class="muted block">${m.description || ''}</small><b class="price">${money(m.price)}</b></span>${v.open ? (q ? html`<span class="stepper"><button data-act="dec" data-id="${m.id}" aria-label="Remove one ${m.name}">${icon('minus', 16)}</button><b>${q}</b><button data-act="inc" data-id="${m.id}" aria-label="Add one ${m.name}">${icon('plus', 16)}</button></span>` : html`<button class="add-btn" data-act="inc" data-id="${m.id}" aria-label="Add ${m.name}">${icon('plus', 18)}</button>`) : ''}</div>`; };

  layout(html`<div class="page nopad">
    <div class="v-hero">${v.cover || v.logo ? html`<img src="${v.cover || v.logo}" alt="">` : emoji(v.category)}<a class="icon-btn" href="javascript:history.back()" aria-label="Back">${icon('back')}</a><button class="icon-btn fav" data-act="fav" aria-label="Favourite" aria-pressed="${v.favorite}">${icon('heart')}</button></div>
    <div class="inner">
      <div class="card v-head"><h1>${v.name}</h1>
        <div class="row gap-s wrap small mt-s">${ratingBadge(v)} <span class="muted">· ${v.cuisine || v.category}</span> <span class="muted">· ${km(v.distance_km)}</span></div>
        <div class="row gap-s wrap mt-s">${v.open ? html`<span class="badge green">Open</span>` : html`<span class="badge gray">Closed</span>`}<span class="badge navy">${icon('clock', 13)} ${v.prep_minutes}–${v.prep_minutes + 10} min</span>${v.delivers ? html`<span class="badge navy">${icon('motor', 13)} Delivery · up to ${v.max_delivery_km} km</span>` : html`<span class="badge amber">Pickup only</span>`}${v.min_order > 0 ? html`<span class="badge">Min ${money(v.min_order)}</span>` : ''}</div>
        ${v.description ? html`<p class="muted small mt-s">${v.description}</p>` : ''}<p class="muted xs">${icon('pin', 13)} ${v.address || ''}</p></div>
      ${!v.open ? html`<div class="alert mt">${v.name} is closed right now. You can browse the menu but can't order.</div>` : ''}
      ${Object.entries(sections).map(([name, items]) => html`<section class="section"><h3>${name}</h3><div class="card flat mt-s">${items.map(dishRow)}</div></section>`)}
      ${data.reviews.length ? html`<section class="section"><h3>Reviews</h3>${data.reviews.map((r) => html`<div class="card flat mt-s"><div class="row between"><b>${r.name.split(' ')[0]}</b><span class="stars">${stars(r.rating)}</span></div>${r.comment ? html`<p class="small muted">${r.comment}</p>` : ''}</div>`)}</section>` : ''}
    </div><div class="basket-bar" id="bbar"></div></div>`);
  const root = $('#app');
  drawBar();
  const bump = async (mid, delta) => {
    const m = data.menu.find((x) => x.id === +mid);
    if (S.basket && S.basket.vendor_id !== id && basketCount() && delta > 0) {
      if (!(await confirmSheet('Start a new basket?', `Your basket has items from ${S.basket.vendor_name}. Adding this clears it.`, 'Start new'))) return;
      S.basket = null;
    }
    if (!S.basket || S.basket.vendor_id !== id) S.basket = { vendor_id: id, vendor_name: v.name, items: {} };
    const it = (S.basket.items[m.id] ||= { id: m.id, name: m.name, price: m.price, qty: 0 });
    it.qty = Math.max(0, it.qty + delta); if (!it.qty) delete S.basket.items[m.id];
    saveBasket();
    const row = $(`.dish[data-m="${m.id}"]`, root); row.outerHTML = dishRow(m).s; drawBar();
  };
  actions(root, {
    inc: (b) => bump(b.dataset.id, 1), dec: (b) => bump(b.dataset.id, -1),
    fav: async (b) => { if (!S.me) return; const r = await POST('/favorites/' + id); b.setAttribute('aria-pressed', r.favorite); toast(r.favorite ? 'Added to favourites' : 'Removed from favourites', 'ok'); },
  });
}

// ---------------------------------------------------------------- checkout
export async function checkout() {
  if (!S.basket || !basketCount()) { location.hash = '#/eats'; return; }
  const st = { fulfilment: 'delivery', dest: null, payment: 'paystack', promo: '', notes: '', quote: null, vendor: null };
  const el = layout(html`<div class="page">${topbar('Checkout')}<div id="co"><div class="skeleton"></div><div class="skeleton"></div></div></div>`);
  const pos = await getPos();
  try { st.vendor = (await GET(`/vendors/${S.basket.vendor_id}?lat=${pos.lat}&lng=${pos.lng}`)).vendor; } catch (e) { $('#co', el).innerHTML = html`<div class="alert red">${e.message}</div>`.s; return; }
  if (!st.vendor.delivers) st.fulfilment = 'pickup';
  const root = $('#app');
  let seq = 0;
  const items = () => Object.values(S.basket.items).map((i) => ({ id: i.id, qty: i.qty }));

  const getQuote = async () => {
    const my = ++seq; st.quote = null; st.err = null; draw();
    if (st.fulfilment === 'delivery' && !st.dest) return;
    try { const q = await POST('/orders/quote', { vendor_id: S.basket.vendor_id, items: items(), fulfilment: st.fulfilment, dest: st.dest ? { lat: st.dest.lat, lng: st.dest.lng } : undefined, promo: st.promo || undefined }); if (my === seq) st.quote = q; }
    catch (e) { if (my === seq) st.err = e.message; }
    if (my === seq) draw();
  };
  const draw = () => {
    const q = st.quote; const v = st.vendor; const lines = Object.values(S.basket.items);
    $('#co', root).innerHTML = html`
      <div class="card flat"><div class="row gap"><span class="v-thumb sm">${v.logo ? html`<img src="${v.logo}" alt="">` : emoji(v.category)}</span><div class="grow"><b>${v.name}</b><small class="muted block">${v.address || ''}</small></div><a class="btn ghost sm" href="#/vendor/${v.id}">Add items</a></div>
        <hr class="hr">${lines.map((i) => html`<div class="row between gap line"><span class="grow">${i.name}</span><span class="stepper"><button data-act="dec" data-id="${i.id}" aria-label="Remove one ${i.name}">${icon('minus', 14)}</button><b>${i.qty}</b><button data-act="inc" data-id="${i.id}" aria-label="Add one ${i.name}">${icon('plus', 14)}</button></span><b class="w-price">${money(i.price * i.qty)}</b></div>`)}</div>
      <div class="seg tabs mt" role="radiogroup" aria-label="Fulfilment">${v.delivers ? html`<button class="${st.fulfilment === 'delivery' ? 'on' : ''}" data-act="ful" data-v="delivery">${icon('motor', 18)} Delivery</button>` : ''}<button class="${st.fulfilment === 'pickup' ? 'on' : ''}" data-act="ful" data-v="pickup">${icon('bag', 18)} Pickup</button></div>
      ${st.fulfilment === 'delivery' ? html`<button class="route-line card flat mt-s" data-act="dest"><i class="dot sq"></i><span class="grow"><span class="lbl">Deliver to</span><span class="val ${st.dest ? '' : 'ph'}">${st.dest ? shortAddr(st.dest.address) : 'Choose delivery address'}</span></span>${icon('chev')}</button>`
        : html`<div class="alert green mt-s">${icon('pin', 20)}<span>Collect at <b>${v.address}</b>. You'll get a pickup code when it's ready.</span></div>`}
      <label class="field mt-s"><span>Note for the vendor (optional)</span><input class="input" id="nt" maxlength="200" value="${st.notes}" placeholder="No pepper, extra shito…"></label>
      <form id="pf" class="promo-row"><input class="input" name="promo" placeholder="Promo code" value="${st.promo}" autocomplete="off" aria-label="Promo code"><button class="btn ghost sm" type="submit">Apply</button></form>
      <h4 class="mt">Payment</h4>
      <div class="pay-opts mt-s" role="radiogroup" aria-label="Payment method">
        <button class="veh-opt ${st.payment === 'paystack' ? 'on' : ''}" data-act="payopt" data-v="paystack" role="radio" aria-checked="${st.payment === 'paystack'}"><span class="art">${icon('card', 28)}</span><span class="grow"><b>Pay online with Paystack</b><s>Card or Mobile Money · vendor starts cooking once paid</s></span></button>
        <button class="veh-opt ${st.payment === 'cash' ? 'on' : ''}" data-act="payopt" data-v="cash" role="radio" aria-checked="${st.payment === 'cash'}"><span class="art">${icon('wallet', 28)}</span><span class="grow"><b>Pay cash on ${st.fulfilment === 'delivery' ? 'delivery' : 'pickup'}</b><s>Have the exact amount ready</s></span></button></div>
      <div class="card mt summary">
        ${st.err ? html`<div class="alert red">${st.err}</div>` : !q ? (st.fulfilment === 'delivery' && !st.dest ? html`<p class="muted center">Choose where to deliver to see the exact delivery fee.</p>` : html`<div class="skeleton" style="height:90px"></div>`) : html`
          <div class="row between"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
          ${q.fulfilment === 'delivery' ? html`<div class="row between"><span>Delivery <small class="muted">(${km(q.distance_km)} by road${q.approx ? ', estimated' : ''})</small></span><span>${money(q.delivery_fee)}</span></div>` : ''}
          ${q.discount > 0 ? html`<div class="row between green-t"><span>Promo</span><span>−${money(q.discount)}</span></div>` : ''}
          ${q.promo_error ? html`<p class="xs red-t">${q.promo_error}</p>` : ''}
          <hr class="hr"><div class="row between total"><b>Total</b><b>${money(q.total)}</b></div>
          <p class="xs muted mt-s">${icon('shield', 14)} Delivery price is calculated from the real road distance. It can't be changed by anyone.</p>`}
      </div>
      <button class="btn block mt" data-act="place" ${q ? '' : raw('disabled')}>${q ? (st.payment === 'paystack' ? `Pay ${money(q.total)}` : `Place order · ${money(q.total)}`) : 'Place order'}</button>`.s;
    const pf = $('#pf', root); if (pf) onSubmit(root, pf, async (d) => { st.promo = String(d.promo || '').trim().toUpperCase(); await getQuote(); if (st.promo && st.quote && !st.quote.promo_error) toast('Promo applied', 'ok'); });
    const nt = $('#nt', root); if (nt) nt.addEventListener('input', () => { st.notes = nt.value; });
  };
  const bump = async (id, delta) => {
    const it = S.basket.items[id]; if (!it) return; it.qty += delta; if (it.qty <= 0) delete S.basket.items[id]; saveBasket();
    if (!basketCount()) { S.basket = null; saveBasket(); location.hash = '#/eats'; return; }
    await getQuote();
  };
  actions(root, {
    inc: (b) => bump(b.dataset.id, 1), dec: (b) => bump(b.dataset.id, -1),
    ful: (b) => { st.fulfilment = b.dataset.v; if (st.fulfilment === 'pickup' && st.payment === 'paystack') { /* keep */ } getQuote(); },
    payopt: (b) => { st.payment = b.dataset.v; draw(); },
    dest: async () => { const p = await pickPlace({ title: 'Deliver to', near: pos }); if (p) { st.dest = p; await getQuote(); } },
    place: async () => {
      const q = st.quote; if (!q) return;
      const r = await POST('/orders', { vendor_id: S.basket.vendor_id, items: items(), fulfilment: st.fulfilment, dest: st.dest ? { lat: st.dest.lat, lng: st.dest.lng } : undefined, dest_addr: st.dest?.address, promo: st.promo || undefined, notes: st.notes, payment_method: st.payment });
      S.basket = null; saveBasket();
      if (r.checkout) { location.href = r.checkout.authorization_url; return; }
      toast('Order sent to the vendor', 'ok'); location.hash = '#/order/' + r.id;
    },
  });
  draw();
  if (st.fulfilment === 'delivery') { try { st.dest = await currentPlace(); } catch { /* user can choose */ } }
  getQuote();
}

// ---------------------------------------------------------------- order tracking
export async function order({ params }) {
  const id = +params.id;
  const el = layout(html`<div class="page">${topbar('Your order', { right: bell() })}<div id="ob"><div class="skeleton"></div><div class="skeleton"></div></div></div>`);
  const root = $('#app');
  let d = null, prev = null, map = null, rating = 5, rrating = 5, routeDone = false, lastSig = '';

  const steps = (o) => {
    const dl = o.fulfilment === 'delivery'; const s = o.status; const ds = o.delivery_status;
    const after = (...a) => a.includes(s);
    const list = [['Order placed', s !== 'pending_payment'], ['Approved by vendor', after('accepted', 'preparing', 'ready', 'out_for_delivery', 'completed')], ['Being prepared', after('preparing', 'ready', 'out_for_delivery', 'completed')]];
    if (dl) list.push(['Rider assigned', ['assigned', 'picked_up', 'arrived'].includes(ds) || s === 'completed'], ['On the way', after('out_for_delivery', 'completed')], ['Delivered', s === 'completed']);
    else list.push(['Ready for pickup', after('ready', 'completed')], ['Collected', s === 'completed']);
    return list;
  };
  const celebrateChange = () => {
    if (!prev) return; const o = d.order;
    if (prev.status !== o.status) {
      if (o.status === 'accepted') celebrate('Order approved!', `${d.vendor.name} accepted your order.`, 'check');
      else if (o.status === 'ready' && o.fulfilment === 'pickup') celebrate('Ready for pickup!', `Show code ${o.delivery_pin} at ${d.vendor.name}.`, 'bag');
      else if (o.status === 'completed') celebrate(o.fulfilment === 'delivery' ? 'Delivered!' : 'Collected!', 'Enjoy your order. Please rate it.', 'check');
    }
    if (prev.delivery_status !== o.delivery_status) {
      if (o.delivery_status === 'assigned') celebrate('Rider assigned', `${d.rider?.name || 'A rider'} will deliver your order. Your code: ${o.delivery_pin}`, 'motor');
      else if (o.delivery_status === 'picked_up') celebrate('On the way!', 'Your rider has picked up your order.', 'motor');
      else if (o.delivery_status === 'arrived') celebrate('Your order has arrived', 'Please go and pick it up. Give your code to the rider.', 'pin');
    }
  };

  const draw = () => {
    const o = d.order; const [label, , ic] = orderLabel(o); const closed = ['completed', 'cancelled', 'rejected'].includes(o.status);
    const showCode = o.delivery_pin && !closed && ((o.fulfilment === 'delivery' && ['assigned', 'picked_up', 'arrived'].includes(o.delivery_status)) || (o.fulfilment === 'pickup' && o.status === 'ready'));
    const live = o.fulfilment === 'delivery' && !closed && o.rider;
    $('#ob', root).innerHTML = html`
      <div class="card status-card"><span class="st-ic">${icon(ic, 26)}</span><div class="grow"><small class="muted">Order ${o.code}</small><h3>${label}</h3><small class="muted">${d.vendor.name}</small></div></div>
      ${o.fulfilment === 'delivery' && !['cancelled', 'rejected', 'pending_payment'].includes(o.status) ? html`<div class="card flat mt-s nopad-c"><div id="om" class="mapbox short"></div></div>` : ''}
      ${o.status === 'pending_payment' ? html`<div class="alert mt">${icon('wallet', 20)}<span>Your order is waiting for payment. The vendor sees it once you've paid.<br><button class="btn sm" data-act="pay">Pay ${money(o.total)} with Paystack</button></span></div>` : ''}
      ${showCode ? html`<div class="code-card mt"><small>${o.fulfilment === 'delivery' ? 'Your delivery code' : 'Your pickup code'}</small><div class="digits" aria-label="Code ${o.delivery_pin}">${o.delivery_pin}</div><small>${o.fulfilment === 'delivery' ? 'Tell this code to the rider when they arrive. Only then is the order handed over.' : `Show this code at ${d.vendor.name} to collect your order.`}</small></div>` : ''}
      ${d.rider && !closed ? html`<div class="card flat rider-card row gap mt-s">${avatar({ name: d.rider.name, role: 'rider', vehicle_type: 'motor', avatar: d.rider.avatar })}<div class="grow"><b>${d.rider.name}</b> <span class="rate">${icon('star', 13)} ${d.rider.rating || 'New'}</span><small class="muted block">${d.rider.vehicle_make || 'Motorbike'}</small></div><div class="plate">${d.rider.plate || '—'}</div><a class="icon-btn" href="${tel(d.rider.phone)}" aria-label="Call rider">${icon('phone', 20)}</a></div>` : ''}
      <div class="card mt"><ul class="tl">${(() => { let nowSet = false; return steps(o).map(([t, done]) => { const now = !done && !nowSet && !['cancelled', 'rejected', 'pending_payment'].includes(o.status); if (now) nowSet = true; return html`<li class="${done ? 'done' : now ? 'now' : ''}"><i>${done ? icon('check', 12) : ''}</i>${t}</li>`; }); })()}</ul>
        ${['cancelled', 'rejected'].includes(o.status) ? html`<div class="alert red">${o.status === 'rejected' ? 'The vendor could not take this order.' : 'This order was cancelled.'} ${o.payment_status === 'refunded' ? 'You have been refunded.' : ''}</div>` : ''}</div>
      <div class="card mt"><b>Order summary</b>${d.items.map((i) => html`<div class="row between small mt-s"><span>${i.qty} × ${i.name}</span><span>${money(i.qty * i.price)}</span></div>`)}<hr class="hr">
        <div class="row between small"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
        ${o.fulfilment === 'delivery' ? html`<div class="row between small"><span>Delivery (${km(o.distance_km)})</span><span>${money(o.delivery_fee)}</span></div>` : ''}
        ${o.discount > 0 ? html`<div class="row between small green-t"><span>Promo ${o.promo_code || ''}</span><span>−${money(o.discount)}</span></div>` : ''}
        <div class="row between mt-s"><b>Total</b><b>${money(o.total)}</b></div>
        <small class="muted">${o.payment_status === 'paid' ? 'Paid with Paystack ✓' : o.payment_method === 'cash' ? `Pay cash on ${o.fulfilment === 'delivery' ? 'delivery' : 'pickup'}` : 'Awaiting payment'}</small>
        ${o.dest_addr ? html`<p class="small muted mt-s">${icon('pin', 14)} ${shortAddr(o.dest_addr)}</p>` : ''}</div>
      ${o.status === 'completed' ? (d.reviewed ? html`<div class="alert green mt">Thanks for rating your order.</div>` : html`<div class="card mt"><h4 class="center">How was ${d.vendor.name}?</h4>
          <div class="star-input" data-g="v" role="radiogroup" aria-label="Rate vendor">${[1, 2, 3, 4, 5].map((n) => html`<button data-act="star" data-g="v" data-n="${n}" class="${n <= rating ? 'on' : ''}" aria-label="${n} stars">${icon('star', 32)}</button>`)}</div>
          ${d.rider ? html`<h4 class="center">And ${d.rider.name.split(' ')[0]}'s delivery?</h4><div class="star-input" data-g="r" role="radiogroup" aria-label="Rate rider">${[1, 2, 3, 4, 5].map((n) => html`<button data-act="star" data-g="r" data-n="${n}" class="${n <= rrating ? 'on' : ''}" aria-label="${n} stars">${icon('star', 32)}</button>`)}</div>` : ''}
          <textarea class="input" id="cm" maxlength="300" placeholder="Leave a comment (optional)"></textarea><button class="btn block mt-s" data-act="rate">Submit rating</button></div>`) : ''}
      <div class="row gap mt">${['pending_payment', 'placed'].includes(o.status) ? html`<button class="btn danger grow" data-act="cancel">Cancel order</button>` : ''}${d.rider && o.rider_id ? html`<button class="btn ghost grow" data-act="report">Report rider</button>` : ''}<a class="btn ghost grow" href="${tel(d.vendor.phone)}">${icon('phone', 18)} Call vendor</a></div>`.s;
    if ($('#om', root)) drawMap();
  };
  const drawMap = () => {
    const o = d.order; const v = d.vendor;
    if (!map || !map.alive) { map = createMap($('#om', root), { center: { lat: v.lat, lng: v.lng }, zoom: 14 }); map.alive = true; routeDone = false; }
    map.marker('v', { lat: v.lat, lng: v.lng, type: 'food', label: v.name });
    if (o.dest_lat != null) map.marker('d', { lat: o.dest_lat, lng: o.dest_lng, type: 'drop' });
    if (d.rider?.lat != null) map.marker('rider', { lat: d.rider.lat, lng: d.rider.lng, type: 'motor' }); else map.remove('rider');
    const pts = [{ lat: v.lat, lng: v.lng }, o.dest_lat != null && { lat: o.dest_lat, lng: o.dest_lng }, d.rider?.lat != null && { lat: d.rider.lat, lng: d.rider.lng }];
    map.fit(pts, 50);
    if (!routeDone && o.dest_lat != null) { routeDone = true; POST('/geo/route', { from: { lat: v.lat, lng: v.lng }, to: { lat: o.dest_lat, lng: o.dest_lng } }).then((g) => map.route(g.geometry)).catch(() => {}); }
  };
  const load = async () => {
    const nd = await GET('/orders/' + id); prev = d && { status: d.order.status, delivery_status: d.order.delivery_status }; d = nd; celebrateChange();
    const sig = JSON.stringify([d.order.status, d.order.delivery_status, d.order.payment_status, d.order.delivery_pin, d.reviewed, d.rider?.id]);
    if (sig !== lastSig) { if (map) { map.destroy && map.destroy(); map = null; } lastSig = sig; draw(); } else if (map && d.rider?.lat != null) map.marker('rider', { lat: d.rider.lat, lng: d.rider.lng, type: 'motor' });
  };
  on('order:update', (e) => { if (!e.id || e.id === id) load().catch(() => {}); });
  onLeave(on('track', (t) => { if (t.kind === 'order' && t.id === id && d) { d.rider = { ...(d.rider || {}), lat: t.lat, lng: t.lng }; if (map) map.marker('rider', { lat: t.lat, lng: t.lng, type: 'motor' }); } }));
  const poll = setInterval(() => load().catch(() => {}), 9000); onLeave(() => { clearInterval(poll); if (map && map.destroy) map.destroy(); });
  actions(root, {
    pay: async () => { const c = await POST('/payments/init', { kind: 'order', id }); location.href = c.authorization_url; },
    cancel: async () => { if (await confirmSheet('Cancel this order?', 'If you already paid you will be refunded.', 'Yes, cancel', true)) { await POST(`/orders/${id}/cancel`, {}); await load(); } },
    star: (b) => { const g = b.dataset.g, n = +b.dataset.n; if (g === 'v') rating = n; else rrating = n; $$(`.star-input[data-g="${g}"] button`, root).forEach((x) => x.classList.toggle('on', +x.dataset.n <= n)); },
    rate: async () => { await POST('/reviews', { kind: 'order', ref_id: id, rating, rider_rating: d.rider ? rrating : undefined, comment: $('#cm', root).value }); toast('Thanks for your feedback!', 'ok'); await load(); },
    report: () => sheet(html`<h3>Report the rider</h3><form id="rf"><textarea class="input" name="details" placeholder="What happened?" maxlength="400" required></textarea><button class="btn block mt-s" type="submit">Send report</button></form>`, {
      onMount: (w, close) => onSubmit(w, '#rf', async (f) => { const r = await POST('/reports', { kind: 'order', ref_id: id, reason: 'Delivery problem', details: f.details }); toast(r.message, 'ok'); close(); }) }),
  });
  try { await load(); } catch (e) { $('#ob', root).innerHTML = html`<div class="alert red">${e.message}</div>`.s; }
}
