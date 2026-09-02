const CACHE = 'project-strike-v9-shell';
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

async function rememberSmall(request, response) {
  if (!response?.ok) return response;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 2_000_000) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function fetchWithSourceFallback(request) {
  const response = await fetch(request);
  if (response.ok) return response;

  const url = new URL(request.url);
  if (url.pathname.includes('/game-assets/') && !url.pathname.includes('/public/game-assets/')) {
    const fallbackUrl = new URL(url.href);
    fallbackUrl.pathname = url.pathname.replace('/game-assets/', '/public/game-assets/');
    const fallback = await fetch(new Request(fallbackUrl.href, request));
    if (fallback.ok) return fallback;
  }
  return response;
}

async function networkFirstSmall(request) {
  try {
    const response = await fetchWithSourceFallback(request);
    if (!response.ok) throw new Error(`${response.status} ${request.url}`);
    return await rememberSmall(request, response);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error(`Offline resource unavailable: ${request.url}`);
  }
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
    event.respondWith(networkFirstSmall(request));
    return;
  }

  if (url.pathname.includes('/game-assets/') || url.pathname.includes('/public/game-assets/')) {
    event.respondWith(fetchWithSourceFallback(request));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirstSmall(request));
    return;
  }

  event.respondWith(networkFirstSmall(request));
});
