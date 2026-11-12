// Chi guarda i dati condivisi e la sua generazione. Usato da shareSync.ts; sta a parte perché non
// dipende da supabase-js né dalla sessione, così si prova in Node (tests/sharedStore.test.mjs).
//
// Ogni cambio di chi guarda (accesso, logout, altro account, blocco/sblocco del vault, cambio di
// modalità, reset locale) fa salire la generazione: una passata, un invio o una rilettura partiti
// prima si fermano senza toccare lo store, e la passata nuova parte solo a store ricaricato.

import { useSharedStore } from "../store/useSharedStore";

export class ViewerChanged extends Error {
  constructor() {
    super("Account cambiato durante l'aggiornamento.");
    this.name = "ViewerChanged";
  }
}

export interface ViewerHooks {
  /** Subito, a ogni richiesta di cambio (prima della fila). */
  requested?: () => void;
  /** All'inizio di ogni cambio, in fila: Realtime fermo, cache in memoria dimenticate. */
  reset: () => Promise<void>;
  isLocked: () => boolean;
  /** Cache su disco (false col vault: solo memoria). */
  isPersistent: () => boolean;
  /** Store caricato per la generazione corrente: può partire la prima passata. */
  ready: () => void;
  /**
   * Subito, quando l'account di prima se ne va (logout, anche involontario, o altro account): ciò che
   * era in sospeso per lui su questo dispositivo (un invito aperto da link) non passa al prossimo.
   */
  accountLeft?: () => void;
}

/** Ciò che conta dello stato di useStudyStore: vault bloccato e modalità di sicurezza. */
export interface StudyFlags {
  locked: boolean;
  mode: string;
}

export interface ViewerLifecycle {
  readonly generation: number;
  readonly viewer: string | null;
  /** Lo store è caricato per `gen`: solo allora parte una passata. */
  isHydrated: (gen: number) => boolean;
  /** Da chiamare dopo ogni attesa e prima di toccare lo store: un risultato di un'altra generazione si scarta. */
  still: (gen: number) => void;
  /** Sessione cambiata: accesso, logout, altro account. */
  setViewer: (next: string | null) => void;
  /** Blocco o sblocco del vault, vault attivato o tolto. */
  studyChanged: (curr: StudyFlags, prev: StudyFlags) => void;
  /** Reset locale con l'account ancora collegato (resetAllData → clear()): ricarica senza ricaricare la pagina. */
  watch: () => () => void;
  /** Fine dei cambi in fila. */
  settled: () => Promise<void>;
}

export const createViewerLifecycle = (hooks: ViewerHooks): ViewerLifecycle => {
  /** Sale a ogni cambio di chi guarda. */
  let generation = 0;
  /** Generazione per cui lo store è caricato (hydrate concluso). */
  let hydrated = -1;
  let current: string | null = null;
  let switching: Promise<void> = Promise.resolve();

  const switchViewer = async (next: string | null, previous: string | null, gen: number) => {
    await hooks.reset();
    const store = useSharedStore.getState();
    if (!next) {
      // Logout vero (c'era un account): via i dati altrui anche dal disco. Le scritture ancora in
      // coda si perdono: senza sessione non si possono inviare.
      if (previous) await store.clear();
      store.setAvailability("off");
      return;
    }
    // Vault bloccato: dati altrui fuori dalla memoria (la cache su disco, se c'è, resta). Lo sblocco li ricarica.
    if (hooks.isLocked()) {
      store.forgetMemory();
      return;
    }
    await store.hydrate(next, hooks.isPersistent());
    // Un altro cambio è arrivato durante il caricamento: è già in coda e decide lui.
    if (gen !== generation) return;
    hydrated = gen;
    hooks.ready();
  };

  /** Le risposte in corso si scartano subito; i caricamenti dello store si eseguono in fila. */
  const requestSwitch = (next: string | null, previous: string | null) => {
    generation += 1;
    hooks.requested?.();
    const gen = generation;
    switching = switching.then(() => switchViewer(next, previous, gen)).catch(() => undefined);
  };

  return {
    get generation() {
      return generation;
    },
    get viewer() {
      return current;
    },
    isHydrated: (gen) => hydrated === gen,
    still: (gen) => {
      if (gen !== generation) throw new ViewerChanged();
    },
    setViewer: (next) => {
      if (next === current) return;
      const previous = current;
      current = next;
      if (previous) hooks.accountLeft?.();
      requestSwitch(next, previous);
    },
    studyChanged: (curr, prev) => {
      if (!prev.locked && curr.locked) {
        // Subito fuori dalla memoria; il cambio in coda lo ripete dopo un eventuale caricamento in corso.
        useSharedStore.getState().forgetMemory();
        requestSwitch(current, current);
        return;
      }
      if (curr.locked || !current) return;
      // Sblocco, oppure vault attivato o tolto: la cache passa da disco a memoria (o viceversa) da capo.
      if (prev.locked || curr.mode !== prev.mode) requestSwitch(current, current);
    },
    // Il blocco del vault (forgetMemory) toglie anch'esso viewerId, ma lì ci pensa lo sblocco.
    watch: () =>
      useSharedStore.subscribe((curr, prev) => {
        if (prev.viewerId && !curr.viewerId && current && !hooks.isLocked()) requestSwitch(current, current);
      }),
    settled: async () => {
      // Anche i cambi chiesti mentre si aspetta (es. il reset locale durante un caricamento).
      let last: Promise<void>;
      do {
        last = switching;
        await last;
      } while (last !== switching);
    }
  };
};
