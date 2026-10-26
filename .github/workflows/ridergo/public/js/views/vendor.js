// Food vendor workspace (a tenant): orders board, menu, own riders, shop profile.
import { S, GET, POST, PATCH, DEL, html, raw, $, $$, icon, money, km, emoji, actions, onSubmit, on, onLeave, toast, sheet, confirmSheet, uploadImage, shortAddr, when, ago, tel, loadMe } from '../core.js';
import { layout, bell, topbar, statusBadge } from '../shell.js';
import { pickPlace } from '../picker.js';
import { orderBadge, empty, skeletons, fmtDate } from '../components.js';

const W = { wide: true };
const subAlert = () => { const t = S.me.tenant; return t && !t.active ? html`<div class="alert red mb">${icon('shield', 22)}<span><b>${t.status === 'pending_payment' ? 'Subscribe to go live' : 'Your subscription has expired'}</b><br>Customers can't see or order from your shop until your monthly plan is paid.<br><a class="btn sm" href="#/billing">Choose a plan</a></span></div>` : ''; };

// ------------------------------------------------------------------ orders board
export async function orders() {
  await loadMe();
  const t = S.me.tenant; let scope = 'live', rows = [], prof = null, team = null, sig = '';
  const el = layout(html`<div class="page">
    <header class="hello"><span class="mark"></span><div class="grow"><h1>${t.name}</h1><span class="muted small">Orders &amp; kitchen</span></div><label class="open-switch"><span id="openl" class="small b">…</span><span class="switch"><input type="checkbox" id="open" aria-label="Shop open"><i></i></span></label>${bell()}</header>
    ${subAlert()}<div class="stats" id="stats"></div>
    <div class="seg tabs mt"><button class="on" data-act="scope" data-s="live">Live orders</button><button data-act="scope" data-s="history">History</button></div>
    <div id="board" class="mt">${skeletons(3)}</div></div>`, { nav: 'orders', ...W });
  const root = $('#app');
  const loadStats = async () => { try { const s = await GET('/vendor/stats'); $('#stats', root).innerHTML = html`<div class="stat"><div class="n">${s.pending}</div><div class="l">New orders</div></div><div class="stat"><div class="n">${s.today_orders}</div><div class="l">Delivered today</div></div><div class="stat"><div class="n">${money(s.today_sales)}</div><div class="l">Sales today</div></div><div class="stat"><div class="n">${s.rating_count ? s.rating.toFixed(1) + ' ★' : '–'}</div><div class="l">${s.rating_count} rating${s.rating_count === 1 ? '' : 's'}</div></div><div class="stat"><div class="n">${money(s.wallet)}</div><div class="l">Wallet</div></div>`.s; } catch { /* ignore */ } };
  GET('/vendor/profile').then((p) => { prof = p; const c = $('#open', root); c.checked = !!p.is_open; $('#openl', root).textContent = p.is_open ? 'Open' : 'Closed'; });
  $('#open', root).addEventListener('change', async (e) => { try { await PATCH('/vendor/profile', { is_open: e.target.checked }); $('#openl', root).textContent = e.target.checked ? 'Open' : 'Closed'; toast(e.target.checked ? 'Shop is open for orders' : 'Shop is closed', 'ok'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); } });

  const dlv = (o) => {
    if (o.fulfilment !== 'delivery') return '';
    const ds = o.delivery_status;
    if (['assigned', 'picked_up', 'arrived'].includes(ds)) return html`<div class="rider-line">${icon('motor', 18)} <span class="grow"><b>${o.rider_name || 'Rider'}</b> · ${{ assigned: 'on the way to you', picked_up: 'out for delivery', arrived: 'at the customer' }[ds]}</span></div><div class="code-mini">Delivery code <b>${o.delivery_pin}</b><small>Customer has the same code</small></div>`;
    if (ds === 'finding') return html`<div class="rider-line pulse-b">${icon('search', 18)} Finding a nearby rider…</div>`;
    if (ds === 'no_riders') return html`<div class="alert red">No rider accepted. Assign one of yours or try again.</div>`;
    return '';
  };
  const actionsFor = (o) => {
    const rid = o.id;
    if (o.status === 'placed') return html`<button class="btn grow" data-act="accept" data-id="${rid}">Accept</button><button class="btn danger grow" data-act="reject" data-id="${rid}">Reject</button>`;
    if (o.status === 'accepted') return html`<button class="btn grow" data-act="prep" data-id="${rid}">Start preparing</button>${o.fulfilment === 'delivery' && !['assigned', 'finding', 'picked_up', 'arrived'].includes(o.delivery_status) ? html`<button class="btn ghost grow" data-act="assign" data-id="${rid}">${icon('motor', 18)} Assign rider</button>` : ''}`;
    if (o.status === 'preparing') return html`<button class="btn grow" data-act="ready" data-id="${rid}">Mark ready</button>${o.fulfilment === 'delivery' && !['assigned', 'finding', 'picked_up', 'arrived'].includes(o.delivery_status) ? html`<button class="btn ghost grow" data-act="assign" data-id="${rid}">${icon('motor', 18)} Assign rider</button>` : ''}`;
    if (o.status === 'ready') return o.fulfilment === 'pickup' ? html`<button class="btn grow" data-act="handover" data-id="${rid}">Hand over to customer</button>` : (!['assigned', 'finding', 'picked_up', 'arrived'].includes(o.delivery_status) ? html`<button class="btn grow" data-act="assign" data-id="${rid}">${icon('motor', 18)} Assign rider</button>` : '');
    return '';
  };
  const card = (o) => html`<article class="card order-card ${['completed', 'cancelled', 'rejected'].includes(o.status) ? 'done' : ''}">
    <div class="row between gap"><div><b>${o.code}</b> <small class="muted">· ${ago(o.created_at)}</small></div>${orderBadge(o)}</div>
    <div class="row gap-s wrap mt-s"><span class="badge navy">${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span><span class="badge ${o.payment_status === 'paid' ? 'green' : 'amber'}">${o.payment_status === 'paid' ? 'Paid online' : o.payment_method === 'cash' ? 'Cash on ' + (o.fulfilment === 'delivery' ? 'delivery' : 'pickup') : 'Awaiting payment'}</span></div>
    <ul class="items">${o.items.map((i) => html`<li><b>${i.qty}×</b> ${i.name}</li>`)}</ul>
    ${o.notes ? html`<p class="note-b">“${o.notes}”</p>` : ''}
    <div class="row between small"><span>${o.customer_name} <a href="${tel(o.customer_phone)}" class="b">${icon('phone', 14)} Call</a></span><b>${money(o.subtotal - o.discount)}</b></div>
    ${o.fulfilment === 'delivery' && o.dest_addr ? html`<small class="muted block">${icon('pin', 13)} ${shortAddr(o.dest_addr)} · ${km(o.distance_km)}</small>` : ''}
    ${dlv(o)}${o.status === 'ready' && o.fulfilment === 'pickup' ? html`<div class="code-mini">Customer will show a 4-digit pickup code</div>` : ''}
    <div class="row gap mt-s">${actionsFor(o)}</div></article>`;
  const draw = () => {
    const b = $('#board', root);
    if (scope === 'history') { b.innerHTML = rows.length ? `<div class="board-grid">${rows.map((o) => card(o).s).join('')}</div>` : empty('📜', 'No past orders', 'Completed and cancelled orders appear here.').s; return; }
    const col = (title, f, tone) => { const list = rows.filter(f); return html`<div class="col-b"><h4 class="col-h ${tone}">${title} <span>${list.length}</span></h4>${list.length ? list.map(card) : html`<p class="muted small center pad">Nothing here</p>`}</div>`; };
    b.innerHTML = html`<div class="board">${col('New', (o) => o.status === 'placed', 'red')}${col('Kitchen', (o) => ['accepted', 'preparing'].includes(o.status), 'amber')}${col('Ready & on the way', (o) => ['ready', 'out_for_delivery'].includes(o.status), 'green')}</div>`.s;
  };
  const load = async () => {
    try { rows = await GET('/vendor/orders?scope=' + (scope === 'history' ? 'history' : 'live')); const s = JSON.stringify(rows.map((o) => [o.id, o.status, o.delivery_status, o.payment_status, o.rider_id])); if (s !== sig || scope === 'history') { sig = s; draw(); } } catch (e) { $('#board', root).innerHTML = html`<div class="alert red">${e.message}</div>`.s; }
    loadStats();
  };
  on('order:update', () => load()); on('notification', (n) => { if (n.type === 'order') load(); });
  const poll = setInterval(load, 8000); onLeave(() => clearInterval(poll));
  const call = (path, ok) => async (b) => { await POST(`/vendor/orders/${b.dataset.id}/${path}`, {}); if (ok) toast(ok, 'ok'); await load(); };
  actions(root, {
    scope: (b) => { scope = b.dataset.s; sig = ''; $$('.seg button', root).forEach((x) => x.classList.toggle('on', x === b)); load(); },
    accept: call('accept', 'Order accepted — customer notified'), prep: call('preparing'), ready: call('ready', 'Marked ready'),
    reject: async (b) => { if (await confirmSheet('Reject this order?', 'The customer is told, and refunded if they paid online.', 'Reject', true)) { await POST(`/vendor/orders/${b.dataset.id}/reject`, { reason: 'Rejected by vendor' }); await load(); } },
    assign: async (b) => {
      const id = b.dataset.id; const tm = await GET('/vendor/team');
      sheet(html`<h3>Assign a rider</h3><p class="muted small">Pick one of your own riders, or ask riders nearby. A secret 4-digit code is generated and sent to the customer.</p>
        ${tm.members.length ? tm.members.map((m) => html`<button class="pl-row" data-rid="${m.id}" ${m.busy ? raw('disabled') : ''}><span class="pl-ic"><span class="mark sm"></span></span><span class="grow"><b>${m.name}</b><small>${m.plate || ''} · ${m.busy ? 'On a delivery' : m.online ? 'Online' : 'Offline'}</small></span>${m.online && !m.busy ? html`<span class="badge green">Free</span>` : ''}</button>`) : html`<p class="muted small">You have no riders of your own yet. <a href="#/shop/team" data-close>Add one</a>.</p>`}
        <hr class="hr"><button class="btn block" data-bc>${icon('bolt', 18)} Broadcast to nearby RiderGo riders</button>`, { onMount: (w, close) => {
        w.addEventListener('click', async (e) => {
          const r = e.target.closest('[data-rid]'); const bc = e.target.closest('[data-bc]');
          try {
            if (r) { const res = await POST(`/vendor/orders/${id}/assign`, { rider_id: +r.dataset.rid }); close(); toast(`Rider assigned. Delivery code ${res.delivery_pin}`, 'ok', 5000); await load(); }
            if (bc) { await POST(`/vendor/orders/${id}/broadcast`); close(); toast('Request sent to riders near you', 'ok'); await load(); }
          } catch (err) { toast(err.message, 'error', 4500); }
        }); } });
    },
    handover: (b) => sheet(html`<h3>Hand over order</h3><p class="muted small">Ask the customer for the 4-digit pickup code shown in their app.</p><form id="hf"><input class="pin-single" name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="••••" required aria-label="Pickup code"><button class="btn block mt-s" type="submit">Confirm handover</button></form>`, {
      onMount: (w, close) => onSubmit(w, '#hf', async (f) => { await POST(`/vendor/orders/${b.dataset.id}/handover`, { pin: f.pin }); close(); toast('Order handed over', 'ok'); await load(); }) }),
  });
  load();
}

