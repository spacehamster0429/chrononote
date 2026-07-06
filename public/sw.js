const CACHE_NAME = "chrononote-shell-v6";
const APP_SHELL = [
  "/",
  "/memos",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/legal.css",
  "/terms/",
  "/privacy/",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/vendor/marked/marked.min.js",
  "/vendor/dompurify/purify.min.js",
  "/vendor/katex/katex.min.css",
  "/vendor/katex/katex.min.js",
  "/vendor/katex/auto-render.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/attachments/")) return;

  if (url.pathname === "/manifest.webmanifest" || url.pathname === "/sw.js") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === "navigate") {
    const isLegalPage = url.pathname === "/terms" || url.pathname === "/terms/"
      || url.pathname === "/privacy" || url.pathname === "/privacy/";
    if (isLegalPage) {
      const cacheKey = url.pathname.startsWith("/terms") ? "/terms/" : "/privacy/";
      event.respondWith(
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
            return response;
          })
          .catch(() => caches.match(cacheKey))
      );
      return;
    }
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
  );
});
