const CACHE_NAME = "studyos-shell-v8";
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

// ——— Notifiche push (invito ricevuto, invito accettato, permessi cambiati) ———
// Il Worker invia un messaggio cifrato; qui arriva già decifrato come JSON: { kind, title, body, url, tag }.
// `url` è relativo all'ambito dell'app (es. "?apri=notifiche"). Con userVisibleOnly ogni push deve
// mostrare una notifica: se il contenuto non è leggibile si mostra un testo generico.
const PUSH_FALLBACK = { title: "StudyOS", body: "Hai una nuova notifica.", url: "./", tag: "studyos" };

const readPushPayload = (event) => {
  try {
    const raw = event.data ? event.data.json() : null;
    if (!raw || typeof raw !== "object") return { ...PUSH_FALLBACK };
    const text = (value, fallback, max) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
    return {
      title: text(raw.title, PUSH_FALLBACK.title, 120),
      body: text(raw.body, "", 300),
      url: text(raw.url, PUSH_FALLBACK.url, 300),
      tag: text(raw.tag, PUSH_FALLBACK.tag, 200)
    };
  } catch {
    return { ...PUSH_FALLBACK };
  }
};

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: new URL("icons/studyos-192.png", self.registration.scope).href,
      badge: new URL("icons/favicon-64.png", self.registration.scope).href,
      data: { url: payload.url }
    })
  );
});

// Solo pagine dell'app: mai un altro sito, anche se il contenuto di una push fosse manomesso.
const resolveNotificationUrl = (raw) => {
  const scope = new URL(self.registration.scope);
  try {
    const target = new URL(typeof raw === "string" ? raw : "", scope);
    if (target.origin === scope.origin && target.pathname.startsWith(scope.pathname)) return target.href;
  } catch {
    // indirizzo non valido: si apre la pagina iniziale
  }
  return scope.href;
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = resolveNotificationUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const scope = self.registration.scope;
      const inScope = windows.filter((candidate) => candidate.url.startsWith(scope));
      const client = inScope.find((candidate) => candidate.focused) || inScope[0];
      if (client) {
        try {
          await client.focus();
          await client.navigate(target);
          return;
        } catch {
          // scheda non controllata dal service worker o chiusa nel frattempo: se ne apre una nuova
        }
      }
      await self.clients.openWindow(target);
    })
  );
});
