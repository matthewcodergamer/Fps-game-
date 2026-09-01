const CACHE='project-strike-shell-v4';
const SHELL=['./','./index.html','./styles.css','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(SHELL);
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('project-strike-shell-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==location.origin)return;
  const code=/\.(?:html|js|css|json)$/i.test(url.pathname)||req.mode==='navigate';
  const largeAsset=/\.(?:glb|gltf|ktx2|wav|bin)$/i.test(url.pathname);
  if(code){
    event.respondWith((async()=>{
      try{const fresh=await fetch(req,{cache:'no-cache'});if(fresh.ok){const cache=await caches.open(CACHE);cache.put(req,fresh.clone())}return fresh}
      catch{const cached=await caches.match(req);return cached||(req.mode==='navigate'?await caches.match('./index.html'):Response.error())}
    })());
    return;
  }
  if(largeAsset){
    event.respondWith((async()=>{
      const cached=await caches.match(req);if(cached)return cached;
      const fresh=await fetch(req);if(fresh.ok){const cache=await caches.open(CACHE);cache.put(req,fresh.clone())}return fresh
    })());
    return;
  }
  event.respondWith(fetch(req).catch(()=>caches.match(req)));
});