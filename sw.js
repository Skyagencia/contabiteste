// sw.js
const CACHE_NAME = "contabils-v4"; // <- troque esse número quando fizer mudanças grandes
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

// instala e faz cache dos arquivos básicos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // baixa e deixa pronto (mas não assume controle ainda)
});

// ativa e limpa caches antigos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
      await self.clients.claim(); // controla as abas/PWA abertas
    })()
  );
});

// estrategia: cache-first para assets, network-first para chamadas API
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // não cachear API
  if (url.pathname.startsWith("/api/") || url.pathname.endsWith(".xlsx")) {
    return; // deixa ir direto pra rede
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      // só cacheia GET ok
      if (req.method === "GET" && res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    })()
  );
});

// quando a página pedir pra aplicar update
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

