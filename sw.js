const CACHE_NAME = 'pedidos-ebd-v2-9-1';
const APP_SHELL = [
  './',
  './index.html',
  './config.js?v=2.8.0',
  './css/style.css?v=2.8.0',
  './js/app.js?v=2.9.1',
  './manifest.webmanifest?v=2.8.0',
  './img/logo-ad-vicosa.png?v=2.8.0',
  './img/app-logo-oficial.png?v=2.8.0',
  './img/apple-touch-icon.png?v=2.8.0',
  './img/icon-192.png?v=2.8.0',
  './img/icon-512.png?v=2.8.0',
  './img/icon-192-maskable.png?v=2.8.0',
  './img/icon-512-maskable.png?v=2.8.0',
  './img/favicon.png?v=2.8.0'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
