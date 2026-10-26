// PWA: registers the service worker, offers "Install RiderGo", announces updates and offline state.
import { html, icon, toast, $ } from './core.js';

let deferred = null;
export const canInstall = () => !!deferred && !isStandalone();
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; renderInstall(); });
window.addEventListener('appinstalled', () => { deferred = null; $('#install-bar')?.remove(); toast('RiderGo installed 🎉', 'ok'); });

export async function promptInstall() {
  if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $('#install-bar')?.remove(); return; }
  if (isIOS()) toast('Tap Share, then “Add to Home Screen”', 'info', 6000);
}

function renderInstall() {
  if (isStandalone() || $('#install-bar') || sessionStorage.getItem('rg_noinstall')) return;
  const bar = document.createElement('div'); bar.id = 'install-bar'; bar.className = 'install-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Install app');
  bar.innerHTML = html`<span class="mark"></span><span class="grow"><b>Install RiderGo</b><small>Faster, full-screen, one tap from your home screen</small></span><button class="btn sm" data-i>Install</button><button class="icon-btn sm" data-x aria-label="Dismiss">${icon('x', 16)}</button>`.s;
  document.body.appendChild(bar);
  $('[data-i]', bar).onclick = promptInstall;
  $('[data-x]', bar).onclick = () => { sessionStorage.setItem('rg_noinstall', '1'); bar.remove(); };
}

function offlineBanner() {
  let el = $('#offline-pill');
  const set = () => {
    if (navigator.onLine) { el?.remove(); el = null; return; }
    if (!el) { el = document.createElement('div'); el.id = 'offline-pill'; el.className = 'offline-pill'; el.setAttribute('role', 'status'); el.textContent = 'You are offline — live features are paused'; document.body.appendChild(el); }
  };
  addEventListener('online', () => { set(); toast('Back online', 'ok', 2000); }); addEventListener('offline', set); set();
}

export function initPWA() {
  offlineBanner();
  if (isIOS()) setTimeout(renderInstall, 4000);
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
    const announce = (w) => { const bar = document.createElement('div'); bar.className = 'install-bar'; bar.innerHTML = html`<span class="grow"><b>Update ready</b><small>A new version of RiderGo is available</small></span><button class="btn sm">Refresh</button>`.s; document.body.appendChild(bar); $('button', bar).onclick = () => w.postMessage('skipWaiting'); };
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w); }); });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; if (document.querySelector('.install-bar button.btn')) location.reload(); });
}
