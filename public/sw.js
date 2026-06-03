/*
 * Conservative service worker for the Pioneer inventory PWA.
 *
 * Goals: make the app installable + give a friendly offline page, WITHOUT
 * serving stale authenticated content. Strategy:
 *   - Navigations  → network-first, fall back to /offline.html when offline.
 *   - Build assets → cache-first (immutable hashed files under /_next/static).
 *   - Everything else (API, etc.) → passthrough (no caching).
 */
const CACHE = 'pioneer-static-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // App navigations: try the network, fall back to the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Immutable build assets + logo: cache-first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/logo.jpg') {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
