// Condivisione: pulsanti e pannelli, dettagli altrui, inviti, cronologia e ripristini.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.
import type { RevertSummary } from "../shareHistory";
import type { InviteBlock, ItemRevision, ShareInviteStatus, ShareScope } from "../sharing";

/** "Condividi" come voce del menu "Altre azioni". */
export const SHARE_ACTION_LABEL = "Condividi";

export const SHARE_SCOPE_HINT: Record<ShareScope, string> = {
  calendar: "Eventi e lezioni, compresi gli appelli che hai aggiunto",
  barb_exams: "Solo gli appelli ufficiali che hai scelto (in sola lettura)",
  tasks: "Le cose da fare, con scadenza",
  study: "Sessioni di studio e argomenti da ripassare",
  progress: "Esami ancora da sostenere e preparazione, mai i voti",
  materials: "File, link e note",
  goals: "I tuoi traguardi"
};

export const SHARE_INVITE_STATUS_LABEL: Record<ShareInviteStatus, string> = {
  pending: "In attesa",
  accepted: "Accettato",
  declined: "Rifiutato",
  expired: "Scaduto"
};

/**
 * Testi del dettaglio di un elemento di un'altra persona. `who` è il nome di chi condivide già adatto
 * a una frase ("Giulia Rossi", "un'altra persona"; vedi actorInSentence): i testi aggiungono "Di", "a", "dai dati di".
 */
export const SHARED_ITEM_TEXT = {
  gone: "Questo elemento non è più condiviso con te.",
  invalidField: (label: string) => `Controlla «${label}»: serve un valore valido.`,
  readOnlyIntro: (who: string) => `Di ${who}: puoi solo vedere.`,
  editIntro: (who: string) => `Di ${who}: le modifiche arrivano subito anche a ${who}, che può ripristinarle dalla cronologia.`,
  deleteConfirm: (title: string, who: string) => `Eliminare «${title}» dai dati di ${who}? Resta nella sua cronologia e può ripristinarlo.`,
  // Chiudere (✕, Esc, tocco fuori, Indietro, «Annulla») con campi cambiati: la domanda sul posto dei pulsanti.
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: (who: string) => `Hai cambiato questo elemento di ${who} senza salvarlo.`,
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche"
} as const;

/** Perché un invito aperto da link non si può accettare (il link salvato su questo dispositivo si toglie). */
export const SHARE_INVITE_BLOCKED: Record<InviteBlock, string> = {
  invalid: "Link non valido, oppure l'invito è stato annullato.",
  own: "È un tuo invito: mandalo a un'altra persona.",
  otherAccount: "Questo invito è per un altro indirizzo email: accedi con quell'account e riapri il link.",
  accepted: "Invito già usato.",
  declined: "Invito rifiutato.",
  expired: "Invito scaduto: chiedine uno nuovo."
};

/** Schede della sezione Condivisione. */
export const SHARING_TAB_LABEL = {
  mine: "Condivisi da me",
  received: "Condivisi con me",
  invites: "Inviti",
  history: "Modifiche di altri"
} as const;

/** Testi del pulsante e del pannello Condividi che non dipendono da un valore enum. */
export const SHARE_TEXT = {
  opening: "Apro…",
  loadFailed: "Non riesco ad aprire Condividi: controlla la connessione e riprova. Se succede ancora, ricarica la pagina.",
  done: "Fatto",
  linkOnce: "Il link non si può rivedere dopo aver chiuso questa finestra: se lo perdi, crea un nuovo invito.",
  /** Dopo il nome di un gruppo tra i destinatari: il codice del gruppo non scade, chi entra dopo vede anche lui. */
  groupTarget: "tutto il gruppo, anche chi entrerà dopo"
} as const;

export const REVISION_CHANGE_LABEL: Record<ItemRevision["change"], string> = {
  create: "ha aggiunto",
  update: "ha modificato",
  delete: "ha eliminato"
};

/**
 * Intestazione della cronologia. La lista ha un tetto (`limit`): se è piena le modifiche più vecchie
 * possono mancare e lo dice, invece di promettere "gli ultimi 90 giorni".
 */
export const revisionListIntro = (shown: number, limit: number) =>
  `${shown >= limit ? `Ultime ${limit} modifiche degli ultimi 90 giorni (le più vecchie non compaiono).` : "Ultimi 90 giorni."} «Ripristina» riporta l'elemento alla versione prima della modifica.`;

/** "1 elemento" / "3 elementi" con la frase accordata al numero. */
const several = (count: number, one: string, many: (count: number) => string) => (count === 1 ? one : many(count));

/**
 * "Modifiche di altri" → annullare tutte le modifiche di una persona da un giorno. `who` è il nome già
 * adatto a una frase (actorInSentence), `day` il giorno scelto ("3 nov").
 */
