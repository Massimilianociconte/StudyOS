import { useEffect, useState } from "react";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { BarbCourse } from "../lib/university/types";
import type { BarbExamSession } from "../lib/university/examTypes";
import { BARB_EXAM_SESSIONS, getExamStatus } from "../lib/university/examSessions";
import { examSlotKey } from "../lib/barbExamSlots";
import { courseColor } from "../lib/barbCourseVisuals";
import { safeHref } from "../lib/safeUrl";
import { BARB_EXAM_TIMING_LABEL, BARB_EXAM_TYPE_LABEL, BARB_EXAM_TYPE_MISSING, EXAMS_HELP, EXAMS_TEXT } from "../lib/labels/exams";
import { useNow } from "../hooks/useNow";
import { CourseIcon } from "./CourseIcon";
import { Button, Drawer, EmptyState, HelpTip, Tag } from "./ui";

export const barbToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const barbSessionDate = (date: string) => format(parseISO(date), "d MMMM yyyy", { locale: it });
export const barbSessionType = (type: string | null) => (type ? (BARB_EXAM_TYPE_LABEL[type] ?? type) : BARB_EXAM_TYPE_MISSING);

export function BarbExamAvailability({ course }: { course: BarbCourse }) {
  const count = new Set(BARB_EXAM_SESSIONS.filter(session => session.courseId === course.id).map(examSlotKey)).size;
  return <p className={`mt-2 text-xs font-bold ${count ? "text-[var(--accent-ink)]" : "text-[var(--faint)]"}`}>{count ? `${count} ${count === 1 ? "appello ufficiale" : "appelli ufficiali"}` : "Nessun appello ufficiale trovato"}</p>;
}

export function BarbExamSessionDetail({ session, course, onClose, inline = false }: { session: BarbExamSession; course: BarbCourse; onClose: () => void; inline?: boolean }) {
  const fields = [
    ["Data", barbSessionDate(session.date)],
    ["Tipo di prova", barbSessionType(session.type)],
    ...(session.component ? [["Parte dell'esame", session.component]] : []),
    ...(session.commission ? [["Commissione", session.commission]] : []),
    ["Orario", session.time ?? "Orario non pubblicato"],
    ["Sede e aula", session.location ?? "Sede e aula non pubblicate"],
    ["Apertura iscrizioni", session.registrationOpens ? barbSessionDate(session.registrationOpens) : "Non pubblicata"],
    ["Chiusura iscrizioni", session.registrationCloses ? barbSessionDate(session.registrationCloses) : "Non pubblicata"]
  ];
  const legacy = !BARB_DATASET.courses.some((item) => item.id === course.id);
  const content = <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5"><Tag color={courseColor(course)}>{legacy ? EXAMS_TEXT.legacy : `${course.cfu} CFU`}</Tag>{legacy && <HelpTip title={EXAMS_HELP.legacy.title} text={EXAMS_HELP.legacy.text} />}</div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="quiet-panel p-3"><dt className="text-xs font-bold text-[var(--muted)]">{label}</dt><dd className="safe-text mt-1 text-sm font-extrabold">{value}</dd></div>)}</dl>
      <p className="text-sm text-[var(--muted)]">La durata della prova non è pubblicata: se aggiungi l'appello al tuo calendario, compare come promemoria per tutta la giornata.</p>
      <div><h3 className="text-sm font-black">Note ufficiali</h3><p className="safe-text mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{session.notes ?? "Nessuna nota pubblicata."}</p></div>
      {session.sourceReferences && session.sourceReferences.length > 1 && <div><h3 className="mb-2 text-sm font-black">Iscrizioni per ordinamento</h3><ul className="grid grid-cols-1 gap-2">{session.sourceReferences.map((reference, index) => <li key={`${reference.sourceUrl}-${reference.officialId ?? index}`} className="quiet-panel p-3"><a href={safeHref(reference.sourceUrl)} target="_blank" rel="noreferrer" className="text-sm font-extrabold text-[var(--accent-ink)] underline">Fonte {reference.degreeCode ?? index + 1}</a><p className="safe-text mt-1 text-xs text-[var(--muted)]">{reference.sourceCourseName}</p><p className="mt-1 text-xs">Apertura: {reference.registrationOpens ? barbSessionDate(reference.registrationOpens) : "Non pubblicata"}<br />Chiusura: {reference.registrationCloses ? barbSessionDate(reference.registrationCloses) : "Non pubblicata"}</p></li>)}</ul></div>}
      <div className="quiet-panel p-4"><a href={safeHref(session.provenance.sourceUrl)} target="_blank" rel="noreferrer" className="text-sm font-extrabold text-[var(--accent-ink)] underline">Apri la fonte ufficiale UNIMI</a>
        <p className="safe-text mt-2 text-xs text-[var(--muted)]">Verificata il {barbSessionDate(session.provenance.lastVerifiedAt.slice(0, 10))}{session.provenance.sourcePage ? ` · pagina ${session.provenance.sourcePage}` : ""}. Date e iscrizioni possono cambiare: controlla la fonte prima di iscriverti.</p>
      </div>
    </div>;
  if (inline) return <section className="quiet-panel mt-4 p-4" aria-label="Dettagli dell'appello"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-black">Dettagli dell'appello</h4><Button icon="X" onClick={onClose}>Chiudi dettagli</Button></div>{content}</section>;
  return <Drawer open onClose={onClose} title={course.name} eyebrow={EXAMS_TEXT.officialEyebrow} headerExtra={<CourseIcon course={course} className="h-7 w-7" />}>{content}</Drawer>;
}

