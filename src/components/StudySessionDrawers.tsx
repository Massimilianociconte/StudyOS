// Moduli delle sessioni di studio: riepilogo prima di salvare Timer e Cronometro, modifica di una
// sessione salvata (dall'elenco di Studio, dalla materia, dall'avviso "Blocco finito") e "Aggiungi
// studio fatto". Stessi campi ovunque; i controlli sono funzioni pure in lib/studySessions.ts.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { format, isSameDay } from "date-fns";
import { it } from "date-fns/locale";
import type { StudySession, StudyTopic, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects } from "../lib/selectors";
import { SESSION_FORM_TEXT, SESSION_SOURCE_LABEL, SESSION_TEMPLATE_LABEL, TIMER_KIND_LABEL, formatMinutes } from "../lib/labels";
import {
  LONG_SESSION_MINUTES,
  draftFromSession,
  matchTopic,
  readSessionDraft,
  sessionEditPatch,
  topicsOfSubject,
  type SessionDraft,
  type SessionDraftError
} from "../lib/studySessions";
import { finishedSession, timerUnsavedSeconds, type TimerState } from "../lib/studyTimer";
import { Button, Drawer, Field, inputClass } from "./ui";

const TEMPLATES = Object.keys(SESSION_TEMPLATE_LABEL) as StudySession["template"][];
/** Quanto resta visibile "Annulla" dopo aver eliminato o scartato. */
export const UNDO_MS = 15_000;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("it");

/** Argomenti proponibili: quelli della materia più quello già scelto (anche se archiviato). */
const topicOptions = (topics: StudyTopic[], subjectId: string, current: string) => {
  const list = topicsOfSubject(topics, subjectId);
  const chosen = current ? topics.find((topic) => topic.id === current && topic.subjectId === subjectId) : undefined;
  return chosen && !list.includes(chosen) ? [...list, chosen] : list;
};

