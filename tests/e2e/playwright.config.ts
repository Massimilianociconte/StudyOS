import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { APP_URL, DEFAULT_API, REPO_ROOT, assertLocalApi } from "./support/stack";

// Rifiuta di partire se l'URL di Supabase non è lo stack locale (http://127.0.0.1:5542x).
process.env.E2E_SUPABASE_URL = assertLocalApi(process.env.E2E_SUPABASE_URL ?? DEFAULT_API);

const cache = path.join(REPO_ROOT, ".cache/ai/e2e");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  globalSetup: "./global-setup.ts",
  // Gli stessi due account in ogni prova: una alla volta, ognuna parte da account azzerati.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(cache, "test-results"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(cache, "report"), open: "never" }],
    ["json", { outputFile: path.join(cache, "results.json") }]
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `${APP_URL}/`,
    viewport: { width: 1440, height: 1000 },
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
