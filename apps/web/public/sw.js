/* CatGPT service worker: installability + a graceful offline experience.
 * - App shell/static assets are cached after first use (fast repeat loads).
 * - Page navigations go network-first and fall back to a friendly offline page.
 * - The API and anything cross-origin (Supabase, Railway) is NEVER touched or
 *   cached, so chats, tokens and user data never end up in a cache. */
const VERSION = "v1";
const STATIC_CACHE = `catgpt-static-${VERSION}`;
const PAGE_CACHE = `catgpt-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/catgpt-logo.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/icons/") ||
  /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, Supabase, storage

  // Hashed build assets and icons never change for a given URL: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: always try the network first so users get the latest version.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return cached || (await caches.match(OFFLINE_URL));
        }),
    );
  }
});
