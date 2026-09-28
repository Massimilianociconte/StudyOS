const CACHE_NAME = "studyos-shell-v5";
const PRECACHE_MANIFEST = "./precache-manifest.json";
const NAVIGATION_TIMEOUT_MS = 4000;
const PRECACHE_REFRESH_MS = 10 * 60 * 1000;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/studyos.svg",
  "./icons/studyos-192.png",
  "./icons/studyos-512.png",
  "./icons/apple-touch-icon-180.png"
];

let lastPrecacheRefresh = 0;

// Precache di tutti i chunk della build corrente (viste lazy comprese) + pulizia dei chunk
// di build precedenti: senza questo, offline funzionavano solo le viste già aperte.
const refreshPrecache = async () => {
  lastPrecacheRefresh = Date.now();
  try {
    const response = await fetch(PRECACHE_MANIFEST, { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const cache = await caches.open(CACHE_NAME);
    const wanted = new Set(files.map((file) => new URL(file, self.registration.scope).href));
    await Promise.all(
      [...wanted].map(async (url) => {
        if (await cache.match(url)) return;
        await cache.add(url).catch(() => undefined);
      })
    );
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((request) => new URL(request.url).pathname.includes("/assets/") && !wanted.has(request.url))
        .map((request) => cache.delete(request))
    );
  } catch {
    // offline o manifest assente (dev): nessun problema
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(refreshPrecache)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isCacheable = (request) => {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== self.location.origin) return false;
  return true;
};

const isHtmlRequest = (request) => {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
};

// Vite genera nomi tipo `assets/CalendarView-Cdhr6W5f.js` (hash base64url dopo il trattino).
// La vecchia regex cercava `.hash.` e non combaciava mai: ogni asset passava dalla rete.
const isHashedAsset = (url) =>
  /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|ttf|svg|png|jpg|webp)$/i.test(url.pathname);

const putInCache = (request, response) => {
  if (!response || !response.ok) return;
  const clone = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
};

const networkWithTimeout = (request, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isCacheable(request)) return;

  const url = new URL(request.url);

  if (isHtmlRequest(request)) {
    // Network-first con timeout: su rete lenta/assente si apre subito la shell in cache.
    event.respondWith(
      networkWithTimeout(request, NAVIGATION_TIMEOUT_MS)
        .then((response) => {
          putInCache(request, response);
          if (Date.now() - lastPrecacheRefresh > PRECACHE_REFRESH_MS) event.waitUntil(refreshPrecache());
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  if (isHashedAsset(url)) {
    // Immutabili: cache-first.
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          putInCache(request, response);
          return response;
        });
      })
    );
    return;
  }

  if (url.pathname.endsWith("precache-manifest.json")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        putInCache(request, response);
        return response;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
