// Client Firecrawl OSS self-hosted (SOLO locale: nessuna chiamata cloud, nessun credito).
// Endpoint predefinito: http://localhost:3002 (docker compose in ~/firecrawl-oss).
// Auth OSS: header `Authorization: Bearer <TEST_API_KEY>` letto dall'ambiente
// o dalla configurazione locale dello stack (mai incluso nel sorgente).
//
// Miglioramenti rispetto alla versione precedente:
// - API v2 con fallback automatico a v1 (istanze OSS più vecchie);
// - health check reale (/v0/health/liveness + readiness) invece di un OPTIONS sempre "ok";
// - le pagine con statusCode >= 400 (es. 404) sono errori, non contenuti validi;
// - retry con backoff esponenziale + jitter su timeout, 429 e 5xx;
// - cache su disco per URL (TTL configurabile) -> run ripetuti quasi istantanei;
// - concorrenza limitata con intervallo minimo per host (cortesia verso i server UNIMI);
// - avvio automatico opzionale dello stack docker (`ensureFirecrawl({ autostart: true })`).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIRECRAWL_BASE = (process.env.FIRECRAWL_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
export const FIRECRAWL_DIR = process.env.FIRECRAWL_DIR ?? join(homedir(), "firecrawl-oss");
const CACHE_DIR = join(ROOT, ".cache", "ai", "university", "pages");

