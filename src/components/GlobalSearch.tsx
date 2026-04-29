import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import type { AppView, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { inputClass } from "./ui";

type ResultKind = "task" | "event" | "subject" | "exam" | "material" | "session" | "topic" | "goal" | "note";

interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle: string;
  view: AppView;
  icon: string;
  score: number;
  accent?: string;
  badge?: string;
}

const labels: Record<ResultKind, string> = {
  task: "Task",
  event: "Evento",
  subject: "Materia",
  exam: "Esame",
  material: "Materiale",
  session: "Sessione",
  topic: "Argomento",
  goal: "Obiettivo",
  note: "Nota"
};

const kindIcon: Record<ResultKind, string> = {
  task: "Check",
  event: "CalendarDays",
  subject: "BookOpen",
  exam: "GraduationCap",
  material: "Paperclip",
  session: "Timer",
  topic: "Sigma",
  goal: "Target",
  note: "PenLine"
};

const subjectOf = (subjects: Subject[], id?: string) =>
  subjects.find((subject) => subject.id === id);

const score = (haystack: string, needle: string) => {
  if (!haystack) return 0;
  const lower = haystack.toLowerCase();
  if (lower === needle) return 100;
  if (lower.startsWith(needle)) return 80;
  const index = lower.indexOf(needle);
  if (index === -1) return 0;
  if (lower[index - 1] === " " || lower[index - 1] === undefined) return 60;
  return 35;
};

const scoreFields = (needle: string, fields: { text?: string; weight?: number }[]) => {
  let total = 0;
  for (const { text, weight = 1 } of fields) {
    if (!text) continue;
    total += score(text, needle) * weight;
  }
  return total;
};

