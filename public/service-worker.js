const CACHE = 'project-strike-v12-webgpu-shell';
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

async function networkFresh(request) {
  return fetch(new Request(request, { cache: 'no-store' }));
}

async function cacheSmallBuildAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (!response?.ok) return response;
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length <= 1_000_000) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // V10 never serves navigation, GLB, textures or audio from an old Project
  // Strike cache. Large assets stream once to the browser/loader and are not
  // cloned into Cache Storage, avoiding a second Safari memory/storage copy.
  if (
    request.mode === 'navigate' ||
    url.pathname.includes('/game-assets/') ||
    url.pathname.includes('/public/game-assets/')
  ) {
    event.respondWith(networkFresh(request));
    return;
  }

  // Vite hashed JS/CSS chunks are immutable by filename and small enough to
  // cache safely. Everything else stays network-fresh while V10 stabilizes.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheSmallBuildAsset(request));
    return;
  }

  event.respondWith(networkFresh(request));
});
