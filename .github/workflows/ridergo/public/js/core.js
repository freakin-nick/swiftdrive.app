// Core helpers: safe templating, API client, state, realtime, icons, UI primitives.
export const S = {
  token: localStorage.getItem('rg_token'), me: null, cfg: null, pos: null, unread: 0,
  basket: JSON.parse(sessionStorage.getItem('rg_basket') || 'null'),
};
export const saveBasket = () => sessionStorage.setItem('rg_basket', JSON.stringify(S.basket));

// ---------- safe html templating (everything interpolated is escaped unless wrapped in raw()) ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const render = (v) => (v == null || v === false || v === true ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v));
export const html = (strings, ...vals) => new Raw(strings.reduce((o, s, i) => o + s + (i < vals.length ? render(vals[i]) : ''), ''));
export const mount = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- formatting ----------
const SYM = { GHS: 'GH₵', NGN: '₦', ZAR: 'R', KES: 'KSh', USD: '$' };
export const money = (n) => `${SYM[S.cfg?.currency] || S.cfg?.currency || ''} ${(+n || 0).toFixed(2)}`;
export const km = (n) => (n == null ? '' : `${(+n).toFixed(1)} km`);
export const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
export const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

// ---------- icons (24px stroke set) ----------
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 12h8"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  car: '<path d="M4 15l1.5-5A2 2 0 0 1 7.4 8.5h9.2a2 2 0 0 1 1.9 1.5L20 15v3h-2v-1.5H6V18H4z"/><circle cx="7.5" cy="13.2" r="1"/><circle cx="16.5" cy="13.2" r="1"/>',
  motor: '<circle cx="6" cy="16" r="3"/><circle cx="18" cy="16" r="3"/><path d="M6 16l3.5-7H13l2.5 3.5L18 16M9.5 9H7.5M13 9l1.2-2H17"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', back: '<path d="M19 12H5M11 6l-6 6 6 6"/>', chev: '<path d="M9 6l6 6-6 6"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" fill="currentColor"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M4 7h15a1 1 0 0 1 1 1v11H5a1 1 0 0 1-1-1z"/><path d="M4 7V6a2 2 0 0 1 2-2h11v3"/><circle cx="16" cy="13.5" r="1.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5.5 12v8h13v-8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.1"/>',
  bike2: '<circle cx="6" cy="16" r="3.2"/><circle cx="18" cy="16" r="3.2"/><path d="M6 16l4-8h5l3 8M10 8l2 8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5S15.5 16.5 15.5 20M16 5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.5 2.2 3.5 5.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 13h17M12 9v11M12 9c-1-4-5-4-5-1.5S10 9 12 9zm0 0c1-4 5-4 5-1.5S14 9 12 9z"/>',
  sos: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.1"/>',
};
export const icon = (n, size = 22, cls = '') => raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`);

// ---------- API ----------
export class ApiError extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data; } }
export async function api(method, url, body) {
  let res;
  try { res = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError('You appear to be offline. Check your connection and try again.', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && S.token) { setSession(null); location.hash = '#/login'; }
    throw new ApiError(data.error || 'Something went wrong', res.status, data);
  }
  return data;
}
export const GET = (u) => api('GET', u); export const POST = (u, b) => api('POST', u, b || {}); export const PATCH = (u, b) => api('PATCH', u, b || {}); export const DEL = (u) => api('DELETE', u);

export function setSession(sess) {
  if (!sess) { S.token = null; S.me = null; localStorage.removeItem('rg_token'); closeStream(); return; }
  S.token = sess.token || S.token; if (sess.token) localStorage.setItem('rg_token', sess.token);
  S.me = { user: sess.user, tenant: sess.tenant, wallet: sess.wallet }; S.unread = sess.unread || 0;
  openStream();
}
export async function loadMe() { if (!S.token) return null; try { const m = await GET('/me'); setSession(m); return S.me; } catch { return null; } }

// ---------- realtime (SSE) ----------
let es = null; const handlers = new Map();
export function openStream() {
  closeStream(); if (!S.token) return;
  es = new EventSource('/api/stream?token=' + encodeURIComponent(S.token));
  for (const ev of ['notification', 'ride:update', 'order:update', 'track', 'job:offer', 'job:taken', 'job:assigned', 'sub:update']) {
    es.addEventListener(ev, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} (handlers.get(ev) || []).slice().forEach((fn) => fn(d)); });
  }
}
export function closeStream() { if (es) es.close(); es = null; }
/** subscribe; returns an unsubscribe function */
export function on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(fn); return () => handlers.set(ev, handlers.get(ev).filter((f) => f !== fn)); }

// ---------- view lifecycle ----------
let cleanups = [];
export const onLeave = (fn) => cleanups.push(fn);
export const runCleanups = () => { cleanups.forEach((f) => { try { f(); } catch {} }); cleanups = []; };

// ---------- UI primitives ----------
export function toast(msg, kind = 'info', ms = 3200) {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.setAttribute('role', 'status'); el.textContent = msg;
  let host = $('#toasts'); if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  host.appendChild(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}
/** Big animated status banner for key moments (rider assigned, arrived, delivered…). */
export function banner(title, body, ic = 'check') {
  let host = $('#banners'); if (!host) { host = document.createElement('div'); host.id = 'banners'; document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = 'banner'; el.setAttribute('role', 'alert');
  el.innerHTML = `<span class="banner-ic">${icon(ic, 26).s}</span><div><b>${esc(title)}</b><span>${esc(body || '')}</span></div>`;
  host.appendChild(el); beep();
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 350); };
  el.addEventListener('click', kill); setTimeout(kill, 5200);
}
let actx;
export function beep(freq = 880, ms = 140) {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = freq; g.gain.value = 0.04; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000); } catch {}
}
export function sheet(content, { onMount, dismissable = true, cls = '' } = {}) {
  const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="grab"></div>${content.s ?? esc(content)}</div>`;
  $('#layer').appendChild(wrap);
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 220); };
  if (dismissable) $('.sheet-back', wrap).addEventListener('click', close);
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  onMount && onMount(wrap, close);
  return close;
}
export const confirmSheet = (title, body, yes = 'Confirm', danger = false) => new Promise((res) => {
  let done = false;
  const close = sheet(html`<h3>${title}</h3><p class="muted">${body}</p><div class="row gap"><button class="btn ghost grow" data-no>Not now</button><button class="btn ${danger ? 'danger' : ''} grow" data-yes>${yes}</button></div>`, {
    onMount: (w, c) => { $('[data-yes]', w).onclick = () => { done = true; c(); res(true); }; $('[data-no]', w).onclick = () => { c(); res(false); }; $('.sheet-back', w).addEventListener('click', () => res(false)); },
  });
});
export function busy(btn, fn) {
  return async (...a) => {
    if (btn.disabled) return; const t = btn.innerHTML; btn.disabled = true; btn.classList.add('loading');
    try { return await fn(...a); } catch (e) { toast(e.message, 'error', 4500); } finally { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = t; }
  };
}
export const stars = (v, n = 5) => raw(Array.from({ length: n }, (_, i) => `<span class="${i < Math.round(v) ? 'on' : ''}">${icon('star', 14).s}</span>`).join(''));
export const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- location ----------
export function getPos(force = false) {
  return new Promise((resolve) => {
    if (S.pos && !force && Date.now() - S.pos.at < 60000) return resolve(S.pos);
    const fallback = () => resolve((S.pos = { ...S.cfg.center, approx: true, at: Date.now() }));
    if (!navigator.geolocation) return fallback();
    navigator.geolocation.getCurrentPosition((p) => resolve((S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, approx: false, at: Date.now() })), fallback, { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 });
  });
}
export const reverse = async (lat, lng) => { try { return (await GET(`/geo/reverse?lat=${lat}&lng=${lng}`)).address; } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; } };
export const shortAddr = (a) => String(a || '').split(',').slice(0, 2).join(',');
export const emoji = (cat) => ({ food: '🍲', grocery: '🥬', convenience: '🛍️' }[cat] || '🍽️');
export const go = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
export async function uploadImage(file) {
  if (!file) return null; if (file.size > 3 * 1024 * 1024) throw new Error('Image is too large (max 3 MB)');
  const data = await new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(file); });
  return (await POST('/upload', { data })).url;
}

