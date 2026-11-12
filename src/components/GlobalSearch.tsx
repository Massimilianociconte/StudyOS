import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { AnimatePresence, m } from "framer-motion";
import type { AppView, CalendarEvent, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { inputClass } from "./ui";
import {
  ALL_DAY_LABEL,
  ATTACHMENT_KIND_LABEL,
  EVENT_CATEGORY_LABEL,
  EXAM_STATUS_LABEL,
  GOAL_CATEGORY_LABEL,
  GOAL_STATUS_LABEL,
  PRIORITY_LABEL,
  SESSION_STATUS_LABEL,
  TASK_STATUS_LABEL,
  attachmentKind,
  SEARCH_TEXT,
  formatMinutes,
  hostOf
} from "../lib/labels";
import { safeCssColor } from "../lib/sharing";
import { isDateToDecide } from "../lib/examOutcome";
import { allDayFirstDate, searchHits } from "../lib/repeat";
import { nextSearchIndex, searchOptionId, searchPanelBox } from "../lib/searchUi";
import { openItemPlan, searchKindEntity, type OccurrenceAt, type SearchKind } from "../lib/openItem";
import { writeUiState } from "../lib/uiState";
import { lazyView } from "../lib/lazyView";
import { DeferredPart } from "./DeferredPart";

const NoteDrawer = lazyView(() => import("./NoteDrawer"), "NoteDrawer");
import { NOTES_TEXT } from "../lib/labels/notes";

type ResultKind = SearchKind;

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
  /** Evento ripetuto: la volta mostrata nel risultato, da aprire (searchHits). */
  at?: OccurrenceAt;
}