/** Campi comuni: materia, argomento, descrizione, (giorno e ora), minuti, tipo, note. */
function SessionFields({
  draft,
  onChange,
  subjects,
  topics,
  withStart,
  minutesRef,
  minutesHint
}: {
  draft: SessionDraft;
  onChange: (next: SessionDraft) => void;
  subjects: Subject[];
  topics: StudyTopic[];
  withStart: boolean;
  minutesRef?: RefObject<HTMLInputElement | null>;
  minutesHint?: string;
}) {
  const set = (patch: Partial<SessionDraft>) => onChange({ ...draft, ...patch });
  const options = topicOptions(topics, draft.subjectId, draft.topicId);
  const topic = options.find((item) => item.id === draft.topicId);
  const minutesField = (
    <Field label={SESSION_FORM_TEXT.minutes}>
      <input
        ref={minutesRef}
        className={inputClass}
        inputMode="numeric"
        placeholder={SESSION_FORM_TEXT.minutesPlaceholder}
        value={draft.minutes}
        onChange={(event) => set({ minutes: event.target.value })}
      />
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className={`grid grid-cols-1 gap-3 ${options.length ? "min-[480px]:grid-cols-2" : ""}`}>
        <Field label={SESSION_FORM_TEXT.subject}>
          <select
            className={inputClass}
            value={draft.subjectId}
            onChange={(event) => {
              const subjectId = event.target.value;
              // L'argomento è della materia: cambiandola si toglie.
              set({ subjectId, topicId: topics.some((item) => item.id === draft.topicId && item.subjectId === subjectId) ? draft.topicId : "" });
            }}
          >
            <option value="">{SESSION_FORM_TEXT.noSubject}</option>
            {selectableSubjects(subjects, draft.subjectId).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
        {options.length ? (
          <Field label={SESSION_FORM_TEXT.topic}>
            <select className={inputClass} value={draft.topicId} onChange={(event) => set({ topicId: event.target.value })}>
              <option value="">{SESSION_FORM_TEXT.noTopic}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <Field label={SESSION_FORM_TEXT.title}>
        <input
          className={inputClass}
          value={draft.title}
          maxLength={160}
          onChange={(event) => set({ title: event.target.value })}
          placeholder={topic?.title ?? SESSION_FORM_TEXT.titlePlaceholder}
        />
      </Field>
      {withStart ? (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          <Field label={SESSION_FORM_TEXT.date}>
            <input className={inputClass} type="date" value={draft.date ?? ""} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => set({ date: event.target.value })} />
          </Field>
          <Field label={SESSION_FORM_TEXT.time}>
            <input className={inputClass} type="time" value={draft.time ?? ""} onChange={(event) => set({ time: event.target.value })} />
          </Field>
          {minutesField}
        </div>
      ) : (
        minutesField
      )}
      {minutesHint ? <p className="-mt-1.5 text-xs font-bold text-[var(--muted)]">{minutesHint}</p> : null}
      <Field label={SESSION_FORM_TEXT.template}>
        <select className={inputClass} value={draft.template} onChange={(event) => set({ template: event.target.value as StudySession["template"] })}>
          {TEMPLATES.map((id) => (
            <option key={id} value={id}>
              {SESSION_TEMPLATE_LABEL[id]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={SESSION_FORM_TEXT.notes}>
        <textarea
          className={`${inputClass} min-h-20 py-3`}
          value={draft.notes}
          maxLength={2000}
          onChange={(event) => set({ notes: event.target.value })}
          placeholder={SESSION_FORM_TEXT.notesPlaceholder}
        />
      </Field>
    </div>
  );
}

/** Conferma in riga (Scarta, Elimina): niente finestre del browser. */
function InlineConfirm({ text, yes, no, onYes, onNo }: { text: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <p className="safe-text min-w-[12rem] flex-1 text-sm font-bold">{text}</p>
      <Button variant="ghost" onClick={onNo}>
        {no}
      </Button>
      <Button variant="danger" icon="Trash2" onClick={onYes}>
        {yes}
      </Button>
    </div>
  );
}

function FormError({ error }: { error: SessionDraftError | "" }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
      {SESSION_FORM_TEXT.error[error]}
    </p>
  );
}

const useSessionData = () =>
  useStudyStore(
    useShallow((state) => ({
      subjects: state.subjects,
      topics: state.topics
    }))
  );

/** "Dalle 9:05 alle 10:40" (o con il giorno se la sessione passa la mezzanotte). */
const whenLabel = (kind: string, start: number, end: number) =>
  isSameDay(start, end)
    ? SESSION_FORM_TEXT.reviewWhen(kind, format(start, "HH:mm"), format(end, "HH:mm"))
    : SESSION_FORM_TEXT.reviewWhenDays(kind, format(start, "EEE d HH:mm", { locale: it }), format(end, "EEE d HH:mm", { locale: it }));

/**
 * Riepilogo di Timer e Cronometro prima di salvare: si apre a fine Timer, con "Termina" e alla
 * riapertura dell'app se il Timer è finito mentre era chiusa (con l'ora di fine reale).
 */
export function TimerReviewDrawer({
  onSaved,
  onDiscarded
}: {
  onSaved: (session: StudySession) => void;
  onDiscarded: (previous: TimerState, studied: string) => void;
}) {
  const { timer, open, subjects, topics, saveTimerReview, setTimerReviewOpen, resetStudyTimer } = useStudyStore(
    useShallow((state) => ({
      timer: state.timer,
      open: state.timerReview && state.timer.ended === true && state.timer.kind !== "pomodoro" && !state.loading && !state.locked,
      subjects: state.subjects,
      topics: state.topics,
      saveTimerReview: state.saveTimerReview,
      setTimerReviewOpen: state.setTimerReviewOpen,
      resetStudyTimer: state.resetStudyTimer
    }))
  );
  const block = open ? finishedSession(timer, Date.now()) : null;
  const initial = (): SessionDraft => {
    const title = timer.title ?? "";
    // Argomento scelto prima di avviare, o scritto con lo stesso titolo di uno della materia.
    const topic = topics.find((item) => item.id === timer.topicId && item.subjectId === timer.subjectId) ?? matchTopic(title, topics, timer.subjectId);
    return {
      subjectId: timer.subjectId && subjects.some((item) => item.id === timer.subjectId) ? timer.subjectId : "",
      topicId: topic?.id ?? "",
      title: topic && normalize(title) === normalize(topic.title) ? "" : title.trim(),
      notes: "",
      minutes: String(block?.actualMinutes ?? ""),
      template: timer.template ?? "new-topic"
    };
  };
  const [draft, setDraft] = useState<SessionDraft>(initial);
  const [error, setError] = useState<SessionDraftError | "">("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [openFor, setOpenFor] = useState<string | undefined>(undefined);
  const minutesRef = useRef<HTMLInputElement>(null);
  // Ogni sessione da rivedere riparte dai dati del timer.
  const key = open ? `${timer.sessionId ?? ""}:${timer.pausedAt ?? ""}` : undefined;
  if (key !== openFor) {
    setOpenFor(key);
    if (key) {
      setDraft(initial());
      setError("");
      setConfirmDiscard(false);
    }
  }

  if (!block) return <Drawer open={false} onClose={() => setTimerReviewOpen(false)} title={SESSION_FORM_TEXT.reviewTitle} />;

  const studied = formatMinutes(block.actualMinutes);
  const long = block.actualMinutes > LONG_SESSION_MINUTES;

  const save = () => {
    const result = readSessionDraft(draft, { subjects, topics, now: Date.now() });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = saveTimerReview(result.value);
    if (saved.status === "saved") onSaved(saved.session);
  };

  const discard = () => {
    const previous = useStudyStore.getState().timer;
    const lost = timerUnsavedSeconds(previous, Date.now());
    resetStudyTimer();
    onDiscarded(previous, formatMinutes(Math.floor(lost / 60)));
  };

  return (
    <Drawer
      open={open}
      onClose={() => setTimerReviewOpen(false)}
      eyebrow={SESSION_FORM_TEXT.eyebrow}
      title={SESSION_FORM_TEXT.reviewTitle}
      width="max-w-[520px]"
      footer={
        confirmDiscard ? (
          <InlineConfirm
            text={SESSION_FORM_TEXT.discardConfirm(studied)}
            yes={SESSION_FORM_TEXT.discardYes}
            no={SESSION_FORM_TEXT.discardNo}
            onYes={discard}
            onNo={() => setConfirmDiscard(false)}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" icon="Trash2" onClick={() => setConfirmDiscard(true)}>
              {SESSION_FORM_TEXT.discard}
            </Button>
            <Button variant="primary" icon="Check" onClick={save}>
              {SESSION_FORM_TEXT.save}
            </Button>
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="text-sm font-black">{SESSION_FORM_TEXT.reviewStudied(studied)}</p>
          <p className="text-xs font-bold text-[var(--muted)]">{whenLabel(TIMER_KIND_LABEL[timer.kind], block.start, block.end)}</p>
        </div>
        {long ? (
          <div role="alert" className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-[var(--warning-text)]">
            <p className="text-sm font-black">{SESSION_FORM_TEXT.longTitle(studied)}</p>
            <p className="mt-0.5 text-sm font-bold">{SESSION_FORM_TEXT.longText}</p>
            <Button
              variant="soft"
              className="mt-2"
              onClick={() => {
                minutesRef.current?.focus();
                minutesRef.current?.select();
              }}
            >
              {SESSION_FORM_TEXT.longFix}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">{SESSION_FORM_TEXT.reviewIntro}</p>
        )}
        <SessionFields
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setError("");
          }}
          subjects={subjects}
          topics={topics}
          withStart={false}
          minutesRef={minutesRef}
        />
        <FormError error={error} />
      </div>
    </Drawer>
  );
}

/** Modifica di una sessione salvata: materia, argomento, descrizione, note, inizio e minuti; Elimina. */
export function SessionEditorDrawer({
  sessionId,
  onClose,
  onSaved,
  onDeleted
}: {
  sessionId: string | null;
  onClose: () => void;
  onSaved?: (session: StudySession) => void;
  onDeleted: (session: StudySession) => void;
}) {
  const { subjects, topics } = useSessionData();
  const session = useStudyStore((state) => (sessionId ? state.sessions.find((item) => item.id === sessionId) : undefined));
  const updateSession = useStudyStore((state) => state.updateSession);
  const deleteSession = useStudyStore((state) => state.deleteSession);
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [error, setError] = useState<SessionDraftError | "">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = Boolean(session);
  if ((session?.id ?? null) !== openFor) {
    setOpenFor(session?.id ?? null);
    setDraft(session ? draftFromSession(session, subjects, topics) : null);
    setError("");
    setConfirmDelete(false);
  }

  const save = async () => {
    if (!session || !draft) return;
    const result = readSessionDraft(draft, { subjects, topics, now: Date.now() });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const patch = sessionEditPatch(session, result.value);
    await updateSession(session.id, patch);
    onSaved?.({ ...session, ...patch });
    onClose();
  };

  const remove = async () => {
    if (!session) return;
    const removed = session;
    onClose();
    await deleteSession(removed.id);
    onDeleted(removed);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={SESSION_FORM_TEXT.eyebrow}
      title={SESSION_FORM_TEXT.editTitle}
      width="max-w-[520px]"
      footer={
        confirmDelete ? (
          <InlineConfirm
            text={SESSION_FORM_TEXT.deleteConfirm}
            yes={SESSION_FORM_TEXT.deleteYes}
            no={SESSION_FORM_TEXT.deleteNo}
            onYes={() => void remove()}
            onNo={() => setConfirmDelete(false)}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" icon="Trash2" onClick={() => setConfirmDelete(true)}>
              {SESSION_FORM_TEXT.delete}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                {SESSION_FORM_TEXT.cancel}
              </Button>
              <Button variant="primary" icon="Check" onClick={() => void save()}>
                {SESSION_FORM_TEXT.save}
              </Button>
            </div>
          </div>
        )
      }
    >
      {session && draft ? (
        <div className="grid grid-cols-1 gap-4">
          {session.source ? <p className="text-xs font-bold text-[var(--muted)]">{SESSION_FORM_TEXT.savedWith(SESSION_SOURCE_LABEL[session.source])}</p> : null}
          <SessionFields
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setError("");
            }}
            subjects={subjects}
            topics={topics}
            withStart
          />
          <FormError error={error} />
        </div>
      ) : null}
    </Drawer>
  );
}

/** "Aggiungi studio fatto": una sessione fatta senza timer (biblioteca, lezione, gruppo). */
export function ManualSessionDrawer({
  open,
  defaultSubjectId,
  onClose,
  onSaved
}: {
  open: boolean;
  defaultSubjectId: string;
  onClose: () => void;
  onSaved: (minutes: number) => void;
}) {
  const { subjects, topics } = useSessionData();
  const addSession = useStudyStore((state) => state.addSession);
  const initial = (): SessionDraft => {
    const start = new Date(Date.now() - 60 * 60_000);
    return {
      subjectId: defaultSubjectId,
      topicId: "",
      title: "",
      notes: "",
      minutes: "60",
      template: "new-topic",
      date: format(start, "yyyy-MM-dd"),
      time: format(start, "HH:mm")
    };
  };
  const [draft, setDraft] = useState<SessionDraft>(initial);
  const [error, setError] = useState<SessionDraftError | "">("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(initial());
      setError("");
    }
  }

  const save = async () => {
    const result = readSessionDraft(draft, { subjects, topics, now: Date.now() });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { value } = result;
    const start = value.start ?? Date.now() - value.minutes * 60_000;
    await addSession({
      title: value.title,
      subjectId: value.subjectId,
      topicId: value.topicId,
      template: value.template,
      notes: value.notes,
      plannedMinutes: value.minutes,
      actualMinutes: value.minutes,
      start: new Date(start).toISOString(),
      end: new Date(start + value.minutes * 60_000).toISOString(),
      status: "completed",
      focusLevel: 3,
      source: "manual"
    });
    onSaved(value.minutes);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={SESSION_FORM_TEXT.eyebrow}
      title={SESSION_FORM_TEXT.addTitle}
      width="max-w-[520px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {SESSION_FORM_TEXT.cancel}
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()}>
            {SESSION_FORM_TEXT.saveAdd}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <p className="text-sm text-[var(--muted)]">{SESSION_FORM_TEXT.addIntro}</p>
        <SessionFields
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setError("");
          }}
          subjects={subjects}
          topics={topics}
          withStart
        />
        <FormError error={error} />
      </div>
    </Drawer>
  );
}

