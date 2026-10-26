import { S, POST, html, raw, icon, money, actions, onSubmit, $, esc } from '../core.js';
import { afterAuth, fullscreen, layout } from '../shell.js';
import { pickPlace } from '../picker.js';

const cheapest = (type) => Math.min(...S.cfg.plans.filter((p) => p.tenant_type === type).map((p) => p.amount));

const brandHead = () => html`<div class="logo-card"><img src="/img/logo-full.jpg" alt="RiderGo – Riders for riders" width="530" height="390"></div>`;

export function welcome() {
  const el = layout(html`<div class="auth">
    ${brandHead()}
    <div class="kente" aria-hidden="true"></div>
    <h1 class="center">Ride. Eat. <em>Earn.</em></h1>
    <p class="muted center mt-s">Motorbike rides, car rides and food delivery from people around you. Built for riders first.</p>
    <a class="btn block mt" href="#/login">Log in</a>
    <a class="btn ghost block mt-s" href="#/register">Create a customer account</a>
    <a class="card partner mt" href="#/join">
      <span class="pl-ic big">${icon('bike2', 26)}</span>
      <span class="grow"><b>Earn with RiderGo</b><small class="muted block">Ride, drive or sell food. Plans from ${money(Math.min(cheapest('rider'), cheapest('driver'), cheapest('vendor')))} / month.</small></span>
      ${icon('chev')}
    </a>
  </div>`);
  return el;
}

const DEMOS = [['Customer', 'alex@demo.com'], ['Rider', 'kwame@demo.com'], ['Driver', 'yaw@demo.com'], ['Food vendor', 'mama@demo.com'], ['Vendor’s rider', 'kojo@demo.com']];

export function login() {
  const el = layout(html`<div class="auth">
    <a class="icon-btn" href="#/welcome" aria-label="Back">${icon('back')}</a>
    <div class="row gap mt"><span class="mark"></span><h1>Welcome back</h1></div>
    <p class="muted">Log in with your email or phone number.</p>
    <form id="f" class="mt" novalidate>
      <label class="field"><span>Email or phone</span><input class="input" name="identifier" autocomplete="username" required inputmode="email" placeholder="you@example.com"></label>
      <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" required placeholder="••••••••"></label>
      <button class="btn block" type="submit">Log in</button>
    </form>
    <p class="center mt small muted">New here? <a href="#/register" class="b">Create an account</a></p>
    ${S.cfg.demo ? html`<div class="card flat mt"><b class="small">Demo accounts</b> <span class="muted xs">(password demo123)</span><div class="chips mt-s">${DEMOS.map(([l, e]) => html`<button type="button" class="chip" data-act="demo" data-e="${e}">${l}</button>`)}</div></div>` : ''}
  </div>`);
  onSubmit(el, '#f', async (d) => afterAuth(await POST('/auth/login', d)));
  actions(el, { demo: async (b) => { const f = $('#f', el); f.identifier.value = b.dataset.e; f.password.value = 'demo123'; f.requestSubmit(); } });
}

export function register() {
  const el = layout(html`<div class="auth">
    <a class="icon-btn" href="#/welcome" aria-label="Back">${icon('back')}</a>
    <h1 class="mt">Create your account</h1>
    <p class="muted">Order rides and food from riders and vendors near you.</p>
    <form id="f" class="mt" novalidate>
      <label class="field"><span>Full name</span><input class="input" name="name" autocomplete="name" required></label>
      <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Phone number</span><input class="input" type="tel" name="phone" autocomplete="tel" required placeholder="+233 24 000 0000"></label>
      <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required></label>
      <button class="btn block" type="submit">Sign up</button>
    </form>
    <p class="center mt small muted">Already have an account? <a href="#/login" class="b">Log in</a></p>
    <p class="center small muted">Want to earn instead? <a href="#/join" class="b">Join as a rider, driver or vendor</a></p>
  </div>`);
  onSubmit(el, '#f', async (d) => afterAuth(await POST('/auth/register', d)));
}

const TYPES = {
  rider: { art: '🏍️', title: 'Motorbike rider', blurb: 'Carry passengers and food deliveries on your motorbike.' },
  driver: { art: '🚗', title: 'Car driver', blurb: 'Drive passengers in your car, like Bolt or Yango.' },
  vendor: { art: '🍲', title: 'Food vendor / shop', blurb: 'Sell food, groceries or essentials. Add your own riders.' },
};

