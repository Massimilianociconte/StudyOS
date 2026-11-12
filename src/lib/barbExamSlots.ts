// Appelli ufficiali raggruppati (logica pura, senza dati BARB): gli elenchi ufficiali pubblicano a
// volte lo stesso appello più volte, una per iscrizione (corsi di laurea o moduli diversi). Per lo
// studente è un appello solo: stesso giorno, tipo di prova, ora e prova (component) dello stesso
// insegnamento. Prove diverse alla stessa ora (Inglese B2: test online e test in aula) restano due appelli.
import type { BarbExamSession } from "./university/examTypes";

type SlotFields = Pick<BarbExamSession, "date" | "type" | "time"> & Partial<Pick<BarbExamSession, "component">>;

/** La prova come la scrive l'elenco: maiuscole e spazi non la cambiano. */
const componentKey = (component: string | null | undefined) => (component ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("it");

/** Stesso appello: stesso giorno, tipo di prova, ora e prova. */
export const examSlotKey = (session: SlotFields): string => `${session.date}|${session.type ?? ""}|${session.time ?? ""}|${componentKey(session.component)}`;

/** Appello di un insegnamento: chiave unica anche tra insegnamenti diversi. */
export const courseSlotKey = (session: SlotFields & Pick<BarbExamSession, "courseId">): string => `${session.courseId}|${examSlotKey(session)}`;

export interface BarbExamSlot {
  key: string;
  courseId: string;
  /** L'iscrizione che si aggiunge al calendario (la prima, sempre la stessa). */
  session: BarbExamSession;
  sessions: BarbExamSession[];
  /** Già nel calendario con una qualsiasi delle sue iscrizioni. */
  imported: boolean;
}

/** Appelli in ordine di data e ora, uno per giorno, tipo, ora e prova di ogni insegnamento. */
export function groupExamSlots(
  sessions: readonly BarbExamSession[],
  importedUids: ReadonlySet<string>,
  uidOf: (session: BarbExamSession) => string
): BarbExamSlot[] {
  const slots = new Map<string, BarbExamSlot>();
  const sorted = [...sessions].sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? "").localeCompare(y.time ?? "") || x.id.localeCompare(y.id));
  for (const session of sorted) {
    const key = courseSlotKey(session);
    const slot = slots.get(key) ?? { key, courseId: session.courseId, session, sessions: [], imported: false };
    slot.sessions.push(session);
    if (importedUids.has(uidOf(session))) slot.imported = true;
    slots.set(key, slot);
  }
  return [...slots.values()];
}

/**
 * Appelli gemelli di `slot` (lui compreso): stesso insegnamento, giorno, tipo e ora, diversi solo per
 * la prova. A vista sono righe uguali (Inglese B2: test online e test in aula).
 */
export const slotTwins = (slot: BarbExamSlot, slots: readonly BarbExamSlot[]): BarbExamSlot[] =>
  slots.filter((other) => other.courseId === slot.courseId && other.session.date === slot.session.date && other.session.type === slot.session.type && (other.session.time ?? "") === (slot.session.time ?? ""));

export interface SlotDifference {
  component: string | null;
  location: string | null;
  registrationCloses: string | null;
  sourceCourseCode: string | null;
}

/**
 * Ciò che distingue `variant` dalle altre del gruppo (iscrizioni dello stesso appello o appelli
 * gemelli), solo nei campi diversi: prova, aula, chiusura delle iscrizioni. Se cambiano solo la
 * commissione (già nel nome) o nemmeno quella, resta il codice dell'elenco.
 */
export function slotDifference(variant: BarbExamSession, group: readonly BarbExamSession[]): SlotDifference {
  const differs = (pick: (session: BarbExamSession) => string | null | undefined) => new Set(group.map((session) => pick(session) ?? null)).size > 1;
  const component = differs((session) => session.component) ? variant.component ?? null : null;
  const location = differs((session) => session.location) ? variant.location : null;
  const registrationCloses = differs((session) => session.registrationCloses) ? variant.registrationCloses : null;
  const sourceCourseCode = !component && !location && !registrationCloses && !differs((session) => session.commission) ? variant.sourceCourseCode ?? null : null;
  return { component, location, registrationCloses, sourceCourseCode };
}
