const CACHE_NAME = 'race-to-tank-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './assets/tank-watch-hero.jpg',
  './assets/icons/icon-192-v2.png',
  './assets/icons/icon-512-v2.png',
  './assets/icons/icon-192-maskable-v2.png',
  './assets/icons/icon-512-maskable-v2.png',
  './assets/icons/apple-touch-icon-v2.png',
  './data/latest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data/latest.json')) {
    const canonicalDataRequest = new Request(`${url.origin}${url.pathname}`);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(canonicalDataRequest, copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(canonicalDataRequest);
          if (cached) return cached;
          throw new Error('No cached latest.json available.');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
