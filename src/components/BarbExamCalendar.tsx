import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { it } from "date-fns/locale";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { BARB_EXAM_COURSES, BARB_EXAM_DATA, BARB_EXAM_SESSIONS } from "../lib/university/examSessions";
import type { BarbExamSession } from "../lib/university/examTypes";
import type { BarbCourse } from "../lib/university/types";
import { courseColor } from "../lib/barbCourseVisuals";
import { groupExamSlots, slotDifference, slotTwins, type BarbExamSlot } from "../lib/barbExamSlots";
import { safeHref } from "../lib/safeUrl";
import { EXAMS_HELP, EXAMS_TEXT, OFFICIAL_EXAMS_ADD_LABEL } from "../lib/labels/exams";
import { oneOf, useUiState } from "../lib/uiState";
import { useNow } from "../hooks/useNow";
import { CourseIcon } from "./CourseIcon";
import { BarbExamImport } from "./BarbExamImport";
import { BarbExamSessionDetail, BarbExamSessions, barbSessionDate, barbSessionType, barbToday } from "./BarbExamSessions";
import { Button, Drawer, EmptyState, Field, HelpTip, IconButton, Panel, Segmented, Tag, inputClass } from "./ui";

type Mode = "day" | "week" | "month";
const modes: { id: Mode; label: string }[] = [{ id: "day", label: "Giorno" }, { id: "week", label: "Settimana" }, { id: "month", label: "Mese" }];
const dateKey = (date: Date) => format(date, "yyyy-MM-dd");
const currentIds = new Set(BARB_DATASET.courses.map((course) => course.id));
const appelliLabel = (count: number) => (count === 0 ? "Nessun appello ufficiale trovato" : count === 1 ? "1 appello ufficiale" : `${count} appelli ufficiali`);
/** Qui non serve sapere cosa è già nel calendario: si raggruppano solo gli appelli. */
const NO_IMPORTED: ReadonlySet<string> = new Set();

/** Riga che distingue un'iscrizione (o un appello gemello) dalle altre: solo ciò che cambia. */
function registrationHint(variant: BarbExamSession, group: readonly BarbExamSession[]): string {
  const difference = slotDifference(variant, group);
  return EXAMS_TEXT.registrationHint({ component: difference.component, location: difference.location, closes: difference.registrationCloses && barbSessionDate(difference.registrationCloses), list: difference.sourceCourseCode });
}

/**
 * Un appello pubblicato con più iscrizioni: ognuna a un tocco, coi suoi dettagli sotto. Nessuna è
 * aperta da sola, perché commissione, aula e chiusura possono essere diverse.
 */
