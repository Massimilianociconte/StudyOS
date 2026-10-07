import type { CalendarEvent, Subject } from '../types';
import type { BarbCourse } from './university/types';
import type { BarbExamSession } from './university/examTypes';
import { barbExamSourceUid, resolveBarbCourse } from './university/examSessions';
import { isOfficialUnimiUrl } from './university/officialSources';

export type ImportedExamEvent = Pick<CalendarEvent, 'title' | 'description' | 'category' | 'subjectId' | 'color' | 'priority' | 'start' | 'end' | 'allDay' | 'recurrence' | 'notes' | 'links' | 'sourceUid'>;

/** Prepare date reminders, never an estimated exam duration. The store commits the whole batch. */
export function prepareBarbExamImport(
  sessions: BarbExamSession[], courses: BarbCourse[], subjects: Subject[],
  existingEvents: Pick<CalendarEvent, 'sourceUid'>[]
): { events: ImportedExamEvent[]; skipped: number } {
  const byCourse = new Map<string, Subject>();
  for (const subject of subjects) {
    if (subject.archived || subject.status === 'archived' || subject.status === 'completed') continue;
    const course = resolveBarbCourse(subject, courses);
    if (course && !byCourse.has(course.id)) byCourse.set(course.id, subject);
  }
  const seen = new Set(existingEvents.flatMap((event) => event.sourceUid ? [event.sourceUid] : []));
  const events: ImportedExamEvent[] = [];
  let skipped = 0;
  for (const session of sessions) {
    const subject = byCourse.get(session.courseId);
    const course = courses.find((item) => item.id === session.courseId);
    const uid = barbExamSourceUid(session);
    const start = new Date(`${session.date}T00:00:00`);
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(session.date) && !Number.isNaN(start.getTime()) &&
      start.getFullYear() === Number(session.date.slice(0, 4)) && start.getMonth() + 1 === Number(session.date.slice(5, 7)) && start.getDate() === Number(session.date.slice(8, 10));
    if (!subject || !course || !validDay || seen.has(uid) || !isOfficialUnimiUrl(session.provenance.sourceUrl) || !session.provenance.sourceUrl.startsWith('https:')) {
      skipped += 1;
      continue;
    }
    seen.add(uid);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    events.push({
      title: `Appello · ${course.name}`,
      description: [
        'Appello BARB scelto per il calendario personale. Promemoria sulla data: la durata non è pubblicata.',
        session.type ? `Prova: ${session.type}` : null,
        session.time ? `Orario ufficiale: ${session.time} (Europe/Rome)` : 'Orario non pubblicato',
        session.location ? `Sede ufficiale: ${session.location}` : 'Sede non pubblicata',
        session.notes
      ].filter(Boolean).join('\n'),
      notes: [
        session.registrationOpens ? `Apertura iscrizioni: ${session.registrationOpens}` : null,
        session.registrationCloses ? `Chiusura iscrizioni: ${session.registrationCloses}` : null,
        `Fonte ufficiale: ${session.provenance.sourceUrl}`,
        session.provenance.sourcePage ? `Pagina ${session.provenance.sourcePage}` : null,
        `Verificato: ${session.provenance.lastVerifiedAt}`
      ].filter(Boolean).join('\n'),
      category: 'exam', subjectId: subject.id, color: subject.color,
      // Floating date ISO: a reminder for the 18th remains on the 18th after cloud sync/travel.
      priority: 'high', start: `${session.date}T00:00:00`,
      end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T00:00:00`,
      allDay: true, recurrence: 'none', links: [session.provenance.sourceUrl], sourceUid: uid
    });
  }
  return { events, skipped };
}

// Helper senza dati BARB: lo store li usa a ogni salvataggio di evento, il dataset no.
export { barbReminderEventId, preserveBarbReminderDates } from './barbReminders';
