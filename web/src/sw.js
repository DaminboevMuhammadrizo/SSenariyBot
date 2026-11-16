// Service worker (template: tools/build.mjs fills in the version and the file list).
// The app shell and the lazy chunks are stored on install, so the second launch opens from the device.
// API data is never cached here: the app keeps its own copies with ETags (304 when unchanged).
const CACHE = 'tartib-__VERSION__';
const SHELL = __SHELL__;
const TG_SDK = 'https://telegram.org/js/telegram-web-app.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tartib-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    void caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(TG_SDK)) {
    // cached copy at once, refreshed in the background
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/webhook') return;
  if (req.mode === 'navigate') {
    // network first for the shell (it is tiny and 304s), device copy when offline
    e.respondWith(fetch(req).then((r) => put(new Request('./'), r)).catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
});
