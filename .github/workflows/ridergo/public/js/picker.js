// Place picker: search (OpenStreetMap/Nominatim via our server), saved places, current location, or drop a pin on the map.
import { html, esc, $, $$, sheet, GET, S, getPos, reverse, debounce, toast, icon, shortAddr } from './core.js';
import { createMap } from './map.js';

export async function currentPlace() {
  const p = await getPos(true);
  return { lat: p.lat, lng: p.lng, address: await reverse(p.lat, p.lng), current: true, approx: p.approx };
}

export function pickPlace({ title = 'Where to?', current = true, near } = {}) {
  return new Promise(async (resolve) => {
    let saved = [];
    if (S.me?.user.role === 'customer') { try { saved = await GET('/places'); } catch { /* optional */ } }
    let done = false, handoff = false; let results = [];
    const items = []; // everything clickable, by index
    const finish = (v) => { if (done) return; done = true; resolve(v); };

    const row = (label, sub, ic, v) => { items.push(v); return html`<button class="pl-row" data-i="${items.length - 1}"><span class="pl-ic">${icon(ic, 18)}</span><span class="grow"><b>${label}</b>${sub ? html`<small>${sub}</small>` : ''}</span></button>`; };
    const draw = (w, q) => {
      items.length = 0;
      const box = $('#pres', w);
      const parts = [];
      if (current) parts.push(row('Current location', 'Use GPS', 'target', { current: true }));
      parts.push(html`<button class="pl-row" data-map><span class="pl-ic">${icon('map', 18)}</span><span class="grow"><b>Choose on map</b><small>Drop a pin exactly where you need it</small></span></button>`);
      if (!q) for (const s of saved) parts.push(row(s.label, shortAddr(s.address), 'heart', s));
      if (q && q.length >= 3) {
        if (results === null) parts.push(html`<p class="muted small pad">Searching…</p>`);
        else if (!results.length) parts.push(html`<p class="muted small pad">No places found. Try a landmark, or choose on the map.</p>`);
        else for (const r of results) parts.push(row(r.name, shortAddr(r.address), 'pin', r));
      }
      box.innerHTML = parts.map((p) => p.s).join('');
    };
    sheet(html`<h3>${title}</h3><label class="search-box">${icon('search', 18)}<input class="input" id="pq" placeholder="Search a place, street or landmark" autocomplete="off" enterkeyhint="search"></label><div id="pres" class="plist"></div>`, {
      cls: 'tall',
      onMount: (w, close) => {
        draw(w, '');
        const input = $('#pq', w); setTimeout(() => input.focus(), 250);
        const search = debounce(async () => {
          const q = input.value.trim(); if (q.length < 3) { results = []; return draw(w, q); }
          results = null; draw(w, q);
          try { const n = near || (S.pos ? { lat: S.pos.lat, lng: S.pos.lng } : S.cfg.center); results = await GET(`/geo/search?q=${encodeURIComponent(q)}&lat=${n.lat}&lng=${n.lng}`); }
          catch (e) { results = []; toast(e.message, 'error'); }
          if (input.value.trim() === q) draw(w, q);
        }, 380);
        input.addEventListener('input', search);
        w.addEventListener('click', async (e) => {
          const r = e.target.closest('.pl-row'); if (!r) return;
          if (r.hasAttribute('data-map')) { handoff = true; close(); const v = await mapPick({ title }); return finish(v); }
          const v = items[+r.dataset.i];
          if (v.current) {
            r.classList.add('loading');
            try { const c = await currentPlace(); close(); return finish(c); } catch { toast('Could not get your location', 'error'); r.classList.remove('loading'); return; }
          }
          close(); finish({ lat: +v.lat, lng: +v.lng, address: v.address || v.label, name: v.name || v.label });
        });
        $('.sheet-back', w).addEventListener('click', () => finish(null));
        const obs = new MutationObserver(() => { if (!w.isConnected) { if (!handoff) finish(null); obs.disconnect(); } });
        obs.observe($('#layer'), { childList: true });
      },
    });
  });
}

/** Full-screen map: tap to drop a pin, then confirm. */
export function mapPick({ title = 'Choose location', start } = {}) {
  return new Promise(async (resolve) => {
    const el = document.createElement('div'); el.className = 'full pickmap';
    el.innerHTML = `<div class="mapbox" id="pm"></div>
      <div class="float-top"><button class="icon-btn" data-x aria-label="Back">${icon('back').s}</button><div class="card tight grow pm-addr" id="pmaddr">Tap the map to drop a pin</div></div>
      <div class="panel"><div class="grab"></div><button class="btn block" id="pmok" disabled>Confirm location</button></div>`;
    $('#layer').appendChild(el);
    const pos = start || await getPos();
    const map = createMap($('#pm', el), { center: pos, zoom: 16, onTap: async (p) => {
      map.marker('pin', { ...p, type: 'drop' }); chosen = { ...p, address: '…' };
      $('#pmaddr', el).textContent = 'Finding address…'; $('#pmok', el).disabled = true;
      chosen.address = await reverse(p.lat, p.lng);
      $('#pmaddr', el).textContent = chosen.address; $('#pmok', el).disabled = false;
    } });
    let chosen = null;
    if (start) map.marker('pin', { ...start, type: 'drop' });
    map.marker('me', { lat: pos.lat, lng: pos.lng, type: 'me' });
    const out = (v) => { el.remove(); resolve(v); };
    $('[data-x]', el).onclick = () => out(null);
    $('#pmok', el).onclick = () => out(chosen);
    $('#pmaddr', el).title = title;
  });
}
