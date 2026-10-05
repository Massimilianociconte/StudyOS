import { useEffect, useState } from "react";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { BarbCourse } from "../lib/university/types";
import type { BarbExamSession } from "../lib/university/examTypes";
import { BARB_EXAM_SESSIONS, getExamStatus } from "../lib/university/examSessions";
import { courseColor } from "../lib/barbCourseVisuals";
import { safeHref } from "../lib/safeUrl";
import { useNow } from "../hooks/useNow";
import { CourseIcon } from "./CourseIcon";
import { Button, Drawer, EmptyState, Tag } from "./ui";

export const barbToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const barbSessionDate = (date: string) => format(parseISO(date), "d MMMM yyyy", { locale: it });
export const barbSessionType = (type: string | null) => type ? ({ written: "Scritto", oral: "Orale", practical: "Pratico", exam: "Esame", partial: "Parziale" }[type] ?? type) : "Tipo non pubblicato";

export function BarbExamAvailability({ course }: { course: BarbCourse }) {
  const count = BARB_EXAM_SESSIONS.filter((session) => session.courseId === course.id).length;
  return <p className={`mt-2 text-xs font-bold ${count ? "text-[var(--accent-ink)]" : "text-[var(--faint)]"}`}>{count ? `${count} ${count === 1 ? "appello verificato" : "appelli verificati"}` : "Nessun appello verificato"}</p>;
}

export function BarbExamSessionDetail({ session, course, onClose, inline = false }: { session: BarbExamSession; course: BarbCourse; onClose: () => void; inline?: boolean }) {
  const fields = [
    ["Data", barbSessionDate(session.date)],
    ["Tipo di prova", barbSessionType(session.type)],
    ...(session.component ? [["Componente / prova", session.component]] : []),
    ...(session.commission ? [["Commissione", session.commission]] : []),
    ["Orario", session.time ?? "Orario non pubblicato"],
    ["Sede / aula", session.location ?? "Sede e aula non pubblicate"],
    ["Apertura iscrizioni", session.registrationOpens ? barbSessionDate(session.registrationOpens) : "Non pubblicata"],
    ["Chiusura iscrizioni", session.registrationCloses ? barbSessionDate(session.registrationCloses) : "Non pubblicata"]
  ];
  const legacy = !BARB_DATASET.courses.some((item) => item.id === course.id);
  const content = <div className="space-y-5">
      <Tag color={courseColor(course)}>{legacy ? "Precedente ordinamento F92" : `${course.cfu} CFU`}</Tag>{legacy && <p className="text-xs text-[var(--muted)]">Appello del precedente ordinamento F92: questo insegnamento non è nel piano BARB attuale.</p>}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="quiet-panel p-3"><dt className="text-xs font-bold text-[var(--muted)]">{label}</dt><dd className="safe-text mt-1 text-sm font-extrabold">{value}</dd></div>)}</dl>
      <p className="text-sm text-[var(--muted)]">Promemoria sulla data; consulta l'orario ufficiale nei dettagli. La durata della prova non è pubblicata.</p>
      <div><h3 className="text-sm font-black">Note ufficiali</h3><p className="safe-text mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{session.notes ?? "Nessuna nota pubblicata."}</p></div>
      {session.sourceReferences && session.sourceReferences.length > 1 && <div><h3 className="mb-2 text-sm font-black">Iscrizioni per ordinamento</h3><ul className="grid grid-cols-1 gap-2">{session.sourceReferences.map((reference, index) => <li key={`${reference.sourceUrl}-${reference.officialId ?? index}`} className="quiet-panel p-3"><a href={safeHref(reference.sourceUrl)} target="_blank" rel="noreferrer" className="text-sm font-extrabold text-[var(--accent-ink)] underline">Fonte {reference.degreeCode ?? index + 1}</a><p className="safe-text mt-1 text-xs text-[var(--muted)]">{reference.sourceCourseName}</p><p className="mt-1 text-xs">Apertura: {reference.registrationOpens ? barbSessionDate(reference.registrationOpens) : "Non pubblicata"}<br />Chiusura: {reference.registrationCloses ? barbSessionDate(reference.registrationCloses) : "Non pubblicata"}</p></li>)}</ul></div>}
      <div className="quiet-panel p-4"><a href={safeHref(session.provenance.sourceUrl)} target="_blank" rel="noreferrer" className="text-sm font-extrabold text-[var(--accent-ink)] underline">Apri la fonte ufficiale UNIMI</a>
        <p className="safe-text mt-2 text-xs text-[var(--muted)]">Verificata il {barbSessionDate(session.provenance.lastVerifiedAt.slice(0, 10))}{session.provenance.sourcePage ? ` · pagina ${session.provenance.sourcePage}` : ""}. Date e iscrizioni possono cambiare: controlla la fonte prima di prenotare.</p>
      </div>
    </div>;
  if (inline) return <section className="quiet-panel mt-4 p-4" aria-label="Dettagli dell'appello"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-black">Dettagli dell'appello</h4><Button icon="X" onClick={onClose}>Chiudi dettagli</Button></div>{content}</section>;
  return <Drawer open onClose={onClose} title={course.name} eyebrow="Appello ufficiale BARB" headerExtra={<CourseIcon course={course} className="h-7 w-7" />}>{content}</Drawer>;
}

export function BarbExamSessions({ course }: { course: BarbCourse }) {
  const today = barbToday(useNow(60_000));
  const [selected, setSelected] = useState<BarbExamSession | null>(null);
  useEffect(() => setSelected(null), [course.id]);
  const sessions = BARB_EXAM_SESSIONS.filter((session) => session.courseId === course.id).sort((a, b) => a.date.localeCompare(b.date));
  return <div className="min-w-0">
    <div className="mb-3 flex items-start gap-3"><span style={{ color: courseColor(course) }}><CourseIcon course={course} className="h-6 w-6" /></span><div className="min-w-0"><h3 className="safe-text text-lg font-black">{course.name}</h3><p className="text-xs font-bold text-[var(--muted)]">Tutti gli appelli pubblicati · {sessions.length}</p></div></div>
    {sessions.length ? <ul className="grid grid-cols-1 gap-2">{sessions.map((session) => <li key={session.id}><button type="button" onClick={() => setSelected(session)} className="quiet-panel flex w-full min-w-0 flex-wrap items-center gap-2 p-3 text-left hover:bg-[var(--surface)]"><div className="min-w-0 flex-1"><div className="text-sm font-extrabold">{barbSessionDate(session.date)}</div><div className="safe-text mt-1 text-xs text-[var(--muted)]">{barbSessionType(session.type)} · {session.time ?? "Orario non pubblicato"}</div></div><Tag color={getExamStatus(session, BARB_EXAM_SESSIONS, today) === "prossimo" ? "var(--accent)" : undefined}>{({ passato: "Passato", prossimo: "Prossimo", futuro: "Futuro" })[getExamStatus(session, BARB_EXAM_SESSIONS, today)]}</Tag></button></li>)}</ul> : <EmptyState icon="CalendarDays" title="Nessun appello verificato" body="Nelle fonti consultate non risultano date verificate per questo insegnamento. Non significa che non siano previsti esami." />}
    {selected && selected.courseId === course.id && <BarbExamSessionDetail inline session={selected} course={course} onClose={() => setSelected(null)} />}
  </div>;
}
