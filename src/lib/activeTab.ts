// StudyOS lavora in UNA scheda (o finestra) attiva alla volta per profilo del browser.
//
// Due schede aperte si cancellavano i dati a vicenda: col vault ogni salvataggio ricifra l'intera
// copia in memoria della scheda (vince l'ultima), una scheda aperta prima di attivare la password
// continuava a scrivere in chiaro, e la sync di una scheda scartava le modifiche in coda dell'altra.
// Ora decide un blocco Web Locks, prima che l'app si monti (src/main.tsx):
// - blocco libero → questa scheda lo tiene finché vive e apre l'app;
// - blocco occupato → solo la schermata di guardia: niente app, niente caricamento, niente scritture;
// - «Usa questa scheda» → messaggio sul BroadcastChannel: l'attiva salva tutto, smette di scrivere
//   e si ricarica (il blocco si libera), la nuova lo riceve e carica i dati dal disco;
// - nessuna risposta entro ~3 s (scheda congelata sullo sfondo) → «Usa comunque qui» prende il
//   blocco con `steal`: la scheda derubata smette subito di scrivere e torna alla guardia senza salvare.
// Senza `navigator.locks` resta il comportamento di prima (nessuna guardia).
//
// Qui solo logica (blocchi, canale e timer iniettati): testabile in Node con finti `locks`.

export const ACTIVE_TAB_LOCK = "studyos-active-tab";
export const ACTIVE_TAB_CHANNEL = "studyos-active-tab";
export const TAKEOVER_TIMEOUT_MS = 3_000;

const TAKEOVER_MESSAGE = "studyos:takeover";
const BUSY = "busy";

/** "elsewhere": aperto in un'altra scheda. "moved": questa scheda ha appena ceduto il posto. */
export type GuardReason = "elsewhere" | "moved";
/** idle: pulsante «Usa questa scheda». waiting: passaggio in corso. slow: l'altra non risponde. */
export type GuardPhase = "idle" | "waiting" | "slow";

export interface GuardView {
  reason: GuardReason;
  phase: GuardPhase;
}

export interface LockRequestOptions {
  ifAvailable?: boolean;
  steal?: boolean;
  signal?: AbortSignal;
}

/** Il sottoinsieme di `navigator.locks` che serve. */
export interface LockManagerLike {
  request: (name: string, options: LockRequestOptions, callback: (lock: unknown) => unknown) => Promise<unknown>;
}

/** Il sottoinsieme di `BroadcastChannel` che serve. */
export interface ChannelLike {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
}

