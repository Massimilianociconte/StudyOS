import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { StudySession, StudyTopic, Subject, TimerSettings } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, studyMinutesThisWeek, studyStreak, subjectColor, subjectName } from "../lib/selectors";
import {
  SESSION_SOURCE_LABEL,
  SESSION_TEMPLATE_LABEL,
  STUDY_SIDE_TEXT,
  TIMER_KIND_LABEL,
  TIMER_PHASE_LABEL,
  TIMER_SETTINGS_TEXT,
  TIMER_TEXT,
  capitalizeFirst,
  formatHours,
  formatMinutes
} from "../lib/labels";
import { REVIEW_RATINGS, REVIEW_RATING_LABEL, dueTopics, previewInterval, type ReviewRating } from "../lib/review";
import { Button, Drawer, Field, HelpTip, IconButton, Panel, ProgressBar, SectionTitle, Segmented, StatTile, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { TopicManager, reviewDueLabel } from "../components/TopicManager";
import { ShareButton } from "../components/ShareButton";
import { SharedSection } from "../components/SharedSection";
import { useNow } from "../hooks/useNow";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { requestSettingsSection } from "../lib/settingsJump";
import {
  TIMER_KINDS,
  formatTimerClock,
  isTimerIdle,
  timerElapsedSeconds,
  timerRemainingSeconds,
  timerUnsavedSeconds,
  type TimerKind,
  type TimerState
} from "../lib/studyTimer";
import { FOCUS_QUICK_PICKS, TIMER_LIMITS, TIMER_SETTING_KEYS, parseTimerInput, resolveTimerDurations, type TimerSettingKey } from "../lib/timerPrefs";
import {
  TIMER_SOUND_KEY,
  TIMER_VIBRATE_KEY,
  canVibrate,
  primeTimerSound,
  requestSystemNotifications,
  systemNotificationState,
  type SystemNotificationState
} from "../lib/timerAlerts";

const TEMPLATES = Object.keys(SESSION_TEMPLATE_LABEL) as StudySession["template"][];
/** Quanto resta visibile "Annulla" dopo aver scartato una sessione. */
const UNDO_MS = 15_000;

const pillClass = (active: boolean) =>
  `min-h-9 rounded-full px-3 text-xs font-black ${
    active ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--text)]"
  }`;

const linkClass = "font-black text-[var(--accent-ink)] underline-offset-2 hover:underline";

export function StudyView() {
  const store = useStudyStore();
  const { sessions, topics, subjects, addSession, deleteSession, reviewTopic, setActiveView } = store;
  const weeklyTarget = selectPreferences(store).weeklyTargetMinutes;
  const [topicsOpen, setTopicsOpen] = useUiState("study.topicsOpen", false, { scope: "tab" });
  const [logOpen, setLogOpen] = useUiState("study.logOpen", false, { scope: "tab" });
  const [notice, setNotice] = useState("");

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
  const lastSubjectId = useStudyStore((state) => state.timer.subjectId);

  return (
    <div>
      <SectionTitle
        title="Studio"
        subtitle="Cronometra lo studio, tieni il conto delle ore e ripassa ogni argomento al momento giusto."
        action={<ShareButton scopes={["study"]} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid grid-cols-1 min-w-0 content-start gap-4">
          <TimerPanel notice={notice} setNotice={setNotice} />

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
                  <p className="text-xs font-bold text-[var(--muted)]">{todayMinutes ? `Oggi hai studiato ${formatMinutes(todayMinutes)}` : "Oggi non hai ancora studiato"}</p>
                </div>
                <Button variant="soft" icon="Plus" onClick={() => setLogOpen(true)} title="Per lo studio fatto senza timer: biblioteca, lezione, gruppo">
                  Aggiungi studio fatto
                </Button>
              </div>
              {history.length ? (
                <ul className="grid grid-cols-1 gap-1">
                  {history.map((session) => (
                    <li key={session.id} className="group flex min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 hover:bg-[var(--surface-soft)]">
                      <span className="grid grid-cols-1 h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${subjectColor(subjects, session.subjectId)} 30%, transparent)` }}>
                        <Icon name={session.source === "stopwatch" ? "Clock" : "Timer"} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="one-line-safe text-sm font-extrabold">{session.title}</p>
                        <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
                          {capitalizeFirst(format(parseISO(session.start), "EEE d MMM · HH:mm", { locale: it }))} · {SESSION_TEMPLATE_LABEL[session.template]}
                          {session.source && session.source !== "manual" ? ` · ${SESSION_SOURCE_LABEL[session.source]}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-black tabular-nums">{formatMinutes(session.actualMinutes || session.plannedMinutes)}</span>
                      <IconButton
                        icon="Trash2"
                        label={`Elimina la sessione "${session.title}"`}
                        className="h-8 w-8 bg-transparent text-[var(--danger-text)] transition-opacity hover:bg-[var(--danger-bg)] can-hover:opacity-0 can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100"
                        onClick={() => {
                          if (window.confirm(`Eliminare la sessione "${session.title}" (${formatMinutes(session.actualMinutes)})? Le ore verranno tolte dalle statistiche. L'operazione non si può annullare.`)) void deleteSession(session.id);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                  Ancora nessuna sessione. Qui trovi lo studio salvato con il timer o aggiunto con «Aggiungi studio fatto».
                </p>
              )}
            </Panel>
          </div>
        </div>

        <aside className="grid grid-cols-1 content-start gap-4">
          <Panel>
            <StatTile
              label={STUDY_SIDE_TEXT.week}
              value={`${formatHours(weeklyMinutes)} h`}
              hint={STUDY_SIDE_TEXT.weekHint(formatHours(weeklyTarget), streak)}
              icon="BarChart3"
              onClick={() => setActiveView("stats")}
            />
            <div className="mt-3">
              <ProgressBar value={(weeklyMinutes / weeklyTarget) * 100} label={STUDY_SIDE_TEXT.weekProgress} />
            </div>
            <button
              type="button"
              className={`mt-2 text-xs ${linkClass}`}
              onClick={() => {
                requestSettingsSection("profilo");
                setActiveView("settings");
              }}
            >
              {STUDY_SIDE_TEXT.changeTarget}
            </button>
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-black">{STUDY_SIDE_TEXT.upcoming}</h3>
              <button type="button" onClick={() => setTopicsOpen(true)} className="text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
                {STUDY_SIDE_TEXT.seeAll}
              </button>
            </div>
            {upcomingReviews.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {upcomingReviews.map((topic) => (
                  <li key={topic.id}>
                    <button
                      type="button"
                      onClick={() => setTopicsOpen(true)}
                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-[14px] px-2 py-1.5 text-left hover:bg-[var(--surface-soft)]"
                    >
                      <span className="min-w-0">
                        <span className="one-line-safe block text-sm font-black">{topic.title}</span>
                        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{subjectName(subjects, topic.subjectId)}</span>
                      </span>
                      <Tag className="shrink-0">{capitalizeFirst(reviewDueLabel(topic.nextReviewDate))}</Tag>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">{topics.some((topic) => !topic.archived) ? STUDY_SIDE_TEXT.noUpcoming : STUDY_SIDE_TEXT.upcomingEmpty}</p>
            )}
          </Panel>
        </aside>
      </div>

      <Drawer open={topicsOpen} onClose={() => setTopicsOpen(false)} eyebrow="Ripasso" title="Argomenti da ripassare" width="max-w-[560px]">
        <p className="mb-3 text-sm text-[var(--muted)]">Ti ricordiamo quando ripassare ogni argomento: all'inizio spesso, poi sempre più di rado man mano che lo ricordi.</p>
        <TopicManager subjects={subjects} />
      </Drawer>

      <ManualSessionDrawer
        open={logOpen}
        subjects={subjects}
        defaultSubjectId={lastSubjectId && subjects.some((subject) => subject.id === lastSubjectId) ? lastSubjectId : ""}
        onClose={() => setLogOpen(false)}
        onSave={async (session) => {
          await addSession(session);
          setLogOpen(false);
          setNotice(`Studio aggiunto: ${formatMinutes(session.actualMinutes ?? 0)}.`);
        }}
      />

      <SharedSection entityTypes={["studySession", "studyTopic"]} />
    </div>
  );
}

/**
 * Timer di studio: Pomodoro (blocchi e pause, ogni blocco finito si salva da solo) o Cronometro.
 * Lo stato vero è nello store (persistito e condiviso tra schede); qui si ridisegna ogni secondo
 * solo questo pannello. Su telefono anello e tempo stanno affiancati e "Avvia" subito sotto.
 */
function TimerPanel({ notice, setNotice }: { notice: string; setNotice: (text: string) => void }) {
  const {
    timer,
    subjects,
    preferences,
    toggleStudyTimer,
    finishStudyTimer,
    resetStudyTimer,
    restoreStudyTimer,
    skipBreak,
    setTimerKind,
    setTimerSubject,
    setTimerDetails,
    saveTimerSettings,
    setActiveView
  } = useStudyStore(
    useShallow((state) => ({
      timer: state.timer,
      subjects: state.subjects,
      preferences: selectPreferences(state),
      toggleStudyTimer: state.toggleStudyTimer,
      finishStudyTimer: state.finishStudyTimer,
      resetStudyTimer: state.resetStudyTimer,
      restoreStudyTimer: state.restoreStudyTimer,
      skipBreak: state.skipBreak,
      setTimerKind: state.setTimerKind,
      setTimerSubject: state.setTimerSubject,
      setTimerDetails: state.setTimerDetails,
      saveTimerSettings: state.saveTimerSettings,
      setActiveView: state.setActiveView
    }))
  );
  // Il timer è basato su timestamp: qui serve solo ridisegnare ogni secondo.
  const now = useNow(1000, timer.running).getTime();
  const [settingsOpen, setSettingsOpen] = useUiState("study.timerSettingsOpen", false, { scope: "tab" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [undo, setUndo] = useState<{ previous: TimerState; studied: string } | null>(null);
  // Chiavi di sempre: ricordano le scelte e permettono ad altre sezioni di aprire Studio su una materia.
  const [savedSubjectId, setSavedSubjectId] = useUiState("study.subject", () => selectableSubjects(subjects)[0]?.id ?? "");
  const [savedTitle, setSavedTitle] = useUiState("study.title", "", { scope: "tab" });
  const [savedTemplate, setSavedTemplate] = useUiState<StudySession["template"]>("study.template", "new-topic", { validate: oneOf(...TEMPLATES) });
  const [savedKind, setSavedKind] = useUiState<TimerKind>("study.timerKind", timer.kind, { validate: oneOf(...TIMER_KINDS) });

  // All'apertura un timer fermo prende modalità, materia e dettagli ricordati (anche la materia
  // scritta da un'altra sezione in "study.subject"); un timer già avviato vince e aggiorna i ricordi.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const state = useStudyStore.getState();
    const current = state.timer;
    if (!isTimerIdle(current)) {
      setSavedKind(current.kind);
      setSavedSubjectId(current.subjectId ?? "");
      return;
    }
    if (savedKind !== current.kind) state.setTimerKind(savedKind);
    const wanted = savedSubjectId && state.subjects.some((subject) => subject.id === savedSubjectId) ? savedSubjectId : "";
    if (wanted !== (current.subjectId ?? "")) state.setTimerSubject(wanted || null);
    const details: { title?: string; template?: StudySession["template"] } = {};
    if (current.title === undefined && savedTitle) details.title = savedTitle;
    if (current.template === undefined) details.template = savedTemplate;
    if (details.title !== undefined || details.template !== undefined) state.setTimerDetails(details);
    // Solo all'apertura: dopo, la fonte è il timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!undo) return undefined;
    const id = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [undo]);

  const subjectId = timer.subjectId && subjects.some((subject) => subject.id === timer.subjectId) ? timer.subjectId : "";
  const subject = subjects.find((item) => item.id === subjectId);
  const durations = resolveTimerDurations(subject?.timer, preferences.timer);
  const stopwatch = timer.kind === "stopwatch";
  const studying = timer.phase === "focus";
  const idle = isTimerIdle(timer, now);
  const elapsed = timerElapsedSeconds(timer, now);
  const unsaved = timerUnsavedSeconds(timer, now);
  // Da fermo si mostrano le durate attuali (cambiano con materia e impostazioni).
  const phaseSeconds = idle && !stopwatch && timer.mode === "pomodoro" ? durations.focusMinutes * 60 : timer.durationSeconds;
  const remaining = idle && !stopwatch ? phaseSeconds : timerRemainingSeconds(timer, now);
  const target = stopwatch ? (idle ? (durations.stopwatchTargetMinutes ?? 0) * 60 : timer.durationSeconds) : 0;
  const clock = formatTimerClock(stopwatch ? elapsed : remaining);
  const progress = stopwatch ? (target ? elapsed / target : (elapsed % 3600) / 3600) : phaseSeconds ? (phaseSeconds - remaining) / phaseSeconds : 0;
  const studied = formatMinutes(Math.floor(unsaved / 60));
  const title = timer.title ?? "";
  const template = timer.template ?? savedTemplate;

  const phaseLine = stopwatch
    ? TIMER_KIND_LABEL.stopwatch
    : studying
      ? `${TIMER_PHASE_LABEL.focus} · ${TIMER_TEXT.blockOf(Math.min(timer.cycle + 1, durations.longBreakEvery), durations.longBreakEvery)}`
      : TIMER_PHASE_LABEL[timer.phase];
  const status = idle
    ? TIMER_TEXT.idle[timer.kind]
    : !studying
      ? timer.running
        ? TIMER_TEXT.onBreak
        : TIMER_TEXT.breakPaused
      : timer.running
        ? TIMER_TEXT.running(studied)
        : TIMER_TEXT.paused(studied);
  // Da fermo l'obiettivo è già nella riga sotto la materia.
  const targetLine = target && !idle ? (elapsed >= target ? TIMER_TEXT.targetReached(formatMinutes(target / 60)) : TIMER_TEXT.target(formatMinutes(target / 60))) : "";

  const clearMessages = () => {
    setNotice("");
    setUndo(null);
    setConfirmDiscard(false);
  };

  const chooseKind = (kind: TimerKind) => {
    if (kind === timer.kind) return;
    // Meno di un minuto non si può salvare: si cambia senza chiedere. Oltre, prima si decide.
    if (timerUnsavedSeconds(timer, Date.now()) >= 60) {
      setNotice(TIMER_TEXT.switchBlocked);
      return;
    }
    clearMessages();
    setTimerKind(kind);
    setSavedKind(kind);
  };

  const chooseSubject = (id: string) => {
    setTimerSubject(id || null);
    setSavedSubjectId(id);
  };

  const onPrimary = () => {
    primeTimerSound();
    clearMessages();
    toggleStudyTimer();
  };

  const onFinish = () => {
    clearMessages();
    const result = finishStudyTimer();
    if (result.status === "saved") setNotice(TIMER_TEXT.saved(formatMinutes(result.session.actualMinutes)));
    else if (result.status === "too-short") setNotice(TIMER_TEXT.tooShort);
    else if (result.status === "ended") setNotice(TIMER_TEXT.cycleEnded);
  };

  const onSkip = () => {
    primeTimerSound();
    clearMessages();
    skipBreak();
  };

  const discard = () => {
    const previous = useStudyStore.getState().timer;
    const lost = timerUnsavedSeconds(previous, Date.now());
    clearMessages();
    resetStudyTimer();
    // Da un minuto in su si può tornare indietro.
    if (lost >= 60) setUndo({ previous, studied: formatMinutes(Math.floor(lost / 60)) });
  };

  const pickFocus = (minutes: number) => {
    void saveTimerSettings(
      subject ? { subjectId: subject.id, subject: { ...subject.timer, focusMinutes: minutes } } : { defaults: { ...preferences.timer, focusMinutes: minutes } }
    );
  };

  const ringIcon = stopwatch ? "Clock" : studying ? "Timer" : "Coffee";
  const ringColor = studying ? "var(--accent)" : "var(--accent-2)";
  const customFocus = !FOCUS_QUICK_PICKS.some((minutes) => minutes === durations.focusMinutes);

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Segmented
            label={TIMER_TEXT.kindAria}
            size="sm"
            value={timer.kind}
            onChange={chooseKind}
            options={TIMER_KINDS.map((kind) => ({ id: kind, label: TIMER_KIND_LABEL[kind], icon: kind === "pomodoro" ? "Timer" : "Clock" }))}
          />
          <HelpTip title={TIMER_TEXT.kindHelp.title} text={TIMER_TEXT.kindHelp.text} example={TIMER_TEXT.kindHelp.example} />
        </div>
        <IconButton icon="Settings" label={TIMER_TEXT.settings} onClick={() => setSettingsOpen(true)} className="h-10 w-10" />
      </div>

      <div className="mt-4 grid grid-cols-[84px_minmax(0,1fr)] items-center gap-4 min-[420px]:grid-cols-[112px_minmax(0,1fr)] md:grid-cols-[168px_minmax(0,1fr)] md:gap-6">
        <TimerRing value={progress} icon={ringIcon} color={ringColor} />
        <div className="min-w-0">
          <p className="one-line-safe text-xs font-black uppercase text-[var(--faint)]">{phaseLine}</p>
          <p className={`${clock.length > 5 ? "text-4xl" : "text-5xl"} mt-0.5 font-black leading-none tabular-nums sm:text-6xl`}>{clock}</p>
          <p className="safe-text mt-1.5 text-xs font-bold text-[var(--muted)]">{status}</p>
          {targetLine ? <p className="safe-text mt-0.5 text-xs font-black text-[var(--accent-ink)]">{targetLine}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={timer.running ? "soft" : "primary"} icon={timer.running ? "Pause" : "Zap"} onClick={onPrimary} className="min-w-[120px]">
          {timer.running ? TIMER_TEXT.pause : idle ? TIMER_TEXT.start : TIMER_TEXT.resume}
        </Button>
        {!idle && studying ? (
          <Button variant="soft" icon="Check" onClick={onFinish} disabled={unsaved < 60} title={unsaved < 60 ? TIMER_TEXT.finishHint : undefined}>
            {TIMER_TEXT.finish}
          </Button>
        ) : null}
        {!studying ? (
          <Button variant="soft" icon="SkipForward" onClick={onSkip}>
            {TIMER_TEXT.skipBreak}
          </Button>
        ) : null}
        {!studying ? (
          <Button variant="ghost" onClick={onFinish}>
            {TIMER_TEXT.endCycle}
          </Button>
        ) : null}
        {!idle && studying ? (
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)} title={TIMER_TEXT.discardHint} aria-expanded={confirmDiscard}>
            {TIMER_TEXT.discard}
          </Button>
        ) : null}
      </div>

      {confirmDiscard && !idle && studying ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="safe-text min-w-[12rem] flex-1 text-sm font-bold">{unsaved >= 60 ? TIMER_TEXT.discardConfirm(studied) : TIMER_TEXT.discardConfirmShort}</p>
          <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
            {TIMER_TEXT.discardNo}
          </Button>
          <Button variant="danger" icon="Trash2" onClick={discard}>
            {TIMER_TEXT.discardYes}
          </Button>
        </div>
      ) : null}
      {undo ? (
        <div role="status" className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--muted)]">
          <span>{TIMER_TEXT.discarded(undo.studied)}</span>
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              // Non si torna indietro se nel frattempo è partita un'altra sessione.
              if (!restoreStudyTimer(undo.previous)) setNotice(TIMER_TEXT.switchBlocked);
              setUndo(null);
            }}
          >
            {TIMER_TEXT.undo}
          </button>
        </div>
      ) : notice ? (
        <p role="status" className="mt-2 text-sm font-bold text-[var(--muted)]">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Field label={TIMER_TEXT.subject}>
            <select className={inputClass} value={subjectId} onChange={(event) => chooseSubject(event.target.value)}>
              <option value="">{TIMER_TEXT.noSubject}</option>
              {selectableSubjects(subjects, subjectId).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          {!selectableSubjects(subjects).length ? (
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">
              {TIMER_TEXT.noSubjectsYet}{" "}
              <button type="button" className={linkClass} onClick={() => setActiveView("subjects")}>
                {TIMER_TEXT.addSubjects}
              </button>
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{TIMER_TEXT.details}</span>
          <button type="button" onClick={() => setDetailsOpen(true)} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
            <span className="one-line-safe min-w-0">{TIMER_TEXT.detailsSummary(title.trim(), SESSION_TEMPLATE_LABEL[template])}</span>
            <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          </button>
        </div>
      </div>

      {stopwatch ? (
        <p className="mt-3 text-xs font-bold text-[var(--muted)]">
          {durations.stopwatchTargetMinutes ? TIMER_TEXT.target(formatMinutes(durations.stopwatchTargetMinutes)) : TIMER_TEXT.noTarget} ·{" "}
          <button type="button" className={linkClass} onClick={() => setSettingsOpen(true)}>
            {TIMER_TEXT.change}
          </button>
        </p>
      ) : (
        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">
            {subject ? TIMER_TEXT.durationsFor(subject.name) : TIMER_TEXT.defaultDurations}
          </span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={TIMER_TEXT.focusQuick}>
            {FOCUS_QUICK_PICKS.map((minutes) => (
              <button key={minutes} type="button" aria-pressed={durations.focusMinutes === minutes} onClick={() => pickFocus(minutes)} className={pillClass(durations.focusMinutes === minutes)}>
                {TIMER_TEXT.minutes(minutes)}
              </button>
            ))}
            <button type="button" aria-pressed={customFocus} onClick={() => setSettingsOpen(true)} className={pillClass(customFocus)}>
              {customFocus ? TIMER_TEXT.minutes(durations.focusMinutes) : TIMER_TEXT.otherDuration}
            </button>
          </div>
          <p className="mt-1.5 text-xs font-bold text-[var(--muted)]">
            {TIMER_TEXT.breaksSummary(durations.shortBreakMinutes, durations.longBreakMinutes, durations.longBreakEvery)} ·{" "}
            <button type="button" className={linkClass} onClick={() => setSettingsOpen(true)}>
              {TIMER_TEXT.change}
            </button>
          </p>
        </div>
      )}

      <TimerSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} subject={subject} defaults={preferences.timer} onSave={saveTimerSettings} />

      <Drawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        eyebrow={TIMER_SETTINGS_TEXT.eyebrow}
        title={TIMER_TEXT.details}
        width="max-w-[480px]"
        footer={
          <div className="flex justify-end">
            <Button variant="primary" icon="Check" onClick={() => setDetailsOpen(false)}>
              {TIMER_TEXT.detailsDone}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          <Field label={TIMER_TEXT.titleField}>
            <input
              className={inputClass}
              value={title}
              onChange={(event) => {
                setTimerDetails({ title: event.target.value });
                setSavedTitle(event.target.value);
              }}
              placeholder={TIMER_TEXT.titlePlaceholder}
            />
          </Field>
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1">
              <span className="text-xs font-black uppercase text-[var(--faint)]">{TIMER_TEXT.templateField}</span>
              <HelpTip title={TIMER_TEXT.templateHelp.title} text={TIMER_TEXT.templateHelp.text} example={TIMER_TEXT.templateHelp.example} />
            </div>
            <select
              className={inputClass}
              aria-label={TIMER_TEXT.templateField}
              value={template}
              onChange={(event) => {
                const value = event.target.value as StudySession["template"];
                setTimerDetails({ template: value });
                setSavedTemplate(value);
              }}
            >
              {TEMPLATES.map((id) => (
                <option key={id} value={id}>
                  {SESSION_TEMPLATE_LABEL[id]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Drawer>
    </Panel>
  );
}

/** Anello di avanzamento con l'icona della fase (niente percentuali: il tempo è già accanto). */
function TimerRing({ value, icon, color }: { value: number; icon: string; color: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, value)));
  return (
    <div className="relative grid aspect-square w-full grid-cols-1 place-items-center rounded-full bg-[var(--surface-soft)]">
      <svg viewBox="0 0 108 108" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="54" cy="54" r={radius} fill="none" stroke="var(--surface-strong)" strokeWidth="10" />
        <m.circle
          cx="54"
          cy="54"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: offset, opacity: value > 0 ? 1 : 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </svg>
      <Icon name={icon} className="relative h-6 w-6 text-[var(--muted)] md:h-9 md:w-9" />
    </div>
  );
}

const SETTING_LABEL: Record<TimerSettingKey, string> = {
  focusMinutes: TIMER_SETTINGS_TEXT.focus,
  shortBreakMinutes: TIMER_SETTINGS_TEXT.shortBreak,
  longBreakMinutes: TIMER_SETTINGS_TEXT.longBreak,
  longBreakEvery: TIMER_SETTINGS_TEXT.longBreakEvery,
  stopwatchTargetMinutes: TIMER_SETTINGS_TEXT.target
};

type SaveTimerSettings = (change: { subjectId?: string | null; subject?: TimerSettings | null; defaults?: TimerSettings | null }) => Promise<void>;

/**
 * "Impostazioni timer": durate della materia scelta (o generali senza materia), avvisi del
 * dispositivo e, solo con un pulsante, le notifiche di sistema.
 */
function TimerSettingsDrawer({
  open,
  onClose,
  subject,
  defaults,
  onSave
}: {
  open: boolean;
  onClose: () => void;
  subject?: Subject;
  defaults?: TimerSettings;
  onSave: SaveTimerSettings;
}) {
  const initial = () => {
    const resolved = resolveTimerDurations(subject?.timer, defaults);
    return Object.fromEntries(TIMER_SETTING_KEYS.map((key) => [key, resolved[key] === undefined ? "" : String(resolved[key])])) as Record<TimerSettingKey, string>;
  };
  const [draft, setDraft] = useState(initial);
  const [alsoDefaults, setAlsoDefaults] = useState(false);
  const [error, setError] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(initial());
      setAlsoDefaults(false);
      setError("");
    }
  }
  const [sound, setSound] = useUiState(TIMER_SOUND_KEY, true);
  const [vibrate, setVibrate] = useUiState(TIMER_VIBRATE_KEY, true);
  const [permission, setPermission] = useState<SystemNotificationState>(() => systemNotificationState());

  const save = async () => {
    const values: TimerSettings = {};
    for (const key of TIMER_SETTING_KEYS) {
      const parsed = parseTimerInput(key, draft[key]);
      if (parsed.invalid || (parsed.empty && key !== "stopwatchTargetMinutes")) {
        const [min, max] = TIMER_LIMITS[key];
        setError(TIMER_SETTINGS_TEXT.invalid(SETTING_LABEL[key], min, max));
        return;
      }
      if (parsed.value !== undefined) values[key] = parsed.value;
    }
    if (!subject) await onSave({ defaults: values });
    else if (alsoDefaults) await onSave({ subjectId: subject.id, subject: null, defaults: values });
    else await onSave({ subjectId: subject.id, subject: values });
    onClose();
  };

  const field = (key: TimerSettingKey) => (
    <Field label={SETTING_LABEL[key]}>
      <input
        className={inputClass}
        inputMode="numeric"
        value={draft[key]}
        onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
        placeholder={`${TIMER_LIMITS[key][0]}–${TIMER_LIMITS[key][1]}`}
      />
    </Field>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={TIMER_SETTINGS_TEXT.eyebrow}
      title={TIMER_SETTINGS_TEXT.title}
      width="max-w-[520px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {TIMER_SETTINGS_TEXT.cancel}
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()}>
            {TIMER_SETTINGS_TEXT.save}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <p className="text-sm text-[var(--muted)]">{subject ? TIMER_SETTINGS_TEXT.forSubject(subject.name) : TIMER_SETTINGS_TEXT.forAll}</p>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          {field("focusMinutes")}
          {field("shortBreakMinutes")}
          {field("longBreakMinutes")}
          {field("longBreakEvery")}
        </div>
        <div>
          {field("stopwatchTargetMinutes")}
          <p className="mt-1 text-xs font-bold text-[var(--faint)]">{TIMER_SETTINGS_TEXT.targetHint}</p>
        </div>
        {subject ? (
          <label className="flex items-start gap-2 text-sm font-bold">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={alsoDefaults} onChange={(event) => setAlsoDefaults(event.target.checked)} />
            <span>{TIMER_SETTINGS_TEXT.alsoDefaults}</span>
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        {subject?.timer || (!subject && defaults) ? (
          <div>
            <Button
              variant="ghost"
              icon="RotateCcw"
              onClick={async () => {
                await onSave(subject ? { subjectId: subject.id, subject: null } : { defaults: null });
                onClose();
              }}
            >
              {subject ? TIMER_SETTINGS_TEXT.backToDefaults : TIMER_SETTINGS_TEXT.resetDefaults}
            </Button>
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-4">
          <h4 className="text-xs font-black uppercase text-[var(--faint)]">{TIMER_SETTINGS_TEXT.alerts}</h4>
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={sound} onChange={(event) => setSound(event.target.checked)} />
            {TIMER_SETTINGS_TEXT.sound}
          </label>
          {canVibrate() ? (
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={vibrate} onChange={(event) => setVibrate(event.target.checked)} />
              {TIMER_SETTINGS_TEXT.vibrate}
            </label>
          ) : null}
          <div className="mt-1 rounded-[18px] bg-[var(--surface-soft)] p-3">
            <p className="text-sm font-black">{TIMER_SETTINGS_TEXT.systemTitle}</p>
            <p className="text-xs font-bold text-[var(--muted)]">
              {permission === "granted"
                ? TIMER_SETTINGS_TEXT.systemOn
                : permission === "denied"
                  ? TIMER_SETTINGS_TEXT.systemBlocked
                  : permission === "unsupported"
                    ? TIMER_SETTINGS_TEXT.systemUnsupported
                    : TIMER_SETTINGS_TEXT.systemText}
            </p>
            {permission === "default" ? (
              <Button variant="soft" icon="Bell" className="mt-2" onClick={() => void requestSystemNotifications().then(setPermission)}>
                {TIMER_SETTINGS_TEXT.systemEnable}
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </Drawer>
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
          <h3 className="text-lg font-black">Ripasso</h3>
          <p className="text-xs font-bold text-[var(--muted)]">
            {due.length
              ? `${due.length} ${due.length === 1 ? "argomento" : "argomenti"} da ripassare oggi`
              : totalTopics
                ? `${totalTopics} ${totalTopics === 1 ? "argomento" : "argomenti"} in programma`
                : "Ti ricordiamo quando ripassare ogni argomento"}
          </p>
        </div>
        <Button variant="soft" icon={totalTopics ? "Brain" : "Plus"} onClick={onManage}>
          {totalTopics ? "Gestisci argomenti" : "Aggiungi argomenti"}
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
            <p className="mt-3 text-xs font-bold text-[var(--muted)]">Ripeti l'argomento a voce o per iscritto, senza guardare gli appunti.</p>
          )}

          <p className="mt-3 text-xs font-black text-[var(--text)]">Quanto ricordavi? Da questo dipende il prossimo ripasso.</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="Quanto ricordavi">
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
                <span className="text-[10px] font-bold opacity-75">tra {previewInterval(current, rating)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          {totalTopics
            ? "Nessun ripasso per oggi: i prossimi li trovi in «Prossimi ripassi»."
            : "Aggiungi gli argomenti che vuoi ricordare: te li riproponiamo al momento giusto, sempre più distanziati."}
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
          {rest.length > 6 ? <li className="px-2 text-xs font-bold text-[var(--faint)]">E altri {rest.length - 6}</li> : null}
        </ul>
      ) : null}
    </Panel>
  );
}

/** "Aggiungi studio fatto": registra una sessione fatta senza timer (biblioteca, lezione, studio di gruppo). */
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
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 16 * 60) return setError("Scrivi una durata tra 1 e 960 minuti (16 ore).");
    if (Number.isNaN(start.getTime())) return setError("Controlla il giorno e l'ora di inizio.");
    if (start.getTime() > Date.now()) return setError("L'ora di inizio è nel futuro: scegli un momento già passato.");
    await onSave({
      title: draft.title.trim() || `${SESSION_TEMPLATE_LABEL[draft.template]}${draft.subjectId ? ` · ${subjectName(subjects, draft.subjectId)}` : ""}`,
      subjectId: draft.subjectId || undefined,
      template: draft.template,
      plannedMinutes: minutes,
      actualMinutes: minutes,
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60_000).toISOString(),
      status: "completed",
      focusLevel: 3,
      source: "manual"
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Studio"
      title="Aggiungi studio fatto"
      width="max-w-[480px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()}>
            Salva sessione
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <p className="text-sm text-[var(--muted)]">Hai studiato senza timer, in biblioteca, a lezione o in gruppo? Aggiungilo qui: conterà nelle tue ore.</p>
        <Field label="Materia">
          <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
            <option value="">Nessuna materia</option>
            {selectableSubjects(subjects, draft.subjectId).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          <Field label="Giorno">
            <input className={inputClass} type="date" value={draft.date} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} />
          </Field>
          <Field label="Ora di inizio">
            <input className={inputClass} type="time" value={draft.time} onChange={(event) => setDraft((value) => ({ ...value, time: event.target.value }))} />
          </Field>
          <Field label="Durata (minuti)">
            <input className={inputClass} inputMode="numeric" placeholder="Es. 60" value={draft.minutes} onChange={(event) => setDraft((value) => ({ ...value, minutes: event.target.value }))} />
          </Field>
        </div>
        <Field label="Titolo (facoltativo)">
          <input className={inputClass} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Es. Ripasso in biblioteca" />
        </Field>
        <Field label="Tipo di sessione">
          <select className={inputClass} value={draft.template} onChange={(event) => setDraft((value) => ({ ...value, template: event.target.value as StudySession["template"] }))}>
            {TEMPLATES.map((id) => (
              <option key={id} value={id}>
                {SESSION_TEMPLATE_LABEL[id]}
              </option>
            ))}
          </select>
        </Field>
        {error ? (
          <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
