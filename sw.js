const CACHE_NAME = "meus-gastos-v41";
const NAVIGATION_TIMEOUT_MS = 3000;
const APP_SHELL = [
  "./",
  "./index.html",
  "./mobile.css?v=2026111301",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./js/config.js?v=2026081001",
  "./js/domain.js?v=2026111301",
  "./js/document-validator.js?v=2026111104",
  "./js/local-store.js?v=2026111202",
  "./js/local-profile.js?v=2026111201",
  "./js/backup-recovery.js?v=2026111102",
  "./js/google-auth.js?v=2026111201",
  "./js/google-drive-repository.js?v=2026111201",
  "./js/sync-service.js?v=2026111102",
  "./js/confirm-dialog.js?v=2026111301",
  "./js/app-update.js?v=2026111201",
  "./js/app.js?v=2026111301",
];

self.addEventListener("install", (event) => {
  // No skipWaiting here: the new version waits until the person accepts it.
  // cache: "reload" skips the HTTP cache, so a new worker never stores a
  // stale index.html that still points to the previous asset versions.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
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
    const scopePath = new URL(self.registration.scope).pathname;
    const isAppShell = url.pathname === scopePath || url.pathname === `${scopePath}index.html`;
    const network = fetch(event.request).then((response) => {
      // Only a successful app-shell response may replace the offline copy.
      // A 404/5xx page must never become the cached application.
      if (response.ok && response.type === "basic" && isAppShell) {
        const copy = response.clone();
        return caches.open(CACHE_NAME)
          .then((cache) => cache.put("./index.html", copy))
          .then(() => response, () => response);
      }
      if (response.ok) return response;
      return caches.match("./index.html").then((cached) => cached || response);
    });
    // A slow connection must not hold the app: after a short wait the cached
    // shell answers, and the network copy still refreshes the cache.
    event.waitUntil(network.catch(() => undefined));
    event.respondWith(new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => {
        caches.match("./index.html").then((cached) => { if (cached) finish(cached); });
      }, NAVIGATION_TIMEOUT_MS);
      network.then(
        (response) => { clearTimeout(timer); finish(response); },
        () => { clearTimeout(timer); caches.match("./index.html").then(finish); },
      );
    }));
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
      if (cached) {
        // Background revalidation may fail offline; the cached copy still answers.
        event.waitUntil(updated.catch(() => undefined));
        return cached;
      }
      return updated;
    }),
  );
});