/** Riga "Sessione eliminata · Annulla", che sparisce da sola dopo 15 secondi. */
export function UndoNotice({ text, onUndo, onDone }: { text: string; onUndo: () => void; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [text]);
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--muted)]">
      <span className="safe-text min-w-0">{text}</span>
      <button
        type="button"
        className="font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
        onClick={() => {
          onUndo();
          onDone();
        }}
      >
        {SESSION_FORM_TEXT.undo}
      </button>
    </div>
  );
}

/**
 * Modifica di una sessione da un elenco: `edit(id)` apre il Drawer; dopo Elimina compare
 * "Annulla" in `undoNotice` (da mettere sotto l'elenco).
 */
export function useSessionEditor(): { edit: (id: string) => void; drawer: ReactNode; undoNotice: ReactNode } {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<StudySession | null>(null);
  const restoreSession = useStudyStore((state) => state.restoreSession);
  return {
    edit: (id: string) => {
      setDeleted(null);
      setEditingId(id);
    },
    drawer: <SessionEditorDrawer sessionId={editingId} onClose={() => setEditingId(null)} onDeleted={setDeleted} />,
    undoNotice: deleted ? (
      <UndoNotice text={SESSION_FORM_TEXT.deleted(deleted.title)} onUndo={() => void restoreSession(deleted)} onDone={() => setDeleted(null)} />
    ) : null
  };
}