const Highlight = ({ text, query }: { text: string; query: string }) => {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[6px] bg-[var(--accent)] px-1 text-[#10131d]">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
};

export function GlobalSearch({ onJump }: { onJump: (view: AppView) => void }) {
  const { tasks, events, subjects, exams, attachments, sessions, topics, goals, notes } = useStudyStore();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const out: SearchResult[] = [];

    for (const task of tasks) {
      const subject = subjectOf(subjects, task.subjectId);
      const s = scoreFields(needle, [
        { text: task.title, weight: 3 },
        { text: task.description, weight: 1 },
        { text: task.notes, weight: 0.5 },
        { text: task.tags.join(" "), weight: 0.5 }
      ]);
      if (s > 0) {
        const due = task.dueDate ? format(parseISO(task.dueDate), "d MMM HH:mm", { locale: it }) : null;
        out.push({
          id: task.id,
          kind: "task",
          title: task.title,
          subtitle: [task.status, due, subject?.name].filter(Boolean).join(" · "),
          view: "tasks",
          icon: kindIcon.task,
          score: s,
          accent: subject?.color ?? "var(--accent)",
          badge: task.priority === "urgent" || task.priority === "high" ? task.priority : undefined
        });
      }
    }

    for (const event of events) {
      const subject = subjectOf(subjects, event.subjectId);
      const s = scoreFields(needle, [
        { text: event.title, weight: 3 },
        { text: event.description, weight: 1 },
        { text: event.notes, weight: 0.4 }
      ]);
      if (s > 0) {
        const when = format(parseISO(event.start), "d MMM HH:mm", { locale: it });
        out.push({
          id: event.id,
          kind: "event",
          title: event.title,
          subtitle: [event.category, when, subject?.name].filter(Boolean).join(" · "),
          view: "calendar",
          icon: kindIcon.event,
          score: s,
          accent: event.color || subject?.color
        });
      }
    }

    for (const subject of subjects) {
      const s = scoreFields(needle, [
        { text: subject.name, weight: 3 },
        { text: subject.teacher, weight: 1 },
        { text: subject.notes, weight: 0.5 }
      ]);
      if (s > 0) {
        out.push({
          id: subject.id,
          kind: "subject",
          title: subject.name,
          subtitle: [subject.teacher, subject.semester, `${subject.cfu} CFU`].filter(Boolean).join(" · "),
          view: "subjects",
          icon: kindIcon.subject,
          score: s,
          accent: subject.color
        });
      }
    }

    for (const exam of exams) {
      const subject = subjectOf(subjects, exam.subjectId);
      const s = scoreFields(needle, [
        { text: subject?.name ?? "", weight: 3 },
        { text: exam.program.join(" "), weight: 1 }
      ]);
      if (s > 0) {
        out.push({
          id: exam.id,
          kind: "exam",
          title: subject?.name ?? "Esame",
          subtitle: `${format(parseISO(exam.date), "d MMM yyyy", { locale: it })} · ${exam.preparation}% prep · ${exam.status}`,
          view: "exams",
          icon: kindIcon.exam,
          score: s,
          accent: subject?.color
        });
      }
    }

    for (const attachment of attachments) {
      const s = scoreFields(needle, [
        { text: attachment.name, weight: 3 },
        { text: attachment.description, weight: 1 },
        { text: attachment.tags.join(" "), weight: 0.5 }
      ]);
      if (s > 0) {
        out.push({
          id: attachment.id,
          kind: "material",
          title: attachment.name,
          subtitle: [attachment.mimeType, attachment.externalUrl ? "link" : null].filter(Boolean).join(" · "),
          view: "materials",
          icon: kindIcon.material,
          score: s
        });
      }
    }

    for (const session of sessions) {
      const subject = subjectOf(subjects, session.subjectId);
      const s = scoreFields(needle, [
        { text: session.title, weight: 3 },
        { text: session.notes, weight: 0.5 }
      ]);
      if (s > 0) {
        out.push({
          id: session.id,
          kind: "session",
          title: session.title,
          subtitle: [
            `${session.actualMinutes || session.plannedMinutes} min`,
            subject?.name,
            session.status
          ]
            .filter(Boolean)
            .join(" · "),
          view: "study",
          icon: kindIcon.session,
          score: s,
          accent: subject?.color
        });
      }
    }

    for (const topic of topics) {
      const subject = subjectOf(subjects, topic.subjectId);
      const s = scoreFields(needle, [
        { text: topic.title, weight: 3 },
        { text: topic.notes, weight: 0.5 }
      ]);
      if (s > 0) {
        out.push({
          id: topic.id,
          kind: "topic",
          title: topic.title,
          subtitle: [
            subject?.name,
            `${topic.completedReviews} ripassi`,
            `prossimo ${format(parseISO(topic.nextReviewDate), "d MMM", { locale: it })}`
          ]
            .filter(Boolean)
            .join(" · "),
          view: "study",
          icon: kindIcon.topic,
          score: s,
          accent: subject?.color
        });
      }
    }

    for (const goal of goals) {
      const s = scoreFields(needle, [
        { text: goal.title, weight: 3 },
        { text: goal.description, weight: 1 },
        { text: goal.notes, weight: 0.4 }
      ]);
      if (s > 0) {
        out.push({
          id: goal.id,
          kind: "goal",
          title: goal.title,
          subtitle: `${goal.category} · ${goal.progress}% · ${goal.status}`,
          view: "goals",
          icon: kindIcon.goal,
          score: s
        });
      }
    }

    for (const note of notes) {
      const s = scoreFields(needle, [
        { text: note.title, weight: 3 },
        { text: note.body, weight: 1 }
      ]);
      if (s > 0) {
        out.push({
          id: note.id,
          kind: "note",
          title: note.title,
          subtitle: note.body.slice(0, 80),
          view: "materials",
          icon: kindIcon.note,
          score: s
        });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }, [query, tasks, events, subjects, exams, attachments, sessions, topics, goals, notes]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const jump = (result: SearchResult) => {
    onJump(result.view);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      jump(results[activeIndex]);
    }
  };

  const showDropdown = open && query.trim().length > 0;
  const trimmed = query.trim();

  return (
    <div ref={wrapperRef} className="relative">
      <Icon
        name="Search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]"
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        className={`${inputClass} pl-10 pr-10`}
        placeholder="Cerca task, eventi, materie, materiali, ripassi..."
        aria-label="Ricerca globale"
        autoComplete="off"
        spellCheck={false}
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          aria-label="Pulisci ricerca"
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]"
        >
          <Icon name="MoreHorizontal" className="h-4 w-4" />
        </button>
      ) : null}

      <AnimatePresence>
        {showDropdown ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="scrollbar-soft absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,520px)] overflow-y-auto rounded-[24px] border border-[var(--border)] bg-[var(--bg-2)] p-2 shadow-soft"
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[10px] font-black uppercase tracking-wider text-[var(--faint)]">
              <span>{results.length} risultati</span>
              <span>↑ ↓ Enter</span>
            </div>

            {results.length === 0 ? (
              <div className="grid place-items-center gap-2 px-4 py-6 text-center">
                <Icon name="Search" className="h-6 w-6 text-[var(--faint)]" />
                <p className="text-sm font-extrabold">Nessun risultato per "{trimmed}"</p>
                <p className="text-xs font-bold text-[var(--muted)]">Prova un termine più corto o aggiungi nuovi dati.</p>
              </div>
            ) : (
              <ul role="listbox" className="grid gap-1">
                {results.map((result, index) => {
                  const active = index === activeIndex;
                  return (
                    <li key={`${result.kind}-${result.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => jump(result)}
                        className={`flex w-full min-h-[58px] items-center gap-3 rounded-[18px] border px-3 py-2 text-left transition ${
                          active ? "border-[var(--accent)] bg-[var(--surface)]" : "border-transparent hover:bg-[var(--surface-soft)]"
                        }`}
                      >
                        <span
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                          style={{
                            background: result.accent ?? "var(--surface-strong)",
                            color: result.accent ? "#10131d" : "var(--text)"
                          }}
                        >
                          <Icon name={result.icon} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="one-line-safe block text-sm font-extrabold">
                              <Highlight text={result.title} query={trimmed} />
                            </span>
                            {result.badge ? (
                              <span className="shrink-0 rounded-full bg-[var(--warning)]/30 px-2 py-0.5 text-[10px] font-black uppercase text-[var(--warning)]">
                                {result.badge}
                              </span>
                            ) : null}
                          </span>
                          {result.subtitle ? (
                            <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                              {result.subtitle}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--muted)]">
                          {labels[result.kind]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
