// Etichette italiane per i valori enum salvati nei dati: la UI non mostra mai i codici interni.
import type { Attachment, CalendarEvent, Exam, Goal, StudySession, Subject, Task } from "../types";
import type { InviteBlock, ItemRevision, ShareAction, ShareInviteStatus, SharePermission, ShareScope } from "./sharing";
import type { RevertSummary } from "./shareHistory";

export const PRIORITY_LABEL: Record<Task["priority"], string> = {
  low: "Bassa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente"
};

export const ENERGY_LABEL: Record<Task["energy"], string> = {
  low: "Energia bassa",
  medium: "Energia media",
  high: "Energia alta"
};

export const TASK_STATUS_LABEL: Record<Task["status"], string> = {
  todo: "Da fare",
  doing: "In corso",
  blocked: "Bloccata",
  done: "Completata",
  postponed: "Rimandata",
  archived: "Archiviata"
};

export const SUBJECT_STATUS_LABEL: Record<Subject["status"], string> = {
  "not-started": "Non iniziata",
  active: "In corso",
  review: "Da ripassare",
  "exam-ready": "Pronta per l'esame",
  completed: "Completata",
  archived: "Archiviata"
};

export const EXAM_STATUS_LABEL: Record<Exam["status"], string> = {
  planning: "Da pianificare",
  studying: "In preparazione",
  reviewing: "In ripasso",
  ready: "Pronto per l'esame",
  done: "Sostenuto"
};

export const GOAL_STATUS_LABEL: Record<Goal["status"], string> = {
  active: "Attivo",
  paused: "In pausa",
  done: "Raggiunto",
  archived: "Archiviato"
};

export const GOAL_CATEGORY_LABEL: Record<Goal["category"], string> = {
  study: "Studio",
  exam: "Esame",
  notes: "Appunti",
  review: "Ripasso",
  streak: "Costanza",
  fitness: "Sport",
  personal: "Personale",
  project: "Progetto"
};

export const SESSION_STATUS_LABEL: Record<StudySession["status"], string> = {
  planned: "Pianificata",
  running: "In corso",
  completed: "Completata",
  skipped: "Saltata"
};

export const SESSION_TEMPLATE_LABEL: Record<StudySession["template"], string> = {
  "new-topic": "Nuovo argomento",
  review: "Ripasso",
  exercises: "Esercizi",
  "exam-simulation": "Simulazione esame",
  "pdf-reading": "Lettura PDF",
  "notes-cleanup": "Riordino appunti",
  memorization: "Memorizzazione",
  lab: "Laboratorio",
  "oral-prep": "Preparazione orale"
};

export const EVENT_CATEGORY_LABEL: Record<CalendarEvent["category"], string> = {
  study: "Studio",
  lesson: "Lezione",
  lab: "Laboratorio",
  exam: "Esame",
  review: "Ripasso",
  deadline: "Scadenza",
  project: "Progetto",
  gym: "Palestra",
  personal: "Personale",
  work: "Lavoro",
  relax: "Relax",
  other: "Altro"
};

export const EVENT_STATUS_LABEL: Record<CalendarEvent["status"], string> = {
  planned: "Pianificato",
  "in-progress": "In corso",
  done: "Fatto",
  skipped: "Saltato"
};

/** Colore semantico della priorità (token del tema, leggibile in chiaro e scuro). */
export const PRIORITY_TONE: Record<Task["priority"], string> = {
  low: "var(--faint)",
  medium: "var(--accent-2)",
  high: "var(--warning)",
  urgent: "var(--accent-3)"
};

export type AttachmentKind = "pdf" | "image" | "video" | "doc" | "link" | "file";

export const attachmentKind = (attachment: Pick<Attachment, "mimeType" | "name" | "externalUrl">): AttachmentKind => {
  const mime = attachment.mimeType.toLowerCase();
  const name = attachment.name.toLowerCase();
  const url = attachment.externalUrl?.toLowerCase() ?? "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/") || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) return "video";
  if (/word|document|presentation|sheet|excel|powerpoint|text\/plain|markdown/.test(mime)) return "doc";
  if (attachment.externalUrl) return "link";
  return "file";
};

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  pdf: "PDF",
  image: "Immagine",
  video: "Video",
  doc: "Documento",
  link: "Link",
  file: "File"
};