// ------------------------------------------------------------------ menu
export async function menu() {
  let items = [];
  const el = layout(html`<div class="page">${topbar('Menu', { back: false, right: html`<button class="btn sm" data-act="add">${icon('plus', 16)} Add item</button>` })}${subAlert()}<div id="ml">${skeletons(3)}</div></div>`, { nav: 'menu', ...W });
  const root = $('#app');
  const draw = () => {
    const g = {}; items.forEach((i) => (g[i.section || 'Menu'] ||= []).push(i));
    $('#ml', root).innerHTML = items.length ? Object.entries(g).map(([s, list]) => html`<section class="section"><h3>${s}</h3><div class="menu-grid mt-s">${list.map((i) => html`<div class="card flat menu-item ${i.available ? '' : 'off'}"><span class="img">${i.image ? html`<img src="${i.image}" alt="" loading="lazy">` : '🍽️'}</span><span class="grow"><b>${i.name}</b><small class="muted block">${i.description || ''}</small><b>${money(i.price)}</b></span>
      <span class="col gap-s"><label class="switch" title="Available"><input type="checkbox" data-act="avail" data-id="${i.id}" ${i.available ? raw('checked') : ''} aria-label="${i.name} available"><i></i></label><span class="row gap-s"><button class="icon-btn sm" data-act="edit" data-id="${i.id}" aria-label="Edit ${i.name}">${icon('edit', 16)}</button><button class="icon-btn sm" data-act="del" data-id="${i.id}" aria-label="Delete ${i.name}">${icon('trash', 16)}</button></span></span></div>`)}</div></section>`).map((x) => x.s).join('')
      : empty('🍲', 'Your menu is empty', 'Add what you sell. Customers only see your shop once it has at least one available item and your subscription is active.').s;
  };
  const load = async () => { try { items = await GET('/vendor/menu'); draw(); } catch (e) { $('#ml', root).innerHTML = html`<div class="alert red">${e.message}</div>`.s; } };
  const form = (it) => {
    const sections = [...new Set(items.map((i) => i.section).filter(Boolean))];
    let img = it?.image || null;
    sheet(html`<h3>${it ? 'Edit item' : 'Add menu item'}</h3><form id="mf">
      <div class="photo-pick"><span class="img lg" id="pv">${img ? html`<img src="${img}" alt="">` : '📷'}</span><label class="btn ghost sm">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" id="pf" hidden></label></div>
      <label class="field"><span>Name</span><input class="input" name="name" value="${it?.name || ''}" required maxlength="80"></label>
      <div class="row gap"><label class="field grow"><span>Price</span><input class="input" name="price" type="number" step="0.01" min="0.01" value="${it?.price ?? ''}" required></label><label class="field grow"><span>Section</span><input class="input" name="section" list="secs" value="${it?.section || 'Mains'}"><datalist id="secs">${sections.map((s) => html`<option value="${s}">`)}</datalist></label></div>
      <label class="field"><span>Description</span><input class="input" name="description" value="${it?.description || ''}" maxlength="300" placeholder="Ingredients, portion size…"></label>
      <button class="btn block" type="submit">${it ? 'Save changes' : 'Add to menu'}</button></form>`, { cls: 'wide', onMount: (w, close) => {
      $('#pf', w).addEventListener('change', async (e) => { try { img = await uploadImage(e.target.files[0]); $('#pv', w).innerHTML = `<img src="${img}" alt="">`; } catch (err) { toast(err.message, 'error'); } });
      onSubmit(w, '#mf', async (f) => { const body = { name: f.name, price: +f.price, section: f.section, description: f.description, ...(img ? { image: img } : {}) }; if (it) await PATCH('/vendor/menu/' + it.id, body); else await POST('/vendor/menu', body); close(); toast('Menu updated', 'ok'); await load(); }); } });
  };
  actions(root, {
    add: () => form(null), edit: (b) => form(items.find((i) => i.id === +b.dataset.id)),
    del: async (b) => { if (await confirmSheet('Delete this item?', 'It disappears from your menu. Past orders are not affected.', 'Delete', true)) { await DEL('/vendor/menu/' + b.dataset.id); await load(); } },
  });
  root.addEventListener('change', async (e) => { const c = e.target.closest('[data-act=avail]'); if (!c) return; try { await PATCH('/vendor/menu/' + c.dataset.id, { available: c.checked }); const it = items.find((i) => i.id === +c.dataset.id); it.available = c.checked ? 1 : 0; c.closest('.menu-item').classList.toggle('off', !c.checked); } catch (err) { c.checked = !c.checked; toast(err.message, 'error'); } });
  load();
}

