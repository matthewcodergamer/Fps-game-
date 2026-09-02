const CACHE = 'project-strike-v6-runtime';
const CACHE_PREFIX = 'project-strike-';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function remember(request, response) {
  if (!response?.ok) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallback = null) {
  try {
    return await remember(request, await fetch(request));
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) {
      const shell = await caches.match(fallback);
      if (shell) return shell;
    }
    throw new Error(`Offline asset unavailable: ${request.url}`);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return remember(request, await fetch(request));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.includes('/game-assets/')) {
    // Asset paths can be replaced in-place between builds, so prefer the
    // network and keep the last known-good response only as an offline backup.
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
