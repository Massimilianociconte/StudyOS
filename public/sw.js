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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== PUSH_LOCAL_CACHE).map((key) => caches.delete(key))))
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
// mostrare una notifica: se il contenuto non è leggibile si mostra un testo generico (lo stesso dei
// dispositivi con la password dell'app, src/lib/pushLocal.ts e studyos_push_notify in people.sql).
const PUSH_FALLBACK = { title: "StudyOS", body: "Hai una nuova notifica.", url: "./", tag: "studyos" };

const readPushPayload = (event) => {
  try {
    const raw = event.data ? event.data.json() : null;
    if (!raw || typeof raw !== "object") return { ...PUSH_FALLBACK, account: "" };
    const text = (value, fallback, max) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
    return {
      title: text(raw.title, PUSH_FALLBACK.title, 120),
      body: text(raw.body, "", 300),
      url: text(raw.url, PUSH_FALLBACK.url, 300),
      tag: text(raw.tag, PUSH_FALLBACK.tag, 200),
      account: text(raw.account, "", 64)
    };
  } catch {
    return { ...PUSH_FALLBACK, account: "" };
  }
};

// Stato condiviso con la pagina (src/lib/pushLocal.ts, stesse chiavi): l'account entrato su questo
// dispositivo e i promemoria già comparsi. Resta tra un aggiornamento e l'altro del service worker.
const PUSH_LOCAL_CACHE = "studyos-push-local-v1";
const REMINDER_TAG_PREFIX = "studyos-reminder-";
const SHOWN_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
/** La scheda aperta ha mostrato lo stesso promemoria da poco: la push lo sostituisce in silenzio. */
const PAGE_SHOWN_RECENT_MS = 2 * 60 * 60 * 1000;
const localKey = (path) => `${self.location.origin}/__studyos__/${path}`;
const shownKey = (tag) => localKey(`reminder-shown/${encodeURIComponent(tag)}`);

const openLocal = async () => {
  try {
    return typeof caches === "undefined" ? null : await caches.open(PUSH_LOCAL_CACHE);
  } catch {
    return null;
  }
};

/** Account entrato qui: stringa (anche vuota = uscito) o undefined se la pagina non l'ha mai scritto. */
const readLocalAccount = async (cache) => {
  try {
    const [key] = await cache.keys(localKey("push-account"), { ignoreSearch: true });
    return key ? new URL(key.url).searchParams.get("account") || "" : undefined;
  } catch {
    return undefined;
  }
};

const readShown = async (cache, tag) => {
  try {
    let best = null;
    for (const key of await cache.keys(shownKey(tag), { ignoreSearch: true })) {
      const params = new URL(key.url).searchParams;
      const at = Number(params.get("at"));
      const by = params.get("by");
      if (Number.isFinite(at) && at > 0 && (by === "push" || by === "page") && (!best || at > best.at)) best = { at, by };
    }
    return best;
  } catch {
    return null;
  }
};

const recordShown = async (cache, tag, now) => {
  try {
    await cache.delete(shownKey(tag), { ignoreSearch: true });
    await cache.put(`${shownKey(tag)}?at=${now}&by=push`, new Response(""));
    for (const key of await cache.keys()) {
      if (!key.url.includes("/__studyos__/reminder-shown/")) continue;
      const at = Number(new URL(key.url).searchParams.get("at"));
      if (!Number.isFinite(at) || now - at > SHOWN_KEEP_MS) await cache.delete(key.url);
    }
  } catch {
    // storage pieno: al peggio la scheda aperta mostra il promemoria un'altra volta
  }
};

const showPush = (payload, silent) =>
  self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: new URL("icons/studyos-192.png", self.registration.scope).href,
    badge: new URL("icons/favicon-64.png", self.registration.scope).href,
    data: { url: payload.url },
    ...(silent ? { silent: true } : {})
  });

/**
 * - Push di un altro account (la pagina ha scritto un account diverso, es. dopo un cambio di account
 *   con l'iscrizione non ancora tolta, o nessuno dopo un'uscita): solo il testo generico, con lo stesso
 *   tag e senza aprire nulla di quell'account. Non si scarta: con userVisibleOnly una push senza
 *   notifica fa comparire l'avviso del browser o, ripetuta, fa perdere l'iscrizione.
 * - Promemoria già mostrato dalla scheda aperta: stesso tag, sostituito in silenzio (una notifica sola).
 * - Promemoria mostrato dalla push: la pagina lo ritrova e non lo ripete (EventReminderWatcher).
 */
const handlePush = async (payload) => {
  const cache = await openLocal();
  if (cache && payload.account) {
    const current = await readLocalAccount(cache);
    if (current !== undefined && current !== payload.account) {
      await showPush({ ...PUSH_FALLBACK, tag: payload.tag }, false);
      return;
    }
  }
  const reminder = payload.tag.startsWith(REMINDER_TAG_PREFIX);
  const now = Date.now();
  const shown = reminder && cache ? await readShown(cache, payload.tag) : null;
  const silent = Boolean(shown && shown.by === "page" && now - shown.at < PAGE_SHOWN_RECENT_MS);
  await showPush(payload, silent);
  if (reminder && cache && !silent) await recordShown(cache, payload.tag, now);
};

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  // Se qualcosa va storto non si sa più di quale account sia la push: solo il testo generico.
  event.waitUntil(handlePush(payload).catch(() => showPush(payload.account ? { ...PUSH_FALLBACK, tag: payload.tag } : payload, false)));
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
