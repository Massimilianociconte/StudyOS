import { useEffect, useMemo, useRef, useState } from "react";
import { BARB_EXAM_COURSES, BARB_EXAM_SESSIONS, barbExamSourceUid, resolveBarbCourse } from "../lib/university/examSessions";
import { useStudyStore } from "../store/useStudyStore";
import { courseColor } from "../lib/barbCourseVisuals";
import { CourseIcon } from "./CourseIcon";
import { barbSessionDate, barbSessionType } from "./BarbExamSessions";
import { Button, Drawer, EmptyState, inputClass } from "./ui";

function CourseCheckbox({ checked, mixed, disabled, onChange, label }: { checked: boolean; mixed: boolean; disabled: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" checked={checked} aria-checked={mixed ? "mixed" : checked} disabled={disabled} onChange={onChange} aria-label={label} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />;
}

export function BarbExamImport({ onClose }: { onClose: () => void }) {
  const { subjects, events, importBarbExamSessions } = useStudyStore();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const eligibleIds = useMemo(() => new Set(subjects.filter((subject) => !subject.archived && subject.status !== "archived" && subject.status !== "completed").map((subject) => resolveBarbCourse(subject, BARB_EXAM_COURSES)?.id).filter(Boolean)), [subjects]);
  const imported = useMemo(() => new Set(events.map((event) => event.sourceUid).filter(Boolean)), [events]);
  const eligibleSessions = BARB_EXAM_SESSIONS.filter((session) => eligibleIds.has(session.courseId) && !imported.has(barbExamSourceUid(session)));
  const eligibleSessionIds = new Set(eligibleSessions.map((session) => session.id));
  const selectedSessions = eligibleSessions.filter((session) => selected.has(session.id));
  const courses = BARB_EXAM_COURSES.filter((course) => eligibleIds.has(course.id) || BARB_EXAM_SESSIONS.some((session) => session.courseId === course.id)).filter((course) => !query || course.name.toLocaleLowerCase("it").includes(query.toLocaleLowerCase("it"))).sort((a, b) => Number(eligibleIds.has(b.id)) - Number(eligibleIds.has(a.id)) || a.name.localeCompare(b.name, "it"));
  const toggleSessions = (ids: string[]) => setSelected((current) => {
    const next = new Set(current);
    const all = ids.every((id) => next.has(id));
    ids.forEach((id) => all ? next.delete(id) : next.add(id));
    return next;
  });
  const save = async () => {
    if (busy || !selectedSessions.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await importBarbExamSessions(selectedSessions);
      setSelected(new Set());
      setNotice(`${result.added} ${result.added === 1 ? "appello aggiunto" : "appelli aggiunti"} al calendario personale.${result.skipped ? ` ${result.skipped} già presenti o non importabili.` : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Importazione non riuscita. Riprova.");
    } finally { setBusy(false); }
  };
  return <Drawer open onClose={() => { if (!busy) onClose(); }} title="Importa appelli BARB" eyebrow="Calendario personale" footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-bold text-[var(--muted)]">{selectedSessions.length} appelli selezionati</span><Button variant="primary" icon="Download" disabled={busy || !selectedSessions.length} onClick={() => void save()}>{busy ? "Importazione…" : `Aggiungi ${selectedSessions.length} appelli`}</Button></div>}>
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">Scegli le date da aggiungere per le materie attive del tuo piano. Gli appelli sono promemoria sulla data; gli orari pubblicati sono nei dettagli.</p>
      {error && <p role="alert" className="rounded-[18px] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{error}</p>}
      {notice && <p role="status" className="rounded-[18px] bg-[var(--success-bg)] p-3 text-sm font-bold text-[var(--success-text)]">{notice}</p>}
      <Button variant="soft" icon="Check" className="w-full py-2 [&>span]:whitespace-normal [&>span]:overflow-visible" disabled={busy || !eligibleSessions.length} onClick={() => setSelected(new Set(eligibleSessions.map((session) => session.id)))}>Seleziona tutti gli insegnamenti del mio piano</Button>
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-[var(--muted)]">{eligibleIds.size} insegnamenti del piano · {eligibleSessions.length} appelli disponibili</span><Button disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Deseleziona</Button></div>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} aria-label="Cerca insegnamento da importare" placeholder="Cerca insegnamento…" />
      {!eligibleIds.size && <EmptyState icon="BookOpen" title="Aggiungi le materie del tuo piano" body="Per importare gli appelli serve una materia personale collegata all'insegnamento BARB. Le materie archiviate o già superate non sono selezionabili." />}
      {!courses.length && <p className="text-sm text-[var(--muted)]">Nessun insegnamento corrisponde alla ricerca.</p>}
      <div className="space-y-2">{courses.map((course) => {
        const sessions = BARB_EXAM_SESSIONS.filter((session) => session.courseId === course.id).sort((a, b) => a.date.localeCompare(b.date));
        const available = sessions.filter((session) => eligibleSessionIds.has(session.id)).map((session) => session.id);
        const count = available.filter((id) => selected.has(id)).length;
        const eligible = eligibleIds.has(course.id);
        return <section key={course.id} className="quiet-panel overflow-hidden">
          <label className="flex min-h-12 cursor-pointer items-start gap-3 p-3"><span className="mt-1"><CourseCheckbox checked={available.length > 0 && count === available.length} mixed={count > 0 && count < available.length} disabled={busy || !available.length} onChange={() => toggleSessions(available)} label={`Seleziona tutti gli appelli di ${course.name}`} /></span><span className="mt-0.5 shrink-0" style={{ color: courseColor(course) }}><CourseIcon course={course} className="h-5 w-5" /></span><span className="min-w-0"><span className="safe-text block text-sm font-extrabold">{course.name}</span><span className="block text-xs text-[var(--muted)]">{!eligible ? "Non presente tra le materie attive del piano" : `${count}/${available.length} selezionati`}</span></span></label>
          {sessions.length ? <ul className="border-t border-[var(--border)]">{sessions.map((session) => {
            const already = imported.has(barbExamSourceUid(session));
            return <li key={session.id}><label className={`flex min-h-11 items-center gap-3 px-3 py-2 ${eligible && !already ? "cursor-pointer hover:bg-[var(--surface)]" : "opacity-60"}`}><input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" disabled={busy || !eligible || already} checked={eligible && !already && selected.has(session.id)} onChange={() => toggleSessions([session.id])} aria-label={`${course.name}, ${barbSessionDate(session.date)}, ${barbSessionType(session.type)}`} /><span className="min-w-0 flex-1 text-xs"><span className="font-extrabold">{barbSessionDate(session.date)}</span><span className="safe-text block text-[var(--muted)]">{barbSessionType(session.type)} · {session.time ?? "Orario non pubblicato"}{already ? " · Già importato" : ""}</span></span></label></li>;
          })}</ul> : <p className="px-3 pb-3 text-xs text-[var(--muted)]">Nessun appello verificato nelle fonti consultate.</p>}
        </section>;
      })}</div>
    </div>
  </Drawer>;
}
