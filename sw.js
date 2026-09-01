const CACHE_NAME = "meus-gastos-v15";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./js/config.js?v=2026081001",
  "./js/domain.js?v=2026083101",
  "./js/document-validator.js?v=2026082602",
  "./js/local-store.js?v=2026082601",
  "./js/google-auth.js?v=2026081003",
  "./js/google-drive-repository.js?v=2026082601",
  "./js/sync-service.js?v=2026082601",
  "./js/app.js?v=2026083102",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  const cacheKey = new Request(url.href);
  event.respondWith(
    caches.match(cacheKey).then((cached) => {
      const updated = fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
        }
        return response;
      });
      return cached || updated;
    }),
  );
});
