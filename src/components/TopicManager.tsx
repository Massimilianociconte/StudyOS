import { useState, type FormEvent } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { StudyTopic, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { subjectColor, subjectName } from "../lib/selectors";
import { Field, IconButton, inputClass } from "./ui";
import { Icon } from "./Icon";

/** "oggi", "domani", "tra 5 giorni", "in ritardo di 2 giorni". */
export const reviewDueLabel = (iso: string, now: Date = new Date()) => {
  const date = parseISO(iso);
  if (Number.isNaN(date.getTime())) return "da pianificare";
  const days = differenceInCalendarDays(date, now);
  if (days < 0) return days === -1 ? "in ritardo di 1 giorno" : `in ritardo di ${-days} giorni`;
  if (days === 0) return "oggi";
  if (days === 1) return "domani";
  if (days < 14) return `tra ${days} giorni`;
  return format(date, "d MMM", { locale: it });
};

/**
 * Elenco e gestione degli argomenti da ripassare. Con `subjectId` mostra e crea solo gli
 * argomenti di quella materia (dettaglio materia), altrimenti tutti con filtro per materia.
 */
export function TopicManager({ subjects, subjectId }: { subjects: Subject[]; subjectId?: string }) {
  const { topics, addTopics, updateTopic, deleteTopic } = useStudyStore();
  const [filter, setFilter] = useState(subjectId ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const activeSubjects = subjects.filter((subject) => !subject.archived);
  const scope = subjectId ?? filter;
  const list = topics
    .filter((topic) => !topic.archived && (!scope || topic.subjectId === scope))
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));

  return (
    <div className="grid grid-cols-1 gap-3">
      <NewTopicForm subjects={activeSubjects} fixedSubjectId={subjectId} defaultSubjectId={filter} onAdd={(title, target) => addTopics([{ title, subjectId: target }])} />

      {!subjectId && activeSubjects.length > 1 ? (
        <select className={`${inputClass} min-h-10`} value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtra per materia">
          <option value="">Tutte le materie · {topics.filter((topic) => !topic.archived).length} argomenti</option>
          {activeSubjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      ) : null}

      {list.length ? (
        <ul className="grid grid-cols-1 gap-1">
          {list.map((topic) =>
            editingId === topic.id ? (
              <TopicEditor
                key={topic.id}
                topic={topic}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  await updateTopic(topic.id, patch);
                  setEditingId(null);
                }}
              />
            ) : (
              <li key={topic.id} className="group flex min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 hover:bg-[var(--surface-soft)]">
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: subjectColor(subjects, topic.subjectId) }} />
                <button type="button" onClick={() => setEditingId(topic.id)} className="min-w-0 flex-1 text-left">
                  <span className="one-line-safe block text-sm font-extrabold">{topic.title}</span>
                  <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                    {subjectId ? "" : `${subjectName(subjects, topic.subjectId)} · `}
                    ripasso {reviewDueLabel(topic.nextReviewDate)}
                    {topic.completedReviews ? ` · ${topic.completedReviews} ${topic.completedReviews === 1 ? "ripasso fatto" : "ripassi fatti"}` : " · nuovo"}
                    {topic.questions.length ? ` · ${topic.questions.length} domande` : ""}
                  </span>
                </button>
                <IconButton
                  icon="Trash2"
                  label={`Elimina "${topic.title}"`}
                  className="h-8 w-8 bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                  onClick={() => {
                    if (window.confirm(`Eliminare l'argomento "${topic.title}" e la sua cronologia di ripasso?`)) void deleteTopic(topic.id);
                  }}
                />
              </li>
            )
          )}
        </ul>
      ) : (
        <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          Nessun argomento. Aggiungine uno qui sopra, oppure importa il programma di un esame dalla sezione Esami.
        </p>
      )}
    </div>
  );
}

function NewTopicForm({
  subjects,
  fixedSubjectId,
  defaultSubjectId,
  onAdd
}: {
  subjects: Subject[];
  fixedSubjectId?: string;
  defaultSubjectId?: string;
  onAdd: (title: string, subjectId: string) => Promise<number>;
}) {
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState("");
  const [message, setMessage] = useState("");
  const target = fixedSubjectId ?? (chosen || defaultSubjectId || subjects[0]?.id || "");

  if (!subjects.length && !fixedSubjectId) {
    return <p className="text-sm font-bold text-[var(--muted)]">Crea prima una materia: ogni argomento appartiene a una materia.</p>;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !target) return;
    const added = await onAdd(title.trim(), target);
    setMessage(added ? "" : "Questo argomento esiste già per la materia.");
    if (added) setTitle("");
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className={`grid grid-cols-1 gap-2 ${fixedSubjectId ? "" : "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"}`}>
        <label className="relative block min-w-0">
          <span className="sr-only">Nuovo argomento</span>
          <Icon name="Brain" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
          <input className={`${inputClass} pl-10`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nuovo argomento da ripassare" />
        </label>
        {fixedSubjectId ? null : (
          <select className={`${inputClass} min-w-0`} value={target} onChange={(event) => setChosen(event.target.value)} aria-label="Materia dell'argomento">
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <button
        type="submit"
        disabled={!title.trim()}
        className="motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-extrabold text-[#10131d] disabled:opacity-50"
      >
        <Icon name="Plus" className="h-4 w-4" /> Aggiungi
      </button>
      {message ? (
        <p role="alert" className="text-xs font-bold text-[var(--warning-text)] sm:col-span-2">
          {message}
        </p>
      ) : null}
    </form>
  );
}

function TopicEditor({ topic, onSave, onCancel }: { topic: StudyTopic; onSave: (patch: Partial<StudyTopic>) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(topic.title);
  const [questions, setQuestions] = useState(topic.questions.join("\n"));
  const [notes, setNotes] = useState(topic.notes);
  return (
    <li className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <Field label="Argomento">
        <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </Field>
      <Field label="Domande guida (una per riga)">
        <textarea
          className={`${inputClass} min-h-24 py-2.5`}
          value={questions}
          onChange={(event) => setQuestions(event.target.value)}
          placeholder={"Es. Quali sono le fasi dell'infiammazione acuta?\nChe ruolo hanno i neutrofili?"}
        />
      </Field>
      <Field label="Note">
        <textarea className={`${inputClass} min-h-16 py-2.5`} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-full px-4 text-sm font-extrabold hover:bg-[var(--surface)]">
          Annulla
        </button>
        <button
          type="button"
          disabled={!title.trim()}
          onClick={() =>
            void onSave({
              title: title.trim(),
              questions: questions
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
              notes
            })
          }
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-extrabold text-[#10131d] disabled:opacity-50"
        >
          <Icon name="Check" className="h-4 w-4" /> Salva
        </button>
      </div>
    </li>
  );
}
