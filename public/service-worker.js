const CACHE = 'project-strike-v11-shell';
const CACHE_PREFIX = 'project-strike-';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

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

async function fetchWithSourceFallback(request, { fresh = false } = {}) {
  const first = fresh
    ? new Request(request, { cache: 'no-store' })
    : request;
  const response = await fetch(first);
  if (response.ok) return response;

  const url = new URL(request.url);
  if (url.pathname.includes('/game-assets/') && !url.pathname.includes('/public/game-assets/')) {
    const fallbackUrl = new URL(url.href);
    fallbackUrl.pathname = url.pathname.replace('/game-assets/', '/public/game-assets/');
    const fallback = await fetch(new Request(fallbackUrl.href, { cache: 'no-store' }));
    if (fallback.ok) return fallback;
  }
  return response;
}

async function freshNavigation(request) {
  // Never satisfy navigation from an older Project Strike shell. This is the
  // stale-build recovery path for Safari while V9 real-model streaming evolves.
  return fetchWithSourceFallback(request, { fresh: true });
}

async function cacheFirstSmall(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetchWithSourceFallback(request);
  return rememberSmall(request, response);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(freshNavigation(request));
    return;
  }

  if (url.pathname.includes('/game-assets/') || url.pathname.includes('/public/game-assets/')) {
    // V11 rule: real model/audio/texture responses stream from the network and
    // are never cloned into Cache Storage. AssetManager owns decoded-model
    // lifetime and iPhone serializes GLB work to one decode at a time.
    event.respondWith(fetchWithSourceFallback(request, { fresh: true }));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirstSmall(request));
    return;
  }

  event.respondWith(fetchWithSourceFallback(request, { fresh: true }));
});
