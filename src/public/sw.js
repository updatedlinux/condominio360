/* Minimal SW for PWA/TWA. */
const CACHE = 'condominio360-static-v2';
const ASSETS = [
  '/manifest.webmanifest',
  '/assets/images/isotipo-naranja.svg'
];

/** Rutas que nunca deben servirse desde caché del SW. */
function isAuthSensitivePath(pathname) {
  return pathname === '/js/auth.js'
    || pathname === '/sw.js'
    || pathname === '/login'
    || pathname.startsWith('/api/auth');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isAuthSensitivePath(url.pathname)) return;
  if (!url.pathname.startsWith('/assets/') && !url.pathname.endsWith('.css') && !url.pathname.endsWith('.js') && url.pathname !== '/manifest.webmanifest') return;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
