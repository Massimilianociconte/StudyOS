import { useMemo, useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { StudySession, StudyTopic, Subject } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, studyMinutesThisWeek, studyStreak, subjectColor, subjectName } from "../lib/selectors";
import { SESSION_TEMPLATE_LABEL, formatHours, formatMinutes } from "../lib/labels";
import { REVIEW_RATINGS, REVIEW_RATING_LABEL, dueTopics, previewInterval, type ReviewRating } from "../lib/review";
import { Button, Drawer, Field, IconButton, Panel, ProgressBar, ProgressRing, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { TopicManager, reviewDueLabel } from "../components/TopicManager";
import { useNow } from "../hooks/useNow";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { TIMER_DURATIONS, TIMER_LABELS, timerElapsedSeconds, timerRemainingSeconds, type TimerMode } from "../lib/studyTimer";

const TEMPLATES = Object.keys(SESSION_TEMPLATE_LABEL) as StudySession["template"][];

export function StudyView() {
  const store = useStudyStore();
  const { sessions, topics, subjects, timer, toggleStudyTimer, resetStudyTimer, addSession, deleteSession, reviewTopic } = store;
  const weeklyTarget = selectPreferences(store).weeklyTargetMinutes;
  const [topicsOpen, setTopicsOpen] = useUiState("study.topicsOpen", false, { scope: "tab" });
  const [logOpen, setLogOpen] = useUiState("study.logOpen", false, { scope: "tab" });
  // Materia, titolo e tipo accompagnano il timer (che sopravvive già al refresh): restano anche loro.
  const [savedSubjectId, setSubjectId] = useUiState("study.subject", () => selectableSubjects(subjects)[0]?.id ?? "");
  const subjectId = !savedSubjectId || subjects.some((subject) => subject.id === savedSubjectId) ? savedSubjectId : "";
  const [sessionTitle, setSessionTitle] = useUiState("study.title", "", { scope: "tab" });
  const [template, setTemplate] = useUiState<StudySession["template"]>("study.template", "new-topic", { validate: oneOf(...TEMPLATES) });
  const [notice, setNotice] = useState("");
  // Il timer è basato su timestamp: qui serve solo ridisegnare ogni secondo.
  const now = useNow(1000, timer.running);

  const remainingSeconds = timerRemainingSeconds(timer, now.getTime());
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const elapsedSeconds = timerElapsedSeconds(timer, now.getTime());
  const today = new Date();
  const dueReviews = dueTopics(topics, today);
  const dueIds = new Set(dueReviews.map((topic) => topic.id));
  const upcomingReviews = topics
    .filter((topic) => !topic.archived && !dueIds.has(topic.id))
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate))
    .slice(0, 5);
  const weeklyMinutes = studyMinutesThisWeek(sessions);
  const streak = studyStreak(sessions);
  const history = useMemo(
    () => sessions.filter((session) => session.status === "completed").sort((a, b) => b.start.localeCompare(a.start)).slice(0, 8),
    [sessions]
  );
  const todayMinutes = sessions
    .filter((session) => session.status === "completed" && isSameDay(parseISO(session.start), today))
    .reduce((sum, session) => sum + session.actualMinutes, 0);

  // Cambiare durata prepara il timer (senza avviarlo); a timer attivo chiede conferma.
  const selectMode = (mode: TimerMode) => {
    if (mode === timer.mode) return;
    if (timerElapsedSeconds(timer, Date.now()) >= 60 && !window.confirm("Cambiare durata azzera il timer in corso senza registrare la sessione. Continuare?")) return;
    setNotice("");
    resetStudyTimer(mode);
  };

  const finishSession = async () => {
    const elapsed = timerElapsedSeconds(timer, Date.now());
    if (elapsed < 60) {
      setNotice("Sessione troppo breve per essere registrata (meno di 1 minuto).");
      return;
    }
    const actualMinutes = Math.max(1, Math.round(elapsed / 60));
    await addSession({
      title: sessionTitle.trim() || `${SESSION_TEMPLATE_LABEL[template]}${subjectId ? ` · ${subjectName(subjects, subjectId)}` : ""}`,
      subjectId: subjectId || undefined,
      template,
      actualMinutes,
      plannedMinutes: Math.round(timer.durationSeconds / 60),
      status: "completed",
      start: new Date(Date.now() - elapsed * 1000).toISOString(),
      end: new Date().toISOString(),
      focusLevel: 4
    });
    resetStudyTimer("pomodoro");
    setNotice(`Sessione registrata: ${formatMinutes(actualMinutes)}.`);
  };

  const idle = !timer.running && remainingSeconds === timer.durationSeconds;

  return (
    <div>
      <SectionTitle title="Studio" subtitle="Timer, sessioni registrate e ripassi a intervalli. Scegli materia e tipo di sessione, poi avvia." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid grid-cols-1 min-w-0 content-start gap-4">
          <Panel>
            <div className="grid grid-cols-1 items-center gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-7">
              <div className="mx-auto w-full max-w-[180px] md:max-w-[200px]">
                <ProgressRing value={timer.durationSeconds > 0 ? (remainingSeconds / timer.durationSeconds) * 100 : 0} label={timer.label} color="var(--accent)" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-5xl font-black tabular-nums sm:text-6xl">
                    {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
                  </div>
                  <Segmented
                    label="Durata timer"
                    size="sm"
                    value={timer.mode}
                    onChange={selectMode}
                    options={(Object.keys(TIMER_LABELS) as TimerMode[]).map((mode) => ({ id: mode, label: `${TIMER_LABELS[mode]} · ${TIMER_DURATIONS[mode] / 60}′` }))}
                  />
                </div>
                <p className="mt-1 text-xs font-bold text-[var(--muted)]">
                  {timer.running ? `In corso · ${formatMinutes(Math.floor(elapsedSeconds / 60))} trascorsi` : idle ? "Pronto a partire" : "In pausa"}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant={timer.running ? "soft" : "primary"} icon={timer.running ? "Pause" : "Zap"} onClick={toggleStudyTimer} className="min-w-[120px]">
                    {timer.running ? "Pausa" : idle ? "Avvia" : "Riprendi"}
                  </Button>
                  <Button variant="soft" icon="Check" onClick={finishSession} disabled={elapsedSeconds < 60}>
                    Registra sessione
                  </Button>
                  {!idle ? (
                    <Button variant="ghost" onClick={() => resetStudyTimer(timer.mode)}>
                      Azzera
                    </Button>
                  ) : null}
                </div>
                {notice ? <p className="mt-2 text-sm font-bold text-[var(--muted)]">{notice}</p> : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Materia">
                    <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                      <option value="">Nessuna</option>
                      {selectableSubjects(subjects, subjectId).map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Titolo (opzionale)">
                    <input
                      className={inputClass}
                      value={sessionTitle}
                      onChange={(event) => setSessionTitle(event.target.value)}
                      placeholder={`${SESSION_TEMPLATE_LABEL[template]}${subjectId ? ` · ${subjectName(subjects, subjectId)}` : ""}`}
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">Tipo di sessione</span>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo di sessione">
                    {TEMPLATES.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={template === id}
                        onClick={() => setTemplate(id)}
                        className={`min-h-8 rounded-full px-3 text-xs font-black ${
                          template === id ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--text)]"
                        }`}
                      >
                        {SESSION_TEMPLATE_LABEL[id]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <ReviewPanel
              due={dueReviews}
              totalTopics={topics.filter((topic) => !topic.archived).length}
              subjects={subjects}
              onRate={(id, rating) => void reviewTopic(id, rating)}
              onManage={() => setTopicsOpen(true)}
            />

            <Panel>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-lg font-black">Sessioni recenti</h3>
                  <p className="text-xs font-bold text-[var(--muted)]">oggi {formatMinutes(todayMinutes)}</p>
                </div>
                <Button variant="soft" icon="Plus" onClick={() => setLogOpen(true)}>
                  Registra a mano
                </Button>
              </div>
              {history.length ? (
                <ul className="grid grid-cols-1 gap-1">
                  {history.map((session) => (
                    <li key={session.id} className="group flex min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 hover:bg-[var(--surface-soft)]">
                      <span className="grid grid-cols-1 h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${subjectColor(subjects, session.subjectId)} 30%, transparent)` }}>
                        <Icon name="Timer" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="one-line-safe text-sm font-extrabold">{session.title}</p>
                        <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
                          {format(parseISO(session.start), "EEE d MMM · HH:mm", { locale: it })} · {SESSION_TEMPLATE_LABEL[session.template]}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-black tabular-nums">{formatMinutes(session.actualMinutes || session.plannedMinutes)}</span>
                      <IconButton
                        icon="Trash2"
                        label={`Elimina la sessione "${session.title}"`}
                        className="h-8 w-8 bg-transparent text-[var(--danger-text)] transition-opacity hover:bg-[var(--danger-bg)] can-hover:opacity-0 can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100"
                        onClick={() => {
                          if (window.confirm(`Eliminare la sessione "${session.title}" (${formatMinutes(session.actualMinutes)})? Le statistiche verranno ricalcolate.`)) void deleteSession(session.id);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                  Ancora nessuna sessione. Avvia il timer o registra a mano lo studio fatto altrove.
                </p>
              )}
            </Panel>
          </div>
        </div>

        <aside className="grid grid-cols-1 content-start gap-4">
          <Panel>
            <h3 className="text-xs font-black uppercase text-[var(--faint)]">Questa settimana</h3>
            <p className="mt-1 text-4xl font-black">{formatHours(weeklyMinutes)} h</p>
            <p className="text-xs font-bold text-[var(--muted)]">
              su {formatHours(weeklyTarget)} h di obiettivo · streak {streak} {streak === 1 ? "giorno" : "giorni"}
            </p>
            <div className="mt-3">
              <ProgressBar value={(weeklyMinutes / weeklyTarget) * 100} />
            </div>
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-black">Prossimi ripassi</h3>
              <button type="button" onClick={() => setTopicsOpen(true)} className="text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
                Argomenti
              </button>
            </div>
            {upcomingReviews.length ? (
              <ul className="grid grid-cols-1 gap-2.5">
                {upcomingReviews.map((topic) => (
                  <li key={topic.id} className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="one-line-safe block text-sm font-black">{topic.title}</span>
                      <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{subjectName(subjects, topic.subjectId)}</span>
                    </span>
                    <Tag className="shrink-0">{reviewDueLabel(topic.nextReviewDate)}</Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">Nessun ripasso pianificato.</p>
            )}
          </Panel>
        </aside>
      </div>

      <Drawer open={topicsOpen} onClose={() => setTopicsOpen(false)} eyebrow="Ripasso attivo" title="Argomenti da ripassare" width="max-w-[560px]">
        <TopicManager subjects={subjects} />
      </Drawer>

      <ManualSessionDrawer
        open={logOpen}
        subjects={subjects}
        defaultSubjectId={subjectId}
        onClose={() => setLogOpen(false)}
        onSave={async (session) => {
          await addSession(session);
          setLogOpen(false);
          setNotice(`Sessione registrata: ${formatMinutes(session.actualMinutes ?? 0)}.`);
        }}
      />
    </div>
  );
}

/**
 * Ripasso attivo: un argomento alla volta, lo studente prova a ricordarlo (domande guida) e
 * valuta quanto ricordava. La valutazione decide quando ripresentarlo (vedi lib/review.ts).
 */
function ReviewPanel({
  due,
  totalTopics,
  subjects,
  onRate,
  onManage
}: {
  due: StudyTopic[];
  totalTopics: number;
  subjects: Subject[];
  onRate: (id: string, rating: ReviewRating) => void;
  onManage: () => void;
}) {
  const [focusId, setFocusId] = useUiState<string | null>("study.reviewFocus", null, { scope: "tab", validate: isNullableString });
  const [revealed, setRevealed] = useUiState("study.reviewRevealed", false, { scope: "tab" });
  const current = due.find((topic) => topic.id === focusId) ?? due[0];
  const rest = due.filter((topic) => topic.id !== current?.id);

  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-black">Ripasso attivo</h3>
          <p className="text-xs font-bold text-[var(--muted)]">
            {due.length ? `${due.length} ${due.length === 1 ? "argomento" : "argomenti"} da ripassare oggi` : `${totalTopics} ${totalTopics === 1 ? "argomento" : "argomenti"} in programma`}
          </p>
        </div>
        <Button variant="soft" icon="Brain" onClick={onManage}>
          Argomenti
        </Button>
      </div>

      {current ? (
        <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-soft)] p-3.5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: subjectColor(subjects, current.subjectId) }} />
            <div className="min-w-0 flex-1">
              <p className="two-line-safe text-base font-black leading-snug">{current.title}</p>
              <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
                {subjectName(subjects, current.subjectId)} · {current.completedReviews ? `ripasso n. ${current.completedReviews + 1}` : "primo ripasso"}
                {reviewDueLabel(current.nextReviewDate).startsWith("in ritardo") ? <span className="text-[var(--danger-text)]"> · {reviewDueLabel(current.nextReviewDate)}</span> : null}
              </p>
            </div>
          </div>

          {current.questions.length ? (
            revealed ? (
              <ol className="mt-3 grid grid-cols-1 gap-1 pl-4 text-sm font-bold text-[var(--muted)] [list-style:decimal]">
                {current.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
            ) : (
              <button type="button" onClick={() => setRevealed(true)} className="mt-3 text-xs font-black text-[var(--accent-ink)]">
                Mostra le {current.questions.length} domande guida
              </button>
            )
          ) : (
            <p className="mt-3 text-xs font-bold text-[var(--muted)]">Ripeti l'argomento a voce o per iscritto senza guardare gli appunti, poi valuta quanto ricordavi.</p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {REVIEW_RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => {
                  setRevealed(false);
                  setFocusId(null);
                  onRate(current.id, rating);
                }}
                className={`grid min-h-12 place-items-center rounded-[16px] px-2 text-center text-xs font-black ${
                  rating === "good" ? "bg-[var(--accent)] text-[#10131d]" : rating === "again" ? "bg-[var(--danger-bg)] text-[var(--danger-text)]" : "bg-[var(--surface-strong)]"
                }`}
              >
                <span>{REVIEW_RATING_LABEL[rating]}</span>
                <span className="text-[10px] font-bold opacity-75">{previewInterval(current, rating)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          {totalTopics
            ? "Nessun ripasso in scadenza oggi."
            : "Aggiungi gli argomenti che vuoi fissare (o importa il programma di un esame): StudyOS te li ripropone a intervalli crescenti."}
        </p>
      )}

      {rest.length ? (
        <ul className="mt-2 grid grid-cols-1 gap-0.5">
          {rest.slice(0, 6).map((topic) => (
            <li key={topic.id}>
              <button
                type="button"
                onClick={() => {
                  setRevealed(false);
                  setFocusId(topic.id);
                }}
                className="flex w-full min-w-0 items-center gap-2 rounded-[14px] px-2 py-1.5 text-left hover:bg-[var(--surface-soft)]"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(subjects, topic.subjectId) }} />
                <span className="one-line-safe min-w-0 flex-1 text-sm font-bold">{topic.title}</span>
                <span className="shrink-0 text-[11px] font-bold text-[var(--muted)]">{subjectName(subjects, topic.subjectId).split(" ")[0]}</span>
              </button>
            </li>
          ))}
          {rest.length > 6 ? <li className="px-2 text-xs font-bold text-[var(--faint)]">e altri {rest.length - 6}</li> : null}
        </ul>
      ) : null}
    </Panel>
  );
}

/** Registra una sessione fatta senza timer (biblioteca, lezione, studio di gruppo). */
function ManualSessionDrawer({
  open,
  subjects,
  defaultSubjectId,
  onClose,
  onSave
}: {
  open: boolean;
  subjects: Subject[];
  defaultSubjectId: string;
  onClose: () => void;
  onSave: (session: Partial<StudySession> & Pick<StudySession, "title">) => Promise<void>;
}) {
  const initial = () => ({ subjectId: defaultSubjectId, template: "new-topic" as StudySession["template"], date: format(new Date(), "yyyy-MM-dd"), time: format(new Date(Date.now() - 60 * 60_000), "HH:mm"), minutes: "60", title: "" });
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(initial());
      setError("");
    }
  }

  const save = async () => {
    const minutes = Math.round(Number(draft.minutes.replace(",", ".")));
    const start = new Date(`${draft.date}T${draft.time || "09:00"}`);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 16 * 60) return setError("Durata non valida (da 1 minuto a 16 ore).");
    if (Number.isNaN(start.getTime())) return setError("Data o ora non valida.");
    if (start.getTime() > Date.now()) return setError("La sessione non può iniziare nel futuro.");
    await onSave({
      title: draft.title.trim() || `${SESSION_TEMPLATE_LABEL[draft.template]}${draft.subjectId ? ` · ${subjectName(subjects, draft.subjectId)}` : ""}`,
      subjectId: draft.subjectId || undefined,
      template: draft.template,
      plannedMinutes: minutes,
      actualMinutes: minutes,
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60_000).toISOString(),
      status: "completed",
      focusLevel: 3
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Studio"
      title="Registra una sessione"
      width="max-w-[480px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()}>
            Registra
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <Field label="Materia">
          <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
            <option value="">Nessuna</option>
            {selectableSubjects(subjects, draft.subjectId).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo">
          <select className={inputClass} value={draft.template} onChange={(event) => setDraft((value) => ({ ...value, template: event.target.value as StudySession["template"] }))}>
            {TEMPLATES.map((id) => (
              <option key={id} value={id}>
                {SESSION_TEMPLATE_LABEL[id]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Giorno">
            <input className={inputClass} type="date" value={draft.date} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} />
          </Field>
          <Field label="Inizio">
            <input className={inputClass} type="time" value={draft.time} onChange={(event) => setDraft((value) => ({ ...value, time: event.target.value }))} />
          </Field>
          <Field label="Minuti">
            <input className={inputClass} inputMode="numeric" value={draft.minutes} onChange={(event) => setDraft((value) => ({ ...value, minutes: event.target.value }))} />
          </Field>
        </div>
        <Field label="Titolo (opzionale)">
          <input className={inputClass} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Es. Ripasso in biblioteca" />
        </Field>
        {error ? <p className="text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
      </div>
    </Drawer>
  );
}
