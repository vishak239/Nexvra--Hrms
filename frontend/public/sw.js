// Nexvra HRMS service worker.
// Caches the app shell (static assets) so the login page and shell load offline.
// API calls are NOT cached here: they are handled by the offline queue in lib/offline.ts
// which persists work-session events in localStorage and syncs when the connection returns.
// Nothing runs while the browser is fully closed; the cache is used on the next visit.

const CACHE_NAME = "nexvra-hrms-shell-v1";
const ASSETS = [
  "/",
  "/manifest.json",
  "/brand/nexvra-logo.png",
  "/brand/nexvra-logo.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests. Never cache API or non-GET requests.
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Don't cache non-successful responses or API routes.
        if (!response.ok || response.status !== 200 || url.pathname.startsWith("/api/")) {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
