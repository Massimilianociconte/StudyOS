import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Drawer, Field, HelpTip, IconButton, inputClass } from "./ui";
import { DateTimeField } from "./DatePicker";
import { HelpField } from "./HelpField";
import { DurationField } from "./DurationField";
import { durationToMinutes, minutesToDuration } from "../lib/duration";
import { ENERGY_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from "../lib/labels";
import { TASK_EDITOR_TEXT, TASKS_HELP } from "../lib/labels/tasks";
import { useNow } from "../hooks/useNow";
import { editedMinutesPatch, formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds, taskMinutesFieldValue } from "../lib/taskTimer";
import { selectableSubjects, shortDate } from "../lib/selectors";
import { addStep, cleanSteps, draftChanged, editorCloseRequest, removeStep, renameStep, stepsDone, toggleStep, type TaskStep } from "../lib/tasksUi";
import { createId } from "../lib/id";

const toDatetimeLocal = (date?: string) => {
  if (!date) return "";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const parseTags = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

export function TaskEditorModal({
  task,
  subjects,
  onClose,
  onSave,
  onDelete
}: {
  task: Task;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onClose: () => void;
  onSave: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
}) {
  const initialDuration = minutesToDuration(task.estimatedMinutes ?? 45);
  // Con il timer che corre il campo parte dai minuti misurati finora: se non lo tocchi non si manda.
  const [initialMinutes] = useState(() => taskMinutesFieldValue(task));
  const [initialDraft] = useState(() => ({
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: toDatetimeLocal(task.dueDate),
    durationValue: initialDuration.value,
    durationUnit: initialDuration.unit,
    actualMinutes: initialMinutes,
    energy: task.energy,
    priority: task.priority,
    subjectId: task.subjectId ?? "",
    tags: task.tags.join(", "),
    notes: task.notes,
    difficulty: String(task.difficulty),
    importance: String(task.importance),
    steps: task.subtasks
  }));
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // «Scartare le modifiche?» sul posto, al posto dei pulsanti: Esc e tocco fuori non perdono più nulla.
  const [asking, setAsking] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  // "Altre opzioni" parte aperta solo se contiene già note o tag, così nulla di scritto resta nascosto.
  const [moreOpenAtStart] = useState(() => Boolean(task.notes.trim() || task.tags.length));
  const moreRef = useRef<HTMLDetailsElement>(null);
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);
  const completedLate = isTaskCompletedLate(task);

  // La domanda prende il focus sulla scelta sicura (Invio o Esc tornano a modificare).
  useEffect(() => {
    if (asking) footerRef.current?.querySelector<HTMLElement>("[data-keep]")?.focus();
  }, [asking]);

  const keepEditing = () => {
    setAsking(false);
    requestAnimationFrame(() => footerRef.current?.querySelector<HTMLElement>("[data-save]")?.focus());
  };

  const requestClose = () => {
    if (saving) return;
    const next = editorCloseRequest(draftChanged(initialDraft, draft), asking);
    if (next === "close") onClose();
    else if (next === "ask") setAsking(true);
    else keepEditing();
  };

  const showMore = () => {
    if (moreRef.current) moreRef.current.open = true;
  };

  const save = async () => {
    if (saving) return;
    setError("");
    if (!draft.title.trim()) {
      setError("Scrivi cosa devi fare: il titolo non può restare vuoto.");
      return;
    }

    const parsedDuration = Number(draft.durationValue.replace(",", "."));
    const estimatedMinutes = draft.durationValue.trim() === "" || !Number.isFinite(parsedDuration) || parsedDuration < 0
      ? NaN
      : durationToMinutes(parsedDuration, draft.durationUnit);
    const actualMinutes = draft.actualMinutes.trim() ? Number(draft.actualMinutes.trim().replace(",", ".")) : undefined;
    const difficulty = Number(draft.difficulty);
    const importance = Number(draft.importance);
    const dueDate = draft.dueDate ? new Date(draft.dueDate) : undefined;

    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 0) {
      showMore();
      setError("Durata prevista non valida: in «Altre opzioni» scrivi un numero da 0 in su.");
      return;
    }
    if (actualMinutes !== undefined && (!Number.isFinite(actualMinutes) || actualMinutes < 0)) {
      showMore();
      setError("Tempo impiegato non valido: in «Altre opzioni» scrivi i minuti come numero, es. 50.");
      return;
    }
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      setError("La scadenza non è valida: scegli di nuovo giorno e ora.");
      return;
    }

    setSaving(true);
    try {
      await onSave(task.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        status: draft.status,
        dueDate: dueDate?.toISOString(),
        estimatedMinutes,
        ...editedMinutesPatch(initialMinutes, draft.actualMinutes),
        energy: draft.energy,
        priority: draft.priority,
        subjectId: draft.subjectId || undefined,
        subtasks: cleanSteps(draft.steps),
        tags: parseTags(draft.tags),
        notes: draft.notes.trim(),
        difficulty: Math.max(1, Math.min(5, difficulty)) as Task["difficulty"],
        importance: Math.max(1, Math.min(5, importance)) as Task["importance"]
      });
      onClose();
    } catch {
      setError("Non è stato possibile salvare le modifiche. Riprova tra qualche secondo.");
    } finally {
      setSaving(false);
    }
  };

  const statusHint =
    draft.status === "archived"
      ? TASK_EDITOR_TEXT.archivedHint
      : timerRunning && draft.status !== "doing"
        ? "Salvando, il timer si ferma e il tempo fatto resta registrato."
        : timerRunning
          ? `Timer attivo da ${formatElapsedSeconds(elapsedSeconds)}. Per fermarlo scegli un altro stato.`
          : draft.status === "doing"
            ? "Salvando parte il timer: ogni tanto ti chiederà come va."
            : "Scegli «In corso» per far partire il timer.";

  // Date che non sono campi del modulo: in una riga sotto il titolo (prima una fila di pillole che
  // ripeteva stato, durata e minuti e spingeva «Salva» sotto la piega sul telefono).
  const facts = (
    <p className="text-xs font-bold text-[var(--muted)]">
      {TASK_EDITOR_TEXT.added(shortDate(task.createdAt))}
      {task.completedAt ? ` · ${TASK_EDITOR_TEXT.completed(shortDate(task.completedAt))}` : null}
      {completedLate ? <span className="text-[var(--warning-text)]"> · {TASK_EDITOR_TEXT.late}</span> : null}
    </p>
  );

  const footer = asking ? (
    <div key="ask" ref={footerRef} role="group" aria-label={TASK_EDITOR_TEXT.discardTitle} className="grid grid-cols-1 gap-2">
      <div>
        <p className="text-sm font-black">{TASK_EDITOR_TEXT.discardTitle}</p>
        <p className="text-xs font-bold text-[var(--muted)]">{TASK_EDITOR_TEXT.discardText}</p>
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
    <div key="edit" ref={footerRef} className="flex items-center justify-between gap-2">
      {/* Solo icona sul telefono, così i tre pulsanti stanno in una riga. */}
      <Button
        variant="danger"
        icon="Trash2"
        onClick={() => onDelete(task)}
        disabled={saving}
        aria-label={TASK_EDITOR_TEXT.remove}
        title={TASK_EDITOR_TEXT.remove}
        className="w-11 shrink-0 !gap-0 !px-0 sm:w-auto sm:!gap-2 sm:!px-4"
      >
        <span className="hidden sm:inline">{TASK_EDITOR_TEXT.remove}</span>
      </Button>
      <div className="flex min-w-0 justify-end gap-2">
        <Button variant="soft" onClick={requestClose} disabled={saving}>
          {TASK_EDITOR_TEXT.cancel}
        </Button>
        <Button data-save variant="primary" icon="Check" onClick={() => void save()} disabled={saving}>
          {saving ? TASK_EDITOR_TEXT.saving : TASK_EDITOR_TEXT.save}
        </Button>
      </div>
    </div>
  );

  // Drawer condiviso: a destra su desktop, foglio dal basso sul telefono, pulsanti sempre in vista.
  return (
    <Drawer
      open
      onClose={requestClose}
      eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">{TASK_EDITOR_TEXT.eyebrow}</span>}
      title={TASK_EDITOR_TEXT.title}
      headerExtra={facts}
      footer={footer}
      width="max-w-[720px]"
    >
      <div className="min-w-0">
        <div className="grid grid-cols-1 gap-3">
          <Field label="Cosa devi fare">
            <input
              className={inputClass}
              value={draft.title}
              onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              placeholder="Es. Ripassare il capitolo 4 di fisiologia"
              data-autofocus
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <DateTimeField
              label="Scadenza (facoltativa)"
              value={draft.dueDate}
              onChange={(dueDate) => setDraft((value) => ({ ...value, dueDate }))}
              optional
              defaultTime="18:00"
            />
            <Field label="Materia (facoltativa)">
              <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                <option value="">Nessuna materia</option>
                {selectableSubjects(subjects, draft.subjectId).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="min-w-0">
              <HelpField label="Stato" help={TASKS_HELP.status}>
                {(id) => (
                  <select id={id} className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Task["status"] }))}>
                    {(Object.keys(TASK_STATUS_LABEL) as Task["status"][]).map((status) => (
                      <option key={status} value={status}>
                        {TASK_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                )}
              </HelpField>
              <p className="mt-1 text-xs font-bold text-[var(--faint)]">{statusHint}</p>
            </div>
          </div>

          <TaskStepsField steps={draft.steps} onChange={(steps) => setDraft((value) => ({ ...value, steps }))} />

          <Field label="Descrizione (facoltativa)">
            <textarea
              className={`${inputClass} min-h-24 py-3`}
              value={draft.description}
              onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))}
              placeholder="Es. Esercizi da 1 a 10 a pagina 52"
            />
          </Field>

          <details ref={moreRef} open={moreOpenAtStart || undefined} className="quiet-panel p-4">
            <summary className="cursor-pointer text-sm font-extrabold">Altre opzioni: priorità, tempi, tag e note</summary>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <HelpTip {...TASKS_HELP.effort} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Priorità">
                  <select className={inputClass} value={draft.priority} onChange={(event) => setDraft((value) => ({ ...value, priority: event.target.value as Task["priority"] }))}>
                    {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
                      <option key={key} value={key}>
                        {PRIORITY_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Importanza (da 1 a 5)">
                  <input className={inputClass} type="number" min={1} max={5} value={draft.importance} onChange={(event) => setDraft((value) => ({ ...value, importance: event.target.value }))} />
                </Field>
                <Field label="Difficoltà (da 1 a 5)">
                  <input className={inputClass} type="number" min={1} max={5} value={draft.difficulty} onChange={(event) => setDraft((value) => ({ ...value, difficulty: event.target.value }))} />
                </Field>
                <Field label="Energia richiesta">
                  <select className={inputClass} value={draft.energy} onChange={(event) => setDraft((value) => ({ ...value, energy: event.target.value as Task["energy"] }))}>
                    {(Object.keys(ENERGY_LABEL) as Task["energy"][]).map((key) => (
                      <option key={key} value={key}>
                        {ENERGY_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <DurationField
                  label="Durata prevista"
                  value={draft.durationValue}
                  unit={draft.durationUnit}
                  onChange={(value, unit) => setDraft((prev) => ({ ...prev, durationValue: value, durationUnit: unit }))}
                />
                <div className="min-w-0">
                  <Field label="Tempo impiegato (minuti, facoltativo)">
                    <input className={inputClass} type="number" min={0} step={5} value={draft.actualMinutes} onChange={(event) => setDraft((value) => ({ ...value, actualMinutes: event.target.value }))} placeholder="Es. 50" />
                  </Field>
                  <p className="mt-1 text-xs font-bold text-[var(--faint)]">{timerRunning && draft.status === "doing" ? TASK_EDITOR_TEXT.minutesRunning : TASK_EDITOR_TEXT.minutesHint}</p>
                </div>
              </div>

              <Field label="Tag (facoltativo, separati da virgola)">
                <input className={inputClass} value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="Es. orale, laboratorio, da ripassare" />
              </Field>

              <Field label="Note (facoltative)">
                <textarea
                  className={`${inputClass} min-h-24 py-3`}
                  value={draft.notes}
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  placeholder="Es. Chiedere al tutor l'esercizio 7"
                />
              </Field>
            </div>
          </details>

          {error ? (
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}

/**
 * Passaggi da spuntare. Invio nel campo nuovo aggiunge e resta lì; Invio su un passaggio porta al
 * campo nuovo; Backspace su un passaggio vuoto lo toglie e torna al precedente.
 */
function TaskStepsField({ steps, onChange }: { steps: TaskStep[]; onChange: (steps: TaskStep[]) => void }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const count = stepsDone(steps);

  const add = () => {
    const next = addStep(steps, text, createId("subtask"));
    if (next === steps) return;
    onChange(next);
    setText("");
    newRef.current?.focus();
  };

  const focusStep = (index: number) => {
    const inputs = listRef.current?.querySelectorAll<HTMLInputElement>("input[data-step]");
    (inputs?.[index] ?? newRef.current)?.focus();
  };

  const onStepKey = (event: KeyboardEvent<HTMLInputElement>, step: TaskStep, index: number) => {
    if (event.key === "Enter") {
      event.preventDefault();
      newRef.current?.focus();
    } else if (event.key === "Backspace" && step.text === "") {
      event.preventDefault();
      onChange(removeStep(steps, step.id));
      requestAnimationFrame(() => focusStep(index - 1));
    }
  };

  return (
    <section aria-labelledby={headingId} className="grid grid-cols-1 gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 id={headingId} className="text-sm font-extrabold">
          {TASK_EDITOR_TEXT.steps}
        </h4>
        {count.total ? <span className="text-xs font-bold text-[var(--muted)]">{TASK_EDITOR_TEXT.stepsCount(count.done, count.total)}</span> : null}
      </div>
      {steps.length ? (
        <ul ref={listRef} className="grid grid-cols-1 gap-0.5">
          {steps.map((step, index) => {
            const name = step.text.trim() || TASK_EDITOR_TEXT.stepText(index + 1);
            return (
              <li key={step.id} className="flex min-w-0 items-center gap-1">
                {/* Etichetta da 44 px attorno alla casella: il tocco vicino la spunta. */}
                <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 cursor-pointer accent-[var(--accent)]"
                    checked={step.done}
                    onChange={() => onChange(toggleStep(steps, step.id))}
                    aria-label={TASK_EDITOR_TEXT.stepDone(name)}
                  />
                </label>
                <input
                  data-step
                  className={`${inputClass} min-w-0 flex-1 ${step.done ? "text-[var(--muted)] line-through" : ""}`}
                  value={step.text}
                  onChange={(event) => onChange(renameStep(steps, step.id, event.target.value))}
                  onKeyDown={(event) => onStepKey(event, step, index)}
                  aria-label={TASK_EDITOR_TEXT.stepText(index + 1)}
                />
                <IconButton
                  icon="X"
                  label={TASK_EDITOR_TEXT.removeStep(name)}
                  className="bg-transparent text-[var(--muted)] hover:text-[var(--text)]"
                  onClick={() => {
                    onChange(removeStep(steps, step.id));
                    newRef.current?.focus();
                  }}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs font-bold text-[var(--faint)]">{TASK_EDITOR_TEXT.stepsHint}</p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <input
          ref={newRef}
          className={`${inputClass} min-w-0 flex-1`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          placeholder={TASK_EDITOR_TEXT.newStepPlaceholder}
          aria-label={TASK_EDITOR_TEXT.newStep}
          enterKeyHint="enter"
        />
        <Button variant="soft" icon="Plus" onClick={add} disabled={!text.trim()} className="shrink-0">
          {TASK_EDITOR_TEXT.addStep}
        </Button>
      </div>
    </section>
  );
}
