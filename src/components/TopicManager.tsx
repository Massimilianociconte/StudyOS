import { useEffect, useRef, useState, type FormEvent } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { StudyTopic, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, subjectColor, subjectName } from "../lib/selectors";
import { TOPIC_FILTER_TEXT, TOPIC_TEXT } from "../lib/labels/study";
import { subjectPause } from "../lib/review";
import { Field, IconButton, Tag, inputClass } from "./ui";
import { Icon } from "./Icon";
import { InlineConfirm } from "./InlineConfirm";
import { UnsavedPrompt } from "./UnsavedPrompt";

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
 * Il filtro può arrivare da fuori (`filter` + `onFilterChange`, es. Studio aperto dalla scheda
 * d'esame): "" sono tutte le materie, una materia che non c'è più vale come "tutte".
 * Gli argomenti di una materia superata o archiviata restano in fondo, «in pausa»: non tornano nei ripassi.
 * `onDirtyChange` dice se un argomento in modifica ha cambi non salvati (chi lo contiene chiede prima di chiudere).
 */
export function TopicManager({
  subjects,
  subjectId,
  filter: filterProp,
  onFilterChange,
  onDirtyChange
}: {
  subjects: Subject[];
  subjectId?: string;
  filter?: string;
  onFilterChange?: (subjectId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { topics, addTopics, updateTopic, deleteTopic } = useStudyStore();
  const [ownFilter, setOwnFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Nuovi argomenti solo per le materie da studiare (niente archiviate o già superate), come gli altri menu.
  const activeSubjects = selectableSubjects(subjects);
  const wanted = filterProp ?? ownFilter;
  const filter = wanted && subjects.some((subject) => subject.id === wanted) ? wanted : "";
  const setFilter = (next: string) => (onFilterChange ? onFilterChange(next) : setOwnFilter(next));
  const scope = subjectId ?? filter;
  const live = topics.filter((topic) => !topic.archived);
  const pauses = new Map(subjects.map((subject) => [subject.id, subjectPause(subject)]));
  const pauseOf = (topic: StudyTopic) => pauses.get(topic.subjectId) ?? null;
  // Prima quelli da ripassare (dal più urgente), poi quelli in pausa.
  const list = live
    .filter((topic) => !scope || topic.subjectId === scope)
    .sort((a, b) => Number(Boolean(pauseOf(a))) - Number(Boolean(pauseOf(b))) || a.nextReviewDate.localeCompare(b.nextReviewDate));
  const deleteButtonId = (id: string) => `topic-delete-${id}`;
  // Nel filtro: le materie da studiare più quelle (superate o archiviate) che hanno ancora argomenti,
  // e quella scelta da fuori, così il filtro si vede.
  const filterSubjects = subjects.filter(
    (subject) => activeSubjects.includes(subject) || subject.id === filter || live.some((topic) => topic.subjectId === subject.id)
  );
  const countOf = (id: string) => live.filter((topic) => topic.subjectId === id).length;

  return (
    <div className="grid grid-cols-1 gap-3">
      <NewTopicForm
        subjects={activeSubjects}
        fixedSubjectId={subjectId}
        defaultSubjectId={activeSubjects.some((subject) => subject.id === filter) ? filter : undefined}
        onAdd={(title, target) => addTopics([{ title, subjectId: target }])}
      />

      {!subjectId && (filterSubjects.length > 1 || filter) ? (
        <div className="flex min-w-0 items-center gap-2">
          <select className={`${inputClass} min-h-11 min-w-0 flex-1`} value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={TOPIC_FILTER_TEXT.aria}>
            <option value="">{TOPIC_FILTER_TEXT.all(live.length)}</option>
            {filterSubjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {TOPIC_FILTER_TEXT.option(subject.name, countOf(subject.id))}
              </option>
            ))}
          </select>
          {filter ? (
            <button type="button" onClick={() => setFilter("")} className="min-h-11 shrink-0 px-2 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline">
              {TOPIC_FILTER_TEXT.showAll}
            </button>
          ) : null}
        </div>
      ) : null}

      {list.length ? (
        <ul className="grid grid-cols-1 gap-1">
          {list.map((topic) => {
            const pause = pauseOf(topic);
            return editingId === topic.id ? (
              <TopicEditor
                key={topic.id}
                topic={topic}
                onDirtyChange={onDirtyChange}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  await updateTopic(topic.id, patch);
                  setEditingId(null);
                }}
              />
            ) : (
              <li key={topic.id} className="grid grid-cols-1 gap-1.5">
                <div className="group flex min-w-0 items-center gap-3 rounded-[16px] px-2 py-1 hover:bg-[var(--surface-soft)]">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: subjectColor(subjects, topic.subjectId) }} />
                  <button type="button" onClick={() => setEditingId(topic.id)} title="Modifica argomento e domande guida" className="min-h-11 min-w-0 flex-1 text-left">
                    <span className="one-line-safe block text-sm font-extrabold">{topic.title}</span>
                    <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                      {[
                        subjectId ? "" : subjectName(subjects, topic.subjectId),
                        pause ? "" : `ripasso ${reviewDueLabel(topic.nextReviewDate)}`,
                        topic.completedReviews ? `${topic.completedReviews} ${topic.completedReviews === 1 ? "ripasso fatto" : "ripassi fatti"}` : "mai ripassato",
                        topic.questions.length ? `${topic.questions.length} ${topic.questions.length === 1 ? "domanda guida" : "domande guida"}` : ""
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {pause ? <Tag className="mt-1">{TOPIC_TEXT.paused[pause]}</Tag> : null}
                  </button>
                  <IconButton
                    id={deleteButtonId(topic.id)}
                    icon="Trash2"
                    label={TOPIC_TEXT.removeAria(topic.title)}
                    aria-expanded={confirmingId === topic.id}
                    className="bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                    onClick={() => setConfirmingId(topic.id)}
                  />
                </div>
                {confirmingId === topic.id ? (
                  <InlineConfirm
                    text={TOPIC_TEXT.removeConfirm(topic.title)}
                    confirmLabel={TOPIC_TEXT.remove}
                    icon="Trash2"
                    onCancel={() => {
                      setConfirmingId(null);
                      // La conferma sparisce: il focus torna sul cestino da cui era partita.
                      window.requestAnimationFrame(() => document.getElementById(deleteButtonId(topic.id))?.focus());
                    }}
                    onConfirm={() => {
                      setConfirmingId(null);
                      void deleteTopic(topic.id);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          {scope && live.length
            ? TOPIC_FILTER_TEXT.emptyFiltered
            : "Ancora nessun argomento. Scrivine uno qui sopra oppure importa il programma di un esame dalla sezione Esami."}
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
    return <p className="text-sm font-bold text-[var(--muted)]">Per aggiungere argomenti serve almeno una materia: creala nella sezione Materie.</p>;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !target) return;
    const added = await onAdd(title.trim(), target);
    setMessage(added ? "" : "Questo argomento c'è già per questa materia.");
    if (added) setTitle("");
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className={`grid grid-cols-1 gap-2 ${fixedSubjectId ? "" : "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"}`}>
        <label className="relative block min-w-0">
          <span className="sr-only">Nuovo argomento da ripassare</span>
          <Icon name="Brain" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
          <input className={`${inputClass} pl-10`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Infiammazione acuta" />
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
        <Icon name="Plus" className="h-4 w-4" /> Aggiungi argomento
      </button>
      {message ? (
        <p role="alert" className="text-xs font-bold text-[var(--warning-text)] sm:col-span-2">
          {message}
        </p>
      ) : null}
    </form>
  );
}

function TopicEditor({
  topic,
  onSave,
  onCancel,
  onDirtyChange
}: {
  topic: StudyTopic;
  onSave: (patch: Partial<StudyTopic>) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // I campi com'erano all'apertura: una sync nel frattempo non rende «cambiato» l'argomento.
  const [initial] = useState(() => ({ title: topic.title, questions: topic.questions.join("\n"), notes: topic.notes }));
  const [title, setTitle] = useState(initial.title);
  const [questions, setQuestions] = useState(initial.questions);
  const [notes, setNotes] = useState(initial.notes);
  const [asking, setAsking] = useState(false);
  const dirty = title !== initial.title || questions !== initial.questions || notes !== initial.notes;
  const report = useRef(onDirtyChange);
  useEffect(() => {
    report.current = onDirtyChange;
  });
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  // Chiuso (salvato, annullato o riquadro chiuso): niente più da perdere.
  useEffect(() => () => report.current?.(false), []);
  return (
    <li className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <Field label="Argomento">
        <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </Field>
      <Field label="Domande guida (facoltative, una per riga)">
        <textarea
          className={`${inputClass} min-h-24 py-2.5`}
          value={questions}
          onChange={(event) => setQuestions(event.target.value)}
          placeholder={"Es. Quali sono le fasi dell'infiammazione acuta?\nChe ruolo hanno i neutrofili?"}
        />
      </Field>
      <Field label="Note (facoltative)">
        <textarea className={`${inputClass} min-h-16 py-2.5`} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      {asking && dirty ? (
        <UnsavedPrompt
          className="bg-[var(--surface)]"
          title={TOPIC_TEXT.unsavedTitle}
          text={TOPIC_TEXT.unsavedText}
          keep={TOPIC_TEXT.unsavedKeep}
          discard={TOPIC_TEXT.unsavedDiscard}
          onKeep={() => setAsking(false)}
          onDiscard={onCancel}
        />
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => (dirty ? setAsking(true) : onCancel())} className="min-h-11 rounded-full px-4 text-sm font-extrabold hover:bg-[var(--surface)]">
            {TOPIC_TEXT.cancel}
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
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-extrabold text-[#10131d] disabled:opacity-50"
          >
            <Icon name="Check" className="h-4 w-4" /> {TOPIC_TEXT.save}
          </button>
        </div>
      )}
    </li>
  );
}
