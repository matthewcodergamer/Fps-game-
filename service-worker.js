const CACHE = 'project-strike-v12-webgpu-shell';
const CACHE_PREFIX = 'project-strike-';

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function rememberSmall(request, response) {
  if (!response?.ok) return response;
  const length = Number(response.headers.get('content-length') || 0);
  if (!length || length > 1_000_000) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function fetchFresh(request) {
  const response = await fetch(new Request(request, { cache: 'no-store' }));
  if (response.ok) return response;

  // Direct-source previews store runtime assets under public/game-assets while
  // the Vite build copies that folder to game-assets. This is URL normalization,
  // not a visual/model fallback.
  const url = new URL(request.url);
  if (url.pathname.includes('/game-assets/') && !url.pathname.includes('/public/game-assets/')) {
    const sourceUrl = new URL(url.href);
    sourceUrl.pathname = url.pathname.replace('/game-assets/', '/public/game-assets/');
    const sourceResponse = await fetch(new Request(sourceUrl.href, { cache: 'no-store' }));
    if (sourceResponse.ok) return sourceResponse;
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetchFresh(request));
    return;
  }

  if (url.pathname.includes('/game-assets/') || url.pathname.includes('/public/game-assets/')) {
    // Large GLB/audio/texture responses must never be duplicated into Cache
    // Storage on iPhone. They stream once; decoded lifetime is owned by runtime.
    event.respondWith(fetchFresh(request));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return rememberSmall(request, await fetch(request));
    })());
    return;
  }

  event.respondWith(fetchFresh(request));
});
