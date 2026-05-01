import { useState } from "react";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, Pill, inputClass } from "./ui";

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
  const [draft, setDraft] = useState({
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: toDatetimeLocal(task.dueDate),
    estimatedMinutes: String(task.estimatedMinutes ?? 45),
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

  const save = async () => {
    setError("");
    if (!draft.title.trim()) {
      setError("Inserisci un titolo per la task.");
      return;
    }

    const estimatedMinutes = Number(draft.estimatedMinutes);
    const actualMinutes = draft.actualMinutes.trim() ? Number(draft.actualMinutes) : undefined;
    const difficulty = Number(draft.difficulty);
    const importance = Number(draft.importance);
    const dueDate = draft.dueDate ? new Date(draft.dueDate) : undefined;

    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 0) {
      setError("La durata stimata deve essere un numero valido.");
      return;
    }
    if (actualMinutes !== undefined && (!Number.isFinite(actualMinutes) || actualMinutes < 0)) {
      setError("La durata effettiva deve essere un numero valido.");
      return;
    }
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      setError("La data selezionata non e valida.");
      return;
    }

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
      importance: Math.max(1, Math.min(5, importance)) as Task["importance"],
      completedAt: draft.status === "done" ? task.completedAt ?? new Date().toISOString() : undefined
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
      <section className="soft-panel scrollbar-soft max-h-[88vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[var(--faint)]">Task editor</p>
            <h3 className="safe-text text-2xl font-black">Modifica task</h3>
          </div>
          <Button variant="ghost" icon="X" onClick={onClose}>
            Chiudi
          </Button>
        </div>

        <div className="grid gap-3">
          <Field label="Titolo">
            <input className={inputClass} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} autoFocus />
          </Field>

          <Field label="Descrizione">
            <textarea className={`${inputClass} min-h-24 py-3`} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
          </Field>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Stato">
              <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Task["status"] }))}>
                <option value="todo">Da fare</option>
                <option value="doing">In corso</option>
                <option value="blocked">Bloccato</option>
                <option value="done">Completato</option>
                <option value="postponed">Rimandato</option>
                <option value="archived">Archiviato</option>
              </select>
            </Field>
            <Field label="Priorita">
              <select className={inputClass} value={draft.priority} onChange={(event) => setDraft((value) => ({ ...value, priority: event.target.value as Task["priority"] }))}>
                <option value="low">Bassa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </Field>
            <Field label="Energia">
              <select className={inputClass} value={draft.energy} onChange={(event) => setDraft((value) => ({ ...value, energy: event.target.value as Task["energy"] }))}>
                <option value="low">Bassa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Data e ora">
              <input className={inputClass} type="datetime-local" value={draft.dueDate} onChange={(event) => setDraft((value) => ({ ...value, dueDate: event.target.value }))} />
            </Field>
            <Field label="Durata stimata">
              <input className={inputClass} type="number" min={0} step={5} value={draft.estimatedMinutes} onChange={(event) => setDraft((value) => ({ ...value, estimatedMinutes: event.target.value }))} />
            </Field>
            <Field label="Durata effettiva">
              <input className={inputClass} type="number" min={0} step={5} value={draft.actualMinutes} onChange={(event) => setDraft((value) => ({ ...value, actualMinutes: event.target.value }))} placeholder="opzionale" />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Materia">
              <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                <option value="">Nessuna</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Difficolta">
              <input className={inputClass} type="number" min={1} max={5} value={draft.difficulty} onChange={(event) => setDraft((value) => ({ ...value, difficulty: event.target.value }))} />
            </Field>
            <Field label="Importanza">
              <input className={inputClass} type="number" min={1} max={5} value={draft.importance} onChange={(event) => setDraft((value) => ({ ...value, importance: event.target.value }))} />
            </Field>
          </div>

          <Field label="Tag separati da virgola">
            <input className={inputClass} value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="urgente, orale, laboratorio" />
          </Field>

          <Field label="Note">
            <textarea className={`${inputClass} min-h-24 py-3`} value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} />
          </Field>

          <div className="quiet-panel flex flex-wrap gap-2 p-3">
            <Pill>{draft.status}</Pill>
            <Pill>{draft.estimatedMinutes || 0} min stimati</Pill>
            {draft.actualMinutes ? <Pill>{draft.actualMinutes} min effettivi</Pill> : null}
            {task.completedAt ? <Pill>completata</Pill> : null}
          </div>

          {error ? <p className="rounded-[18px] border border-red-400/30 bg-red-500/10 p-3 text-sm font-bold text-red-200">{error}</p> : null}

          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="danger" icon="Trash2" onClick={() => onDelete(task)}>
              Elimina
            </Button>
            <Button variant="soft" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="primary" icon="Check" onClick={save}>
              Salva task
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
