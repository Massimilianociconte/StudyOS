import { useEffect, useMemo, useRef, useState } from "react";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { BarbCourse } from "../lib/university/types";
import type { BarbExamSession } from "../lib/university/examTypes";
import { BARB_EXAMS_PAGE_URL, BARB_EXAM_COURSES, BARB_EXAM_SESSIONS, barbCheckedDay, barbExamSourceUid, getExamStatus, isTechnicalFeedUrl, resolveBarbCourse } from "../lib/university/examSessions";
import { courseSlotKey, examSlotKey } from "../lib/barbExamSlots";
import { courseColor } from "../lib/barbCourseVisuals";
import { safeHref } from "../lib/safeUrl";
import { BARB_EXAM_TIMING_LABEL, BARB_EXAM_TYPE_LABEL, BARB_EXAM_TYPE_MISSING, EXAMS_HELP, EXAMS_TEXT } from "../lib/labels/exams";
import { useNow } from "../hooks/useNow";
import { useStudyStore } from "../store/useStudyStore";
import { CourseIcon } from "./CourseIcon";
import { Icon } from "./Icon";
import { Button, Drawer, EmptyState, HelpTip, Tag } from "./ui";

export const barbToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const barbSessionDate = (date: string) => format(parseISO(date), "d MMMM yyyy", { locale: it });
export const barbSessionType = (type: string | null) => (type ? (BARB_EXAM_TYPE_LABEL[type] ?? type) : BARB_EXAM_TYPE_MISSING);

export function BarbExamAvailability({ course }: { course: BarbCourse }) {
  const count = new Set(BARB_EXAM_SESSIONS.filter(session => session.courseId === course.id).map(examSlotKey)).size;
  return <p className={`mt-2 text-xs font-bold ${count ? "text-[var(--accent-ink)]" : "text-[var(--faint)]"}`}>{count ? `${count} ${count === 1 ? "appello ufficiale" : "appelli ufficiali"}` : "Nessun appello ufficiale trovato"}</p>;
}

/**
 * «Aggiungi al calendario» dal dettaglio di un appello: la stessa aggiunta di «Aggiungi appelli
 * ufficiali» (stesso controllo nello store), per un appello solo. Non per gli appelli passati né per gli
 * insegnamenti che non sono tra le materie attive.
 */
