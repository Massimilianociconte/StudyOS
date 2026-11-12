import type { CalendarEvent, Subject } from '../types';
import type { BarbCourse } from './university/types';
import type { BarbExamSession } from './university/examTypes';
import { BARB_EXAMS_PAGE_URL, barbCheckedDay, barbExamSourceUid, isTechnicalFeedUrl, resolveBarbCourse } from './university/examSessions';
import { isOfficialUnimiUrl } from './university/officialSources';
import { courseSlotKey } from './barbExamSlots';

/** Oggi a Roma (yyyy-MM-dd), il giorno delle date ufficiali: un appello di un giorno prima è passato. */
export const barbTodayKey = (now: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Data ufficiale (yyyy-MM-dd) come la si legge: «20 novembre 2026». */
const officialDay = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  return Number.isNaN(value.getTime()) ? date : new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(value);
};

export type ImportedExamEvent = Pick<CalendarEvent, 'title' | 'description' | 'category' | 'subjectId' | 'color' | 'priority' | 'start' | 'end' | 'allDay' | 'recurrence' | 'notes' | 'links' | 'sourceUid'>;

/**
 * Prepare date reminders, never an estimated exam duration. The store commits the whole batch.
 * One event per exam slot (same course, day, type and time): a slot published with several
 * registrations is imported once, and not again when another registration is already in the
 * calendar (`allSessions` maps existing event UIDs back to their slot). An appello already past
 * (before `today`, Rome) is skipped: the store, the agents and MCP go through here too.
 */
export function prepareBarbExamImport(
  sessions: BarbExamSession[], courses: BarbCourse[], subjects: Subject[],
  existingEvents: Pick<CalendarEvent, 'sourceUid'>[], allSessions: readonly BarbExamSession[] = sessions,
  today: string = barbTodayKey()
): { events: ImportedExamEvent[]; skipped: number } {
  const byCourse = new Map<string, Subject>();
  for (const subject of subjects) {
    if (subject.archived || subject.status === 'archived' || subject.status === 'completed') continue;
    const course = resolveBarbCourse(subject, courses);
    if (course && !byCourse.has(course.id)) byCourse.set(course.id, subject);
  }
  const seen = new Set(existingEvents.flatMap((event) => event.sourceUid ? [event.sourceUid] : []));
  const slotOfUid = new Map([...allSessions, ...sessions].map((session) => [barbExamSourceUid(session), courseSlotKey(session)]));
  const seenSlots = new Set([...seen].flatMap((uid) => slotOfUid.get(uid) ?? []));
  const events: ImportedExamEvent[] = [];
  let skipped = 0;
  for (const session of sessions) {
    const subject = byCourse.get(session.courseId);
    const course = courses.find((item) => item.id === session.courseId);
    const uid = barbExamSourceUid(session);
    const slot = courseSlotKey(session);
    if (seenSlots.has(slot)) {
      skipped += 1;
      continue;
    }
    const start = new Date(`${session.date}T00:00:00`);
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(session.date) && !Number.isNaN(start.getTime()) &&
      start.getFullYear() === Number(session.date.slice(0, 4)) && start.getMonth() + 1 === Number(session.date.slice(5, 7)) && start.getDate() === Number(session.date.slice(8, 10));
    if (!subject || !course || !validDay || session.date < today || seen.has(uid) || !isOfficialUnimiUrl(session.provenance.sourceUrl) || !session.provenance.sourceUrl.startsWith('https:')) {
      skipped += 1;
      continue;
    }
    seen.add(uid);
    seenSlots.add(slot);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    // Il feed JSON è la provenienza dei dati, non una pagina da leggere: il link va alla pagina degli appelli.
    const source = session.provenance.sourceUrl;
    const technical = isTechnicalFeedUrl(source);
    events.push({
      title: `Appello · ${course.name}`,
      description: [
        'Appello BARB scelto per il calendario personale. Promemoria sulla data: la durata non è pubblicata.',
        session.type ? `Prova: ${session.type}` : null,
        session.time ? `Orario ufficiale: ${session.time}` : 'Orario non pubblicato',
        session.location ? `Sede ufficiale: ${session.location}` : 'Sede non pubblicata',
        session.notes
      ].filter(Boolean).join('\n'),
      notes: [
        session.registrationOpens ? `Apertura iscrizioni: ${officialDay(session.registrationOpens)}` : null,
        session.registrationCloses ? `Chiusura iscrizioni: ${officialDay(session.registrationCloses)}` : null,
        technical ? `Dati ufficiali UNIMI (formato tecnico): ${source}` : `Fonte ufficiale: ${source}`,
        session.provenance.sourcePage ? `Pagina ${session.provenance.sourcePage}` : null,
        `Verificato il ${barbCheckedDay(session.provenance.lastVerifiedAt)}`
      ].filter(Boolean).join('\n'),
      category: 'exam', subjectId: subject.id, color: subject.color,
      // Floating date ISO: a reminder for the 18th remains on the 18th after cloud sync/travel.
      priority: 'high', start: `${session.date}T00:00:00`,
      end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T00:00:00`,
      allDay: true, recurrence: 'none', links: [technical ? BARB_EXAMS_PAGE_URL : source], sourceUid: uid
    });
  }
  return { events, skipped };
}

// Helper senza dati BARB: lo store li usa a ogni salvataggio di evento, il dataset no.
export { barbReminderEventId, preserveBarbReminderDates } from './barbReminders';
