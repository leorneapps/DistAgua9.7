const CACHE_VERSION = 'distagua-v9.6-geo-full-fix';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './backup.js',
  './app.js',
  './manifest.json',
  './sw.js',
  './logo-topo.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(k => k !== CACHE_VERSION ? caches.delete(k) : Promise.resolve())
      );
      await self.clients.claim();
    })()
  );
});

function isNav(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Ignorar recursos externos que não queremos cachear obrigatoriamente ou que podem falhar
  if (!req.url.startsWith(self.location.origin)) {
    // Estratégia Network First para recursos externos (Leaflet, etc.)
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  if (isNav(req)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (e) {
          return (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'));
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        // Fallback para index.html se for um recurso essencial não encontrado
        if (req.destination === 'document') {
          return caches.match('./index.html');
        }
        return null;
      }
    })()
  );
});
