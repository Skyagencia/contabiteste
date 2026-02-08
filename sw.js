/* =========================
   Contabils PWA - sw.js
   ========================= */

const VERSION = "V1.3"; // 🔁 TROQUE ISSO A CADA DEPLOY
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
      // ⚠️ NÃO chamar skipWaiting aqui (pra aparecer o banner)
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

  // ✅ HTML: network-first (cacheia a navegação atual + /index.html)
  if (isHTML) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          const fresh = await fetch(req);

          // cacheia a request atual (ex: "/", "/index.html", "/login.html")
          cache.put(req, fresh.clone());

          // garante também o index.html (melhor fallback offline)
          if (url.pathname === "/" || url.pathname.endsWith(".html")) {
            cache.put("/index.html", fresh.clone());
          }

          return fresh;
        } catch {
          // fallback offline: tenta o cache da request, senão index.html
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