// ------------------------------------------------------------------ team (the vendor's own riders)
export async function team() {
  let tm;
  const el = layout(html`<div class="page">${topbar('My riders', { back: false })}${subAlert()}<div id="tl">${skeletons(2)}</div></div>`, { nav: 'team', ...W });
  const root = $('#app');
  const draw = () => {
    const full = tm.used >= tm.seats;
    $('#tl', root).innerHTML = html`<div class="card flat row between gap"><span><b>${tm.used} of ${tm.seats}</b> rider seats used<small class="muted block">Your plan covers these riders' subscription. They work only for you unless you broadcast.</small></span>${full ? html`<a class="btn sm" href="#/billing">Upgrade</a>` : html`<button class="btn sm" data-act="add">${icon('plus', 16)} Add rider</button>`}</div>
      <div class="mt">${tm.members.length ? tm.members.map((m) => html`<div class="card flat row gap mt-s"><span class="avatar logo"></span><span class="grow"><b>${m.name}</b><small class="muted block">${m.plate || 'No plate'} · ${m.vehicle_make || 'Motorbike'} · ${m.phone}</small></span><span class="badge ${m.busy ? 'amber' : m.online ? 'green' : 'gray'}">${m.busy ? 'On delivery' : m.online ? 'Online' : 'Offline'}</span><button class="icon-btn sm" data-act="rm" data-id="${m.id}" aria-label="Remove ${m.name}">${icon('trash', 16)}</button></div>`) : empty('🛵', 'No riders yet', 'Add your own delivery riders to assign orders directly. They log in with the details you set.').s}</div>`.s;
  };
  const load = async () => { try { tm = await GET('/vendor/team'); draw(); } catch (e) { $('#tl', root).innerHTML = html`<div class="alert red">${e.message}</div>`.s; } };
  actions(root, {
    add: () => sheet(html`<h3>Add a rider</h3><p class="muted small">They'll log in with this email (or phone) and password.</p><form id="rf">
      <label class="field"><span>Full name</span><input class="input" name="name" required></label><label class="field"><span>Email</span><input class="input" type="email" name="email" required></label>
      <label class="field"><span>Phone</span><input class="input" type="tel" name="phone" required></label><label class="field"><span>Temporary password</span><input class="input" name="password" minlength="6" required></label>
      <div class="row gap"><label class="field grow"><span>Motorbike</span><input class="input" name="vehicle_make" placeholder="Honda Ace"></label><label class="field grow"><span>Plate</span><input class="input" name="plate" placeholder="GN-1234-24"></label></div>
      <button class="btn block" type="submit">Add rider</button></form>`, { onMount: (w, close) => onSubmit(w, '#rf', async (f) => { await POST('/vendor/team', f); close(); toast('Rider added', 'ok'); await load(); }) }),
    rm: async (b) => { if (await confirmSheet('Remove this rider?', 'They will no longer be able to log in or receive orders.', 'Remove', true)) { await DEL('/vendor/team/' + b.dataset.id); await load(); } },
  });
  load();
}