function AddSessionToCalendar({ session, course }: { session: BarbExamSession; course: BarbCourse }) {
  const today = barbToday(useNow(60_000));
  const subjects = useStudyStore((state) => state.subjects);
  const events = useStudyStore((state) => state.events);
  const importBarbExamSessions = useStudyStore((state) => state.importBarbExamSessions);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [problem, setProblem] = useState("");
  const eligible = useMemo(() => subjects.some((subject) => !subject.archived && subject.status !== "archived" && subject.status !== "completed" && resolveBarbCourse(subject, BARB_EXAM_COURSES)?.id === course.id), [subjects, course.id]);
  // Già nel calendario con una qualsiasi iscrizione dello stesso appello, come nella scelta degli appelli.
  const inCalendar = useMemo(() => {
    const uids = new Set(events.flatMap((event) => (event.sourceUid ? [event.sourceUid] : [])));
    const slot = courseSlotKey(session);
    return [session, ...BARB_EXAM_SESSIONS].some((other) => courseSlotKey(other) === slot && uids.has(barbExamSourceUid(other)));
  }, [events, session]);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await importBarbExamSessions([session]);
      if (result.added) setAdded(true);
      else setProblem(EXAMS_TEXT.sessionNotAdded);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : EXAMS_TEXT.sessionAddFailed);
    } finally {
      setBusy(false);
    }
  };
  return <div className="quiet-panel space-y-3 p-4">
    <p className="text-sm text-[var(--muted)]">La durata della prova non è pubblicata: se aggiungi l'appello al tuo calendario, compare come promemoria per tutta la giornata.</p>
    {inCalendar ? <p role="status" className="flex items-center gap-2 text-sm font-bold text-[var(--success-text)]"><Icon name="Check" className="h-4 w-4 shrink-0" />{added ? EXAMS_TEXT.sessionAdded : EXAMS_TEXT.sessionInCalendar}</p>
      : session.date < today ? <p className="text-sm font-bold text-[var(--muted)]">{EXAMS_TEXT.sessionPast}</p>
      : !eligible ? <p className="text-sm font-bold text-[var(--muted)]">{EXAMS_TEXT.sessionNotYours}</p>
      : <Button variant="soft" icon="CalendarPlus" disabled={busy} onClick={() => void add()}>{busy ? EXAMS_TEXT.addingSession : EXAMS_TEXT.addSessionToCalendar}</Button>}
    {problem ? <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">{problem}</p> : null}
  </div>;
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
  // Il feed JSON è il dato da cui vengono le date, non una pagina da leggere: il link principale va alla
  // pagina degli appelli del corso di laurea, il feed resta come fonte tecnica.
  const source = session.provenance.sourceUrl;
  const technical = isTechnicalFeedUrl(source);
  const linkClass = "inline-flex min-h-11 items-center text-sm font-extrabold text-[var(--accent-ink)] underline";
  const content = <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5"><Tag color={courseColor(course)}>{legacy ? EXAMS_TEXT.legacy : `${course.cfu} CFU`}</Tag>{legacy && <HelpTip title={EXAMS_HELP.legacy.title} text={EXAMS_HELP.legacy.text} />}</div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="quiet-panel p-3"><dt className="text-xs font-bold text-[var(--muted)]">{label}</dt><dd className="safe-text mt-1 text-sm font-extrabold">{value}</dd></div>)}</dl>
      <AddSessionToCalendar key={session.id} session={session} course={course} />
      <div><h3 className="text-sm font-black">Note ufficiali</h3><p className="safe-text mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{session.notes ?? "Nessuna nota pubblicata."}</p></div>
      {session.sourceReferences && session.sourceReferences.length > 1 && <div><h3 className="mb-2 text-sm font-black">Iscrizioni per ordinamento</h3><ul className="grid grid-cols-1 gap-2">{session.sourceReferences.map((reference, index) => <li key={`${reference.sourceUrl}-${reference.officialId ?? index}`} className="quiet-panel p-3"><a href={safeHref(reference.sourceUrl)} target="_blank" rel="noreferrer" className={linkClass}>{EXAMS_TEXT.referenceSource(reference.degreeCode ?? index + 1, isTechnicalFeedUrl(reference.sourceUrl))}</a><p className="safe-text mt-1 text-xs text-[var(--muted)]">{reference.sourceCourseName}</p><p className="mt-1 text-xs">Apertura: {reference.registrationOpens ? barbSessionDate(reference.registrationOpens) : "Non pubblicata"}<br />Chiusura: {reference.registrationCloses ? barbSessionDate(reference.registrationCloses) : "Non pubblicata"}</p></li>)}</ul></div>}
      <div className="quiet-panel p-4">
        <div className="flex flex-wrap items-center gap-x-4">
          <a href={safeHref(technical ? BARB_EXAMS_PAGE_URL : source)} target="_blank" rel="noreferrer" className={linkClass}>{technical ? EXAMS_TEXT.openBarbExamsPage : EXAMS_TEXT.openOfficialSource}</a>
          {technical ? <a href={safeHref(source)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-xs font-bold text-[var(--muted)] underline">{EXAMS_TEXT.technicalData}</a> : null}
        </div>
        <p className="safe-text mt-1 text-xs text-[var(--muted)]">{EXAMS_TEXT.verifiedOn(barbCheckedDay(session.provenance.lastVerifiedAt), session.provenance.sourcePage)}</p>
      </div>
    </div>;
  if (inline) return <section className="quiet-panel mt-2 p-4" aria-label="Dettagli dell'appello"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-black">Dettagli dell'appello</h4><Button icon="X" onClick={onClose}>Chiudi dettagli</Button></div>{content}</section>;
  return <Drawer open onClose={onClose} title={course.name} eyebrow={EXAMS_TEXT.officialEyebrow} headerExtra={<CourseIcon course={course} className="h-7 w-7" />}>{content}</Drawer>;
}

export function BarbExamSessions({ course }: { course: BarbCourse }) {
  const today = barbToday(useNow(60_000));
  const [selected, setSelected] = useState<BarbExamSession | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelected(null);
    setExpanded(null);
  }, [course.id]);
  // Il dettaglio si apre sotto l'appello toccato: lo si porta in vista e ci si sposta il focus,
  // altrimenti sul telefono il tocco sembra non fare nulla.
  useEffect(() => {
    const node = detailRef.current;
    if (!selected || !node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "start" });
  }, [selected]);
  const closeDetail = () => {
    const id = selected?.id ?? "";
    setSelected(null);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-session="${CSS.escape(id)}"]`)?.focus());
  };
  const sessions = BARB_EXAM_SESSIONS.filter(session => session.courseId === course.id)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  // The official FBG feed includes distinct enrolments for different teaching units.
  // Show a single date/time card without discarding any original published registration.
  const groups = new Map<string, BarbExamSession[]>();
  for (const session of sessions) {
    const key = examSlotKey(session);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  const shown = selected && selected.courseId === course.id ? selected : null;
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
    {groups.size ? <ul ref={listRef} className="grid grid-cols-1 gap-2">
      {[...groups.entries()].map(([key, group]) => {
        const session = group[0];
        const status = getExamStatus(session, BARB_EXAM_SESSIONS, today);
        const many = group.length > 1;
        const open = many && expanded === key;
        const here = shown && group.some((item) => item.id === shown.id) ? shown : null;
        return <li key={key} className="min-w-0">
          <button type="button" data-session={many ? undefined : session.id} aria-expanded={many ? open : undefined} aria-pressed={many ? undefined : Boolean(here)} onClick={() => {
            if (many) {
              setExpanded(previous => previous === key ? null : key);
              setSelected(null);
            } else {
              setExpanded(null);
              setSelected(session);
            }
          }} className={`quiet-panel flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 p-3 text-left hover:bg-[var(--surface)] ${!many && here ? "ring-2 ring-[var(--accent)]" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold">{barbSessionDate(session.date)}</div>
              <div className="safe-text mt-1 text-xs text-[var(--muted)]">
                {barbSessionType(session.type)} · {session.time ?? "Orario non pubblicato"}
                {many ? ` · ${EXAMS_TEXT.registrations(group.length)}` : ""}
              </div>
            </div>
            <Tag color={status === "prossimo" ? "var(--accent)" : undefined}>
              {BARB_EXAM_TIMING_LABEL[status]}
            </Tag>
          </button>
          {open && <div className="ml-2 mt-1 grid grid-cols-1 gap-1 border-l-2 border-[var(--accent)] pl-2">
            {group.map((variant, index) => {
              const chosen = here?.id === variant.id;
              return <button key={variant.id} type="button" data-session={variant.id} aria-pressed={chosen}
                onClick={() => setSelected(variant)}
                className={`quiet-panel flex min-h-11 min-w-0 flex-wrap items-center gap-2 p-2 text-left text-xs hover:bg-[var(--surface)] ${chosen ? "ring-2 ring-[var(--accent)]" : ""}`}>
                <span className="min-w-0 flex-1 font-bold">
                  {variant.sourceCourseCode ?? `Voce ${index + 1}`}
                  {variant.commission ? ` · ${variant.commission}` : ""}
                </span>
                <span className="text-[var(--accent-ink)]">{chosen ? EXAMS_TEXT.shownDetails : EXAMS_TEXT.seeDetails}</span>
              </button>;
            })}
          </div>}
          {here ? <div ref={detailRef} tabIndex={-1} className="scroll-mt-2 rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"><BarbExamSessionDetail inline session={here} course={course} onClose={closeDetail} /></div> : null}
        </li>;
      })}
    </ul> : <EmptyState icon="CalendarDays" title="Nessun appello ufficiale trovato" body="Le fonti ufficiali non riportano date per questo insegnamento: non vuol dire che non ci siano esami." />}
  </div>;
}
