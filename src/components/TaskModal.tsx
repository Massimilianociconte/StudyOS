import { useState } from "react";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects } from "../lib/selectors";
import { PRIORITY_LABEL } from "../lib/labels";
import { Button, Field, inputClass } from "./ui";
import { DurationField, type DurationUnit } from "./DurationField";
import { durationToMinutes } from "../lib/duration";

export type NewTaskDraft = Partial<Task> & Pick<Task, "title">;

/**
 * Creazione guidata di una task: un solo ingresso ("Nuova task"), un solo
 * invito finale ("Crea task"). La durata è valore + unità di tempo.
 */
export function TaskModal({
  onClose,
  onCreate
}: {
  onClose: () => void;
  onCreate: (draft: NewTaskDraft) => Promise<void>;
}) {
  const subjects = useStudyStore((state) => state.subjects);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [dueDate, setDueDate] = useState("");
  const [durationValue, setDurationValue] = useState("45");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (busy) return;
    setError("");
    if (!title.trim()) {
      setError("Dai un titolo alla task per continuare.");
      return;
    }
    const parsed = Number(durationValue.replace(",", "."));
    if (durationValue.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      setError("La durata non è valida: usa 0 o più.");
      return;
    }
    const due = dueDate ? new Date(`${dueDate}T18:00`) : undefined;
    if (due && Number.isNaN(due.getTime())) {
      setError("La scadenza selezionata non è valida.");
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        subjectId: subjectId || undefined,
        description: description.trim(),
        priority,
        importance: priority === "urgent" ? 5 : 3,
        dueDate: due?.toISOString(),
        estimatedMinutes: durationToMinutes(parsed, durationUnit)
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Creazione non riuscita. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Nuova task"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <section className="soft-panel scrollbar-soft max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Nuova task</p>
          <h3 className="min-w-0 text-balance text-2xl font-black leading-tight [overflow-wrap:break-word]">
            Cosa vuoi portare a termine?
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">Solo il titolo è obbligatorio: il resto puoi aggiungerlo ora o dopo.</p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <Field label="Titolo">
            <input
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Es. Ripassare il capitolo 4 di fisiologia"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Materia">
              <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">Nessuna materia</option>
                {selectableSubjects(subjects, subjectId).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priorità">
              <select className={inputClass} value={priority} onChange={(event) => setPriority(event.target.value as Task["priority"])}>
                {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
                  <option key={key} value={key}>
                    {PRIORITY_LABEL[key]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Descrizione o note">
            <textarea
              className={`${inputClass} min-h-20 py-3`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Dettagli utili quando la riprenderai in mano (opzionale)"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Scadenza">
              <input className={inputClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </Field>
            <DurationField label="Durata prevista" value={durationValue} unit={durationUnit} onChange={(next, nextUnit) => { setDurationValue(next); setDurationUnit(nextUnit); }} />
          </div>

          {error ? (
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={onClose} disabled={busy}>
              Annulla
            </Button>
            <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>
              {busy ? "Creazione…" : "Crea task"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
