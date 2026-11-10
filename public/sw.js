const CACHE = '__CACHE_VERSION__';
const SHELL = __PRECACHE__;
const THUMB_CACHE = 'comfymui-thumbs-v2';
const MAX_THUMBS = 150;

async function trimCache(name, max) {
  try {
    const c = await caches.open(name);
    const keys = await c.keys();
    if (keys.length > max) {
      await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
    }
  } catch {
    /* Ignore cache trimming failures in restricted environments */
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(
    keys
      .filter(key => key.startsWith('comfymui-') && key !== CACHE && key !== THUMB_CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim())
));

self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isThumb = url.pathname === '/comfy/thumb' || url.pathname === '/comfy-thumb';

  // Only bundled app resources and thumbnails enter the cache. API traffic and raw generated images never do.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/comfy') && !isThumb) return;

  if (isThumb) {
    event.respondWith(
      caches.open(THUMB_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        try {
          const res = await fetch(event.request);
          if (res.ok) {
            await cache.put(event.request, res.clone());
            void trimCache(THUMB_CACHE, MAX_THUMBS);
          }
          return res;
        } catch (e) {
          if (hit) return hit;
          throw e;
        }
      })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
  }
});