export function BarbExamSessions({ course }: { course: BarbCourse }) {
  const today = barbToday(useNow(60_000));
  const [selected, setSelected] = useState<BarbExamSession | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
    setExpanded(null);
  }, [course.id]);
  const sessions = BARB_EXAM_SESSIONS.filter(session => session.courseId === course.id)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  // The official FBG feed includes distinct enrolments for different teaching units.
  // Show a single date/time card without discarding any original published registration.
  const groups = new Map<string, BarbExamSession[]>();
  for (const session of sessions) {
    const key = examSlotKey(session);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return <div className="min-w-0">
    <div className="mb-3 flex items-start gap-3">
      <span style={{ color: courseColor(course) }}><CourseIcon course={course} className="h-6 w-6" /></span>
      <div className="min-w-0">
        <h3 className="safe-text text-lg font-black">{course.name}</h3>
        <p className="text-xs font-bold text-[var(--muted)]">
          {groups.size === 0 ? "Nessun appello pubblicato" : groups.size === 1 ? "1 appello pubblicato (compresi i passati)" : `${groups.size} appelli pubblicati (compresi i passati)`}
          {sessions.length > groups.size && <span> · {EXAMS_TEXT.registrationsCount(sessions.length)}</span>}
        </p>
      </div>
    </div>
    {groups.size ? <ul className="grid grid-cols-1 gap-2">
      {[...groups.entries()].map(([key, group]) => {
        const session = group[0];
        const status = getExamStatus(session, BARB_EXAM_SESSIONS, today);
        return <li key={key} className="min-w-0">
          <button type="button" onClick={() => {
            if (group.length > 1) {
              setExpanded(previous => previous === key ? null : key);
              setSelected(null);
            } else {
              setExpanded(null);
              setSelected(session);
            }
          }} className="quiet-panel flex w-full min-w-0 flex-wrap items-center gap-2 p-3 text-left hover:bg-[var(--surface)]">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold">{barbSessionDate(session.date)}</div>
              <div className="safe-text mt-1 text-xs text-[var(--muted)]">
                {barbSessionType(session.type)} · {session.time ?? "Orario non pubblicato"}
                {group.length > 1 ? ` · ${EXAMS_TEXT.registrations(group.length)}` : ""}
              </div>
            </div>
            <Tag color={status === "prossimo" ? "var(--accent)" : undefined}>
              {BARB_EXAM_TIMING_LABEL[status]}
            </Tag>
          </button>
          {group.length > 1 && expanded === key && <div className="ml-2 mt-1 grid grid-cols-1 gap-1 border-l-2 border-[var(--accent)] pl-2">
            {group.map((variant, index) => <button key={variant.id} type="button"
              onClick={() => setSelected(variant)}
              className="quiet-panel flex min-w-0 flex-wrap items-center gap-2 p-2 text-left text-xs hover:bg-[var(--surface)]">
              <span className="min-w-0 flex-1 font-bold">
                {variant.sourceCourseCode ?? `Voce ${index + 1}`}
                {variant.commission ? ` · ${variant.commission}` : ""}
              </span>
              <span className="text-[var(--accent-ink)]">Vedi dettagli</span>
            </button>)}
          </div>}
        </li>;
      })}
    </ul> : <EmptyState icon="CalendarDays" title="Nessun appello ufficiale trovato" body="Le fonti ufficiali non riportano date per questo insegnamento: non vuol dire che non ci siano esami." />}
    {selected && selected.courseId === course.id && <BarbExamSessionDetail inline session={selected} course={course} onClose={() => setSelected(null)} />}
  </div>;
}