const labels: Record<ResultKind, string> = {
  task: "Attività",
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

/** La volta che searchHits ha scelto per una serie (inizio, fine e giorno di quella occorrenza). */
const occurrenceAt = (event: CalendarEvent & { occurrenceDate?: unknown }): OccurrenceAt | undefined =>
  typeof event.occurrenceDate === "string" ? { start: event.start, end: event.end, date: event.occurrenceDate } : undefined;

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
  const listId = useId();

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
          subtitle: [TASK_STATUS_LABEL[task.status] ?? task.status, due, subject?.name].filter(Boolean).join(" · "),
          view: "tasks",
          icon: kindIcon.task,
          score: s,
          accent: subject?.color ?? "var(--accent)",
          badge: task.priority === "urgent" || task.priority === "high" ? PRIORITY_LABEL[task.priority] : undefined
        });
      }
    }

    // Eventi: ogni serie una volta, i giorni cambiati da soli solo se la serie non c'è già (searchHits).
    const eventScore = (event: CalendarEvent) =>
      scoreFields(needle, [
        { text: event.title, weight: 3 },
        { text: event.description, weight: 1 },
        { text: event.notes, weight: 0.4 }
      ]);
    for (const event of searchHits(events, (item) => eventScore(item) > 0)) {
      const subject = subjectOf(subjects, event.subjectId);
      const when =
        event.allDay === true
          ? `${format(allDayFirstDate(event), "d MMM", { locale: it })} · ${ALL_DAY_LABEL}`
          : format(parseISO(event.start), "d MMM HH:mm", { locale: it });
      out.push({
        id: event.id,
        kind: "event",
        title: event.title,
        subtitle: [EVENT_CATEGORY_LABEL[event.category] ?? event.category, when, subject?.name].filter(Boolean).join(" · "),
        view: "calendar",
        icon: kindIcon.event,
        score: eventScore(event),
        // Il colore di un evento può averlo scritto chi riceve il calendario con modifica: solo esadecimale.
        accent: safeCssColor(event.color) || subject?.color,
        // Una serie porta la volta mostrata (searchHits): il risultato apre quella, non il primo giorno.
        at: occurrenceAt(event)
      });
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
          // Niente semestre: il valore salvato può essere il segnaposto «Semestre», e quello vero vuole il
          // catalogo del corso (fuori dal pacchetto iniziale). Basta il docente con i CFU.
          subtitle: [subject.teacher, `${subject.cfu} CFU`].filter(Boolean).join(" · "),
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
          // Non superato senza nuova data: la data passata e lo stato di prima lo farebbero sembrare in arrivo.
          subtitle: isDateToDecide(exam)
            ? SEARCH_TEXT.examDateToDecide
            : `${format(parseISO(exam.date), "d MMM yyyy", { locale: it })} · ${exam.preparation}% preparazione · ${EXAM_STATUS_LABEL[exam.status] ?? exam.status}`,
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
          subtitle: [ATTACHMENT_KIND_LABEL[attachmentKind(attachment)], hostOf(attachment.externalUrl)].filter(Boolean).join(" · "),
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
            formatMinutes(session.actualMinutes || session.plannedMinutes),
            subject?.name,
            SESSION_STATUS_LABEL[session.status] ?? session.status
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
          subtitle: `${GOAL_CATEGORY_LABEL[goal.category] ?? goal.category} · ${goal.progress}% · ${GOAL_STATUS_LABEL[goal.status] ?? goal.status}`,
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
          title: note.title.trim() || NOTES_TEXT.untitled,
          subtitle: note.body.slice(0, 80),
          view: "materials", // non usata: la nota si apre sul posto
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
    // Tab (o altro) che porta il focus fuori dalla ricerca chiude i risultati. focusin e non blur del
    // campo: un clic nel pannello (scorrimento, intestazione) non sposta il focus su un altro elemento.
    const onFocusIn = (event: FocusEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  // Nota aperta dalla ricerca: si legge sul posto, in un Drawer (non ha una sezione sua).
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  // Il pannello della nota si monta alla prima apertura e poi resta (così la chiusura anima come prima).
  const [noteDrawerMounted, setNoteDrawerMounted] = useState(false);
  useEffect(() => {
    if (openNoteId) setNoteDrawerMounted(true);
  }, [openNoteId]);

  // Il risultato apre proprio l'elemento: chiavi della sezione d'arrivo (lib/openItem) e poi la sezione.
  const jump = (result: SearchResult) => {
    setQuery("");
    setOpen(false);
    if (result.kind === "note") {
      // Il focus resta nel campo: chiudendo il Drawer torna qui.
      setOpenNoteId(result.id);
      return;
    }
    const plan = openItemPlan(searchKindEntity(result.kind), result.id, useStudyStore.getState(), result.at);
    for (const [key, value, scope] of plan?.writes ?? []) writeUiState(key, value, scope);
    onJump(plan?.view ?? result.view);
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
    const next = nextSearchIndex(activeIndex, event.key, results.length);
    if (next !== null) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[Math.min(activeIndex, results.length - 1)];
      if (target) jump(target);
    }
  };

  const showDropdown = open && query.trim().length > 0;
  const trimmed = query.trim();
  const listOpen = showDropdown && results.length > 0;
  const wide = useWideSearch();

  // Sui telefoni il campo è stretto: il pannello si allarga a tutto lo schermo (16 px di margine).
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!showDropdown) return undefined;
    const measure = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      setBox(rect ? searchPanelBox({ left: rect.left }, document.documentElement.clientWidth) : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showDropdown]);

  // Il risultato evidenziato resta visibile scorrendo con le frecce (il focus non lascia il campo).
  useEffect(() => {
    if (!listOpen) return;
    document.getElementById(searchOptionId(listId, activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [listOpen, activeIndex, listId]);

  return (
    <div ref={wrapperRef} className="relative">
      <Icon
        name="Search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]"
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        // Lo spazio a destra serve solo alla ✕ (con del testo): a 320 px il campo è stretto.
        className={`${inputClass} pl-10 ${query ? "pr-10" : "pr-3"}`}
        placeholder={wide ? SEARCH_TEXT.placeholderWide : SEARCH_TEXT.placeholder}
        role="combobox"
        aria-label={SEARCH_TEXT.aria}
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen ? searchOptionId(listId, activeIndex) : undefined}
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
          aria-label={SEARCH_TEXT.clear}
          title={SEARCH_TEXT.clear}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[var(--muted)] after:absolute after:-inset-1.5 after:rounded-full after:content-[''] hover:bg-[var(--surface)]"
        >
          <Icon name="X" className="h-4 w-4" />
        </button>
      ) : null}
      {/* Numero di risultati detto a voce mentre si scrive (il pannello compare e sparisce). */}
      <span role="status" className="sr-only">
        {showDropdown ? (results.length ? SEARCH_TEXT.count(results.length) : SEARCH_TEXT.empty(trimmed)) : ""}
      </span>

      <AnimatePresence>
        {showDropdown ? (
          <m.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            style={box ? { left: box.left, right: "auto", width: box.width } : undefined}
            className="scrollbar-soft absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(70dvh,520px)] overflow-y-auto rounded-[24px] border border-[var(--border)] bg-[var(--bg-2)] p-2 shadow-soft"
          >
            <div aria-hidden="true" className="flex items-center justify-between gap-3 px-3 pb-2 pt-1 text-[10px] font-black uppercase tracking-wider text-[var(--faint)]">
              <span className="shrink-0">{SEARCH_TEXT.count(results.length)}</span>
              {/* Le frecce servono con la tastiera: sui telefoni l'intestazione resta su una riga. */}
              {results.length ? <span className="one-line-safe hidden sm:block">{SEARCH_TEXT.keys}</span> : null}
            </div>

            {results.length === 0 ? (
              <div className="grid grid-cols-1 place-items-center gap-2 px-4 py-6 text-center">
                <Icon name="Search" className="h-6 w-6 text-[var(--faint)]" />
                <p className="safe-text text-sm font-extrabold">{SEARCH_TEXT.empty(trimmed)}</p>
                <p className="text-xs font-bold text-[var(--muted)]">{SEARCH_TEXT.emptyHint}</p>
              </div>
            ) : (
              <ul role="listbox" id={listId} aria-label={SEARCH_TEXT.results} className="grid grid-cols-1 gap-1">
                {results.map((result, index) => {
                  const active = index === activeIndex;
                  return (
                    <li
                      key={`${result.kind}-${result.id}`}
                      id={searchOptionId(listId, index)}
                      role="option"
                      aria-selected={active}
                      // Il focus resta nel campo (combobox): il tocco o il clic apre il risultato.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => jump(result)}
                      className={`flex w-full min-h-[58px] cursor-pointer items-center gap-3 rounded-[18px] border px-3 py-2 text-left transition ${
                        active ? "border-[var(--accent)] bg-[var(--surface)]" : "border-transparent hover:bg-[var(--surface-soft)]"
                      }`}
                    >
                      <span
                        className="grid grid-cols-1 h-10 w-10 shrink-0 place-items-center rounded-full"
                        style={{
                          background: result.accent ?? "var(--surface-strong)",
                          color: result.accent ? "#10131d" : "var(--text)"
                        }}
                      >
                        <Icon name={result.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className="two-line-safe text-sm font-extrabold leading-snug">
                            <Highlight text={result.title} query={trimmed} />
                          </span>
                          {result.badge ? (
                            <span className="mt-0.5 shrink-0 rounded-full bg-[var(--warning)]/30 px-2 py-0.5 text-[10px] font-black uppercase text-[var(--warning)]">
                              {result.badge}
                            </span>
                          ) : null}
                        </span>
                        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                          {/* Sui telefoni il tipo sta qui, così il titolo ha tutta la riga. */}
                          <span className="sm:hidden">
                            {labels[result.kind]}
                            {result.subtitle ? " · " : ""}
                          </span>
                          {result.subtitle}
                        </span>
                      </span>
                      <span className="hidden shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--muted)] sm:block">
                        {labels[result.kind]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </m.div>
        ) : null}
      </AnimatePresence>
      {noteDrawerMounted || openNoteId ? (
        <DeferredPart>
          <NoteDrawer noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
        </DeferredPart>
      ) : null}
    </div>
  );
}

// A 768 px il campo è largo ≈ 344 px (testo utile ≈ 264): il segnaposto intero entra da 1024 in su.
const WIDE_SEARCH_QUERY = "(min-width: 1024px)";
const subscribeWide = (onChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(WIDE_SEARCH_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const readWide = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_SEARCH_QUERY).matches;

/** Campo abbastanza largo per il segnaposto completo (sotto i 1024 px resta «Cerca…»). */
function useWideSearch() {
  return useSyncExternalStore(subscribeWide, readWide, () => false);
}
