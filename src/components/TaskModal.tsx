import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects } from "../lib/selectors";
import { PRIORITY_LABEL } from "../lib/labels";
import { TASK_EDITOR_TEXT, TASK_START_TEXT } from "../lib/labels/tasks";
import { defaultImportance, draftChanged, editorCloseRequest, taskStartFields, type TaskStart } from "../lib/tasksUi";
import { Button, Field, Segmented, inputClass, useBackCloses, useDialogLayer } from "./ui";
import { DateField } from "./DatePicker";
import { DurationField, type DurationUnit } from "./DurationField";
import { durationToMinutes } from "../lib/duration";
import { SubjectSelect } from "./SubjectSelect";

export type NewTaskDraft = Partial<Task> & Pick<Task, "title">;

/** Campi come all'apertura: se sono cambiati, chiudere chiede prima «Scartare le modifiche?». */
const INITIAL_FIELDS = {
  title: "",
  subjectId: "",
  description: "",
  priority: "medium" as Task["priority"],
  dueDate: "",
  durationValue: "45",
  durationUnit: "minutes" as DurationUnit,
  start: "todo" as TaskStart,
  spent: ""
};

const START_OPTIONS = [
  { id: "todo", label: TASK_START_TEXT.todo, icon: "Check" },
  { id: "timer", label: TASK_START_TEXT.timer, icon: "Timer" },
  { id: "done", label: TASK_START_TEXT.done, icon: "CheckCheck" }
] as const;

/**
 * Creazione guidata di un'attività, la stessa da Attività («Nuova attività») e da «Aggiungi»: in vista
 * titolo, «Quando la fai?» (da fare, inizio ora con il cronometro, già fatta), scadenza e materia;
 * priorità, durata (valore + unità di tempo) e descrizione stanno in "Altre opzioni".
 */
