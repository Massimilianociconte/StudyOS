// Due account, un browser (contesto) per dispositivo: ogni contesto ha il suo IndexedDB e localStorage,
// come due telefoni diversi. Ogni prova parte e finisce con gli account azzerati sul server.

import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ACCOUNTS, type TestAccount } from "./accounts";
import { openApp, signIn } from "./app";
import { APP_URL, assertLocalApi, resetAccounts } from "./stack";

export interface Device {
  account: TestAccount;
  context: BrowserContext;
  page: Page;
  /** Canali Realtime confermati dal server, in ordine (es. «studyos-groups:<id utente>»). */
  subscribed: string[];
}

/** Quante iscrizioni confermate ha avuto finora un canale (prefisso del nome). */
export const channelMark = (device: Device, prefix: string) => device.subscribed.filter((name) => name.startsWith(prefix)).length;

/** Aspetta una nuova iscrizione confermata del canale dopo `mark` (il canale si rifà quando cambiano gruppi o persone seguite). */
export const waitForChannel = async (device: Device, prefix: string, mark: number) => {
  await expect
    .poll(() => channelMark(device, prefix), { message: `canale Realtime ${prefix}… di ${device.account.label}`, timeout: 15_000 })
    .toBeGreaterThan(mark);
};

interface Fixtures {
  /** URL del database locale (solo per azzerare gli account e per i controlli lato server). */
  db: string;
  /** Un dispositivo nuovo, con l'app aperta e senza accesso. */
  newDevice: (account: TestAccount) => Promise<Device>;
  /** Dispositivi già collegati ai due account. */
  alice: Device;
  bob: Device;
  /** Suffisso unico per i nomi creati da una prova. */
  tag: string;
}

/** Accesso dal pannello Account, poi attesa del canale Realtime dei propri dati (modifiche da altri dispositivi). */
export const signInOn = async (device: Device) => {
  const mark = channelMark(device, "studyos-items:");
  await signIn(device.page, device.account);
  await waitForChannel(device, "studyos-items:", mark);
};

const apiOrigin = () => new URL(assertLocalApi(process.env.E2E_SUPABASE_URL)).origin;
const appOrigin = new URL(APP_URL).origin;

const openDevice = async (browser: Browser, account: TestAccount, problems: string[]): Promise<Device> => {
  const context = await browser.newContext();
  // Niente rete esterna: solo l'app (Vite) e lo stack locale. Una richiesta a un altro Supabase è un errore grave.
  await context.route(
    (url) => url.origin !== appOrigin && url.origin !== apiOrigin(),
    (route) => {
      const url = route.request().url();
      if (/supabase\.(co|in)/i.test(url)) problems.push(`[${account.label}] richiesta a un Supabase non locale: ${url}`);
      return route.abort();
    }
  );
  const page = await context.newPage();
  // Domande del browser (confirm/alert) non previste: si annotano e la prova fallisce alla fine.
  page.on("dialog", (dialog) => {
    problems.push(`[${account.label}] finestra del browser inattesa: ${dialog.message().slice(0, 120)}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("pageerror", (error) => problems.push(`[${account.label}] errore nella pagina: ${error.message.slice(0, 200)}`));
  // Canali Realtime pronti (messaggio del server «Subscribed to PostgreSQL»): una prova «dal vivo»
  // aspetta il canale giusto prima di far scrivere l'altro account, invece di sperare nei tempi.
  const subscribed: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      const text = typeof frame.payload === "string" ? frame.payload : "";
      if (!text.includes("Subscribed to PostgreSQL")) return;
      const channel = /"channel":"([^"]+)"/.exec(text)?.[1];
      if (channel) subscribed.push(channel);
    });
  });
  await openApp(page);
  return { account, context, page, subscribed };
};

export const test = base.extend<Fixtures>({
  db: [
    async ({}, use) => {
      const db = process.env.E2E_DB_URL;
      if (!db) throw new Error("E2E_DB_URL mancante: il global setup non è partito.");
      resetAccounts(db);
      await use(db);
      resetAccounts(db);
    },
    { auto: true }
  ],

  tag: async ({}, use, testInfo) => {
    await use(`${testInfo.title.slice(0, 2)}${Date.now().toString(36).slice(-5)}`);
  },

  newDevice: async ({ browser }, use) => {
    const devices: Device[] = [];
    const problems: string[] = [];
    await use(async (account) => {
      const device = await openDevice(browser, account, problems);
      devices.push(device);
      return device;
    });
    for (const device of devices) await device.context.close().catch(() => undefined);
    expect(problems, "problemi durante la prova").toEqual([]);
  },

  alice: async ({ newDevice }, use) => {
    const device = await newDevice(ACCOUNTS.alice);
    await signInOn(device);
    await use(device);
  },

  bob: async ({ newDevice }, use) => {
    const device = await newDevice(ACCOUNTS.bob);
    await signInOn(device);
    await use(device);
  }
});

export { expect, ACCOUNTS };
