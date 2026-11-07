const CACHE = '__CACHE_VERSION__';
const SHELL = __PRECACHE__;
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('comfymui-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only bundled app resources enter the cache. API traffic and generated images never do.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/comfy')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
  }
});
