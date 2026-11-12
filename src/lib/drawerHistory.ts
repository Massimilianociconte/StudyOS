// Indietro del browser (o di Android) chiude il drawer aperto invece di uscire dall'app.
// Logica pura, senza DOM: il collegamento a `window.history` sta in `Drawer` (src/components/ui.tsx).
//
// Ogni drawer aperto aggiunge una voce alla cronologia (pushState, stesso indirizzo). Indietro toglie
// quella voce: il drawer in cima riceve `onBack` (= il suo onClose). Se resta aperto (es. conferma
// «Scartare le modifiche?») la voce si rimette, così il prossimo Indietro funziona ancora. Chiuso in
// altro modo (✕, Esc, sfondo, salvataggio) il drawer toglie la sua voce con un Indietro, ma solo se è
// ancora quella corrente. Le voci hanno un numero crescente: dal numero della voce raggiunta si capisce
// quali voci sono state superate, anche con due Indietro veloci o con Avanti.

/** Chiave nello stato della cronologia: `history.pushState({ studyosDrawer: id }, "")`. */
export const DRAWER_STATE_KEY = "studyosDrawer";

export interface DrawerHistoryEnv {
  /** Aggiunge una voce con questo id (pushState, senza cambiare indirizzo). */
  push: (id: string) => void;
  /** Mette questo id nella voce corrente (replaceState, senza cambiare indirizzo). */
  replace: (id: string) => void;
  /** Sposta la cronologia (history.go): asincrono, arriva come popstate. */
  go: (delta: number) => void;
  /** Id della voce corrente, o null se non è di un drawer. */
  current: () => string | null;
  /** Timer (setTimeout). */
  schedule: (fn: () => void, ms: number) => void;
}

/** onBack: chiedi la chiusura. `false` = resta aperto (la voce torna subito). */
export type DrawerBack = () => boolean | void;

type OpenDrawer = { token: symbol; onBack: DrawerBack; seq: number | null; asked: boolean };
type Entry = { seq: number; drawer: OpenDrawer | null };

/** Dopo un Indietro rifiutato senza nuovo disegno, la voce si rimette comunque. */
export const SETTLE_MS = 300;
/** Un Indietro chiesto da noi che non arriva non blocca le aperture successive. */
export const PENDING_MS = 1000;

export function createDrawerHistory(env: DrawerHistoryEnv) {
  // Un prefisso per caricamento di pagina: le voci rimaste da un caricamento precedente non si confondono.
  const loadId = Math.random().toString(36).slice(2, 10);
  let counter = 0;
  /** Drawer aperti, dal più vecchio al più recente. */
  const drawers: OpenDrawer[] = [];
  /** Le nostre voci nella cronologia, dal basso verso l'alto (drawer null = già chiuso, voce da togliere). */
  let entries: Entry[] = [];
  /** Spostamenti chiesti da noi e non ancora arrivati: intanto nessuna nuova voce. */
  let pending = 0;
  let pendingRound = 0;

  const idOf = (seq: number) => `${loadId}:${seq}`;
  /** Numero della voce, 0 se non è nostra (pagina o voce di un caricamento precedente). */
  const seqOf = (id: unknown) => {
    if (typeof id !== "string") return 0;
    const [prefix, seq] = id.split(":");
    return prefix === loadId && Number(seq) > 0 ? Number(seq) : 0;
  };

  const travel = (delta: number) => {
    pending += 1;
    const round = ++pendingRound;
    env.go(delta);
    env.schedule(() => {
      if (round !== pendingRound || pending === 0) return;
      pending = 0;
      flush();
    }, PENDING_MS);
  };

  const push = (drawer: OpenDrawer) => {
    counter += 1;
    // Ricarica con un drawer aperto: la pagina riparte sulla voce di quel drawer. Il primo drawer la
    // riusa invece di aggiungerne un'altra, così le ricariche non lasciano Indietro a vuoto.
    const current = env.current();
    if (!entries.length && current !== null && seqOf(current) === 0) env.replace(idOf(counter));
    else env.push(idOf(counter));
    drawer.seq = counter;
    drawer.asked = false;
    entries.push({ seq: counter, drawer });
  };

  /** Toglie in un colpo le voci in cima dei drawer già chiusi, se la cronologia è dove pensiamo. */
  const trim = () => {
    if (pending) return;
    let stale = 0;
    for (let index = entries.length - 1; index >= 0 && !entries[index].drawer; index -= 1) stale += 1;
    if (!stale) return;
    if (env.current() !== idOf(entries[entries.length - 1].seq)) return;
    travel(-stale);
  };

  /** Drawer aperti senza voce e non in chiusura (aperti durante un Indietro in corso): ora la ricevono. */
  const flush = () => {
    if (pending) return;
    for (const drawer of drawers) if (drawer.seq === null && !drawer.asked) push(drawer);
    trim();
  };

  const settle = (token: symbol) => {
    const drawer = drawers.find((item) => item.token === token);
    if (!drawer || drawer.seq !== null) return;
    drawer.asked = false;
    if (!pending) push(drawer);
  };

  return {
    open(onBack: DrawerBack): symbol {
      const drawer: OpenDrawer = { token: Symbol("drawer"), onBack, seq: null, asked: false };
      drawers.push(drawer);
      if (!pending) push(drawer);
      return drawer.token;
    },

    /** Il drawer si è chiuso (in qualunque modo) o non c'è più. */
    close(token: symbol) {
      const index = drawers.findIndex((item) => item.token === token);
      if (index < 0) return;
      const [drawer] = drawers.splice(index, 1);
      const entry = entries.find((item) => item.drawer === drawer);
      if (entry) entry.drawer = null;
      drawer.seq = null;
      trim();
    },

    /** Il drawer è ancora aperto dopo un Indietro: rimette la sua voce se manca. */
    settle,

    /** popstate: `state` è event.state. */
    popstate(state: unknown) {
      const id = state && typeof state === "object" ? (state as Record<string, unknown>)[DRAWER_STATE_KEY] : null;
      const seq = seqOf(id);
      if (pending) pending -= 1;
      const top = entries.length ? entries[entries.length - 1].seq : 0;
      if (seq > top) {
        // Avanti su una voce di un drawer già chiuso: si torna dov'eravamo.
        travel(-1);
        return;
      }
      const passed = entries.filter((entry) => entry.seq > seq);
      entries = entries.filter((entry) => entry.seq <= seq);
      // Dal più recente: con drawer annidati un Indietro supera solo la voce di quello in cima.
      const asked: OpenDrawer[] = [];
      for (const entry of passed.reverse()) {
        const drawer = entry.drawer;
        if (!drawer) continue;
        drawer.seq = null;
        if (drawer.asked) continue;
        drawer.asked = true;
        asked.push(drawer);
      }
      for (const drawer of asked) {
        if (drawer.onBack() === false) settle(drawer.token);
        else env.schedule(() => settle(drawer.token), SETTLE_MS);
      }
      flush();
    },

    get size() {
      return drawers.length;
    }
  };
}