const localApiKey = () => {
  try {
    const line = readFileSync(join(FIRECRAWL_DIR, ".env"), "utf8")
      .split(/\r?\n/)
      .find((entry) => /^\s*(?:export\s+)?TEST_API_KEY\s*=/.test(entry));
    const value = line?.replace(/^\s*(?:export\s+)?TEST_API_KEY\s*=\s*/, "").trim();
    if (!value) return null;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value.split(/\s+#/)[0].trim();
  } catch {
    return null;
  }
};

const API_KEY = process.env.FIRECRAWL_API_KEY ?? process.env.TEST_API_KEY ?? localApiKey();

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class FirecrawlError extends Error {
  constructor(message, { status = null, retryable = false, pageStatus = null } = {}) {
    super(message);
    this.name = "FirecrawlError";
    this.status = status;
    this.retryable = retryable;
    this.pageStatus = pageStatus;
  }
}

const isLocalBase = () => {
  try {
    const url = new URL(FIRECRAWL_BASE);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function http(method, path, body, timeoutMs) {
  if (!isLocalBase()) {
    throw new FirecrawlError(`Firecrawl OSS deve usare un endpoint locale (localhost/loopback): ${FIRECRAWL_BASE}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new FirecrawlError(`Risposta non-JSON da ${path}: ${text.slice(0, 200)}`, {
        status: res.status,
        retryable: RETRYABLE_STATUS.has(res.status),
      });
    }
    return { status: res.status, ok: res.ok, json, text };
  } catch (error) {
    if (error instanceof FirecrawlError) throw error;
    const aborted = error?.name === "AbortError";
    throw new FirecrawlError(aborted ? `Timeout ${timeoutMs}ms su ${path}` : `Firecrawl non raggiungibile (${error?.message ?? error})`, {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth() {
  const started = Date.now();
  try {
    const live = await http("GET", "/v0/health/liveness", null, 5000);
    const ready = await http("GET", "/v0/health/readiness", null, 5000).catch(() => null);
    const ok = live.ok && (ready === null || ready.ok);
    return {
      ok,
      base: FIRECRAWL_BASE,
      liveness: live.status,
      readiness: ready?.status ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, base: FIRECRAWL_BASE, error: error instanceof Error ? error.message : String(error) };
  }
}

const dockerBin = () => {
  const candidates = ["docker", "/usr/local/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker", "/opt/homebrew/bin/docker"];
  return candidates.find((bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0) ?? null;
};

/**
 * Verifica Firecrawl; con `autostart` prova ad avviare lo stack docker locale e attende
 * che l'API risponda (max `waitMs`). Non avvia mai servizi remoti.
 */
export async function ensureFirecrawl({ autostart = false, waitMs = 180_000, log = () => {} } = {}) {
  let health = await checkHealth();
  if (!isLocalBase()) return health;
  if (health.ok || !autostart) return health;
  const docker = dockerBin();
  if (!docker) return { ...health, error: "docker non trovato nel PATH" };
  if (!existsSync(join(FIRECRAWL_DIR, "docker-compose.yaml"))) {
    return { ...health, error: `docker-compose.yaml non trovato in ${FIRECRAWL_DIR}` };
  }
  if (spawnSync(docker, ["info"], { stdio: "ignore" }).status !== 0) {
    log("Docker non attivo: provo ad aprire Docker Desktop...");
    spawnSync("open", ["-a", "Docker"], { stdio: "ignore" });
    const until = Date.now() + waitMs;
    while (Date.now() < until && spawnSync(docker, ["info"], { stdio: "ignore" }).status !== 0) await sleep(3000);
  }
  log(`Avvio Firecrawl OSS (${FIRECRAWL_DIR})...`);
  const up = spawnSync(docker, ["compose", "up", "-d"], { cwd: FIRECRAWL_DIR, encoding: "utf8" });
  if (up.status !== 0) return { ...health, error: `docker compose up fallito: ${(up.stderr || up.stdout).slice(-300)}` };
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    health = await checkHealth();
    if (health.ok) return { ...health, autostarted: true };
    await sleep(3000);
  }
  return { ...health, error: health.error ?? "Firecrawl non pronto entro il tempo limite" };
}

let apiVersion = process.env.FIRECRAWL_API_VERSION ?? null; // "v2" | "v1"

async function scrapeOnce(url, opts) {
  const timeout = opts.timeout ?? 45_000;
  const body = {
    url,
    formats: opts.formats ?? ["markdown", "links"],
    onlyMainContent: opts.onlyMainContent ?? true,
    waitFor: opts.waitFor ?? 0,
    timeout,
    removeBase64Images: true,
    blockAds: true,
  };
  const version = apiVersion ?? "v2";
  const res = await http("POST", `/${version}/scrape`, body, timeout + 20_000);
  if (res.status === 404 && version === "v2" && !apiVersion) {
    apiVersion = "v1";
    return scrapeOnce(url, opts);
  }
  if (!apiVersion && res.ok) apiVersion = version;
  if (!res.ok || res.json?.success === false) {
    const message = res.json?.error ?? res.text.slice(0, 300);
    throw new FirecrawlError(`Firecrawl ${version}/scrape -> HTTP ${res.status}: ${message}`, {
      status: res.status,
      retryable: RETRYABLE_STATUS.has(res.status),
    });
  }
  const doc = res.json?.data ?? res.json ?? {};
  const metadata = doc.metadata ?? {};
  const pageStatus = Number(metadata.statusCode ?? 200);
  if (pageStatus >= 400) {
    throw new FirecrawlError(`La pagina ${url} ha risposto ${pageStatus}`, {
      pageStatus,
      retryable: RETRYABLE_STATUS.has(pageStatus),
    });
  }
  return {
    url,
    finalUrl: metadata.url ?? metadata.sourceURL ?? url,
    markdown: doc.markdown ?? "",
    links: Array.isArray(doc.links) ? doc.links : [],
    title: metadata.title ?? null,
    statusCode: pageStatus,
    metadata,
  };
}

const cachePath = (url, formats) => join(CACHE_DIR, `${sha(`${url}|${formats.join(",")}`).slice(0, 32)}.json`);

function readCache(url, formats, ttlMs) {
  if (!ttlMs) return null;
  try {
    const cached = JSON.parse(readFileSync(cachePath(url, formats), "utf8"));
    if (Date.now() - Date.parse(cached.fetchedAt) <= ttlMs) return { ...cached, fromCache: true };
  } catch {
    // cache assente o corrotta
  }
  return null;
}

function writeCache(url, formats, doc) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(url, formats), JSON.stringify(doc));
}

/**
 * Scrape di una singola URL (con retry e cache). Ritorna
 * { url, finalUrl, markdown, links, title, statusCode, fetchedAt, contentHash, fromCache, attempts }
 * oppure lancia FirecrawlError: mai contenuti inventati.
 */
export async function scrapeUrl(url, opts = {}) {
  const formats = opts.formats ?? ["markdown", "links"];
  const cached = readCache(url, formats, opts.cacheTtlMs ?? 0);
  if (cached) return cached;
  const retries = opts.retries ?? 3;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const doc = await scrapeOnce(url, { ...opts, formats });
      const result = {
        ...doc,
        metadata: undefined,
        fetchedAt: new Date().toISOString(),
        contentHash: sha(doc.markdown),
        fromCache: false,
        attempts: attempt + 1,
      };
      writeCache(url, formats, result);
      return result;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof FirecrawlError ? error.retryable : true;
      if (!retryable || attempt === retries) break;
      const delay = Math.min(15_000, 1000 * 3 ** attempt) + Math.floor(Math.random() * 400);
      opts.onRetry?.({ url, attempt: attempt + 1, delay, error });
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Scrape di più URL con concorrenza limitata e intervallo minimo per host.
 * Ritorna un array nello stesso ordine: { ok: true, ...doc } | { ok: false, url, error, pageStatus }.
 */
export async function scrapeMany(urls, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const perHostDelayMs = opts.perHostDelayMs ?? 400;
  const nextSlot = new Map();
  const results = new Array(urls.length);
  let cursor = 0;

  const waitHost = async (url) => {
    const host = new URL(url).host;
    const now = Date.now();
    const slot = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + perHostDelayMs);
    if (slot > now) await sleep(slot - now);
  };

  const worker = async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      const url = urls[index];
      const started = Date.now();
      try {
        const cached = readCache(url, opts.formats ?? ["markdown", "links"], opts.cacheTtlMs ?? 0);
        if (!cached) await waitHost(url);
        const doc = cached ?? (await scrapeUrl(url, opts));
        results[index] = { ok: true, ...doc, durationMs: Date.now() - started };
      } catch (error) {
        results[index] = {
          ok: false,
          url,
          error: error instanceof Error ? error.message : String(error),
          pageStatus: error?.pageStatus ?? null,
          durationMs: Date.now() - started,
        };
      }
      opts.onProgress?.({ done: results.filter(Boolean).length, total: urls.length, url, result: results[index] });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

/** Compatibilità con la vecchia API (sequenziale). */
export async function crawlUrls(urls, opts = {}) {
  return scrapeMany(urls, { ...opts, concurrency: 1, perHostDelayMs: opts.delayMs ?? 1200 });
}
