// Più persone sullo stesso connettore: ogni browser collegato dichiara il nome del profilo
// (Impostazioni → Profilo) e l'hub manda ogni azione ai browser dell'account scelto in chat.
// Logica pura: la usano l'hub e i test.
import type { BridgeSite } from "./hubEndpoint";

export const UNNAMED_ACCOUNT = "Senza nome";
/** Browser non più visti da tanto: l'hub li dimentica, così un account sparito non resta tra le scelte. */
export const BROWSER_FORGET_MS = 30 * 24 * 60 * 60_000;
const NAME_MAX = 80;
const BROWSER_ID = /^[A-Za-z0-9_-]{8,80}$/;

export interface BridgeBrowser {
  id: string;
  /** accountKey del nome: i browser con lo stesso nome sono lo stesso account. */
  key: string;
  label: string;
  site: BridgeSite;
  lastSeen: number;
  /** Versione dell'app che non dichiara il browser: vale come account senza nome e non si salva. */
  legacy?: boolean;
}

export interface AccountView {
  key: string;
  name: string;
  connected: boolean;
}

export type AccountChoice =
  | { ok: true; key: string; name: string }
  | { ok: false; code: "invalid" | "not_found"; error: string };

/** Nome confrontabile: minuscole, senza accenti né punteggiatura. «Cicónte, M.» → «ciconte m». */
export const accountKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const cleanAccountName = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";

/** `name` assente = il browser non lo sa ancora (vault chiuso): si tiene quello già noto. */
export const parseBrowserInfo = (value: unknown): { id: string; name?: string } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, name } = value as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || !BROWSER_ID.test(id)) return null;
  return typeof name === "string" ? { id, name: cleanAccountName(name) } : { id };
};

export const accountLabel = (name: string) => name || UNNAMED_ACCOUNT;

/** Un account per nome. Un browser vecchio senza dichiarazione conta solo finché è collegato. */
export const listAccounts = (browsers: Iterable<BridgeBrowser>, now: number, freshMs: number): AccountView[] => {
  const byKey = new Map<string, { name: string; seen: number; connected: boolean }>();
  for (const browser of browsers) {
    const fresh = now - browser.lastSeen < freshMs;
    if (browser.legacy && !fresh) continue;
    const current = byKey.get(browser.key);
    if (!current) {
      byKey.set(browser.key, { name: browser.label, seen: browser.lastSeen, connected: fresh });
      continue;
    }
    if (browser.lastSeen > current.seen) {
      current.seen = browser.lastSeen;
      if (browser.label) current.name = browser.label;
    }
    current.connected ||= fresh;
  }
  return [...byKey.entries()]
    .map(([key, value]) => ({ key, name: value.name, connected: value.connected }))
    .sort((left, right) => accountLabel(left.name).localeCompare(accountLabel(right.name), "it"));
};

const namesOf = (accounts: readonly AccountView[]) => accounts.map((account) => accountLabel(account.name)).join(", ");

const covers = (whole: string[], part: string[]) => part.length > 0 && part.every((token) => whole.includes(token));

/**
 * Sceglie l'account dal nome scritto in chat. Con un solo account il nome si può omettere; con più
 * account serve sempre, così un'azione non finisce nell'account sbagliato. «Camilla» trova «Camilla
 * Rossi» e «Camilla Rossi» trova un profilo chiamato solo «Camilla», se non ci sono altre Camilla.
 */
export const chooseAccount = (accounts: readonly AccountView[], query: string | undefined): AccountChoice => {
  const asked = cleanAccountName(query);
  if (!asked) {
    if (accounts.length <= 1) return { ok: true, key: accounts[0]?.key ?? "", name: accounts[0]?.name ?? "" };
    return {
      ok: false,
      code: "invalid",
      error: `A questo connettore sono collegati più account: ${namesOf(accounts)}. Chiedi alla persona quale usare e ripeti passando account con quel nome.`
    };
  }
  const key = accountKey(asked);
  const named = accounts.filter((account) => account.key);
  const exact = named.find((account) => account.key === key);
  if (exact) return { ok: true, key: exact.key, name: exact.name };
  const tokens = key.split(" ").filter(Boolean);
  const matches = named.filter((account) => {
    const own = account.key.split(" ");
    return covers(own, tokens) || covers(tokens, own);
  });
  if (matches.length === 1) return { ok: true, key: matches[0].key, name: matches[0].name };
  if (matches.length > 1) {
    return {
      ok: false,
      code: "invalid",
      error: `«${asked}» corrisponde a più account: ${namesOf(matches)}. Ripeti con il nome completo.`
    };
  }
  return {
    ok: false,
    code: "not_found",
    error: accounts.length
      ? `Nessun account collegato si chiama «${asked}». Account collegati: ${namesOf(accounts)}. Per aggiungerne uno, quella persona apre StudyOS nel suo browser, scrive il suo nome in Impostazioni → Profilo e collega il browser in Impostazioni → Agenti con la stessa chiave.`
      : `Nessun account è collegato. Apri StudyOS, scrivi il tuo nome in Impostazioni → Profilo e collega il browser in Impostazioni → Agenti.`
  };
};

// --- Connettore remoto di un account: https://<hub>/u/<nome>/mcp ---

const CLOUD_PATH = /^\/u\/([^/]{1,160})\/mcp\/?$/;

/** «Camilla Rossi», «camilla-rossi» e «Camilla%20Rossi» danno tutti `camilla-rossi`. */
export const cloudSlug = (raw: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const key = accountKey(decoded.replace(/[-_+.]/g, " "));
  if (!key || key.length > NAME_MAX) return null;
  return key.replace(/ /g, "-");
};

/** Percorso del connettore remoto: slug normalizzato e nome con cui cercare l'account. */
export const cloudPathOf = (pathname: string): { slug: string; query: string } | null => {
  const match = CLOUD_PATH.exec(pathname);
  if (!match) return null;
  const slug = cloudSlug(match[1]);
  return slug ? { slug, query: slug.replace(/-/g, " ") } : null;
};

export const cloudMcpPath = (slug: string) => `/u/${slug}/mcp`;
