// Chizukan service worker: 画面本体はネット優先（更新がすぐ届く）、画像・アイコンは使い回し。
// API（別オリジン）には関与しない。
const CACHE = 'czk-shell-v2';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'board.jpg', 'ui_frame_N.webp', 'ui_frame_R.webp', 'ui_frame_SR.webp', 'ui_frame_SSR.webp', 'ui_cardback.webp', 'ui_btn_blue.webp', 'ui_btn_red.webp', 'ui_btn_teal.webp', 'ui_btn_wide.webp', 'ui_plaque.webp', 'ui_emblem.webp'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate' || u.pathname.endsWith('/index.html') || u.pathname.endsWith('/')) {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put('index.html', cp)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
});
