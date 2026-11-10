import { useEffect, useId, useRef, useState } from "react";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, Pill, inputClass } from "./ui";
import { DurationField } from "./DurationField";
import { durationToMinutes, minutesToDuration } from "../lib/duration";
import { PRIORITY_LABEL, TASK_STATUS_LABEL, formatMinutes } from "../lib/labels";
import { useNow } from "../hooks/useNow";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";
import { selectableSubjects, shortDate } from "../lib/selectors";

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
  const [draft, setDraft] = useState({
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: toDatetimeLocal(task.dueDate),
    durationValue: initialDuration.value,
    durationUnit: initialDuration.unit,
    actualMinutes: task.actualMinutes === undefined ? "" : String(task.actualMinutes),
    energy: task.energy,
    priority: task.priority,
    subjectId: task.subjectId ?? "",
    tags: task.tags.join(", "),
    notes: task.notes,
    difficulty: String(task.difficulty),
    importance: String(task.importance)
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // "Altre opzioni" parte aperta solo se contiene già note o tag, così nulla di scritto resta nascosto.
  const [moreOpenAtStart] = useState(() => Boolean(task.notes.trim() || task.tags.length));
  const moreRef = useRef<HTMLDetailsElement>(null);
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);
  const completedLate = isTaskCompletedLate(task);
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    const actualMinutes = draft.actualMinutes.trim() ? Number(draft.actualMinutes) : undefined;
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
        actualMinutes,
        energy: draft.energy,
        priority: draft.priority,
        subjectId: draft.subjectId || undefined,
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
      ? "Le attività archiviate spariscono dall'elenco."
      : timerRunning && draft.status !== "doing"
        ? "Salvando, il timer si ferma e il tempo fatto resta registrato."
        : timerRunning
          ? `Timer attivo da ${formatElapsedSeconds(elapsedSeconds)}. Per fermarlo scegli un altro stato.`
          : draft.status === "doing"
            ? "Salvando parte il timer: ogni tanto ti chiederà come va."
            : "Scegli «In corso» per far partire il timer.";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="soft-panel scrollbar-soft max-h-[88dvh] w-full max-w-3xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[var(--faint)]">Attività</p>
            <h3 id={titleId} className="safe-text text-2xl font-black">Modifica attività</h3>
          </div>
          <Button variant="ghost" icon="X" onClick={onClose} aria-label="Chiudi senza salvare">
            Chiudi
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <Field label="Cosa devi fare">
            <input
              className={inputClass}
              value={draft.title}
              onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              placeholder="Es. Ripassare il capitolo 4 di fisiologia"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Scadenza (facoltativa)">
              <input className={inputClass} type="datetime-local" value={draft.dueDate} onChange={(event) => setDraft((value) => ({ ...value, dueDate: event.target.value }))} />
            </Field>
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
              <Field label="Stato">
                <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Task["status"] }))}>
                  {(Object.keys(TASK_STATUS_LABEL) as Task["status"][]).map((status) => (
                    <option key={status} value={status}>
                      {TASK_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="mt-1 text-xs font-bold text-[var(--faint)]">{statusHint}</p>
            </div>
          </div>

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
                    <option value="low">Bassa</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
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
                  <p className="mt-1 text-xs font-bold text-[var(--faint)]">Se usi il timer si aggiorna da solo.</p>
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

          <div className="quiet-panel flex flex-wrap gap-2 p-3">
            <Pill>{TASK_STATUS_LABEL[draft.status]}</Pill>
            <Pill>Aggiunta il {shortDate(task.createdAt)}</Pill>
            <Pill>{formatMinutes(durationToMinutes(Number(draft.durationValue.replace(",", ".")) || 0, draft.durationUnit))} previsti</Pill>
            {timerRunning ? <Pill className="border-[var(--accent)] text-[var(--accent-ink)]">Timer attivo: {formatElapsedSeconds(elapsedSeconds)}</Pill> : null}
            {draft.actualMinutes ? <Pill>{draft.actualMinutes} min impiegati</Pill> : null}
            {task.completedAt ? <Pill>Completata il {shortDate(task.completedAt)}</Pill> : null}
            {completedLate ? <Pill className="border-[var(--warning-border)] text-[var(--warning-text)] bg-[var(--warning-bg)]">Completata in ritardo</Pill> : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button variant="danger" icon="Trash2" onClick={() => onDelete(task)} disabled={saving}>
              Elimina attività
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="soft" onClick={onClose} disabled={saving}>
                Annulla
              </Button>
              <Button variant="primary" icon="Check" onClick={() => void save()} disabled={saving}>
                {saving ? "Salvataggio…" : "Salva modifiche"}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
