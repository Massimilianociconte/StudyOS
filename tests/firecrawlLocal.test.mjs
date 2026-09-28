import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Firecrawl OSS non invia richieste a un endpoint cloud configurato per errore", async () => {
  const previousBase = process.env.FIRECRAWL_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
  globalThis.fetch = async () => {
    throw new Error("La richiesta di rete non doveva partire");
  };
  try {
    const { scrapeUrl } = await import("../scripts/university/firecrawlLocal.mjs?test-remote-base");
    await assert.rejects(
      scrapeUrl("https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico", { retries: 0, cacheTtlMs: 0 }),
      /localhost|loopback|locale/i
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.FIRECRAWL_BASE_URL;
    else process.env.FIRECRAWL_BASE_URL = previousBase;
  }
});

test("Firecrawl OSS legge la chiave locale dello stack senza includerla nel sorgente", async () => {
  const directory = mkdtempSync(join(tmpdir(), "studyos-firecrawl-"));
  writeFileSync(join(directory, ".env"), 'TEST_API_KEY="fc-from-local-env"\n');
  const previous = {
    base: process.env.FIRECRAWL_BASE_URL,
    dir: process.env.FIRECRAWL_DIR,
    key: process.env.FIRECRAWL_API_KEY,
    testKey: process.env.TEST_API_KEY,
    fetch: globalThis.fetch
  };
  process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
  process.env.FIRECRAWL_DIR = directory;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.TEST_API_KEY;
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    seen.push(options.headers.Authorization);
    return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
  };
  try {
    const { checkHealth } = await import("../scripts/university/firecrawlLocal.mjs?test-env-key");
    assert.equal((await checkHealth()).ok, true);
    assert.deepEqual(seen, ["Bearer fc-from-local-env", "Bearer fc-from-local-env"]);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["FIRECRAWL_BASE_URL", previous.base],
      ["FIRECRAWL_DIR", previous.dir],
      ["FIRECRAWL_API_KEY", previous.key],
      ["TEST_API_KEY", previous.testKey]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
