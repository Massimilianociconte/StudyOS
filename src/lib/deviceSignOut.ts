// «Ho dimenticato la password»: prima di cancellare i dati questo dispositivo esce dall'account, solo
// qui (gli altri dispositivi restano collegati). Con la sessione ancora salvata, allo sblocco la
// sincronizzazione ripartirebbe e riscaricherebbe tutto senza chiedere la password dell'app.
// Puro e senza supabase-js: la libreria la carica il chiamante con import(), fuori dal bundle iniziale.

/** Sessione di supabase-js nel localStorage: `storageKey` di supabase.ts e i suoi suffissi. */
export const AUTH_STORAGE_KEYS = ["studyos-auth", "studyos-auth-code-verifier", "studyos-auth-user"] as const;

/** Oltre questo tempo il server non ha risposto: la sessione si toglie solo da qui. */
export const SIGN_OUT_TIMEOUT_MS = 8000;

/**
 * - `none`: account non disponibile in questa versione dell'app, niente da fare.
 * - `signed-out`: il server ha chiuso la sessione di questo dispositivo.
 * - `removed-here`: server non raggiungibile o errore; la sessione è tolta solo dal dispositivo e
 *   supabase-js può averne ancora una copia in memoria: il chiamante ricarica l'app dopo la cancellazione.
 */
export type DeviceSignOut = "none" | "signed-out" | "removed-here";

export interface DeviceSignOutEnv {
  /** L'account è configurato in questa versione dell'app. */
  configured: boolean;
  /** Uscita con scope "local" (carica supabase-js). `localOnly`: il server non ha risposto. */
  signOut: () => Promise<{ localOnly: boolean }>;
  removeItem: (key: string) => void;
  /** Toglie subito la sessione dallo stato della sincronizzazione: allo sblocco non riparte. */
  dropSession: () => void;
  /** setTimeout. */
  schedule: (fn: () => void, ms: number) => void;
  timeoutMs?: number;
}

const withTimeout = <T>(run: () => Promise<T>, env: Pick<DeviceSignOutEnv, "schedule" | "timeoutMs">) =>
  new Promise<T>((resolve, reject) => {
    env.schedule(() => reject(new Error("timeout")), env.timeoutMs ?? SIGN_OUT_TIMEOUT_MS);
    run().then(resolve, reject);
  });

/** Va chiamata prima della cancellazione dei dati. Non lancia mai: alla fine la sessione non c'è più. */
export const signOutThisDevice = async (env: DeviceSignOutEnv): Promise<DeviceSignOut> => {
  let outcome: DeviceSignOut = "none";
  if (env.configured) {
    try {
      const result = await withTimeout(env.signOut, env);
      outcome = result.localOnly ? "removed-here" : "signed-out";
    } catch {
      // offline, errore del server o libreria non scaricata
      outcome = "removed-here";
    }
  }
  // Sempre, anche dopo un'uscita riuscita: nessuna sessione resta nello storage o nello stato.
  for (const key of AUTH_STORAGE_KEYS) {
    try {
      env.removeItem(key);
    } catch {
      // storage non disponibile
    }
  }
  env.dropSession();
  return outcome;
};