/** "dal 3 nov", ma "dall'8 nov" e "dall'11 nov" (`Dal`/`Dall'` a inizio frase). */
const fromDay = (day: string, start = false) => `${start ? "D" : "d"}${/^(?:8|11)\b/.test(day) ? "all'" : "al "}${day}`;

export const REVERT_TEXT = {
  open: "Annulla le modifiche di una persona",
  intro:
    "Ogni elemento che ha modificato o eliminato torna com'era prima della sua prima modifica da quel giorno. Gli elementi che ha aggiunto restano.",
  person: "Persona",
  since: "Dal giorno",
  noPeople: "Nessuno può modificare i tuoi dati: qui compaiono le persone con «Può modificare».",
  check: "Controlla",
  checking: "Controllo…",
  close: "Chiudi",
  /** Accanto ad "Annulla" (che chiude la conferma): non deve iniziare con la stessa parola. */
  confirm: "Ripristina tutto",
  tooMany: "Troppe modifiche da quel giorno: scegli un giorno più vicino.",
  /** Tra il controllo e la conferma qualcosa è cambiato: si conferma solo ciò che si è letto. */
  changed: "Nel frattempo è cambiato qualcosa: rileggi il riepilogo e conferma di nuovo.",
  skipChanged: (count: number) =>
    several(count, "Lascia com'è l'elemento cambiato dopo da te o da altri", (n) => `Lascia come sono i ${n} elementi cambiati dopo da te o da altri`),
  skipChangedHint: "Così torna solo ciò che, dopo questa persona, nessun altro ha toccato.",
  nothing: (who: string, day: string) => `${fromDay(day, true)} ${who} non ha cambiato nulla dei tuoi dati.`,
  /** Cosa succede confermando: prima ciò che torna (e cosa si perde), poi ciò che resta com'è. */
  plan: (who: string, day: string, summary: RevertSummary) =>
    [
      summary.toRestore
        ? several(summary.toRestore, "1 elemento torna com'era", (n) => `${n} elementi tornano com'erano`) + ` prima delle modifiche di ${who} ${fromDay(day)}.`
        : "Nessun elemento da riportare indietro.",
      summary.ownerDeleted
        ? several(summary.ownerDeleted, "1 di questi l'avevi eliminato tu: torna tra i tuoi dati.", (n) => `${n} di questi li avevi eliminati tu: tornano tra i tuoi dati.`)
        : "",
      summary.ownerAfter
        ? several(summary.ownerAfter, "Su 1 di questi hai fatto modifiche anche tu, dopo: vengono sostituite.", (n) => `Su ${n} di questi hai fatto modifiche anche tu, dopo: vengono sostituite.`)
        : "",
      summary.othersAfter
        ? several(
            summary.othersAfter,
            "Su 1 di questi elementi ha fatto modifiche anche un'altra persona, dopo: si perdono anche quelle.",
            (n) => `Su ${n} di questi elementi hanno fatto modifiche anche altre persone, dopo: si perdono anche quelle.`
          )
        : "",
      summary.skipped
        ? several(summary.skipped, "1 elemento cambiato dopo da te o da altri resta com'è ora.", (n) => `${n} elementi cambiati dopo da te o da altri restano come sono ora.`)
        : "",
      summary.added
        ? several(summary.added, `1 elemento aggiunto da ${who} resta: eliminalo tu, se non ti serve.`, (n) => `${n} elementi aggiunti da ${who} restano: eliminali tu, se non ti servono.`)
        : "",
      summary.gone
        ? several(summary.gone, "1 elemento che hai eliminato tu resta eliminato.", (n) => `${n} elementi che hai eliminato tu restano eliminati.`)
        : "",
      summary.notHere
        ? several(
            summary.notHere,
            "1 elemento non è ancora arrivato su questo dispositivo e resta com'è: controlla di nuovo dopo la sincronizzazione.",
            (n) => `${n} elementi non sono ancora arrivati su questo dispositivo e restano come sono: controlla di nuovo dopo la sincronizzazione.`
          )
        : ""
    ]
      .filter(Boolean)
      .join(" "),
  done: (who: string, restored: number, notRestored: number) =>
    [
      restored
        ? several(restored, `Fatto: 1 elemento è tornato com'era prima delle modifiche di ${who}.`, (n) => `Fatto: ${n} elementi sono tornati com'erano prima delle modifiche di ${who}.`)
        : notRestored
          ? "Nessun elemento è cambiato."
          : `Nessun elemento è cambiato: le modifiche di ${who} non c'erano più da annullare.`,
      notRestored
        ? several(
            notRestored,
            "1 elemento non si è potuto ripristinare: non era più tra i tuoi dati o nella cronologia.",
            (n) => `${n} elementi non si sono potuti ripristinare: non erano più tra i tuoi dati o nella cronologia.`
          )
        : ""
    ]
      .filter(Boolean)
      .join(" ")
} as const;
