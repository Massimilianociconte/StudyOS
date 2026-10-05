import { useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { it } from "date-fns/locale";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { BARB_EXAM_COURSES, BARB_EXAM_DATA, BARB_EXAM_SESSIONS } from "../lib/university/examSessions";
import type { BarbExamSession } from "../lib/university/examTypes";
import { courseColor } from "../lib/barbCourseVisuals";
import { safeHref } from "../lib/safeUrl";
import { oneOf, useUiState } from "../lib/uiState";
import { useNow } from "../hooks/useNow";
import { CourseIcon } from "./CourseIcon";
import { BarbExamImport } from "./BarbExamImport";
import { BarbExamSessionDetail, BarbExamSessions, barbSessionDate, barbSessionType, barbToday } from "./BarbExamSessions";
import { Button, EmptyState, Field, IconButton, Panel, SectionTitle, Segmented, Tag, inputClass } from "./ui";

type Mode = "day" | "week" | "month";
const modes: { id: Mode; label: string }[] = [{ id: "day", label: "Giorno" }, { id: "week", label: "Settimana" }, { id: "month", label: "Mese" }];
const dateKey = (date: Date) => format(date, "yyyy-MM-dd");
const currentIds = new Set(BARB_DATASET.courses.map((course) => course.id));

export function BarbExamCalendar() {
  const today = barbToday(useNow(60_000));
  const [mode, setMode] = useUiState<Mode>("barbExams.mode", "month", { validate: oneOf("day", "week", "month") });
  const [cursorKey, setCursorKey] = useUiState("barbExams.cursor", () => today, { scope: "tab", validate: (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime()) });
  const [filter, setFilter] = useUiState("barbExams.course", "all", { validate: (value) => value === "all" || BARB_EXAM_COURSES.some((course) => course.id === value) });
  const [selected, setSelected] = useState<BarbExamSession | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const cursor = parseISO(cursorKey);
  const filtered = BARB_EXAM_SESSIONS.filter((session) => filter === "all" || session.courseId === filter);
  const byDate = useMemo(() => {
    const grouped = new Map<string, BarbExamSession[]>();
    for (const session of filtered) grouped.set(session.date, [...(grouped.get(session.date) ?? []), session]);
    return grouped;
  }, [filter]);
  const days = mode === "month" ? eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) }) : mode === "week" ? eachDayOfInterval({ start: startOfWeek(cursor, { weekStartsOn: 1 }), end: endOfWeek(cursor, { weekStartsOn: 1 }) }) : [cursor];
  const collisionCount = (date: string) => new Set(BARB_EXAM_SESSIONS.filter((session) => session.date === date).map((session) => session.courseId)).size;
  const collisions = days.filter((day) => collisionCount(dateKey(day)) > 1);
  const periodLabel = mode === "month" ? format(cursor, "MMMM yyyy", { locale: it }) : mode === "week" ? `${format(days[0], "d MMM", { locale: it })} – ${format(days[6], "d MMM yyyy", { locale: it })}` : format(cursor, "EEEE d MMMM yyyy", { locale: it });
  const selectedCourse = BARB_EXAM_COURSES.find((course) => course.id === filter);
  const detailCourse = selected && BARB_EXAM_COURSES.find((course) => course.id === selected.courseId);
  const coverage = BARB_DATASET.courses.filter((course) => BARB_EXAM_SESSIONS.some((session) => session.courseId === course.id)).length;
  const nextSession = filtered.filter((session) => session.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const navigate = (direction: number) => setCursorKey(dateKey(mode === "month" ? addMonths(cursor, direction) : mode === "week" ? addWeeks(cursor, direction) : addDays(cursor, direction)));
  const sessionButton = (session: BarbExamSession, compact = false) => {
    const course = BARB_EXAM_COURSES.find((item) => item.id === session.courseId);
    if (!course) return null;
    return <button key={session.id} type="button" onClick={() => setSelected(session)} title={`${course.name} · ${barbSessionType(session.type)} · ${session.time ?? "Orario non pubblicato"}`} aria-label={`${course.name}, ${barbSessionDate(session.date)}, ${barbSessionType(session.type)}. Apri dettagli`} style={{ borderLeftColor: courseColor(course) }} className={`w-full min-w-0 rounded-lg border-l-[3px] bg-[var(--surface-strong)] text-left hover:bg-[var(--surface)] ${compact ? "min-h-8 px-1 py-1 sm:px-2" : "flex min-h-14 items-start gap-2 p-3"}`}>
      <span className={compact ? "flex min-w-0 items-center gap-1" : "contents"}><span className="shrink-0" style={{ color: courseColor(course) }}><CourseIcon course={course} className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} /></span><span className="min-w-0"><span className={`${compact ? "block truncate text-[10px] sm:text-xs" : "safe-text block text-sm"} font-extrabold`}>{course.name}</span>{!compact && <span className="safe-text mt-0.5 block text-xs text-[var(--muted)]">{barbSessionType(session.type)} · {session.time ?? "Orario non pubblicato"}{!currentIds.has(course.id) ? " · Precedente ordinamento F92" : ""}</span>}</span></span>
    </button>;
  };
  return <div className="min-w-0 space-y-4">
    <SectionTitle title="Calendario Esami BARB" subtitle="Calendario generale del corso: tutti gli insegnamenti obbligatori e a scelta, indipendentemente dal tuo piano personale." action={<Button icon="Download" variant="primary" onClick={() => setImportOpen(true)}>Importa nel mio calendario</Button>} />
    <div className="quiet-panel p-3 text-sm text-[var(--muted)]"><strong className="text-[var(--text)]">{coverage}/{BARB_DATASET.courses.length} insegnamenti del piano con appelli verificati</strong> · {BARB_EXAM_SESSIONS.length} date ufficiali, inclusi gli insegnamenti del precedente ordinamento F92. Verifica delle fonti: {BARB_EXAM_DATA.checkedAt ? barbSessionDate(BARB_EXAM_DATA.checkedAt.slice(0, 10)) : "non disponibile"}.<p className="mt-1 text-xs">Le fonti consultate non consentono di verificare date per tutti gli insegnamenti. Nessuna data viene dedotta; l'assenza di appelli verificati non significa assenza di esami.</p></div>
    <Panel>
      {BARB_EXAM_DATA.sources.some((source) => source.status === "non-verificato") && <p role="status" className="mb-3 rounded-[18px] bg-[var(--warning-bg)] p-3 text-sm text-[var(--warning-text)]">Alcune fonti non sono disponibili o sono parziali. Il calendario include solo gli appelli verificati; controlla la copertura delle fonti qui sotto.</p>}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><Field label="Insegnamento" className="lg:max-w-md lg:flex-1"><select value={filter} onChange={(event) => setFilter(event.target.value)} className={inputClass}><option value="all">Tutti gli insegnamenti BARB</option>{BARB_EXAM_COURSES.map((course) => <option key={course.id} value={course.id}>{course.name}{!currentIds.has(course.id) ? " (F92)" : ""}</option>)}</select></Field><Segmented value={mode} options={modes} onChange={setMode} label="Vista del calendario esami BARB" /></div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="safe-text min-w-0 text-lg font-black capitalize">{periodLabel}</h3><div className="flex items-center gap-1"><Button variant="soft" onClick={() => setCursorKey(today)}>Oggi</Button><IconButton icon="ChevronLeft" label="Periodo precedente" onClick={() => navigate(-1)} /><IconButton icon="ChevronRight" label="Periodo successivo" onClick={() => navigate(1)} /></div></div>
      {collisions.length > 0 && <div className="mb-3 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs font-bold text-[var(--warning-text)]"><span className="block text-sm font-black">Appelli nella stessa giornata</span>{collisions.map((day) => barbSessionDate(dateKey(day))).join(" · ")}<span className="mt-1 block">Insegnamenti diversi condividono la data. Verifica gli orari pubblicati: questo avviso non indica una sovrapposizione oraria.</span></div>}
      <p className="mb-3 text-xs text-[var(--muted)]">Gli appelli sono promemoria sulla data; gli orari pubblicati sono nei dettagli.</p>
      {mode === "month" ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)]"><div className="grid grid-cols-7 bg-[var(--surface-soft)]">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <div key={day} className="py-2 text-center text-[10px] font-black text-[var(--muted)] sm:text-xs">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => {
        const key = dateKey(day); const sessions = byDate.get(key) ?? []; const sameDay = collisionCount(key);
        return <div key={key} className={`min-h-[86px] min-w-0 border-t border-r border-[var(--border)] ${sameDay > 1 ? "ring-1 ring-inset ring-[var(--warning-text)]" : ""} p-0.5 sm:min-h-[115px] sm:p-1.5 ${!isSameMonth(day, cursor) ? "bg-[var(--surface-soft)]" : ""}`}><button type="button" onClick={() => { setCursorKey(key); setMode("day"); }} aria-label={`Apri ${barbSessionDate(key)}, ${sessions.length} appelli`} aria-current={key === today ? "date" : undefined} className={`mb-1 grid h-7 w-7 place-items-center rounded-full text-xs font-black ${key === today ? "bg-[var(--accent)] text-[#10131d]" : !isSameMonth(day, cursor) ? "text-[var(--faint)]" : "hover:bg-[var(--surface)]"}`}>{format(day, "d")}</button>{sameDay > 1 && <span title="Appelli di insegnamenti diversi nella stessa giornata" className="mb-1 block truncate text-[9px] font-bold text-[var(--warning-text)]">{sameDay} corsi</span>}<div className="space-y-1">{sessions.map((session) => sessionButton(session, true))}</div></div>;
      })}</div></div> : <div className={`grid grid-cols-1 gap-3 ${mode === "week" ? "xl:grid-cols-7" : ""}`}>{days.map((day) => <section key={dateKey(day)} className={`quiet-panel min-w-0 p-3 ${collisionCount(dateKey(day)) > 1 ? "ring-1 ring-[var(--warning-text)]" : ""}`}><h4 className="mb-3 text-sm font-black capitalize">{format(day, "EEE d MMM", { locale: it })}{dateKey(day) === today ? " · Oggi" : ""}</h4>{collisionCount(dateKey(day)) > 1 && <p className="mb-2 text-xs font-bold text-[var(--warning-text)]">Appelli nella stessa giornata · {collisionCount(dateKey(day))} corsi</p>}<div className="grid grid-cols-1 gap-2">{(byDate.get(dateKey(day)) ?? []).map((session) => sessionButton(session))}</div>{!byDate.has(dateKey(day)) && <p className="text-xs text-[var(--muted)]">Nessun appello verificato.</p>}</section>)}</div>}
      {!days.some((day) => byDate.has(dateKey(day))) && <div className="mt-4"><EmptyState icon="CalendarDays" title="Nessun appello verificato in questo periodo" body="Puoi cambiare periodo o consultare l'elenco degli appelli per insegnamento." action={nextSession ? <Button variant="soft" onClick={() => setCursorKey(nextSession.date)}>Vai al prossimo appello</Button> : undefined} /></div>}
    </Panel>
    {selectedCourse && <div id="barb-exam-course-sessions" className="scroll-mt-6"><Panel><BarbExamSessions course={selectedCourse} /></Panel></div>}
    <Panel><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-black">Appelli per insegnamento</h3><Tag>{BARB_DATASET.courses.length} insegnamenti del piano BARB</Tag></div><p className="mb-4 text-sm text-[var(--muted)]">Scegli un insegnamento per vedere tutte le date pubblicate, anche passate.</p><div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{BARB_EXAM_COURSES.map((course) => <button type="button" key={course.id} aria-pressed={filter === course.id} onClick={() => { setFilter(course.id); requestAnimationFrame(() => document.getElementById("barb-exam-course-sessions")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} className={`quiet-panel flex min-w-0 items-start gap-2 p-3 text-left hover:bg-[var(--surface)] ${filter === course.id ? "ring-2 ring-[var(--accent)]" : ""}`}><span style={{ color: courseColor(course) }} className="mt-0.5 shrink-0"><CourseIcon course={course} className="h-5 w-5" /></span><span className="min-w-0"><span className="safe-text block text-sm font-extrabold">{course.name}</span><span className="block text-xs text-[var(--muted)]">{BARB_EXAM_SESSIONS.filter((session) => session.courseId === course.id).length} appelli verificati{!currentIds.has(course.id) ? " · Precedente ordinamento F92" : ""}</span></span></button>)}</div></Panel>
    <details className="quiet-panel p-4"><summary className="cursor-pointer text-sm font-extrabold">Fonti ufficiali e copertura dei dati</summary><ul className="mt-3 grid grid-cols-1 gap-2">{BARB_EXAM_DATA.sources.map((source) => <li key={source.url} className="safe-text text-xs text-[var(--muted)]"><a href={safeHref(source.url)} target="_blank" rel="noreferrer" className="font-bold text-[var(--accent-ink)] underline">Fonte ufficiale UNIMI</a> · {source.note}</li>)}</ul></details>
    {selected && detailCourse && <BarbExamSessionDetail session={selected} course={detailCourse} onClose={() => setSelected(null)} />}
    {importOpen && <BarbExamImport onClose={() => setImportOpen(false)} />}
  </div>;
}