export interface ActiveTabEnv {
  locks?: LockManagerLike | null;
  channel?: ChannelLike | null;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ActiveTabHooks {
  /** Questa scheda è quella attiva: monta l'app (una volta sola). */
  activate: () => void;
  /** Mostra o aggiorna la schermata di guardia. */
  showGuard: (view: GuardView) => void;
  /** Un'altra scheda chiede il posto: salva tutto e smette di scrivere. Se fallisce, si resta attivi. */
  handOff: () => Promise<void>;
  /** Il blocco è stato preso con la forza: smette subito di scrivere, senza salvare. */
  halt: () => void;
  /** Libera il blocco tornando alla guardia (nel browser: ricarica la pagina). */
  leave: () => void;
}

export interface ActiveTabController {
  /** «Usa questa scheda». */
  takeOver: () => void;
  /** «Usa comunque qui»: prende il blocco anche se l'altra scheda non risponde. */
  force: () => void;
}

const isTakeover = (data: unknown) =>
  Boolean(data) && typeof data === "object" && (data as { type?: unknown }).type === TAKEOVER_MESSAGE;

export const startActiveTab = (env: ActiveTabEnv, hooks: ActiveTabHooks, reason: GuardReason = "elsewhere"): ActiveTabController => {
  let state: "deciding" | "guard" | "active" | "leaving" = "deciding";
  let phase: GuardPhase = "idle";
  let waitTimer: unknown = null;
  let queued: AbortController | null = null;
  // Tentativo che tiene il blocco ora: un rifiuto di un tentativo vecchio non conta.
  let attempts = 0;
  let holder = 0;
  // «Usa comunque qui» in corso: un'eventuale richiesta in coda appena concessa a QUESTA scheda
  // viene rubata da noi stessi, e il suo rifiuto non deve fermare la scheda.
  let stealing = false;
  let handingOff = false;

  const controller: ActiveTabController = {
    takeOver: () => {
      if (state !== "guard" || phase !== "idle" || !env.locks) return;
      // In coda PRIMA di avvisare: appena l'altra scheda libera il blocco tocca a questa.
      queued = new AbortController();
      acquire({ signal: queued.signal });
      env.channel?.postMessage({ type: TAKEOVER_MESSAGE });
      show("waiting");
      waitTimer = env.setTimeout(() => {
        waitTimer = null;
        if (state === "guard") show("slow");
      }, TAKEOVER_TIMEOUT_MS);
    },
    force: () => {
      if (state !== "guard" || stealing || !env.locks) return;
      stealing = true;
      queued?.abort();
      queued = null;
      acquire({ steal: true });
    }
  };

  const show = (next: GuardPhase) => {
    phase = next;
    hooks.showGuard({ reason, phase });
  };

  const activate = () => {
    if (state === "active") return;
    state = "active";
    if (waitTimer !== null) env.clearTimeout(waitTimer);
    waitTimer = null;
    hooks.activate();
  };

  const lost = () => {
    if (state !== "active") return;
    state = "leaving";
    hooks.halt();
    hooks.leave();
  };

  const acquire = (options: LockRequestOptions) => {
    const attempt = ++attempts;
    let granted = false;
    let request: Promise<unknown>;
    try {
      request = env.locks!.request(ACTIVE_TAB_LOCK, options, (lock) => {
        if (!lock) return BUSY;
        granted = true;
        holder = attempt;
        if (options.steal) stealing = false;
        activate();
        // Tenuto finché la pagina vive: si libera solo ricaricando o chiudendo la scheda.
        return new Promise<never>(() => undefined);
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      (result) => {
        if (result === BUSY && state === "deciding") {
          state = "guard";
          show("idle");
        }
      },
      () => {
        if (!granted) {
          // La prima richiesta fallita (contesto non sicuro, iframe…): si apre come prima.
          if (options.ifAvailable && state === "deciding") activate();
          return; // richiesta in coda annullata da «Usa comunque qui»
        }
        if (stealing || attempt !== holder) return;
        lost();
      }
    );
  };

  env.channel?.addEventListener("message", (event) => {
    if (!isTakeover(event.data) || state !== "active" || handingOff) return;
    handingOff = true;
    hooks.handOff().then(
      () => {
        if (state !== "active") return;
        state = "leaving";
        hooks.leave();
      },
      () => {
        // Salvataggio non riuscito: si resta attivi (l'errore è già visibile qui); l'altra scheda
        // dopo qualche secondo offre «Usa comunque qui».
        handingOff = false;
      }
    );
  });

  if (!env.locks) {
    activate();
    return controller;
  }
  acquire({ ifAvailable: true });
  return controller;
};

// ——— Nel browser (usato solo da src/main.tsx) ———

// Per scheda: dopo il ricaricamento la guardia dice «passato a un'altra scheda».
const MOVED_KEY = "studyos-tab-moved";
// Tema/palette/densità dell'ultima scheda attiva: la guardia non legge i dati, ma ha lo stesso aspetto.
const LOOK_KEY = "studyos-look";
const LOOK_ATTRIBUTES = ["theme", "palette", "density"] as const;

export const browserActiveTabEnv = (): ActiveTabEnv => {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  let channel: ChannelLike | null = null;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(ACTIVE_TAB_CHANNEL) : null;
  } catch {
    channel = null; // senza canale «Usa comunque qui» compare dopo ~3 s
  }
  return {
    locks: locks && typeof locks.request === "function" ? locks : null,
    channel,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  };
};

/** Motivo della guardia per questa scheda (letto una volta all'avvio). */
export const consumeGuardReason = (): GuardReason => {
  try {
    const moved = window.sessionStorage.getItem(MOVED_KEY) === "1";
    window.sessionStorage.removeItem(MOVED_KEY);
    return moved ? "moved" : "elsewhere";
  } catch {
    return "elsewhere";
  }
};

/** Libera il blocco: la pagina si ricarica e mostra la guardia (l'altra scheda ha già il blocco). */
export const leaveToGuard = () => {
  try {
    window.sessionStorage.setItem(MOVED_KEY, "1");
  } catch {
    // senza sessionStorage la guardia dice «aperto in un'altra scheda»: va bene lo stesso
  }
  window.location.reload();
};

/** Scheda attiva: ricorda l'aspetto scelto (l'app lo mette su <html> dopo il caricamento). */
export const rememberLook = () => {
  const root = document.documentElement;
  const save = () => {
    const look = Object.fromEntries(LOOK_ATTRIBUTES.map((name) => [name, root.dataset[name] ?? ""]));
    try {
      window.localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    } catch {
      // senza storage la guardia usa il tema predefinito
    }
  };
  new MutationObserver(save).observe(root, { attributes: true, attributeFilter: LOOK_ATTRIBUTES.map((name) => `data-${name}`) });
};

/** Guardia: stesso aspetto dell'ultima scheda attiva, se noto. */
export const applyRememberedLook = () => {
  try {
    const look = JSON.parse(window.localStorage.getItem(LOOK_KEY) ?? "null") as Record<string, unknown> | null;
    if (!look || typeof look !== "object") return;
    for (const name of LOOK_ATTRIBUTES) {
      const value = look[name];
      if (typeof value === "string" && /^[a-z0-9-]{1,24}$/.test(value)) document.documentElement.dataset[name] = value;
    }
  } catch {
    // valore rovinato: tema predefinito
  }
};
