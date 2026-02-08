const CACHE_NAME = 'race-to-tank-v6';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './assets/tank-watch-hero.jpg',
  './assets/icons/icon-192-v3.png',
  './assets/icons/icon-512-v3.png',
  './assets/icons/icon-192-maskable-v3.png',
  './assets/icons/icon-512-maskable-v3.png',
  './assets/icons/apple-touch-icon-v3.png',
  './data/latest.json',
];

function cachePut(cache, request, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  cache.put(request, response);
}

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

  const isLatestData = url.pathname.endsWith('/data/latest.json');
  const isAppShell =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/sw.js');

  if (isLatestData) {
    const canonicalDataRequest = new Request(`${url.origin}${url.pathname}`);
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const cache = await caches.open(CACHE_NAME);
          cachePut(cache, canonicalDataRequest, response.clone());
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

  if (isAppShell) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const cache = await caches.open(CACHE_NAME);
          cachePut(cache, request, response.clone());
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(request);
          if (cached) return cached;
          throw new Error(`No cached response available for ${url.pathname}`);
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then(async (response) => {
        const cache = await caches.open(CACHE_NAME);
        cachePut(cache, request, response.clone());
        return response;
      });
    })
  );
});
