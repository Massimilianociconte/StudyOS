// Appelli ufficiali raggruppati (logica pura, senza dati BARB): gli elenchi ufficiali pubblicano a
// volte lo stesso appello più volte, una per iscrizione (corsi di laurea o moduli diversi). Per lo
// studente è un appello solo: stesso giorno, tipo di prova e ora dello stesso insegnamento.
import type { BarbExamSession } from "./university/examTypes";

/** Stesso appello: stesso giorno, tipo di prova e ora. */
export const examSlotKey = (session: Pick<BarbExamSession, "date" | "type" | "time">): string => `${session.date}|${session.type ?? ""}|${session.time ?? ""}`;

/** Appello di un insegnamento: chiave unica anche tra insegnamenti diversi. */
export const courseSlotKey = (session: Pick<BarbExamSession, "courseId" | "date" | "type" | "time">): string => `${session.courseId}|${examSlotKey(session)}`;

export interface BarbExamSlot {
  key: string;
  courseId: string;
  /** L'iscrizione che si aggiunge al calendario (la prima, sempre la stessa). */
  session: BarbExamSession;
  sessions: BarbExamSession[];
  /** Già nel calendario con una qualsiasi delle sue iscrizioni. */
  imported: boolean;
}

/** Appelli in ordine di data e ora, uno per giorno, tipo e ora di ogni insegnamento. */
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
