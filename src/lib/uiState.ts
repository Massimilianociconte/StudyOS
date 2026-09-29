// Stato dell'interfaccia (sezione aperta, schede, filtri, elemento selezionato, scroll) salvato in
// locale, così un refresh (anche forzato) riapre l'app nello stesso punto. I dati veri restano in
// IndexedDB/cloud: qui solo preferenze di navigazione, mai contenuti.
//
// Due ambiti:
// - "tab": sessionStorage. Sopravvive a refresh e hard refresh della stessa scheda, non si
//   mescola tra schede diverse e sparisce chiudendo la scheda (date del calendario, ricerche,
//   elemento aperto, scroll).
// - "device": anche localStorage, come ripiego quando la scheda è nuova (modalità di
//   visualizzazione, ordinamenti, filtri, ultima sezione per "Vista iniziale: ultima sezione").

import { useEffect, useRef, useState } from "react";

export type UiScope = "tab" | "device";

const STORAGE_KEY = "studyos-ui";

type Bag = Record<string, unknown>;

const storageFor = (kind: "session" | "local"): Storage | null => {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null; // storage bloccato (es. navigazione privata restrittiva)
  }
};

const readBag = (storage: Storage | null): Bag => {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Bag) : {};
  } catch {
    return {};
  }
};

const writeBag = (storage: Storage | null, bag: Bag) => {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(bag));
  } catch {
    // quota piena o storage bloccato: lo stato UI è un di più, l'app funziona comunque
  }
};

const hasWindow = typeof window !== "undefined";
const session = hasWindow ? storageFor("session") : null;
const local = hasWindow ? storageFor("local") : null;
const tabBag: Bag = readBag(session);
const deviceBag: Bag = readBag(local);

/** Valore salvato: prima quello della scheda, poi (solo ambito "device") quello del dispositivo. */
export const readUiState = (key: string, scope: UiScope): unknown => {
  if (key in tabBag) return tabBag[key];
  return scope === "device" ? deviceBag[key] : undefined;
};

export const writeUiState = (key: string, value: unknown, scope: UiScope) => {
  if (tabBag[key] !== value) {
    tabBag[key] = value;
    writeBag(session, tabBag);
  }
  if (scope === "device" && deviceBag[key] !== value) {
    deviceBag[key] = value;
    writeBag(local, deviceBag);
  }
};

/** Solo il valore del dispositivo (usato per "Vista iniziale: ultima sezione aperta"). */
export const readDeviceUiState = (key: string): unknown => deviceBag[key];

/** Solo il valore di questa scheda (refresh, hard refresh, scheda ripristinata dal browser). */
export const readTabUiState = (key: string): unknown => tabBag[key];

export const clearUiState = () => {
  for (const bag of [tabBag, deviceBag]) for (const key of Object.keys(bag)) delete bag[key];
  try {
    session?.removeItem(STORAGE_KEY);
    local?.removeItem(STORAGE_KEY);
  } catch {
    // niente da pulire
  }
};

export const oneOf =
  <T extends string>(...values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (values as readonly string[]).includes(value);

export const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

/**
 * useState che ricorda il valore tra i refresh. `key` è globale ("vista.campo"); `validate`
 * scarta valori salvati non più validi (default: stesso tipo del valore iniziale).
 */
export function useUiState<T>(
  key: string,
  initial: T | (() => T),
  { scope = "device", validate }: { scope?: UiScope; validate?: (value: unknown) => boolean } = {}
) {
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === "function" ? (initial as () => T)() : initial;
    const stored = readUiState(key, scope);
    if (stored === undefined) return fallback;
    const ok = validate ? validate(stored) : fallback !== null && typeof stored === typeof fallback;
    return ok ? (stored as T) : fallback;
  });
  useEffect(() => {
    writeUiState(key, value, scope);
  }, [key, value, scope]);
  return [value, setValue] as const;
}

const USER_INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Ricorda la sezione aperta e la sua posizione di scroll. Al primo avvio della pagina (refresh)
 * riporta lo scroll dov'era, aspettando che la vista (caricata in differita) sia abbastanza alta;
 * si ferma se l'utente scorre o tocca prima. Cambiando sezione dall'app si riparte dall'alto.
 */
export function useViewMemory(view: string, ready: boolean) {
  // undefined = da leggere; null = niente da ripristinare. Legato alla vista: se l'utente cambia
  // sezione prima che il ripristino finisca, la nuova sezione parte dall'alto. Sopravvive al
  // doppio effetto di StrictMode (il cleanup non lo azzera).
  const pendingRef = useRef<{ view: string; target: number } | null | undefined>(undefined);

  useEffect(() => {
    if (ready) writeUiState("view", view, "device");
  }, [view, ready]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      // non supportato: il browser gestisce lo scroll da sé
    }
    const key = `scroll.${view}`;
    if (pendingRef.current === undefined) {
      const saved = readTabUiState(key);
      pendingRef.current = typeof saved === "number" && saved > 0 ? { view, target: saved } : null;
    }
    const pending = pendingRef.current?.view === view ? pendingRef.current : null;
    let restoring = 0;
    let saveTimer = 0;

    const cancelRestore = () => {
      window.clearTimeout(restoring);
      restoring = 0;
    };
    const abandonRestore = () => {
      cancelRestore();
      pendingRef.current = null;
    };

    if (pending) {
      // Polling con timer (non requestAnimationFrame): funziona anche se la scheda è in background.
      const started = performance.now();
      const attempt = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max >= pending.target || performance.now() - started > 2500) {
          restoring = 0;
          pendingRef.current = null;
          window.scrollTo(0, Math.min(pending.target, Math.max(0, max)));
          return;
        }
        restoring = window.setTimeout(attempt, 50);
      };
      restoring = window.setTimeout(attempt, 0);
      for (const type of USER_INPUT_EVENTS) window.addEventListener(type, abandonRestore, { passive: true, once: true });
    } else {
      pendingRef.current = null;
      window.scrollTo(0, 0);
    }

    const save = () => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      if (!restoring) writeUiState(key, Math.round(window.scrollY), "tab");
    };
    const onScroll = () => {
      if (!saveTimer) saveTimer = window.setTimeout(save, 150);
    };
    // iOS può chiudere l'app in background senza pagehide: l'ultimo evento affidabile è "hidden".
    const onHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelRestore();
      window.clearTimeout(saveTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
      for (const type of USER_INPUT_EVENTS) window.removeEventListener(type, abandonRestore);
    };
  }, [view, ready]);
}
