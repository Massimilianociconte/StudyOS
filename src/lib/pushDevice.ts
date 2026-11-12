// Notifiche push di questo dispositivo, il pezzo che serve anche nel bundle d'ingresso (App, schermata
// di blocco): spegnerle prima di un'uscita o di una cancellazione, e seguire la sessione quando finisce
// da sola. push.ts (e supabase-js) arriva solo con import(), come vuole il bundle iniziale.
// Nessun import di moduli che leggono import.meta.env: i test lo caricano in Node.
import type { CloudSyncState } from "./cloudSyncState";

type PushModule = Pick<typeof import("./push"), "disablePush" | "syncPushSubscription" | "dropPushOfEndedSession">;
const loadPush = (): Promise<PushModule> => import("./push");

/** Massima attesa per spegnere le notifiche: la rete lenta non blocca l'uscita né la cancellazione. */
export const PUSH_OFF_TIMEOUT_MS = 5000;

/**
 * Le notifiche di questo dispositivo sono cambiate (accese o spente): la sincronizzazione dei
 * promemoria con l'app chiusa ricontrolla subito quanti dispositivi le ricevono.
 */
export const PUSH_CHANGED_EVENT = "studyos:push-changed";

export const notifyPushChanged = () => {
  try {
    window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
  } catch {
    // fuori dal browser: nessuno ascolta
  }
};

/**
 * Unico modo di spegnere le notifiche di questo dispositivo prima di un'uscita dall'account o di una
 * cancellazione dei dati («Esci», «Esci e togli i dati», «Ho dimenticato la password», «Cancella
 * tutti i dati»): annulla l'iscrizione del browser e toglie la sua riga sul server, finché la
 * sessione c'è ancora. Così le notifiche di questo account (inviti, promemoria) non arrivano a chi
 * usa il dispositivo dopo. Al più `timeoutMs`; non lancia mai.
 */
export const turnOffPushHere = async (timeoutMs: number = PUSH_OFF_TIMEOUT_MS, load: () => Promise<PushModule> = loadPush): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      load().then((module) => module.disablePush()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      })
    ]);
  } catch {
    // modulo non scaricato (offline): la sessione esce lo stesso
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  notifyPushChanged();
};

/**
 * Segue la sessione per le notifiche di questo dispositivo (da App, una volta all'avvio, con
 * subscribeCloudSync):
 * - entra un account → riallinea l'iscrizione (syncPushSubscription: endpoint, chiave, account cambiato);
 * - la sessione non c'è o finisce da sola (scaduta, revocata, uscita da un'altra scheda o da un altro
 *   dispositivo) → se le notifiche erano dell'account uscito, l'iscrizione del browser si annulla
 *   (dropPushOfEndedSession). Anche all'avvio: la sessione può essere finita ad app chiusa.
 * Con il permesso non concesso non c'è niente da seguire. Restituisce la funzione di arresto.
 */
export const startPushSessionGuard = (
  subscribe: (listener: (state: Pick<CloudSyncState, "session">) => void) => () => void,
  load: () => Promise<PushModule> = loadPush
): (() => void) => {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return () => undefined;
  let lastUserId: string | null | undefined;
  return subscribe((state) => {
    const userId = state.session?.user.id ?? null;
    if (userId === lastUserId) return;
    lastUserId = userId;
    void load()
      .then(async (module) => {
        if (userId) await module.syncPushSubscription();
        else await module.dropPushOfEndedSession();
      })
      .catch(() => undefined);
  });
};