// ---------- extra icons ----------
Object.assign(P, {
  nav: '<path d="M12 3l7 17-7-4-7 4z"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  power: '<path d="M12 3v8"/><path d="M6.5 6.5a8 8 0 1 0 11 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.2 10.8l7-3.6M8.2 13.2l7 3.6"/>',
  map: '<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  helmet: '<path d="M4 16a8 8 0 0 1 16 0v2H4z"/><path d="M4 16h9l3-4h4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
});

// ---------- delegated actions & forms ----------
/** Click delegation: <button data-act="save"> -> map.save(el, event). Buttons auto-disable while the handler runs. */
export function actions(root, map) {
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const fn = map[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    if (el.disabled) return;
    const isBtn = el.tagName === 'BUTTON';
    if (isBtn) { el.disabled = true; el.classList.add('loading'); }
    try { await fn(el, e); } catch (err) { if (err && err.message) toast(err.message, 'error', 4800); }
    finally { if (isBtn && el.isConnected) { el.disabled = false; el.classList.remove('loading'); } }
  });
}
/** Form handler: submit -> fn(valuesObject, formEl). Submit button shows a busy state. */
export function onSubmit(root, sel, fn) {
  const f = typeof sel === 'string' ? $(sel, root) : sel;
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    const data = {};
    new FormData(f).forEach((v, k) => { data[k] = v; });
    f.querySelectorAll('input[type=checkbox]').forEach((c) => { data[c.name] = c.checked; });
    try { await fn(data, f); } catch (err) { toast(err.message || 'Something went wrong', 'error', 4800); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('loading'); } }
  });
}

/** Full-screen celebration moment (rider assigned, order arrived, delivered...). Auto-dismisses; tap to close. */
export function celebrate(title, sub, ic = 'check') {
  const el = document.createElement('div');
  el.className = 'celebrate'; el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="cel-card"><div class="cel-ring"><i></i><i></i><span>${icon(ic, 44).s}</span></div><h2>${esc(title)}</h2><p>${esc(sub || '')}</p></div>`;
  $('#layer').appendChild(el); beep(660, 120); setTimeout(() => beep(990, 180), 140);
  try { navigator.vibrate && navigator.vibrate([60, 40, 90]); } catch {}
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', kill); setTimeout(kill, 3200);
}

export const ORDER_STEPS = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'];
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
export const tel = (p) => (p ? `tel:${String(p).replace(/[^+\d]/g, '')}` : '#');
export const navLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
export const homeFor = (role) => ({ customer: '/', rider: '/drive', driver: '/drive', vendor: '/shop', admin: '/admin' }[role] || '/');
export const brandMark = (cls = '') => raw(`<span class="mark ${cls}" role="img" aria-label="RiderGo"></span>`);
