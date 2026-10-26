'use strict';
const config = require('./config');

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const validPoint = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

const routeCache = new Map();
/**
 * Road distance + duration + geometry between two points using OSRM.
 * Falls back to straight-line x 1.35 (flagged approx) if the routing service is unreachable.
 */
async function route(a, b) {
  const key = [a.lat, a.lng, b.lat, b.lng].map((x) => (+x).toFixed(5)).join(',');
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  let v;
  try {
    const url = `${config.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'RiderGo/1.0' } });
    const j = await res.json();
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error('no route');
    const r = j.routes[0];
    v = { km: +(r.distance / 1000).toFixed(2), min: Math.max(1, Math.round(r.duration / 60)), geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), approx: false };
  } catch {
    const km = +(haversine(a, b) * 1.35).toFixed(2);
    v = { km, min: Math.max(1, Math.round((km / 24) * 60)), geometry: [[a.lat, a.lng], [b.lat, b.lng]], approx: true };
  }
  routeCache.set(key, { at: Date.now(), v });
  if (routeCache.size > 500) routeCache.delete(routeCache.keys().next().value);
  return v;
}

const gcache = new Map();
async function nominatim(path) {
  const hit = gcache.get(path);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.v;
  const res = await fetch('https://nominatim.openstreetmap.org' + path, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'RiderGo/1.0 (ridergo app)', 'Accept-Language': 'en' } });
  const v = await res.json();
  gcache.set(path, { at: Date.now(), v });
  return v;
}
async function search(text, near) {
  let p = `/search?format=jsonv2&limit=6&addressdetails=0&countrycodes=${config.countryCodes}&q=${encodeURIComponent(text)}`;
  if (near) { const d = 0.5; p += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`; }
  const j = await nominatim(p);
  return j.map((x) => ({ name: x.name || x.display_name.split(',')[0], address: x.display_name, lat: +x.lat, lng: +x.lon }));
}
async function reverse(lat, lng) {
  const j = await nominatim(`/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`);
  return { address: j.display_name || `${(+lat).toFixed(4)}, ${(+lng).toFixed(4)}` };
}

module.exports = { haversine, validPoint, route, search, reverse };
