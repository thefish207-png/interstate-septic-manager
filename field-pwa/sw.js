// Minimal service worker for ISM Field — Phase 1
// - Caches the app shell so it loads instantly on repeat visits
// - Network-first for Supabase API calls (we want fresh data)
// - Cache-first for the app shell + Supabase JS CDN bundle
//
// Phase 2 will add: offline write queue (Background Sync), IndexedDB cache
// of schedule/customers/properties, image upload queue.

const VERSION = 'ism-field-v1';
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase API + websocket: network-first (always want fresh)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request).catch(() =>
      // On network failure, return a stub error JSON the app can handle
      new Response(JSON.stringify({ error: 'offline' }), {
        status: 503, headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // App shell + esm.sh CDN: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Background revalidate
        fetch(event.request).then((fresh) => {
          if (fresh.ok) caches.open(VERSION).then(c => c.put(event.request, fresh));
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response.ok && (event.request.method === 'GET')) {
          const copy = response.clone();
          caches.open(VERSION).then(c => c.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
