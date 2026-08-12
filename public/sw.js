// Tabby service worker. Only precaches the static app shell (icons,
// manifest, offline fallback) — never authenticated page HTML, since that
// would mean serving one user's cached trip data to whoever opens the app
// next on a shared device. Actual trip data is local-first through Dexie
// (see lib/offline/*), not the service worker cache.

const CACHE_NAME = "tabby-shell-v1";
const SHELL_ASSETS = ["/manifest.json", "/offline.html", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Page navigations: always try the network first (pages are dynamic and
  // per-user), fall back to the offline shell only when there's no signal.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html").then((res) => res ?? Response.error()))
    );
    return;
  }

  // Static shell assets: cache-first, since they don't change per user.
  const url = new URL(request.url);
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});