export function TaskModal({
  onClose,
  onCreate
}: {
  onClose: () => void;
  onCreate: (draft: NewTaskDraft) => Promise<void>;
}) {
  const subjects = useStudyStore((state) => state.subjects);
  const [title, setTitle] = useState(INITIAL_FIELDS.title);
  const [subjectId, setSubjectId] = useState(INITIAL_FIELDS.subjectId);
  const [description, setDescription] = useState(INITIAL_FIELDS.description);
  const [priority, setPriority] = useState<Task["priority"]>(INITIAL_FIELDS.priority);
  const [dueDate, setDueDate] = useState(INITIAL_FIELDS.dueDate);
  const [durationValue, setDurationValue] = useState(INITIAL_FIELDS.durationValue);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(INITIAL_FIELDS.durationUnit);
  const [start, setStart] = useState<TaskStart>(INITIAL_FIELDS.start);
  const [spent, setSpent] = useState(INITIAL_FIELDS.spent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // «Scartare le modifiche?» sul posto, come nell'editor: tocco fuori, Esc, Indietro o «Annulla» non perdono il testo.
  const [asking, setAsking] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const changed = draftChanged(INITIAL_FIELDS, { title, subjectId, description, priority, dueDate, durationValue, durationUnit, start, spent });

  const keepEditing = () => {
    setAsking(false);
    requestAnimationFrame(() => footerRef.current?.querySelector<HTMLElement>("[data-save]")?.focus());
  };

  const requestClose = () => {
    if (busy) return;
    const next = editorCloseRequest(changed, asking);
    if (next === "close") onClose();
    else if (next === "ask") setAsking(true);
    else keepEditing();
  };

  useDialogLayer(true, { panelRef, areaRef, onEscape: requestClose });
  // Indietro (browser, Android, gesto di iOS) come Esc; se resta aperta, la voce della cronologia torna.
  useBackCloses(true, () => {
    requestClose();
    return true;
  });

  // La domanda prende il focus sulla scelta sicura (Invio o Esc tornano a scrivere).
  useEffect(() => {
    if (!asking) return;
    const frame = requestAnimationFrame(() => footerRef.current?.querySelector<HTMLElement>("[data-keep]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [asking]);

  const save = async () => {
    if (busy) return;
    setError("");
    if (!title.trim()) {
      setError("Scrivi cosa devi fare: serve almeno il titolo.");
      return;
    }
    const parsed = Number(durationValue.replace(",", "."));
    if (durationValue.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      if (moreRef.current) moreRef.current.open = true;
      setError("Durata prevista non valida: in «Altre opzioni» scrivi un numero da 0 in su.");
      return;
    }
    const due = dueDate ? new Date(`${dueDate}T18:00`) : undefined;
    if (due && Number.isNaN(due.getTime())) {
      setError("La scadenza non è valida: sceglila di nuovo dal calendario.");
      return;
    }
    const spentMinutes = start === "done" && spent.trim() ? Number(spent.replace(",", ".")) : undefined;
    if (spentMinutes !== undefined && (!Number.isFinite(spentMinutes) || spentMinutes < 0)) {
      setError(TASK_START_TEXT.spentInvalid);
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        subjectId: subjectId || undefined,
        description: description.trim(),
        priority,
        importance: defaultImportance(priority),
        dueDate: due?.toISOString(),
        estimatedMinutes: durationToMinutes(parsed, durationUnit),
        ...taskStartFields(start, { due: due?.toISOString(), actualMinutes: spentMinutes })
      });
      onClose();
    } catch {
      setError("Non è stato possibile salvare l'attività. Riprova tra qualche secondo.");
    } finally {
      setBusy(false);
    }
  };

  // Portal su body come Drawer: dentro la vista la barra in basso del telefono restava sopra la finestra.
  return createPortal(
    <div
      ref={areaRef}
      className="fixed inset-0 z-50 grid grid-cols-1 place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Nuova attività"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Il focus resta dov'è: se la finestra non si chiude (domanda) non finisce sul body.
        event.preventDefault();
        requestClose();
      }}
    >
      <section ref={panelRef} tabIndex={-1} className="soft-panel scrollbar-soft max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-4 outline-none sm:p-5">
        <div className="mb-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Nuova attività</p>
          <h3 className="min-w-0 text-balance text-2xl font-black leading-tight [overflow-wrap:break-word]">
            Cosa devi fare?
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">Basta il titolo: tutto il resto è facoltativo e puoi aggiungerlo anche dopo.</p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <Field label="Titolo">
            <input
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Es. Ripassare il capitolo 4 di fisiologia"
              data-autofocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
            />
          </Field>

          <div className="grid gap-1.5">
            {/* Nome visibile come le etichette dei campi; il gruppo ha lo stesso nome per i lettori di schermo. */}
            <span aria-hidden="true" className="text-xs font-black uppercase text-[var(--faint)]">
              {TASK_START_TEXT.label}
            </span>
            <Segmented label={TASK_START_TEXT.label} value={start} options={START_OPTIONS} onChange={setStart} size="sm" />
            {/* Riga di altezza fissa (nota o minuti impiegati): cambiando scelta la finestra non cambia altezza e niente si sposta. */}
            <div className="flex min-h-11 items-center">
              {start === "done" ? (
                <label className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
                  <span>{TASK_START_TEXT.spent}</span>
                  <input
                    className={inputClass.replace("w-full", "w-28")}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={5}
                    value={spent}
                    onChange={(event) => setSpent(event.target.value)}
                    placeholder={TASK_START_TEXT.spentPlaceholder}
                  />
                </label>
              ) : (
                <p className="text-xs font-bold text-[var(--muted)]">{start === "timer" ? TASK_START_TEXT.timerHint : TASK_START_TEXT.todoHint}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField label={start === "done" ? TASK_START_TEXT.dueDone : "Scadenza (facoltativa)"} value={dueDate} onChange={setDueDate} optional />
            <Field label="Materia (facoltativa)">
              <SubjectSelect value={subjectId} onChange={setSubjectId} subjects={selectableSubjects(subjects, subjectId)} none="Nessuna materia" />
            </Field>
          </div>

          <details ref={moreRef} className="quiet-panel p-4">
            <summary className="cursor-pointer text-sm font-extrabold">Altre opzioni: priorità, durata prevista, descrizione</summary>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Priorità">
                  <select className={inputClass} value={priority} onChange={(event) => setPriority(event.target.value as Task["priority"])}>
                    {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
                      <option key={key} value={key}>
                        {PRIORITY_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </Field>
                <DurationField label="Durata prevista" value={durationValue} unit={durationUnit} onChange={(next, nextUnit) => { setDurationValue(next); setDurationUnit(nextUnit); }} />
              </div>

              <Field label="Descrizione (facoltativa)">
                <textarea
                  className={`${inputClass} min-h-20 py-3`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Es. Esercizi da 1 a 10 a pagina 52"
                />
              </Field>
            </div>
          </details>

          {error ? (
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}

          {asking ? (
            <div key="ask" ref={footerRef} role="group" aria-label={TASK_EDITOR_TEXT.discardTitle} className="mt-2 grid grid-cols-1 gap-2">
              <div>
                <p className="text-sm font-black">{TASK_EDITOR_TEXT.discardTitle}</p>
                <p className="text-xs font-bold text-[var(--muted)]">{TASK_EDITOR_TEXT.discardNewText}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button data-keep variant="soft" onClick={keepEditing}>
                  {TASK_EDITOR_TEXT.keepEditing}
                </Button>
                <Button variant="danger" icon="X" onClick={onClose}>
                  {TASK_EDITOR_TEXT.discard}
                </Button>
              </div>
            </div>
          ) : (
            <div key="edit" ref={footerRef} className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="soft" onClick={requestClose} disabled={busy}>
                Annulla
              </Button>
              <Button data-save variant="primary" icon={start === "timer" ? "Timer" : "Check"} onClick={() => void save()} disabled={busy}>
                {busy ? "Creazione…" : start === "timer" ? TASK_START_TEXT.createTimer : start === "done" ? TASK_START_TEXT.createDone : TASK_START_TEXT.create}
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
    ,
    document.body
  );
}
