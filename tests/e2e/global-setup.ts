// Prima di tutte le prove: stack locale pronto (schema e account), poi un solo server Vite con
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY passate in linea (niente .env.local).

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import {
  APP_PORT,
  APP_URL,
  REPO_ROOT,
  assertLocalApi,
  assertSchemaReady,
  ensureAccounts,
  readStackEnv,
  resetAccounts
} from "./support/stack";

const waitForApp = async (child: ChildProcess, timeoutMs: number) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Vite si è chiuso subito (codice ${child.exitCode}): la porta ${APP_PORT} è libera?`);
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
    } catch {
      // non ancora in ascolto
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite non risponde su ${APP_URL} dopo ${timeoutMs / 1000} s.`);
};

export default async function globalSetup(_config: FullConfig) {
  const stack = readStackEnv();
  // L'URL letto dallo stack deve essere quello per cui la configurazione ha dato il via libera.
  assertLocalApi(process.env.E2E_SUPABASE_URL);
  if (stack.apiUrl !== process.env.E2E_SUPABASE_URL) {
    throw new Error(`Lo stack risponde su ${stack.apiUrl}, la configurazione si aspetta ${process.env.E2E_SUPABASE_URL}.`);
  }
  assertSchemaReady(stack.dbUrl);
  await ensureAccounts(stack);
  resetAccounts(stack.dbUrl);

  // Ai test (stesso processo e worker) servono solo URL del database locale e dell'API: la chiave resta a Vite.
  process.env.E2E_DB_URL = stack.dbUrl;

  const vite = spawn(process.execPath, [path.join(REPO_ROOT, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: stack.apiUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
      // Nessun hub degli agenti: le prove non parlano con servizi esterni.
      VITE_AGENT_HUB_ORIGIN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  const keep = (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-4000);
  };
  vite.stdout?.on("data", keep);
  vite.stderr?.on("data", keep);
  try {
    await waitForApp(vite, 60_000);
  } catch (error) {
    vite.kill("SIGTERM");
    throw new Error(`${(error as Error).message}\nUltime righe di Vite:\n${log.replace(/sb_publishable_[A-Za-z0-9_-]+/g, "sb_publishable_…")}`);
  }

  return async () => {
    resetAccounts(stack.dbUrl);
    if (vite.exitCode === null) {
      vite.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        vite.once("exit", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
  };
}