export const ATTACHMENT_KIND_ICON: Record<AttachmentKind, string> = {
  pdf: "FileText",
  image: "Image",
  video: "PlayCircle",
  doc: "FileText",
  link: "Link",
  file: "Paperclip"
};

const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

/** Ore con la virgola decimale italiana: 0,8 h. */
export const formatHours = (minutes: number) => decimal.format(Math.round((minutes / 60) * 10) / 10);

/** Durata leggibile: 45 min, 2 h, 13 h 55 min. */
export const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

export const formatNumber = (value: number) => decimal.format(value);

/** Tipo di pagina ufficiale da cui arrivano i dati del corso (sezione Fonti). */
export const UNIVERSITY_SOURCE_KIND_LABEL: Record<string, string> = {
  "calendario-didattico": "Calendario delle lezioni",
  "contatti-ufficiali": "Contatti",
  "elenco-insegnamenti": "Elenco insegnamenti",
  "manifesto-pdf": "Manifesto (PDF)",
  "piano-didattico": "Piano didattico",
  "scheda-corso": "Scheda del corso"
};

/** Etichetta degli eventi senza orario, che occupano l'intera giornata. */
export const ALL_DAY_LABEL = "Tutto il giorno";

/** Evento senza materia, o con una materia che non si conosce (es. di un'altra persona, non condivisa). */
export const NO_SUBJECT_LABEL = "Senza materia";

/**
 * Prima lettera maiuscola: nomi di giorni/mesi da date-fns a inizio frase, etichette
 * dinamiche in Tag/Pill. Non tocca il resto della stringa (acronimi e nomi propri salvi).
 */
export const capitalizeFirst = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const hostOf = (url: string | undefined) => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Testo di un link di un appello: «ufficiale UniMi» solo se porta davvero a unimi.it (o a un suo
 * sottodominio); gli altri mostrano dove portano, così un link cambiato non si spaccia per l'ateneo.
 */
