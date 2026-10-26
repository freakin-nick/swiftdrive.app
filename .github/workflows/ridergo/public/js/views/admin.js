// Platform admin: overview + MRR, tenants (suspend / grant), plans & Paystack sync, safety reports + SOS, payouts, payments, promos.
import { S, GET, POST, PATCH, html, raw, $, $$, icon, money, actions, onSubmit, onLeave, toast, confirmSheet, sheet, setSession, when, day } from '../core.js';
import { layout, statusBadge } from '../shell.js';
import { empty, skeletons } from '../components.js';

const TABS = [['overview', 'Overview'], ['tenants', 'Tenants'], ['plans', 'Plans'], ['safety', 'Safety'], ['payouts', 'Payouts'], ['payments', 'Payments'], ['promos', 'Promos']];
const TYPE_LABEL = { rider: 'Motorbike rider', driver: 'Car driver', vendor: 'Food vendor' };
const TYPE_ICON = { rider: '🏍️', driver: '🚗', vendor: '🍲' };
let tab = 'overview';

export async function dashboard() {
  const el = layout(html`<div class="page admin">
    <header class="hello"><span class="mark"></span><div class="grow"><h1>RiderGo <em>Admin</em></h1><span class="muted small">Platform control · all tenants</span></div><button class="btn ghost sm" data-act="logout">${icon('logout', 16)} Log out</button></header>
    <div class="seg tabs scroll-tabs" id="tabs" role="tablist"></div>
    <div id="pane" class="mt">${skeletons(3)}</div></div>`, { wide: true });
  const root = $('#app');
  const drawTabs = () => { $('#tabs', root).innerHTML = TABS.map(([k, l]) => html`<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="tab" data-t="${k}">${l}</button>`.s).join(''); };
  const pane = (h) => { $('#pane', root).innerHTML = h.s ?? h; };
  const fail = (e) => pane(html`<div class="alert red">${e.message}</div>`);

  const views = {
    async overview() {
      const o = await GET('/admin/overview');
      const st = (n, l, sub) => html`<div class="stat"><div class="n">${n}</div><div class="l">${l}</div>${sub ? html`<small class="muted">${sub}</small>` : ''}</div>`;
      pane(html`
        <div class="alert ${o.paystack_live ? 'green' : ''} mb">${icon(o.paystack_live ? 'shield' : 'alert', 20)}<span>${o.paystack_live ? html`<b>Paystack is live.</b> Subscriptions renew automatically and webhooks are verified.` : html`<b>Paystack test mode.</b> No <code>PAYSTACK_SECRET_KEY</code> is set, so checkout is simulated.`}</span></div>
        <div class="stats">
          ${st(money(o.mrr), 'Monthly recurring revenue', `${o.tenants.active} active subscriptions`)}
          ${st(money(o.subscription_revenue), 'Subscription revenue collected')}
          ${st(money(o.gmv), 'Order & ride payments (online)')}
          ${st(o.tenants.total, 'Tenants', `${o.tenants.pending} awaiting payment · ${o.tenants.past_due} expired · ${o.tenants.suspended} suspended`)}
          ${st(o.customers, 'Customers')}
          ${st(o.online_providers, 'Providers online now')}
          ${st(`${o.rides.completed}/${o.rides.total}`, 'Rides completed')}
          ${st(`${o.orders.completed}/${o.orders.total}`, 'Food orders completed')}
          ${st(o.open_reports, 'Open reports')}${st(o.sos, 'SOS alerts')}${st(o.pending_payouts, 'Payouts to process')}
        </div>
        <section class="section"><h3>Tenants by type</h3><div class="stats mt-s">${o.by_type.map((t) => html`<div class="stat"><div class="n">${TYPE_ICON[t.type]} ${t.n}</div><div class="l">${TYPE_LABEL[t.type]}s</div><small class="muted">${t.active || 0} active</small></div>`)}</div></section>`);
    },

    async tenants() {
      const f = views.tenants.f ||= { type: '', status: '' };
      const rows = await GET('/admin/tenants?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v)));
      const sel = (k, opts) => html`<select class="input sm" data-f="${k}" aria-label="Filter by ${k}">${opts.map(([v, l]) => html`<option value="${v}" ${f[k] === v ? raw('selected') : ''}>${l}</option>`)}</select>`;
      pane(html`<div class="row gap wrap">${sel('type', [['', 'All types'], ['rider', 'Riders'], ['driver', 'Drivers'], ['vendor', 'Vendors']])}${sel('status', [['', 'Any status'], ['active', 'Active'], ['pending_payment', 'Awaiting payment'], ['past_due', 'Expired'], ['suspended', 'Suspended']])}<span class="muted small grow right">${rows.length} tenant${rows.length === 1 ? '' : 's'}</span></div>
        <div class="card flat scroll-x mt-s">${rows.length ? html`<table class="table"><thead><tr><th>Business</th><th>Owner</th><th>Plan</th><th>Status</th><th>Paid until</th><th></th></tr></thead><tbody>${rows.map((t) => html`<tr>
          <td><b>${TYPE_ICON[t.type]} ${t.name}</b><small class="muted block">${TYPE_LABEL[t.type]} · joined ${day(t.created_at)}</small></td>
          <td>${t.owner || '—'}<small class="muted block">${t.email || ''} ${t.phone || ''}</small></td>
          <td>${t.plan || '—'}<small class="muted block">${t.amount ? money(t.amount) + '/mo' : ''}</small></td>
          <td>${statusBadge(t.status)}</td><td>${t.period_end ? day(t.period_end) : '—'}</td>
          <td class="right nowrap">${t.status === 'suspended' ? html`<button class="btn sm" data-act="activate" data-id="${t.id}">Reinstate</button>` : html`<button class="btn ghost sm" data-act="grant" data-id="${t.id}" title="Give free days">+30 days</button> <button class="btn danger sm" data-act="suspend" data-id="${t.id}">Suspend</button>`}</td></tr>`)}</tbody></table>` : empty('🏢', 'No tenants match', 'Providers appear here as soon as they sign up.')}</div>`);
      $$('[data-f]', root).forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; show(); }));
    },

    async plans() {
      const plans = await GET('/admin/plans');
      pane(html`<p class="muted small mb">Prices are per tenant per month in ${S.cfg.currency}. Changing a price applies from the next payment. Sync a plan to Paystack to enable automatic recurring billing.</p>
        <div class="dash three">${plans.map((p) => html`<form class="card plan-form" data-id="${p.id}">
          <div class="row between"><span class="badge navy">${TYPE_LABEL[p.tenant_type]}</span><label class="row gap-s small">Active <span class="switch"><input type="checkbox" name="active" ${p.active ? raw('checked') : ''}><i></i></span></label></div>
          <label class="field mt-s"><span>Plan name</span><input class="input" name="name" value="${p.name}" required></label>
          <div class="row gap"><label class="field grow"><span>Price / month</span><input class="input" name="amount" type="number" step="0.01" min="1" value="${p.amount}" required></label>${p.tenant_type === 'vendor' ? html`<label class="field grow"><span>Rider seats</span><input class="input" name="seats" type="number" min="1" value="${p.seats}"></label>` : ''}</div>
          <label class="field"><span>Features (separate with |)</span><textarea class="input" name="features">${p.features || ''}</textarea></label>
          <div class="row gap"><button class="btn grow" type="submit">Save</button><button type="button" class="btn ghost grow" data-act="sync" data-id="${p.id}">${p.paystack_plan_code ? 'Re-sync Paystack' : 'Sync to Paystack'}</button></div>
          ${p.paystack_plan_code ? html`<small class="muted block mt-s">Paystack plan: ${p.paystack_plan_code}</small>` : ''}</form>`)}</div>`);
      $$('.plan-form', root).forEach((f) => onSubmit(root, f, async (d) => { await PATCH('/admin/plans/' + f.dataset.id, { name: d.name, amount: +d.amount, seats: d.seats ? +d.seats : undefined, features: d.features, active: d.active }); toast('Plan saved', 'ok'); await loadMe2(); }));
    },

    async safety() {
      const [reports, sos] = await Promise.all([GET('/admin/reports'), GET('/admin/sos')]);
      pane(html`<div class="dash"><div><h3>Reports</h3>${reports.length ? reports.map((r) => html`<article class="card flat mt-s order-card ${r.status === 'open' ? '' : 'done'}"><div class="row between"><b>${r.reason || 'Report'}</b><span class="badge ${r.status === 'open' ? 'red' : 'gray'}">${r.status}</span></div>
          <p class="small mt-s">${r.details || ''}</p><small class="muted block">${r.reporter} reported ${r.against || 'a user'}${r.against_blocked ? ' (blocked)' : ''} · ${r.kind} #${r.ref_id} · ${when(r.created_at)}</small>
          ${r.status === 'open' ? html`<div class="row gap mt-s wrap"><button class="btn sm" data-act="resolve" data-id="${r.id}">Resolve</button><button class="btn ghost sm" data-act="dismiss" data-id="${r.id}">Dismiss</button>${r.against_id && !r.against_blocked ? html`<button class="btn danger sm" data-act="block" data-id="${r.id}">Resolve &amp; block user</button>` : ''}</div>` : ''}</article>`) : empty('✅', 'No reports', 'Riders and customers can report each other from any trip.')}</div>
        <div><h3>SOS alerts</h3>${sos.length ? sos.map((s) => html`<div class="card flat mt-s alert-card"><b>${icon('alert', 16)} ${s.name}</b> <small class="muted">${s.phone || ''}</small><small class="muted block">ride #${s.ride_id || '—'} · ${when(s.created_at)}</small>${s.lat != null ? html`<a class="small b" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}">View location</a>` : ''}</div>`) : empty('🛟', 'No SOS alerts', 'Alerts sent from a live trip land here instantly.')}</div></div>`);
    },

    async payouts() {
      const rows = await GET('/admin/payouts');
      pane(html`<p class="muted small mb">Withdrawal requests from riders, drivers and vendors. When Paystack is live, transfers are sent automatically; otherwise pay manually and mark them paid.</p>
        <div class="card flat scroll-x">${rows.length ? html`<table class="table"><thead><tr><th>Requested</th><th>Tenant</th><th>Amount</th><th>To</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((p) => html`<tr><td>${when(p.created_at)}</td><td>${p.tenant}</td><td><b>${money(p.amount)}</b></td><td>${p.account_name || ''}<small class="muted block">${p.method || ''} ${p.account_number || ''}</small></td><td><span class="badge ${p.status === 'paid' ? 'green' : p.status === 'failed' ? 'gray' : 'amber'}">${p.status}</span></td>
          <td class="right nowrap">${['paid', 'failed'].includes(p.status) ? '' : html`<button class="btn sm" data-act="paid" data-id="${p.id}">Mark paid</button> <button class="btn danger sm" data-act="pfail" data-id="${p.id}">Fail</button>`}</td></tr>`)}</tbody></table>` : empty('💸', 'No payouts yet', 'Withdrawals appear here.')}</div>`);
    },

    async payments() {
      const rows = await GET('/admin/payments');
      pane(html`<div class="card flat scroll-x">${rows.length ? html`<table class="table"><thead><tr><th>Date</th><th>Type</th><th>Payer</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>${rows.map((p) => html`<tr><td>${when(p.created_at)}</td><td><span class="badge navy">${p.kind}</span></td><td>${p.name || '—'}</td><td><b>${money(p.amount)}</b></td><td><span class="badge ${p.status === 'success' ? 'green' : p.status === 'pending' ? 'amber' : 'gray'}">${p.status}</span></td><td class="xs muted">${p.reference}${p.provider === 'mock' ? ' (test)' : ''}</td></tr>`)}</tbody></table>` : empty('🧾', 'No payments yet', 'Subscription, order and ride payments appear here.')}</div>`);
    },

    async promos() {
      const rows = await GET('/admin/promos');
      pane(html`<div class="dash"><div>${rows.map((p) => html`<div class="card flat row between gap mt-s"><span><b>${p.code}</b> <span class="badge">${p.percent}% off</span><small class="muted block">${p.label || ''} · ${p.scope} · max ${money(p.max_discount)} · ${p.per_user_limit}× per user</small></span><span class="badge ${p.active ? 'green' : 'gray'}">${p.active ? 'active' : 'off'}</span></div>`)}</div>
        <form id="pf" class="card"><h3>New promo code</h3>
          <label class="field mt-s"><span>Code</span><input class="input" name="code" required maxlength="20" placeholder="WEEKEND20" style="text-transform:uppercase"></label>
          <label class="field"><span>Message shown to customers</span><input class="input" name="label" placeholder="20% off this weekend"></label>
          <div class="row gap"><label class="field grow"><span>Percent off</span><input class="input" name="percent" type="number" min="1" max="100" required></label><label class="field grow"><span>Max discount</span><input class="input" name="max_discount" type="number" min="0" step="0.5" value="20"></label></div>
          <div class="row gap"><label class="field grow"><span>Applies to</span><select class="input" name="scope"><option value="all">Rides &amp; food</option><option value="order">Food orders</option><option value="ride">Rides</option></select></label><label class="field grow"><span>Uses per customer</span><input class="input" name="per_user_limit" type="number" min="1" value="1"></label></div>
          <button class="btn block" type="submit">Create code</button></form></div>`);
      onSubmit(root, '#pf', async (d) => { await POST('/admin/promos', { ...d, percent: +d.percent, max_discount: +d.max_discount, per_user_limit: +d.per_user_limit }); toast('Promo saved', 'ok'); show(); });
    },
  };
  const loadMe2 = async () => { try { S.cfg = await GET('/config'); } catch { /* ignore */ } };
  const show = async () => { drawTabs(); try { await views[tab](); } catch (e) { fail(e); } };

  const tenantAct = (patch, msg) => async (b) => { await PATCH('/admin/tenants/' + b.dataset.id, patch); toast(msg, 'ok'); show(); };
  const reportAct = (status, block) => async (b) => { await PATCH('/admin/reports/' + b.dataset.id, { status, block_user: block }); toast('Report updated', 'ok'); show(); };
  actions(root, {
    tab: (b) => { tab = b.dataset.t; show(); },
    logout: () => { setSession(null); location.hash = '#/welcome'; },
    suspend: async (b) => { if (await confirmSheet('Suspend this tenant?', 'They go offline immediately and disappear from customers until reinstated.', 'Suspend', true)) await tenantAct({ status: 'suspended' }, 'Tenant suspended')(b); },
    activate: tenantAct({ status: 'active' }, 'Tenant reinstated'),
    grant: tenantAct({ status: 'active', grant_days: 30 }, '30 days added'),
    sync: async (b) => { const r = await POST(`/admin/plans/${b.dataset.id}/sync`); toast('Paystack plan ' + r.plan_code, 'ok'); show(); },
    resolve: reportAct('resolved', false), dismiss: reportAct('dismissed', false), block: reportAct('resolved', true),
    paid: async (b) => { await PATCH('/admin/payouts/' + b.dataset.id, { status: 'paid' }); toast('Marked as paid', 'ok'); show(); },
    pfail: async (b) => { if (await confirmSheet('Mark payout as failed?', 'The amount returns to the tenant’s wallet.', 'Mark failed', true)) { await PATCH('/admin/payouts/' + b.dataset.id, { status: 'failed' }); show(); } },
  });
  const poll = setInterval(() => { if (tab === 'safety' || tab === 'payouts') show(); }, 20000); onLeave(() => clearInterval(poll));
  show();
}
