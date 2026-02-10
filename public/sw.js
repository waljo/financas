const APP_CACHE = "financas-app-v3";
const API_CACHE = "financas-api-v3";
const STATIC_CACHE = "financas-static-v3";
const OFFLINE_FALLBACK_URL = "/offline.html";

const CORE_PAGES = ["/", "/lancar", "/contas-fixas", "/relatorios", "/cartoes", OFFLINE_FALLBACK_URL];
const API_CACHE_ALLOWLIST = [
  "/api/dashboard",
  "/api/lancamentos",
  "/api/contas-fixas",
  "/api/categorias",
  "/api/sync/status"
];

function isSameOrigin(requestUrl) {
  return new URL(requestUrl).origin === self.location.origin;
}

function shouldHandleApi(pathname) {
  return API_CACHE_ALLOWLIST.some((prefix) => pathname.startsWith(prefix));
}

function shouldHandleStatic(pathname) {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/sw.js") return true;
  if (pathname === "/manifest.webmanifest") return true;
  return /\.(?:js|css|mjs|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      for (const path of CORE_PAGES) {
        try {
          const response = await fetch(path, { credentials: "include" });
          if (response.ok) {
            await cache.put(path, response.clone());
          }
        } catch {
          // Mantem a instalacao do SW mesmo se algum item nao puder ser pre-cacheado.
        }
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== APP_CACHE && key !== API_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (!isSameOrigin(request.url)) return;

  const url = new URL(request.url);

  if (shouldHandleStatic(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response("Asset indisponível offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        }
      })()
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cachedPage = await cache.match(request);
          if (cachedPage) return cachedPage;
          const cachedHome = await cache.match("/");
          if (cachedHome) return cachedHome;
          const offlineFallback = await cache.match(OFFLINE_FALLBACK_URL);
          if (offlineFallback) return offlineFallback;
          return new Response("Sem conexao e sem cache local para esta tela.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        }
      })()
    );
    return;
  }

  if (shouldHandleApi(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cachedResponse = await cache.match(request);
          if (cachedResponse) return cachedResponse;
          return new Response(
            JSON.stringify({
              message: "Sem conexao e sem cache local para esta consulta.",
              code: "OFFLINE_NO_CACHE"
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            }
          );
        }
      })()
    );
  }
});
