/*
 * App-shell cache for the offline workspace.
 *
 * A tablet with no connectivity has to be able to LOAD /offline at all —
 * everything below it works from IndexedDB, but the HTML and the JavaScript
 * still have to come from somewhere. That is the entire job of this worker.
 *
 * Deliberately narrow:
 *  - only same-origin GETs are cached;
 *  - /api/** is never cached. A stale answer about work step status is worse
 *    than no answer, and the sync protocol already has a defined behaviour
 *    for "the server is unreachable";
 *  - navigations are network-first with a cache fallback, so an online
 *    tablet always sees current pages and an offline one still gets in.
 */

const CACHE = 'proquado-shell-v1';
const SHELL_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL_URL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          // Any navigation while offline lands on the offline workspace —
          // the one page that can do something useful without a server.
          return cached ?? (await caches.match(SHELL_URL)) ?? Response.error();
        }),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