export const eventLinkLabel = (href: string | undefined) => {
  let url: URL;
  try {
    url = new URL(href ?? "");
  } catch {
    return "Apri il link";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Apri il link";
  const host = url.hostname.toLowerCase();
  if (host === "unimi.it" || host.endsWith(".unimi.it")) return "Apri la pagina ufficiale UniMi";
  return `Apri la pagina · ${hostOf(href)}`;
};

// ——— Condivisione ———

export const SHARE_SCOPE_LABEL: Record<ShareScope, string> = {
  calendar: "Calendario",
  barb_exams: "Appelli ufficiali",
  tasks: "Attività",
  study: "Studio",
  progress: "Progressi",
  materials: "Materiali",
  goals: "Obiettivi"
};

export const SHARE_SCOPE_HINT: Record<ShareScope, string> = {
  calendar: "Eventi e lezioni, compresi gli appelli che hai aggiunto",
  barb_exams: "Solo gli appelli ufficiali che hai scelto (in sola lettura)",
  tasks: "Le cose da fare, con scadenza",
  study: "Sessioni di studio e argomenti da ripassare",
  progress: "Esami ancora da sostenere e preparazione, mai i voti",
  materials: "File, link e note",
  goals: "I tuoi traguardi"
};

export const SHARE_PERMISSION_LABEL: Record<SharePermission, string> = {
  view: "Può vedere",
  edit: "Può modificare"
};

export const SHARE_INVITE_STATUS_LABEL: Record<ShareInviteStatus, string> = {
  pending: "In attesa",
  accepted: "Accettato",
  declined: "Rifiutato",
  expired: "Scaduto"
};

/** Cosa non è andato a buon fine quando fallisce un'azione appena fatta (pannello Condividi, sezione Condivisione). */
export const SHARE_ACTION_FAILED: Record<ShareAction, string> = {
  invite: "Invito non creato.",
  share: "Condivisione non salvata.",
  accept: "Invito non accettato.",
  decline: "Invito non rifiutato.",
  cancel: "Invito non annullato.",
  update: "Permessi non aggiornati.",
  revoke: "Condivisione non tolta.",
  leave: "Non sei uscito dalla condivisione.",
  open: "Invito non aperto.",
  history: "Cronologia non caricata.",
  restore: "Ripristino non riuscito.",
  revertCheck: "Controllo non riuscito.",
  revert: "Modifiche non annullate.",
  save: "Modifiche non salvate.",
  delete: "Elemento non eliminato."
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
  deleteConfirm: (title: string, who: string) => `Eliminare «${title}» dai dati di ${who}? Resta nella sua cronologia e può ripristinarlo.`
} as const;

/** Perché un invito aperto da link non si può accettare (il link salvato su questo dispositivo si toglie). */
export const SHARE_INVITE_BLOCKED: Record<InviteBlock, string> = {
  invalid: "Link non valido, oppure l'invito è stato annullato.",
  own: "È un tuo invito: mandalo a un'altra persona.",
  otherAccount: "Questo invito è per un altro account: accedi con quello giusto e riapri il link.",
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

/** Una condivisione da cambiare o togliere che sul server non c'è più (tolta altrove, o non più tua). */
export const SHARE_GONE_TEXT = "Questa condivisione non c'è più.";

/** Avviso della condivisione mostrato in ogni sezione (AppShell), lì dove si è fatta la modifica. */
export const SHARE_NOTICE_TEXT = {
  denied: (owner: string) => `Non hai più il permesso di modificare i dati di ${owner || "questa persona"}: la modifica non è stata salvata.`,
  dismiss: "Ok",
  dismissTitle: "Chiudi l'avviso sulla condivisione"
} as const;

export const REVISION_CHANGE_LABEL: Record<ItemRevision["change"], string> = {
  create: "ha aggiunto",
  update: "ha modificato",
  delete: "ha eliminato"
};

/** "Calendario (Può modificare), Attività (Può vedere)". */
export const scopesSummary = (offers: ReadonlyArray<{ scope: ShareScope; permission: SharePermission }>) =>
  offers.map((offer) => `${SHARE_SCOPE_LABEL[offer.scope]} (${SHARE_PERMISSION_LABEL[offer.permission]})`).join(", ");

/** Tipo di elemento condivisibile, per la cronologia ("ha modificato l'evento …"). */
export const SHARED_ENTITY_LABEL: Record<string, string> = {
  calendarEvent: "evento",
  task: "attività",
  studySession: "sessione di studio",
  studyTopic: "argomento",
  exam: "esame",
  attachment: "materiale",
  note: "nota",
  goal: "obiettivo"
};

/** Etichetta di un tipo che arriva dal server: i nomi di Object.prototype ("constructor"…) non sono tipi. */
export const sharedEntityLabel = (type: string) =>
  Object.hasOwn(SHARED_ENTITY_LABEL, type) ? SHARED_ENTITY_LABEL[type] : "elemento";

/** Chi ha fatto una modifica quando non si sa il nome: in testa a una frase, e in mezzo ("prima che un'altra persona…"). */
export const UNKNOWN_PERSON = "Un'altra persona";
export const UNKNOWN_PERSON_IN_SENTENCE = "un'altra persona";

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

/** Ripristino di una versione dalla cronologia "Modifiche di altri". */
export const RESTORE_TEXT = {
  notRestorable: "Questo elemento non si può ripristinare.",
  missing: "Questa versione non c'è più nella cronologia: aggiorna l'elenco.",
  /** Il controllo al momento di scrivere (l'elemento è sparito nel frattempo, e la versione non ha i suoi file). */
  notHere: "Questo elemento non è più tra i tuoi dati: aggiorna l'elenco e riprova.",
  /** Versione di una modifica, senza file: l'elemento non è qui e nessuna eliminazione salvata li conserva. */
  gone: (title: string) =>
    `«${title}» non è tra i tuoi dati su questo dispositivo (l'hai eliminato, o non è ancora arrivato) e questa versione non ha i suoi file: non si può ripristinare.`,
  /** Al posto di «Ripristina» quando il ripristino non riuscirebbe (gone). */
  blocked: "Non ripristinabile",
  blockedHint: "Non è tra i tuoi dati su questo dispositivo e questa versione non ha i suoi file."
} as const;

// ——— Persone: ricerca, profilo online, inviti all'account (supabase/people.sql) ———

/**
 * Testi di "Trova una persona", del profilo online e degli inviti all'account. Le voci di `errors`
 * da `rateLimited` a `emailInvitesGone` sono identiche ai messaggi di supabase/people.sql:
 * peopleErrorText (lib/people.ts) le riconosce nel testo del server.
 */
export const peopleLabels = {
  findTitle: "Trova una persona",
  findHint: "Scrivi la sua email esatta o il suo @nome. L'email delle altre persone non compare mai.",
  findFieldLabel: "Email o @nome della persona",
  findPlaceholder: "nome@esempio.it oppure @nome",
  search: "Cerca",
  searching: "Cerco…",
  invite: "Invita",
  inviting: "Invito…",
  wait: "Un attimo…",
  noName: "Nome non impostato",
  noHandle: "Senza @nome",
  somebody: "una persona",
  notFound: "Nessuna persona trovata",
  notFoundHint: "Controlla l'email o il @nome. Se non ha ancora un account, mandale il link di invito.",
  checkHint: "Prima di invitare, controlla con la persona che nome e @nome siano proprio i suoi.",
  needsLogin: "Accedi al tuo account per cercare le persone.",
  needsScopes: "Scegli almeno una cosa da condividere.",
  groupSectionTitle: "Invita una persona con il suo account",
  groupSectionHint: "Per chi ha già un account StudyOS: l'invito compare nella sua app (notifiche e Gruppi) e può accettarlo con un tocco.",
  groupNotAllowed:
    "Solo il proprietario e gli amministratori possono invitare una persona con il suo account. Tu puoi mandare il link, il QR o il codice.",
  groupNotOnline: "Il gruppo non è ancora online: riapri questa finestra tra poco.",
  groupInvited: (name: string) => `Invito mandato a ${name}: lo vede nelle notifiche e in Gruppi.`,
  groupActivity: (name: string) => `ha invitato ${name}`,
  adminRoleHint: "come un membro, ma può anche invitare una persona trovata con la ricerca (email o @nome).",
  shareTarget: "Una persona (cerca per email o @nome)",
  shareInvited: (name: string, scopes: string) =>
    `Invito mandato a ${name}: lo vede nelle notifiche e in Condivisione → Inviti. Quando accetta, vede ${scopes}.`,
  withLink: "Con link",
  sentToPerson: "A una persona, nella sua app",
  invitedPerson: "Persona invitata",
  codeInvite: (code: string) => `Codice ${code}`,
  sentInvitesTitle: (count: number) => `Inviti mandati · ${count}`,
  waiting: "in attesa",
  expired: "scaduto",
  expiredEmailInvite: "Scaduto: cerca la persona per invitarla di nuovo",
  profileTitle: "Profilo online",
  profileIntro: "Come ti vedono gli altri quando ti cercano per invitarti.",
  profileNoCloud: "Gli account non sono attivi in questa versione dell'app.",
  profileSignedOut: "Con l'account puoi scegliere un @nome e farti trovare da chi vuole invitarti.",
  profileLoading: "Carico il profilo online…",
  profileVisibleName: (name: string) => `Nome visibile: ${name}`,
  profileNameHint: "È il nome scritto in «Il tuo nome», qui sopra: il profilo online si aggiorna da solo.",
  handleLabel: "Il tuo @nome (facoltativo)",
  handlePlaceholder: "es. giulia.rossi",
  handleRule: "Da 3 a 24 caratteri: lettere minuscole, numeri, _ e punto.",
  handleChecking: "Controllo se è libero…",
  handleAvailable: "Libero: puoi usarlo.",
  handleTaken: "Già preso: scegline un altro.",
  handleCurrent: "È il tuo @nome.",
  handleSave: "Salva @nome",
  handleRemove: "Togli @nome",
  handleSaved: (handle: string) => `Fatto: ora ti trovano anche come @${handle}.`,
  handleRemoved: "@nome tolto: ti trovano solo con l'email esatta.",
  discoverableLabel: "Gli altri possono trovarmi",
  discoverableOn: "Chi conosce la tua email o il tuo @nome può trovarti per invitarti. Non vede mai la tua email.",
  discoverableOff: "Nessuno ti trova con la ricerca. Gli inviti già ricevuti restano e puoi sempre entrare con link, QR o codice.",
  saving: "Salvo…",
  retry: "Riprova",
  notice: "Ora chi conosce la tua email o il tuo @nome può trovarti per invitarti. Puoi spegnerlo in Impostazioni → Profilo.",
  noticeOk: "Ok",
  noticeOpenProfile: "Apri il profilo",
  errors: {
    rateLimited: "Troppe ricerche, riprova tra un minuto",
    notFound: "Nessuna persona trovata",
    alreadyMember: "È già nel gruppo",
    alreadyInvited: "Ha già un invito",
    notAllowed: "Solo proprietario e amministratori possono invitare",
    self: "Non puoi invitare te stesso",
    tooManyInvites: "Troppi inviti in attesa: annullane qualcuno",
    emailInvitesGone: "Gli inviti per email non ci sono più: cerca la persona",
    badQuery: "Scrivi un'email completa (nome@esempio.it) o un @nome.",
    badHandle: "Il @nome va da 3 a 24 caratteri: lettere minuscole, numeri, _ e punto.",
    handleTaken: "Questo @nome è già preso: scegline un altro.",
    unavailable:
      "La ricerca delle persone non è ancora attiva sul server: esegui supabase/people.sql nel SQL Editor di Supabase (vedi supabase/README.md).",
    offline: "Server cloud non raggiungibile: controlla la connessione e riprova.",
    noPermission: "Non hai il permesso per questa operazione.",
    signedOut: "Accedi al tuo account per cercare le persone.",
    noCloud: "Gli account non sono attivi in questa versione dell'app.",
    generic: "Il server ha risposto con un errore. Riprova tra poco."
  }
} as const;

/** Notifiche push del dispositivo: interruttore in Impostazioni → Profilo e proposta dopo il primo invito. */
export const pushLabels = {
  toggle: "Notifiche su questo dispositivo",
  hint: "Ricevi un avviso anche con l'app chiusa: inviti, inviti accettati e permessi cambiati.",
  checking: "Controllo…",
  on: "Attive su questo dispositivo. Puoi spegnerle quando vuoi.",
  off: "Spente su questo dispositivo.",
  needAccount: "Accedi con il tuo account per ricevere le notifiche.",
  unsupported: "Questo browser non supporta le notifiche. Gli avvisi restano nella campanella dell'app.",
  iosInstall: "Aggiungi StudyOS alla schermata Home per ricevere le notifiche",
  denied: "Hai bloccato le notifiche per StudyOS. Riattivale dalle impostazioni del browser o del telefono, poi torna qui.",
  failed: "Non sono riuscito ad attivare le notifiche. Riprova tra poco.",
  promptTitle: "Vuoi un avviso quando ricevi un invito?",
  promptBody:
    "Ti mandiamo una notifica anche quando StudyOS è chiuso: inviti, inviti accettati e permessi cambiati. Puoi spegnerla in Impostazioni → Profilo.",
  promptAccept: "Attiva le notifiche",
  promptLater: "Non ora",
  promptFailed: "Non è stato possibile attivarle. Puoi riprovare da Impostazioni → Profilo.",
  promptClose: "Chiudi"
} as const;
