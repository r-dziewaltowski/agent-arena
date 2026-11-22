// Agent Arena's service worker (registered by src/components/service-worker.tsx). It does one
// thing: when the phone has no connection, a page shows a small "You're offline" page instead of
// the browser's error. Everything else goes straight to the network as before; nothing is cached
// but that page, since debates are live.
const CACHE = "offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Only page loads; API calls, the live-update stream and assets never pass through here.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((page) => page || Response.error()),
    ),
  );
});
