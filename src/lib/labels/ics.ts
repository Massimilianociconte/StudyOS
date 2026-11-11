// File .ics: testi scritti nel file e avvisi dell'importazione (lib/ics.ts).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.
import { MONTH_NAME } from "../labels";

/** Elenco di titoli tra «»: al massimo tre, poi "e altri N". */
const quotedTitles = (titles: readonly string[]) => {
  const shown = titles.slice(0, 3).map((title) => `«${title}»`);
  const rest = titles.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} e ${rest === 1 ? "un altro evento" : `altri ${rest} eventi`}` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} e ${shown.at(-1)}` : shown[0] ?? "";
};

/** Parti di una regola di ripetizione (RRULE) che StudyOS non sa seguire, dette a parole. */
const RULE_PART_TEXT: Record<string, string> = {
  FREQ: "ripetizioni più fitte di una al giorno",
  INTERVAL: "un intervallo troppo lungo",
  COUNT: "troppe ripetizioni",
  UNTIL: "una data di fine non leggibile",
  BYSECOND: "i secondi",
  BYMINUTE: "più orari nello stesso giorno",
  BYHOUR: "più orari nello stesso giorno",
  BYDAY: "una scelta di giorni della settimana",
  BYMONTHDAY: "una scelta di giorni del mese",
  BYYEARDAY: "una scelta di giorni dell'anno",
  BYWEEKNO: "una scelta di settimane dell'anno",
  BYMONTH: "una scelta di mesi",
  BYSETPOS: "la scelta per posizione (es. «il secondo giorno feriale»)",
  WKST: "il primo giorno della settimana",
  RSCALE: "un calendario diverso da quello solito",
  SKIP: "un calendario diverso da quello solito"
};

const rulePartText = (part: string) => {
  const split = part.indexOf("=");
  const key = (split < 0 ? part : part.slice(0, split)).trim().toUpperCase();
  // INTERVAL=0 o non un numero: non è lungo, è sbagliato.
  if (key === "INTERVAL" && !/^\s*0*[1-9]\d*\s*$/.test(split < 0 ? "" : part.slice(split + 1))) return "un intervallo non valido";
  return RULE_PART_TEXT[key] ?? "una regola scritta in modo particolare";
};

const ruleParts = (parts: readonly string[]) => [...new Set(parts.map(rulePartText))].join(", ");

export const ICS_TEXT = {
  calendarName: "StudyOS",
  untitled: "Evento importato",
  examTitle: (subject: string) => `Esame: ${subject}`,
  examFallback: "materia",
  examCategory: "Esame",
  taskTitle: (title: string) => `Scadenza: ${title}`,
  taskCategory: "Scadenza",
  notCalendar: "Il file non è un calendario .ics valido.",
  skipped: (count: number) => (count === 1 ? "1 evento senza data valida è stato scartato." : `${count} eventi senza data valida sono stati scartati.`),
  tooMany: (max: number) => `Il file è molto grande: sono stati letti solo i primi ${max} eventi.`,
  unknownZone: (zone: string) =>
    `Il fuso orario «${zone}» non è stato riconosciuto: per i suoi eventi è stata usata l'ora di questo dispositivo. Controlla che gli orari siano giusti.`,
  simplified: (titles: readonly string[], parts: readonly string[]) =>
    `${quotedTitles(titles)} si ${titles.length === 1 ? "ripete" : "ripetono"} con una regola che StudyOS non sa seguire del tutto (${ruleParts(parts)}): è stata semplificata, controlla le date nel calendario.`,
  firstOnly: (titles: readonly string[], parts: readonly string[]) =>
    `${quotedTitles(titles)} si ${titles.length === 1 ? "ripete" : "ripetono"} in un modo che StudyOS non sa seguire (${ruleParts(parts)}): è stata importata solo la prima data.`,
  extraDates: "Alcune date aggiunte a mano a una serie sono state ignorate: se mancano, aggiungile come eventi singoli.",
  thisAndFuture: "Alcune modifiche nel file valgono per «questa e le successive»: sono state applicate solo al giorno indicato.",
  multipleRules: (titles: readonly string[]) => `${quotedTitles(titles)} ha più di una regola di ripetizione: è stata usata solo la prima.`,
  tasksIgnored: (count: number) =>
    count === 1 ? "1 attività con scadenza non è stata importata: StudyOS importa solo gli eventi." : `${count} attività con scadenza non sono state importate: StudyOS importa solo gli eventi.`,
  tooLong: (titles: readonly string[]) =>
    `${quotedTitles(titles)} ${titles.length === 1 ? "durava" : "duravano"} più di un anno: la fine è stata portata a un anno dopo l'inizio. Controlla le date.`,
  /** `read`: quanti giorni della serie sono stati letti davvero (i più vicini a oggi). */
  tooManyRows: (titles: readonly string[], read: number) =>
    read
      ? `${quotedTitles(titles)} ${titles.length === 1 ? "ha" : "hanno"} troppi giorni esclusi o modificati: ${read === 1 ? "è stato letto solo quello più vicino a oggi" : `sono stati letti solo i ${read} più vicini a oggi`}.`
      : `${quotedTitles(titles)}: il file ha troppi giorni esclusi o modificati in tutto, e per ${titles.length === 1 ? "questa serie" : "queste serie"} non ne è stato letto nessuno.`,
  legacyKept: (titles: readonly string[]) =>
    titles.length === 1
      ? `${quotedTitles(titles)} era già stato importato in più parti, con modifiche che non si possono unire senza perderne qualcuna: è rimasto com'era. Se vuoi la versione del file, elimina quelle parti e importa di nuovo.`
      : `${quotedTitles(titles)} erano già stati importati in più parti, con modifiche che non si possono unire senza perderne qualcuna: sono rimasti com'erano. Se vuoi la versione del file, elimina quelle parti e importa di nuovo.`,
  /** Il file divide una serie che c'era già: `date` (YYYY-MM-DD) è il primo giorno della parte nuova. */
  splitsExisting: (title: string, date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return `${quotedTitles([title])}: questo file divide una serie che hai già. Dal ${day} ${MONTH_NAME[month - 1] ?? ""} ${year} i giorni li decide la parte nuova, e importare di nuovo il calendario ufficiale non lo annulla. Per tornare indietro elimina la parte nuova.`;
  },
  /** Il file ha una parte (RELATED-TO) di una serie che c'era già, ma non si collega: resta un evento a sé. */
  partKeptApart: (title: string) =>
    `${quotedTitles([title])}: questo file ha una parte di una serie che hai già, ma non combacia con la tua: è stata aggiunta a parte. Se vedi giorni doppi, elimina quella che non ti serve.`
};