export function join() {
  layout(html`<div class="auth">
    <a class="icon-btn" href="#/welcome" aria-label="Back">${icon('back')}</a>
    <h1 class="mt">Work on RiderGo</h1>
    <p class="muted">Every business gets its own private workspace. Pay one flat monthly subscription, keep the rest of what you earn.</p>
    <div class="mt">${Object.entries(TYPES).map(([k, t]) => html`<a class="choice" href="#/join/${k}"><span class="art">${t.art}</span><span class="grow"><b>${t.title}</b><small class="muted block">${t.blurb}</small><span class="badge navy mt-s">from ${money(cheapest(k))} / month</span></span>${icon('chev')}</a>`)}</div>
    <p class="center small muted">Just want to order? <a href="#/register" class="b">Create a customer account</a></p>
  </div>`);
}

export function joinForm({ params }) {
  const type = params.type;
  if (!TYPES[type]) { location.hash = '#/join'; return; }
  const v = type === 'vendor';
  let place = null;
  const el = layout(html`<div class="auth top">
    <a class="icon-btn" href="#/join" aria-label="Back">${icon('back')}</a>
    <h1 class="mt">${TYPES[type].title}</h1>
    <p class="muted">Step 1 of 2: your details. Next you choose a plan and pay with Paystack.</p>
    <form id="f" class="mt" novalidate>
      <label class="field"><span>${v ? 'Owner name' : 'Full name'}</span><input class="input" name="name" autocomplete="name" required></label>
      <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Phone number</span><input class="input" type="tel" name="phone" autocomplete="tel" required placeholder="+233 24 000 0000"></label>
      <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6" required></label>
      ${v ? html`
        <hr class="hr"><h3 class="mb">Your business</h3>
        <label class="field"><span>Business name</span><input class="input" name="business_name" required placeholder="Mama Put Kitchen"></label>
        <label class="field"><span>What do you sell?</span><select class="input" name="category"><option value="food">Food &amp; drinks</option><option value="grocery">Groceries</option><option value="convenience">Convenience / essentials</option></select></label>
        <label class="field"><span>Cuisine / speciality</span><input class="input" name="cuisine" placeholder="Ghanaian, Grill, Pastries…"></label>
        <label class="field"><span>Short description</span><textarea class="input" name="description" maxlength="300" placeholder="Tell customers what makes you special"></textarea></label>
        <label class="field"><span>Average preparation time (minutes)</span><input class="input" type="number" name="prep_minutes" min="5" max="120" value="20"></label>
        <div class="field"><span>Business location</span>
          <button type="button" class="route-line card flat" data-act="place"><i class="dot"></i><span class="grow"><span class="lbl">Pin on map</span><span class="val ph" id="pl">Search your address or drop a pin</span></span>${icon('chev')}</button>
          <small class="muted">Customers find you on the map from this exact spot, and delivery prices are measured from here.</small>
        </div>`
      : html`
        <hr class="hr"><h3 class="mb">Your ${type === 'rider' ? 'motorbike' : 'car'}</h3>
        <label class="field"><span>Make &amp; model</span><input class="input" name="vehicle_make" placeholder="${type === 'rider' ? 'Haojue 150' : 'Toyota Corolla'}"></label>
        <label class="field"><span>Registration number</span><input class="input" name="plate" required placeholder="GR-1234-24"></label>
        <label class="field"><span>Driving licence number</span><input class="input" name="license_no" required></label>
        ${type === 'rider' ? html`<div class="alert"><span>${icon('helmet', 22)}</span><span>Passengers must be given a <b>helmet and protective gear</b>. You'll confirm this before every trip starts.</span></div>` : ''}`}
      <button class="btn block mt" type="submit">Continue to plans</button>
    </form>
    <p class="center mt small muted">Have an account? <a href="#/login" class="b">Log in</a></p>
  </div>`);
  actions(el, { place: async () => {
    const p = await pickPlace({ title: 'Business location', current: true }); if (!p) return;
    place = p; const pl = $('#pl', el); pl.textContent = p.address; pl.classList.remove('ph');
  } });
  onSubmit(el, '#f', async (d) => {
    const body = { ...d, type };
    if (v) { if (!place) throw new Error('Pin your business location on the map'); Object.assign(body, { lat: place.lat, lng: place.lng, address: place.address }); }
    await afterAuth(await POST('/auth/register-provider', body), '/billing?welcome=1');
  });
}
