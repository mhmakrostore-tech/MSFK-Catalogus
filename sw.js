const CACHE_NAME='msfk-catalog-v267';
const APP_SHELL=['./','./index.html','./manifest.json'];
const STATIC_EXTERNAL=[
  'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    for(const url of [...APP_SHELL,...STATIC_EXTERNAL]){
      try{
        const response=await fetch(url,{cache:'reload'});
        if(response&&response.ok)await cache.put(url,response.clone());
      }catch(e){
        console.warn('Precache overgeslagen',url,e);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith('msfk-catalog-')&&n!==CACHE_NAME).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);
  const isNavigation=req.mode==='navigate';
  const isStaticExternal=
    url.hostname==='www.gstatic.com' ||
    url.hostname==='unpkg.com';

  // Do not cache Firestore/API traffic; only app shell and static libraries.
  if(isNavigation){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(req);
        const cache=await caches.open(CACHE_NAME);
        cache.put('./index.html',fresh.clone()).catch(()=>{});
        return fresh;
      }catch(e){
        return (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  if(url.origin===self.location.origin || isStaticExternal){
    event.respondWith((async()=>{
      const cached=await caches.match(req);
      if(cached)return cached;
      try{
        const fresh=await fetch(req);
        if(fresh&&fresh.ok){
          const cache=await caches.open(CACHE_NAME);
          cache.put(req,fresh.clone()).catch(()=>{});
        }
        return fresh;
      }catch(e){
        return cached || Response.error();
      }
    })());
  }
});
