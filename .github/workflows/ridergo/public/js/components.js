import { S, html, raw, icon, money, km, emoji, stars, ago, when } from './core.js';

export const ratingBadge = (v) => (v.rating_count ? html`<span class="rate">${icon('star', 14)} ${v.rating.toFixed(1)} <span class="muted b0">(${v.rating_count})</span></span>` : html`<span class="badge navy">New</span>`);

export const vendorCard = (v) => html`<a class="card v-card flat" href="#/vendor/${v.id}" aria-label="${v.name}">
  <span class="v-thumb">${v.logo ? html`<img src="${v.logo}" alt="" loading="lazy">` : emoji(v.category)}</span>
  <span class="v-info">
    <span class="row between"><h4>${v.name}</h4>${v.favorite ? html`<span class="fav-on">${icon('heart', 16)}</span>` : ''}</span>
    <span class="row gap-s wrap small">${ratingBadge(v)}${v.distance_km != null ? html`<span class="muted">· ${km(v.distance_km)}</span>` : ''}<span class="muted">· ${v.prep_minutes}–${v.prep_minutes + 10} min</span></span>
    <span class="small muted block">${v.cuisine || v.category}${v.delivers ? '' : ' · pickup only'}</span>
    ${v.open ? '' : html`<span class="badge gray mt-s">Closed now</span>`}
  </span></a>`;

/** Plain-English order status for customers. Returns [label, badgeColor, icon] */
export function orderLabel(o) {
  const d = o.delivery_status;
  switch (o.status) {
    case 'pending_payment': return ['Awaiting payment', 'amber', 'wallet'];
    case 'placed': return ['Waiting for the vendor', 'amber', 'clock'];
    case 'accepted': return d === 'assigned' ? ['Rider assigned', 'navy', 'motor'] : d === 'finding' ? ['Finding a rider', 'navy', 'search'] : ['Order approved', 'green', 'check'];
    case 'preparing': return d === 'assigned' ? ['Preparing · rider assigned', 'navy', 'motor'] : d === 'finding' ? ['Preparing · finding a rider', 'navy', 'search'] : ['Being prepared', 'navy', 'bag'];
    case 'ready': return o.fulfilment === 'pickup' ? ['Ready for pickup', 'green', 'bag'] : d === 'assigned' ? ['Ready · rider on the way to the vendor', 'navy', 'motor'] : d === 'finding' ? ['Ready · finding a rider', 'navy', 'search'] : ['Ready for a rider', 'amber', 'bag'];
    case 'out_for_delivery': return d === 'arrived' ? ['Your rider has arrived', 'green', 'pin'] : ['On the way to you', 'navy', 'motor'];
    case 'completed': return ['Delivered', 'green', 'check'];
    case 'cancelled': return ['Cancelled', 'gray', 'x'];
    case 'rejected': return ['Declined by vendor', 'gray', 'x'];
    default: return [o.status, 'gray', 'clock'];
  }
}
export const orderBadge = (o) => { const [l, c] = orderLabel(o); return html`<span class="badge ${c}">${l}</span>`; };

export const rideLabel = (s) => ({ searching: ['Finding your rider', 'amber'], scheduled: ['Scheduled', 'navy'], accepted: ['Rider on the way', 'navy'], arrived: ['Rider has arrived', 'green'], ongoing: ['On trip', 'navy'], completed: ['Completed', 'green'], cancelled: ['Cancelled', 'gray'], no_riders: ['No riders found', 'gray'] }[s] || [s, 'gray']);
export const rideBadge = (s) => { const [l, c] = rideLabel(s); return html`<span class="badge ${c}">${l}</span>`; };

export const empty = (art, title, sub, cta) => html`<div class="empty"><span class="art">${art}</span><h4>${title}</h4><p>${sub || ''}</p>${cta || ''}</div>`;
export const skeletons = (n = 3) => raw(Array.from({ length: n }, () => '<div class="skeleton"></div>').join(''));

export const planFeatures = (f) => String(f || '').split('|').filter(Boolean);
export const daysLeft = (t) => Math.max(0, Math.ceil((t - Date.now()) / 86400000));
export const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