function SlotRegistrations({ slot, course }: { slot: BarbExamSlot; course: BarbCourse }) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const chosen = slot.sessions.find((session) => session.id === chosenId) ?? null;
  const { session } = slot;
  useEffect(() => {
    const node = detailRef.current;
    if (!chosenId || !node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "start" });
  }, [chosenId]);
  const closeDetail = () => {
    const id = chosenId;
    setChosenId(null);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-registration="${CSS.escape(id ?? "")}"]`)?.focus());
  };
  return <div className="space-y-4">
    <div>
      <p className="text-sm font-extrabold">{barbSessionDate(session.date)} · {barbSessionType(session.type)} · {session.time ?? EXAMS_TEXT.timeNotPublished}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{EXAMS_TEXT.slotChooserIntro(slot.sessions.length)}</p>
    </div>
    <ul ref={listRef} className="grid grid-cols-1 gap-2">{slot.sessions.map((variant, index) => {
      const open = variant.id === chosenId;
      const hint = registrationHint(variant, slot.sessions);
      return <li key={variant.id}><button type="button" data-registration={variant.id} aria-pressed={open} onClick={() => setChosenId(variant.id)} className={`quiet-panel flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left hover:bg-[var(--surface)] ${open ? "ring-2 ring-[var(--accent)]" : ""}`}>
        <span className="min-w-0 flex-1"><span className="safe-text block text-sm font-extrabold">{EXAMS_TEXT.registrationLabel(index + 1, variant.commission)}</span>{hint ? <span className="safe-text mt-0.5 block text-xs text-[var(--muted)]">{hint}</span> : null}</span>
        <span className="shrink-0 text-xs font-black text-[var(--accent-ink)]">{open ? EXAMS_TEXT.shownDetails : EXAMS_TEXT.seeDetails}</span>
      </button></li>;
    })}</ul>
    {chosen ? <div ref={detailRef} tabIndex={-1} className="scroll-mt-2 rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"><BarbExamSessionDetail inline session={chosen} course={course} onClose={closeDetail} /></div> : null}
  </div>;
}

/**
 * Scheda "Date ufficiali" di Esami. `header` disegna il titolo della sezione (con l'azione
 * primaria di questa scheda) e le schede: prima il titolo, poi le schede, poi il contenuto.
 */
export function BarbExamCalendar({ header }: { header: (actions: ReactNode) => ReactNode }) {
  const today = barbToday(useNow(60_000));
  const [mode, setMode] = useUiState<Mode>("barbExams.mode", "month", { validate: oneOf("day", "week", "month") });
  const [cursorKey, setCursorKey] = useUiState("barbExams.cursor", () => today, { scope: "tab", validate: (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime()) });
  const [filter, setFilter] = useUiState("barbExams.course", "all", { validate: (value) => value === "all" || BARB_EXAM_COURSES.some((course) => course.id === value) });
  // L'appello aperto: con una sola iscrizione il suo dettaglio, con più iscrizioni la scelta.
  const [selected, setSelected] = useState<BarbExamSlot | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const cursor = parseISO(cursorKey);
  const filtered = BARB_EXAM_SESSIONS.filter((session) => filter === "all" || session.courseId === filter);
  // Un appello per giorno, tipo e ora di ogni insegnamento (come in «Aggiungi appelli ufficiali»): le
  // iscrizioni diverse dello stesso appello sono una riga sola, con il loro numero.
  const byDate = useMemo(() => {
    const grouped = new Map<string, BarbExamSlot[]>();
    for (const slot of groupExamSlots(filtered, NO_IMPORTED, (session) => session.id)) grouped.set(slot.session.date, [...(grouped.get(slot.session.date) ?? []), slot]);
    return grouped;
  }, [filter]);
  const days = mode === "month" ? eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) }) : mode === "week" ? eachDayOfInterval({ start: startOfWeek(cursor, { weekStartsOn: 1 }), end: endOfWeek(cursor, { weekStartsOn: 1 }) }) : [cursor];
  const collisionCount = (date: string) => new Set(BARB_EXAM_SESSIONS.filter((session) => session.date === date).map((session) => session.courseId)).size;
  const collisions = days.filter((day) => collisionCount(dateKey(day)) > 1);
  const periodLabel = mode === "month" ? format(cursor, "MMMM yyyy", { locale: it }) : mode === "week" ? `${format(days[0], "d MMM", { locale: it })} – ${format(days[6], "d MMM yyyy", { locale: it })}` : format(cursor, "EEEE d MMMM yyyy", { locale: it });
  const selectedCourse = BARB_EXAM_COURSES.find((course) => course.id === filter);
  const detailCourse = selected && BARB_EXAM_COURSES.find((course) => course.id === selected.courseId);
  const coverage = BARB_DATASET.courses.filter((course) => BARB_EXAM_SESSIONS.some((session) => session.courseId === course.id)).length;
  const checked = BARB_EXAM_DATA.checkedAt ? barbSessionDate(BARB_EXAM_DATA.checkedAt.slice(0, 10)) : "?";
  const officialHelp = EXAMS_HELP.official(coverage, BARB_DATASET.courses.length, BARB_EXAM_SESSIONS.length, checked);
  const sameDayHelp = EXAMS_HELP.sameDay(collisions.map((day) => barbSessionDate(dateKey(day))).join(" · "));
  const incompleteSources = BARB_EXAM_DATA.sources.some((source) => source.status === "non-verificato");
  const nextSession = filtered.filter((session) => session.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const navigate = (direction: number) => setCursorKey(dateKey(mode === "month" ? addMonths(cursor, direction) : mode === "week" ? addWeeks(cursor, direction) : addDays(cursor, direction)));
  const sessionButton = (slot: BarbExamSlot, compact = false) => {
    const { session } = slot;
    const course = BARB_EXAM_COURSES.find((item) => item.id === session.courseId);
    if (!course) return null;
    // Stesso appello pubblicato più volte (un'iscrizione per modulo o corso): una riga, col numero delle iscrizioni.
    // Prove diverse dello stesso insegnamento, stesso giorno, tipo e ora (Inglese B2: online e in aula):
    // righe uguali a vista, quindi ognuna dice cosa la distingue.
    const twins = slotTwins(slot, byDate.get(session.date) ?? []);
    const distinct = twins.length > 1 ? registrationHint(session, twins.map((other) => other.session)) : "";
    const registrations = [slot.sessions.length > 1 ? EXAMS_TEXT.registrationsCount(slot.sessions.length) : "", distinct].filter(Boolean).join(" · ");
    return <button key={slot.key} type="button" onClick={() => setSelected(slot)} title={`${course.name} · ${barbSessionType(session.type)} · ${session.time ?? EXAMS_TEXT.timeNotPublished}${registrations ? ` · ${registrations}` : ""}`} aria-label={`${course.name}, ${barbSessionDate(session.date)}, ${barbSessionType(session.type)}${registrations ? `, ${registrations}` : ""}. Apri i dettagli`} style={{ borderLeftColor: courseColor(course) }} className={`w-full min-w-0 rounded-lg border-l-[3px] bg-[var(--surface-strong)] text-left hover:bg-[var(--surface)] ${compact ? "min-h-8 px-1 py-1 sm:px-2" : "flex min-h-14 items-start gap-2 p-3"}`}>
      <span className={compact ? "flex min-w-0 items-center gap-1" : "contents"}><span className="shrink-0" style={{ color: courseColor(course) }}><CourseIcon course={course} className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} /></span><span className="min-w-0"><span className={`${compact ? "block truncate text-[10px] sm:text-xs" : "safe-text block text-sm"} font-extrabold`}>{course.name}</span>{!compact && <span className="safe-text mt-0.5 block text-xs text-[var(--muted)]">{barbSessionType(session.type)} · {session.time ?? EXAMS_TEXT.timeNotPublished}{registrations ? ` · ${registrations}` : ""}{!currentIds.has(course.id) ? ` · ${EXAMS_TEXT.legacy}` : ""}</span>}</span></span>
    </button>;
  };
  return <>
    {header(<Button icon="CalendarPlus" variant="primary" onClick={() => setImportOpen(true)}>{OFFICIAL_EXAMS_ADD_LABEL}</Button>)}
    <div className="min-w-0 space-y-4">
    {/* Copertura, fonti e "se non ci sono date…" stanno nel "?" del titolo: in vista resta il calendario. */}
    <div className="flex flex-wrap items-center gap-2 px-1"><h3 className="text-lg font-black">{EXAMS_TEXT.officialTitle}</h3><HelpTip title={officialHelp.title} text={officialHelp.text} example={officialHelp.example} /></div>
    <Panel>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><Field label={EXAMS_TEXT.courseFilter} className="lg:max-w-md lg:flex-1"><select value={filter} onChange={(event) => setFilter(event.target.value)} className={inputClass}><option value="all">{EXAMS_TEXT.allCourses}</option>{BARB_EXAM_COURSES.map((course) => <option key={course.id} value={course.id}>{course.name}{!currentIds.has(course.id) ? ` (${EXAMS_TEXT.legacy})` : ""}</option>)}</select></Field><Segmented value={mode} options={modes} onChange={setMode} label="Vista del calendario degli appelli" /></div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="safe-text min-w-0 text-lg font-black capitalize">{periodLabel}</h4><div className="flex items-center gap-1"><Button variant="soft" onClick={() => setCursorKey(today)}>Oggi</Button><IconButton icon="ChevronLeft" label="Periodo precedente" onClick={() => navigate(-1)} /><IconButton icon="ChevronRight" label="Periodo successivo" onClick={() => navigate(1)} /></div></div>
      {collisions.length > 0 && <p className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--warning-text)]"><span>{EXAMS_TEXT.sameDay(collisions.length)}</span><HelpTip title={sameDayHelp.title} text={sameDayHelp.text} /></p>}
      {mode === "month" ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)]"><div className="grid grid-cols-7 bg-[var(--surface-soft)]">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <div key={day} className="py-2 text-center text-[10px] font-black text-[var(--muted)] sm:text-xs">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => {
        const key = dateKey(day); const slots = byDate.get(key) ?? []; const sameDay = collisionCount(key);
        return <div key={key} className={`min-h-[86px] min-w-0 border-t border-r border-[var(--border)] ${sameDay > 1 ? "ring-1 ring-inset ring-[var(--warning-text)]" : ""} p-0.5 sm:min-h-[115px] sm:p-1.5 ${!isSameMonth(day, cursor) ? "bg-[var(--surface-soft)]" : ""}`}><button type="button" onClick={() => { setCursorKey(key); setMode("day"); }} aria-label={EXAMS_TEXT.dayCellLabel(barbSessionDate(key), slots.length)} aria-current={key === today ? "date" : undefined} className="group relative mb-3 flex w-full after:absolute after:-bottom-3 after:-left-0.5 after:-right-[3px] after:-top-1 after:content-['']">{/* Tocco largo quanto la cella (44 px a 375), il numero resta un cerchio da 28 px. */}<span className={`grid h-7 w-7 grid-cols-1 place-items-center rounded-full text-xs font-black ${key === today ? "bg-[var(--accent)] text-[#10131d]" : !isSameMonth(day, cursor) ? "text-[var(--faint)]" : "group-hover:bg-[var(--surface)]"}`}>{format(day, "d")}</span></button>{sameDay > 1 && <span title="Più appelli nello stesso giorno" className="mb-1 block truncate text-[9px] font-bold text-[var(--warning-text)]">{sameDay} esami</span>}<div className="space-y-1">{slots.map((slot) => sessionButton(slot, true))}</div></div>;
      })}</div></div> : <div className={`grid grid-cols-1 gap-3 ${mode === "week" ? "xl:grid-cols-7" : ""}`}>{days.map((day) => <section key={dateKey(day)} className={`quiet-panel min-w-0 p-3 ${collisionCount(dateKey(day)) > 1 ? "ring-1 ring-[var(--warning-text)]" : ""}`}><h4 className="mb-3 text-sm font-black capitalize">{format(day, "EEE d MMM", { locale: it })}{dateKey(day) === today ? " · Oggi" : ""}</h4>{collisionCount(dateKey(day)) > 1 && <p className="mb-2 text-xs font-bold text-[var(--warning-text)]">Più appelli nello stesso giorno · {collisionCount(dateKey(day))} esami</p>}<div className="grid grid-cols-1 gap-2">{(byDate.get(dateKey(day)) ?? []).map((slot) => sessionButton(slot))}</div>{!byDate.has(dateKey(day)) && <p className="text-xs text-[var(--muted)]">Nessun appello.</p>}</section>)}</div>}
      {!days.some((day) => byDate.has(dateKey(day))) && <div className="mt-4"><EmptyState icon="CalendarDays" title="Nessun appello in questo periodo" body={EXAMS_TEXT.noSessionsInPeriodBody} action={nextSession ? <Button variant="soft" onClick={() => setCursorKey(nextSession.date)}>Vai al prossimo appello</Button> : undefined} /></div>}
    </Panel>
    {selectedCourse && <div id="barb-exam-course-sessions" className="scroll-mt-6"><Panel><BarbExamSessions course={selectedCourse} /></Panel></div>}
    {/* Un solo filtro per insegnamento (il menu sopra): l'elenco completo resta qui, chiuso. */}
    <details className="quiet-panel p-4"><summary className="cursor-pointer text-sm font-extrabold">{EXAMS_TEXT.browseByCourse} <span className="font-bold text-[var(--muted)]">· {EXAMS_TEXT.coursesInPlan(BARB_DATASET.courses.length)}</span></summary><p className="mb-4 mt-3 text-sm text-[var(--muted)]">{EXAMS_TEXT.browseByCourseHint}</p><div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{BARB_EXAM_COURSES.map((course) => <button type="button" key={course.id} aria-pressed={filter === course.id} onClick={() => { setFilter(course.id); requestAnimationFrame(() => document.getElementById("barb-exam-course-sessions")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} className={`quiet-panel flex min-w-0 items-start gap-2 p-3 text-left hover:bg-[var(--surface)] ${filter === course.id ? "ring-2 ring-[var(--accent)]" : ""}`}><span style={{ color: courseColor(course) }} className="mt-0.5 shrink-0"><CourseIcon course={course} className="h-5 w-5" /></span><span className="min-w-0"><span className="safe-text block text-sm font-extrabold">{course.name}</span><span className="block text-xs text-[var(--muted)]">{appelliLabel(BARB_EXAM_SESSIONS.filter((session) => session.courseId === course.id).length)}{!currentIds.has(course.id) ? ` · ${EXAMS_TEXT.legacy}` : ""}</span></span></button>)}</div></details>
    <details className="quiet-panel p-4"><summary className="cursor-pointer text-sm font-extrabold">Fonti ufficiali</summary>{incompleteSources && <p className="mt-3 text-xs font-bold text-[var(--warning-text)]">{EXAMS_TEXT.incompleteSources}</p>}<ul className="mt-3 grid grid-cols-1 gap-2">{BARB_EXAM_DATA.sources.map((source) => <li key={source.url} className="safe-text text-xs text-[var(--muted)]"><a href={safeHref(source.url)} target="_blank" rel="noreferrer" className="font-bold text-[var(--accent-ink)] underline">Fonte ufficiale UNIMI</a> · {source.note}</li>)}</ul></details>
    {selected && detailCourse && (selected.sessions.length > 1
      ? <Drawer open onClose={() => setSelected(null)} title={detailCourse.name} eyebrow={EXAMS_TEXT.officialEyebrow} headerExtra={<CourseIcon course={detailCourse} className="h-7 w-7" />}><SlotRegistrations key={selected.key} slot={selected} course={detailCourse} /></Drawer>
      : <BarbExamSessionDetail session={selected.session} course={detailCourse} onClose={() => setSelected(null)} />)}
    {importOpen && <BarbExamImport onClose={() => setImportOpen(false)} />}
  </div>
  </>;
}
