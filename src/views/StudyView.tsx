import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { StudySession, StudyTopic, Subject, TimerSettings } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, studyMinutesThisWeek, studyStreak, subjectColor, subjectName } from "../lib/selectors";
import {
  SESSION_FORM_TEXT,
  SESSION_TEMPLATE_LABEL,
  TIMER_KIND_LABEL,
  TIMER_PHASE_LABEL,
  TIMER_TEXT,
  capitalizeFirst,
  formatHours,
  formatMinutes
} from "../lib/labels";
import { STUDY_SIDE_TEXT, TIMER_SETTINGS_TEXT } from "../lib/labels/study";
import { REVIEW_RATINGS, REVIEW_RATING_LABEL, dueTopics, previewInterval, type ReviewRating } from "../lib/review";
import { Button, Drawer, Field, HelpTip, IconButton, Panel, ProgressBar, SectionTitle, Segmented, StatTile, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { TopicManager, reviewDueLabel } from "../components/TopicManager";
import { ManualSessionDrawer, useSessionEditor } from "../components/StudySessionDrawers";
import { ShareButton } from "../components/ShareButton";
import { SharedSection } from "../components/SharedSection";
import { useNow } from "../hooks/useNow";
import { isNullableString, oneOf, readUiState, useUiState } from "../lib/uiState";
import { requestSettingsSection } from "../lib/settingsJump";
import {
  TIMER_KINDS,
  formatTimerClock,
  isCountdownOver,
  isTimerIdle,
  timerElapsedSeconds,
  timerRemainingSeconds,
  timerUnsavedSeconds,
  type TimerKind,
  type TimerState
} from "../lib/studyTimer";
import {
  FOCUS_QUICK_PICKS,
  TIMER_LIMITS,
  TIMER_QUICK_PICKS,
  TIMER_SETTING_KEYS,
  changedTimerSettings,
  cleanTimerSettings,
  parseHoursMinutes,
  parseTimerInput,
  resolveTimerDurations,
  splitMinutes,
  type TimerSettingKey
} from "../lib/timerPrefs";
import { UNDO_MS, matchTopic, sessionSourceLabel, topicsOfSubject } from "../lib/studySessions";
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

const pillClass = (active: boolean) =>
  `min-h-11 rounded-full px-3 text-xs font-black ${
    active ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--text)]"
  }`;

const linkClass = "font-black text-[var(--accent-ink)] underline-offset-2 hover:underline";
/** Collegamento nel testo (riga da 16 px): l'area di tocco arriva a 44 px senza allargare la riga. */
const linkHit = `${linkClass} relative after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']`;
/** Righe "… · Cambia" una sotto l'altra: aree estese si sovrapporrebbero, quindi pulsante alto 44 px nella riga. */
const linkBox = `${linkClass} inline-flex min-h-11 items-center px-1`;
const linkRow = "flex flex-wrap items-center gap-x-1 text-xs font-bold text-[var(--muted)]";

/** Icona di ogni modalità (selettore, anello, elenco delle sessioni). */
const KIND_ICON: Record<TimerKind, string> = { pomodoro: "Timer", timer: "Hourglass", stopwatch: "Clock" };

export function StudyView() {
  const store = useStudyStore();
  const { sessions, topics, subjects, reviewTopic, setActiveView } = store;
  const weeklyTarget = selectPreferences(store).weeklyTargetMinutes;
  const [topicsOpen, setTopicsOpen] = useUiState("study.topicsOpen", false, { scope: "tab" });
  // Materia degli argomenti nel riquadro: "" tutte. null quando lo apre un collegamento da un'altra
  // sezione (es. "argomenti" della scheda d'esame): vale la materia scritta in "study.subject",
  // letta qui prima che un timer già avviato la sostituisca con la sua.
  const [topicsFilter, setTopicsFilter] = useUiState<string | null>("study.topicsFilter", null, { scope: "tab", validate: isNullableString });
  const [linkedSubject] = useState(() => {
    const value = readUiState("study.subject", "device");
    return typeof value === "string" ? value : "";
  });
  useEffect(() => {
    if (topicsOpen && topicsFilter === null) setTopicsFilter(linkedSubject);
  }, [topicsOpen, topicsFilter, linkedSubject, setTopicsFilter]);
  const openTopics = (subjectId = "") => {
    setTopicsFilter(subjectId);
    setTopicsOpen(true);
  };
  const closeTopics = () => {
    setTopicsOpen(false);
    setTopicsFilter(null);
  };
  const [logOpen, setLogOpen] = useUiState("study.logOpen", false, { scope: "tab" });
  const [notice, setNotice] = useState("");
  const sessionEditor = useSessionEditor();

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
              onManage={() => openTopics()}
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
                    <li key={session.id}>
                      {/* Tocca la sessione per correggerla o eliminarla (con Annulla). */}
                      <button
                        type="button"
                        onClick={() => sessionEditor.edit(session.id)}
                        className="flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 text-left hover:bg-[var(--surface-soft)]"
                      >
                        <span className="grid grid-cols-1 h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${subjectColor(subjects, session.subjectId)} 30%, transparent)` }}>
                          <Icon name={session.source === "timer" || session.source === "stopwatch" ? KIND_ICON[session.source] : "Timer"} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="one-line-safe block text-sm font-extrabold">{session.title}</span>
                          <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                            {capitalizeFirst(format(parseISO(session.start), "EEE d MMM · HH:mm", { locale: it }))} · {SESSION_TEMPLATE_LABEL[session.template]}
                            {session.source !== "manual" && sessionSourceLabel(session.source) ? ` · ${sessionSourceLabel(session.source)}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-black tabular-nums">{formatMinutes(session.actualMinutes || session.plannedMinutes)}</span>
                        <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                  Ancora nessuna sessione. Qui trovi lo studio salvato con il timer o aggiunto con «Aggiungi studio fatto».
                </p>
              )}
              {sessionEditor.undoNotice ? <div className="mt-2 px-2">{sessionEditor.undoNotice}</div> : null}
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
              className={`mt-2 text-xs ${linkHit}`}
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
              <button
                type="button"
                onClick={() => openTopics()}
                className="relative text-xs font-black text-[var(--muted)] after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] hover:text-[var(--text)]"
              >
                {STUDY_SIDE_TEXT.seeAll}
              </button>
            </div>
            {upcomingReviews.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {upcomingReviews.map((topic) => (
                  <li key={topic.id}>
                    <button
                      type="button"
                      onClick={() => openTopics(topic.subjectId)}
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

      <Drawer open={topicsOpen} onClose={closeTopics} eyebrow="Ripasso" title="Argomenti da ripassare" width="max-w-[560px]">
        <p className="mb-3 text-sm text-[var(--muted)]">Ti ricordiamo quando ripassare ogni argomento: all'inizio spesso, poi sempre più di rado man mano che lo ricordi.</p>
        <TopicManager subjects={subjects} filter={topicsFilter ?? linkedSubject} onFilterChange={setTopicsFilter} />
      </Drawer>

      <ManualSessionDrawer
        open={logOpen}
        defaultSubjectId={lastSubjectId && subjects.some((subject) => subject.id === lastSubjectId) ? lastSubjectId : ""}
        onClose={() => setLogOpen(false)}
        onSaved={(minutes) => {
          setLogOpen(false);
          setNotice(SESSION_FORM_TEXT.added(formatMinutes(minutes)));
        }}
      />
      {sessionEditor.drawer}

      <SharedSection entityTypes={["studySession", "studyTopic"]} />
    </div>
  );
}

/**
 * Timer di studio: Pomodoro (blocchi e pause, ogni blocco finito si salva da solo), Timer (conto
 * alla rovescia con la durata scelta) o Cronometro. Lo stato vero è nello store (persistito e
 * condiviso tra schede); qui si ridisegna ogni secondo solo questo pannello. Su telefono anello e
 * tempo stanno affiancati e "Avvia" subito sotto: materia e "Cosa studi?" vengono dopo.
 */
function TimerPanel({ notice, setNotice }: { notice: string; setNotice: (text: string) => void }) {
  const {
    timer,
    subjects,
    topics,
    preferences,
    toggleStudyTimer,
    finishStudyTimer,
    endStudyTimer,
    resetStudyTimer,
    restoreStudyTimer,
    skipBreak,
    setTimerKind,
    setTimerSubject,
    setTimerDetails,
    saveTimerSettings,
    setTimerReviewOpen,
    setActiveView
  } = useStudyStore(
    useShallow((state) => ({
      timer: state.timer,
      subjects: state.subjects,
      topics: state.topics,
      preferences: selectPreferences(state),
      toggleStudyTimer: state.toggleStudyTimer,
      finishStudyTimer: state.finishStudyTimer,
      endStudyTimer: state.endStudyTimer,
      setTimerReviewOpen: state.setTimerReviewOpen,
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
  const [templateOpen, setTemplateOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState({ hours: "", minutes: "", error: "" });
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
    const details: { title?: string; template?: StudySession["template"]; topicId?: string | null } = {};
    if (current.title === undefined && savedTitle) {
      details.title = savedTitle;
      details.topicId = matchTopic(savedTitle, state.topics, wanted)?.id ?? null;
    }
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
  const subjectTopics = topicsOfSubject(topics, subjectId);
  const durations = resolveTimerDurations(subject?.timer, preferences.timer);
  const stopwatch = timer.kind === "stopwatch";
  const countdown = timer.kind === "timer";
  const studying = timer.phase === "focus";
  const idle = isTimerIdle(timer, now);
  const ended = timer.ended === true;
  const over = isCountdownOver(timer);
  const elapsed = timerElapsedSeconds(timer, now);
  const unsaved = timerUnsavedSeconds(timer, now);
  // Da fermo si mostrano le durate attuali (cambiano con materia e impostazioni).
  const phaseSeconds = idle && countdown ? durations.timerMinutes * 60 : idle && !stopwatch && timer.mode === "pomodoro" ? durations.focusMinutes * 60 : timer.durationSeconds;
  const remaining = idle && !stopwatch ? phaseSeconds : timerRemainingSeconds(timer, now);
  const target = stopwatch ? (idle ? (durations.stopwatchTargetMinutes ?? 0) * 60 : timer.durationSeconds) : 0;
  const clock = formatTimerClock(stopwatch ? elapsed : remaining);
  const progress = stopwatch ? (target ? elapsed / target : (elapsed % 3600) / 3600) : phaseSeconds ? (phaseSeconds - remaining) / phaseSeconds : 0;
  const studied = formatMinutes(Math.floor(unsaved / 60));
  const title = timer.title ?? "";
  const template = timer.template ?? savedTemplate;
  const linkedTopic = timer.topicId ? subjectTopics.find((topic) => topic.id === timer.topicId) : undefined;

  const phaseLine = stopwatch
    ? TIMER_KIND_LABEL.stopwatch
    : countdown
      ? TIMER_TEXT.timerPhase(formatMinutes(phaseSeconds / 60))
      : studying
        ? `${TIMER_PHASE_LABEL.focus} · ${TIMER_TEXT.blockOf(Math.min(timer.cycle + 1, durations.longBreakEvery), durations.longBreakEvery)}`
        : TIMER_PHASE_LABEL[timer.phase];
  const status = idle
    ? TIMER_TEXT.idle[timer.kind]
    : ended
      ? over
        ? TIMER_TEXT.timerEnded(studied)
        : TIMER_TEXT.stoppedToSave(studied)
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
    setCustomOpen(false);
    setTimerKind(kind);
    setSavedKind(kind);
  };

  const chooseSubject = (id: string) => {
    setTimerSubject(id || null);
    setSavedSubjectId(id);
    // Lo stesso testo può essere un argomento della nuova materia.
    if (title.trim()) setTimerDetails({ topicId: matchTopic(title, topics, id)?.id ?? null });
  };

  const writeWhat = (value: string) => {
    setTimerDetails({ title: value, topicId: matchTopic(value, topics, subjectId)?.id ?? null });
    setSavedTitle(value);
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

  const onEnd = () => {
    clearMessages();
    if (endStudyTimer().status === "too-short") setNotice(TIMER_TEXT.tooShort);
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
    // Non azzerato (un'altra scheda era più avanti): niente "Scartata" né "Annulla".
    if (!resetStudyTimer()) return;
    // Da un minuto in su si può tornare indietro.
    if (lost >= 60) setUndo({ previous, studied: formatMinutes(Math.floor(lost / 60)) });
  };

  // Ogni materia ricorda solo i valori cambiati: gli altri continuano a seguire le durate generali.
  const saveDuration = (key: "focusMinutes" | "timerMinutes", minutes: number) => {
    void saveTimerSettings(
      subject ? { subjectId: subject.id, subject: { ...subject.timer, [key]: minutes } } : { defaults: { ...preferences.timer, [key]: minutes } }
    );
  };

  const openCustom = () => {
    if (customOpen) {
      setCustomOpen(false);
      return;
    }
    const parts = splitMinutes(durations.timerMinutes);
    setCustom({ hours: String(parts.hours), minutes: String(parts.minutes), error: "" });
    setCustomOpen(true);
  };

  const applyCustom = () => {
    const parsed = parseHoursMinutes(custom.hours, custom.minutes);
    if (parsed.invalid || parsed.value === undefined) {
      setCustom((value) => ({ ...value, error: TIMER_TEXT.customInvalid }));
      return;
    }
    saveDuration("timerMinutes", parsed.value);
    setCustomOpen(false);
  };

  const ringIcon = stopwatch ? "Clock" : countdown ? "Hourglass" : studying ? "Timer" : "Coffee";
  const ringColor = studying ? "var(--accent)" : "var(--accent-2)";
  const customFocus = !FOCUS_QUICK_PICKS.some((minutes) => minutes === durations.focusMinutes);
  const customTimer = !TIMER_QUICK_PICKS.some((minutes) => minutes === durations.timerMinutes);
  const canDiscard = !idle && studying;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        {/* Senza icone le tre modalità stanno in riga anche a 375 px: l'icona è nell'anello. */}
        <Segmented
          label={TIMER_TEXT.kindAria}
          size="sm"
          value={timer.kind}
          onChange={chooseKind}
          options={TIMER_KINDS.map((kind) => ({ id: kind, label: TIMER_KIND_LABEL[kind] }))}
        />
        <IconButton icon="Settings" label={TIMER_TEXT.settings} onClick={() => setSettingsOpen(true)} className="h-10 w-10 shrink-0" />
      </div>

      <div className="mt-4 grid grid-cols-[84px_minmax(0,1fr)] items-center gap-4 min-[420px]:grid-cols-[112px_minmax(0,1fr)] md:grid-cols-[168px_minmax(0,1fr)] md:gap-6">
        <TimerRing value={progress} icon={ringIcon} color={ringColor} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <p className="one-line-safe text-xs font-black uppercase text-[var(--faint)]">{phaseLine}</p>
            <HelpTip title={TIMER_TEXT.kindHelp.title} text={TIMER_TEXT.kindHelp.text} example={TIMER_TEXT.kindHelp.example} />
          </div>
          <p className={`${clock.length > 5 ? "text-4xl" : "text-5xl"} mt-0.5 font-black leading-none tabular-nums sm:text-6xl`}>{clock}</p>
          <p className="safe-text mt-1.5 text-xs font-bold text-[var(--muted)]">{status}</p>
          {targetLine ? <p className="safe-text mt-0.5 text-xs font-black text-[var(--accent-ink)]">{targetLine}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {ended ? (
          <>
            <Button variant="primary" icon="Check" onClick={() => setTimerReviewOpen(true)} className="min-w-[120px]">
              {TIMER_TEXT.saveEnded}
            </Button>
            {!over ? (
              <Button variant="soft" icon="Zap" onClick={onPrimary}>
                {TIMER_TEXT.resume}
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant={timer.running ? "soft" : "primary"} icon={timer.running ? "Pause" : "Zap"} onClick={onPrimary} className="min-w-[120px]">
            {timer.running ? TIMER_TEXT.pause : idle ? TIMER_TEXT.start : TIMER_TEXT.resume}
          </Button>
        )}
        {/* Pomodoro: salva subito (come i blocchi). Timer e Cronometro: prima il riepilogo. */}
        {!idle && !ended && studying && timer.kind === "pomodoro" ? (
          <Button variant="soft" icon="Check" onClick={onFinish} disabled={unsaved < 60} title={unsaved < 60 ? TIMER_TEXT.finishHint : undefined}>
            {TIMER_TEXT.finish}
          </Button>
        ) : null}
        {!idle && !ended && timer.kind !== "pomodoro" ? (
          <Button variant="soft" icon="Check" onClick={onEnd} disabled={unsaved < 60} title={unsaved < 60 ? TIMER_TEXT.finishHint : undefined}>
            {countdown ? TIMER_TEXT.endEarly : TIMER_TEXT.end}
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
        {canDiscard ? (
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)} title={TIMER_TEXT.discardHint} aria-expanded={confirmDiscard}>
            {TIMER_TEXT.discard}
          </Button>
        ) : null}
      </div>

      {confirmDiscard && canDiscard ? (
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
            className={`${linkClass} inline-flex min-h-11 items-center px-1`}
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
              <button type="button" className={linkHit} onClick={() => setActiveView("subjects")}>
                {TIMER_TEXT.addSubjects}
              </button>
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
            <label htmlFor="study-what" className="text-xs font-black uppercase text-[var(--faint)]">
              {TIMER_TEXT.whatField}
            </label>
            {linkedTopic ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-black text-[var(--accent-ink)]" title={TIMER_TEXT.whatTopic}>
                <Icon name="Brain" className="h-3.5 w-3.5 shrink-0" />
                <span className="one-line-safe">{TIMER_TEXT.whatTopic}</span>
              </span>
            ) : null}
          </div>
          <input
            id="study-what"
            className={inputClass}
            list={subjectTopics.length ? "study-what-topics" : undefined}
            value={title}
            maxLength={160}
            autoComplete="off"
            onChange={(event) => writeWhat(event.target.value)}
            placeholder={TIMER_TEXT.whatPlaceholder}
          />
          {subjectTopics.length ? (
            <datalist id="study-what-topics">
              {subjectTopics.map((topic) => (
                <option key={topic.id} value={topic.title} />
              ))}
            </datalist>
          ) : null}
        </div>
      </div>

      {stopwatch ? (
        <p className={`mt-3 ${linkRow}`}>
          <span className="safe-text min-w-0">{durations.stopwatchTargetMinutes ? TIMER_TEXT.target(formatMinutes(durations.stopwatchTargetMinutes)) : TIMER_TEXT.noTarget} ·</span>
          <button type="button" className={linkBox} onClick={() => setSettingsOpen(true)}>
            {TIMER_TEXT.change}
          </button>
        </p>
      ) : countdown ? (
        idle ? (
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">
              {subject ? TIMER_TEXT.timerDurationFor(subject.name) : TIMER_TEXT.timerDurationDefault}
            </span>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={TIMER_TEXT.timerQuick}>
              {TIMER_QUICK_PICKS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={durations.timerMinutes === minutes}
                  onClick={() => {
                    setCustomOpen(false);
                    saveDuration("timerMinutes", minutes);
                  }}
                  className={pillClass(durations.timerMinutes === minutes)}
                >
                  {formatMinutes(minutes)}
                </button>
              ))}
              <button type="button" aria-pressed={customTimer} aria-expanded={customOpen} onClick={openCustom} className={pillClass(customTimer)}>
                {customTimer ? formatMinutes(durations.timerMinutes) : TIMER_TEXT.otherDuration}
              </button>
            </div>
            {customOpen ? (
              <form
                className="mt-2 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyCustom();
                }}
              >
                <label className="grid w-20 grid-cols-1 gap-1 text-xs font-black uppercase text-[var(--faint)]">
                  {TIMER_TEXT.hoursField}
                  <input className={inputClass} inputMode="numeric" value={custom.hours} onChange={(event) => setCustom((value) => ({ ...value, hours: event.target.value, error: "" }))} />
                </label>
                <label className="grid w-20 grid-cols-1 gap-1 text-xs font-black uppercase text-[var(--faint)]">
                  {TIMER_TEXT.minutesField}
                  <input className={inputClass} inputMode="numeric" value={custom.minutes} onChange={(event) => setCustom((value) => ({ ...value, minutes: event.target.value, error: "" }))} />
                </label>
                <Button type="submit" variant="soft" icon="Check">
                  {TIMER_TEXT.customApply}
                </Button>
                {custom.error ? (
                  <p role="alert" className="basis-full text-xs font-bold text-[var(--danger-text)]">
                    {custom.error}
                  </p>
                ) : null}
              </form>
            ) : null}
          </div>
        ) : null
      ) : (
        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">
            {subject ? TIMER_TEXT.durationsFor(subject.name) : TIMER_TEXT.defaultDurations}
          </span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={TIMER_TEXT.focusQuick}>
            {FOCUS_QUICK_PICKS.map((minutes) => (
              <button key={minutes} type="button" aria-pressed={durations.focusMinutes === minutes} onClick={() => saveDuration("focusMinutes", minutes)} className={pillClass(durations.focusMinutes === minutes)}>
                {TIMER_TEXT.minutes(minutes)}
              </button>
            ))}
            <button type="button" aria-pressed={customFocus} onClick={() => setSettingsOpen(true)} className={pillClass(customFocus)}>
              {customFocus ? TIMER_TEXT.minutes(durations.focusMinutes) : TIMER_TEXT.otherDuration}
            </button>
          </div>
          <p className={`mt-0.5 ${linkRow}`}>
            <span className="safe-text min-w-0">{TIMER_TEXT.breaksSummary(durations.shortBreakMinutes, durations.longBreakMinutes, durations.longBreakEvery)} ·</span>
            <button type="button" className={linkBox} onClick={() => setSettingsOpen(true)}>
              {TIMER_TEXT.change}
            </button>
          </p>
        </div>
      )}

      <p className={linkRow}>
        <span className="safe-text min-w-0">{TIMER_TEXT.templateLine(SESSION_TEMPLATE_LABEL[template])} ·</span>
        <button type="button" className={linkBox} onClick={() => setTemplateOpen(true)}>
          {TIMER_TEXT.change}
        </button>
      </p>

      <TimerSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} subject={subject} defaults={preferences.timer} onSave={saveTimerSettings} />

      <Drawer
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        eyebrow={TIMER_SETTINGS_TEXT.eyebrow}
        title={TIMER_TEXT.templateField}
        width="max-w-[480px]"
        footer={
          <div className="flex justify-end">
            <Button variant="primary" icon="Check" onClick={() => setTemplateOpen(false)}>
              {TIMER_TEXT.detailsDone}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3">
          <p className="text-sm text-[var(--muted)]">{TIMER_TEXT.templateHelp.text}</p>
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
  stopwatchTargetMinutes: TIMER_SETTINGS_TEXT.target,
  timerMinutes: TIMER_SETTINGS_TEXT.timer
};
/** Campi del modulo "Impostazioni timer" (la durata del Timer si sceglie nel pannello). */
const FORM_KEYS = TIMER_SETTING_KEYS.filter((key) => key !== "timerMinutes");

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
    for (const key of FORM_KEYS) {
      const parsed = parseTimerInput(key, draft[key]);
      if (parsed.invalid || (parsed.empty && key !== "stopwatchTargetMinutes")) {
        const [min, max] = TIMER_LIMITS[key];
        setError(TIMER_SETTINGS_TEXT.invalid(SETTING_LABEL[key], min, max));
        return;
      }
      if (parsed.value !== undefined) values[key] = parsed.value;
    }
    // La durata del Timer si sceglie dal pannello: il modulo non la tocca.
    const shown = resolveTimerDurations(subject?.timer, defaults);
    values.timerMinutes = shown.timerMinutes;
    if (!subject) await onSave({ defaults: changedTimerSettings(values, shown, defaults) ?? null });
    // Le stesse durate per tutte: la materia ricorda solo la sua durata del Timer.
    else if (alsoDefaults)
      await onSave({
        subjectId: subject.id,
        subject: subject.timer?.timerMinutes ? { timerMinutes: subject.timer.timerMinutes } : null,
        defaults: cleanTimerSettings({ ...values, timerMinutes: defaults?.timerMinutes }) ?? null
      });
    // Per la materia restano solo i valori cambiati: gli altri seguono le durate generali.
    else await onSave({ subjectId: subject.id, subject: changedTimerSettings(values, shown, subject.timer) ?? null });
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