// ------------------------------------------------------------------ shop profile
export async function profile() {
  let p;
  const el = layout(html`<div class="page">${topbar('Shop profile')}<div id="pl">${skeletons(2)}</div></div>`, { nav: 'account', ...W });
  const root = $('#app');
  try { p = await GET('/vendor/profile'); } catch (e) { $('#pl', root).innerHTML = html`<div class="alert red">${e.message}</div>`.s; return; }
  const loc = { lat: p.lat, lng: p.lng, address: p.address };
  const draw = () => {
    $('#pl', root).innerHTML = html`<form id="f" class="card">
      <div class="photo-row"><div><small class="muted">Logo</small><label class="photo-pick sq"><span class="img lg" id="lg">${p.logo ? html`<img src="${p.logo}" alt="">` : emoji(p.category)}</span><input type="file" accept="image/*" data-up="logo" hidden></label></div><div class="grow"><small class="muted">Cover photo</small><label class="photo-pick wide"><span class="img cover" id="cv">${p.cover ? html`<img src="${p.cover}" alt="">` : '📷 Add cover'}</span><input type="file" accept="image/*" data-up="cover" hidden></label></div></div>
      <label class="field mt"><span>Business name</span><input class="input" name="name" value="${p.name}" required></label>
      <div class="row gap"><label class="field grow"><span>Category</span><select class="input" name="category">${[['food', 'Food & drinks'], ['grocery', 'Groceries'], ['convenience', 'Convenience']].map(([v, l]) => html`<option value="${v}" ${p.category === v ? raw('selected') : ''}>${l}</option>`)}</select></label><label class="field grow"><span>Cuisine</span><input class="input" name="cuisine" value="${p.cuisine || ''}"></label></div>
      <label class="field"><span>Description</span><textarea class="input" name="description" maxlength="300">${p.description || ''}</textarea></label>
      <label class="field"><span>Shop phone</span><input class="input" name="phone" type="tel" value="${p.phone || ''}"></label>
      <div class="field"><span>Location</span><button type="button" class="route-line card flat" data-act="loc"><i class="dot"></i><span class="grow"><span class="lbl">Customers find you here</span><span class="val" id="addr">${loc.address}</span></span>${icon('chev')}</button></div>
      <div class="row gap"><label class="field grow"><span>Prep time (min)</span><input class="input" name="prep_minutes" type="number" min="5" max="120" value="${p.prep_minutes}"></label><label class="field grow"><span>Minimum order</span><input class="input" name="min_order" type="number" step="0.01" min="0" value="${p.min_order}"></label></div>
      <div class="row gap"><label class="field grow"><span>Max delivery distance (km)</span><input class="input" name="max_delivery_km" type="number" step="0.5" min="1" max="50" value="${p.max_delivery_km}"></label></div>
      <label class="row between gap field"><span class="grow">I offer delivery</span><span class="switch"><input type="checkbox" name="delivers" ${p.delivers ? raw('checked') : ''}><i></i></span></label>
      <button class="btn block" type="submit">Save profile</button></form>`.s;
    onSubmit(root, '#f', async (f) => { await PATCH('/vendor/profile', { name: f.name, category: f.category, cuisine: f.cuisine, description: f.description, phone: f.phone, prep_minutes: +f.prep_minutes, min_order: +f.min_order, max_delivery_km: +f.max_delivery_km, delivers: !!f.delivers, lat: loc.lat, lng: loc.lng, address: loc.address }); toast('Profile saved', 'ok'); await loadMe(); });
  };
  actions(root, { loc: async () => { const r = await pickPlace({ title: 'Shop location' }); if (r) { Object.assign(loc, { lat: r.lat, lng: r.lng, address: r.address }); $('#addr', root).textContent = r.address; } } });
  root.addEventListener('change', async (e) => { const f = e.target.closest('[data-up]'); if (!f) return; try { const url = await uploadImage(f.files[0]); const k = f.dataset.up; await PATCH('/vendor/profile', { [k]: url }); p[k] = url; $(k === 'logo' ? '#lg' : '#cv', root).innerHTML = `<img src="${url}" alt="">`; toast('Photo updated', 'ok'); } catch (err) { toast(err.message, 'error'); } });
  draw();
}
