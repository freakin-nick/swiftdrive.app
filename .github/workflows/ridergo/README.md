# RiderGo — Riders for riders

A multi-tenant ride-hailing, delivery and food marketplace, built for **motorbike riders first** (also cars), in the
red mobile UI from the design brief, with the RiderGo kente emblem as the rider identity everywhere.

* **Customers** (free) book motor or car rides, order food/groceries/essentials, and track everything live.
* **Providers** (paid, monthly) sign up as a **Motorbike rider**, **Car driver** or **Food vendor**. Each provider is a **tenant**
  with a private workspace and pays a monthly subscription through **Paystack**.
* **Platform admin** manages tenants, plans/prices, safety reports, SOS alerts, payouts and promo codes.

No build step and **zero npm dependencies** — it uses Node 22's built-in `node:sqlite`.

## Run it

```bash
node -v          # needs 22.13 or newer
npm run demo     # seeds demo data and starts on http://localhost:3000
```

Demo logins (password `demo123`): `alex@demo.com` (customer) · `kwame@demo.com`, `ama@demo.com` (motor riders) ·
`yaw@demo.com` (car driver) · `mama@demo.com` (vendor with her own rider `kojo@demo.com`).
Admin: `admin@ridergo.app` / `admin123` (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`).

Real use: `cp .env.example .env`, fill it in, then `npm start`. Tests: `npm test` (58 end-to-end checks).

## Paystack

Without keys RiderGo runs in **test mode** with a built-in fake checkout page, so everything can be tried safely.
For real payments:

1. Put `PAYSTACK_SECRET_KEY` (and `PAYSTACK_PUBLIC_KEY`) in `.env`.
2. In the Paystack dashboard set the webhook URL to `https://YOUR-DOMAIN/api/payments/webhook`.
3. Set `APP_URL` to your public URL (Paystack redirects back to `/pay/return`).
4. In **Admin → Plans**, press **Sync to Paystack** once per plan. Subscribers then renew automatically every month.

What is wired up: hosted checkout (card / Mobile Money / bank), server-side `verify` (the redirect is never trusted),
HMAC-SHA512 webhook signature check, recurring plan subscriptions with auto-renew and cancel, refunds when a paid order is
rejected/cancelled, banks list and Transfers for withdrawals. Currency defaults to GHS (`CURRENCY` in `.env`).

## How multi-tenancy works

* A **tenant** = one paying business: a solo rider, a solo driver, or a vendor shop. Every provider-owned row
  (menu, orders, wallet ledger, payouts, staff riders) carries a `tenant_id`.
* The tenant is always taken from the logged-in user's token, **never from the request body** — one vendor cannot read or edit another's menu or orders (covered by tests).
* A tenant can only operate while its subscription is **active**: riders/drivers can't go online and vendors disappear from search when it lapses; `past_due` is set automatically when the month ends.
* Vendor plans include **rider seats**: a vendor adds their own riders (they sign in with the details the vendor sets, and are covered by the vendor's subscription).

## What's built (from the brief)

| Area | Features |
|---|---|
| Rides | Bolt-style booking: From / Where to, pick on map or search, **motor vs car** clearly labelled, upfront fare measured along real roads (OSRM) so nobody can be cheated, promo codes, cash or Paystack |
| Dispatch | Request is broadcast to the **closest** matching riders first, widens the radius if nobody accepts; **first accept wins** and the request vanishes from every other rider's screen; decline supported |
| Safety | Secret 4-digit **ride PIN**; motor trips can't start until the rider confirms **helmet & protective gear**; SOS button; ratings, reports, admin can block users; live location shared only once a rider is assigned |
| Food & shops | Vendors publish menus + photos, appear on the **map**; customers search dishes/vendors, see **most-rated first**, favourites, pickup or delivery, distance-based delivery fee added automatically |
| Delivery handover | Vendor assigns **their own rider or broadcasts**; a random **delivery code** goes to the customer; rider must be told it at the door; customer sees animated "Order approved", "Rider assigned", "Your order has arrived" moments and the rider live on the map |
| Money | Customer pays online → vendor and rider wallets are credited when the order completes (minus `COMMISSION_PCT`); withdrawals to Mobile Money/bank; cash option |
| Admin | MRR, tenants (suspend / reinstate / grant days), plans & prices, Paystack sync, reports, SOS, payouts, payments, promos |

## Layout

```
server/   http.js (tiny router) · db.js (schema) · routes/* · paystack.js · payments.js · dispatch.js · pricing.js · sse.js
public/   index.html · css/app.css · js/ (core, shell, map, picker, views/*) — plain ES modules, installable PWA
test/     e2e.js — boots the server on a temp DB and drives the real HTTP + SSE API
```

Maps use Leaflet + OpenStreetMap tiles loaded from unpkg; if they can't load the app falls back to a simple built-in map.
Place search and routing use public OpenStreetMap services (Nominatim / OSRM) — for heavy production traffic point `OSRM_URL`
at your own server.
