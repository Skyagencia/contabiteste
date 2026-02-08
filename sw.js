/* =========================
   Contabils PWA - sw.js
   ========================= */

const VERSION = "V1.1"; // 🔁 TROQUE ISSO A CADA DEPLOY
const CACHE_NAME = `contabils-cache-${VERSION}`;

const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/login.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      // ⚠️ NÃO chamar skipWaiting aqui
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("contabils-cache-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Não intercepta API nem export
  if (url.pathname.startsWith("/api/") || url.pathname.endsWith(".xlsx")) {
    return;
  }

  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  // HTML: network-first
  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("/", fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(req)) || (await cache.match("/index.html"));
        }
      })()
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      if (req.method === "GET" && fresh?.ok) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    })()
  );
});
