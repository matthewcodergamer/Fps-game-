const CACHE = 'project-strike-v8-runtime';
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

async function networkFirst(request, fallback = null) {
  try {
    const response = await fetchWithSourceFallback(request);
    if (!response.ok) throw new Error(`${response.status} ${request.url}`);
    return await remember(request, response);
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
  const response = await fetchWithSourceFallback(request);
  return remember(request, response);
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

  if (url.pathname.includes('/game-assets/') || url.pathname.includes('/public/game-assets/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
