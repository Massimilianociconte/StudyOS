import { useEffect, useId, useMemo, useRef, useState } from "react";
import { selectableSubjects } from "../lib/selectors";
import { addHours } from "date-fns";
import { AnimatePresence, m } from "framer-motion";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, IconButton, Pill, fileInputClass, inputClass, useBackCloses, useDialogLayer } from "./ui";
import { Icon } from "./Icon";
import { UnsavedPrompt } from "./UnsavedPrompt";
import { DateTimeField } from "./DatePicker";
import { fromDatetimeLocal } from "../lib/dates";
import { quickAddDefaults, quickAddTaskDates, type QuickAddTaskCreate } from "../lib/quickAdd";
import { FILE_TEXT, QUICK_ADD_TEXT, REPEAT_PICKER_TEXT, UI_TEXT, type QuickAddSaved } from "../lib/labels";
import { FILE_ACCEPT } from "../lib/attachments";
import { normalizeExternalUrl } from "../lib/safeUrl";
import { deviceTimeZone, isCivilDate } from "../lib/tz";
import { repeatPresets, type RepeatPresetId } from "../lib/repeatPresets";
import { describeRule } from "../lib/repeat";

type Mode = "task" | "event" | "session" | "subject" | "material";
export type QuickAddMode = Mode;
type TaskCreateMode = QuickAddTaskCreate;

// `hint`: una frase che dice cosa si sta creando, mostrata sotto i tipi.
const modes: { id: Mode; label: string; icon: string; hint: string }[] = [
  { id: "task", label: "Attività", icon: "Check", hint: "Una cosa da fare entro una data: un esercizio, una consegna, un capitolo." },
  { id: "event", label: "Evento", icon: "CalendarDays", hint: "Un impegno con data e ora: lezione, ricevimento, appuntamento." },
  { id: "session", label: "Studio pianificato", icon: "Timer", hint: "Tempo che ti riservi per studiare, segnato nel calendario." },
  { id: "subject", label: "Materia", icon: "BookOpen", hint: "Un corso che stai seguendo. Potrai aggiungere CFU e docente dopo." },
  { id: "material", label: "Materiale", icon: "Paperclip", hint: "Un link o un file (PDF, slide, appunti) da ritrovare in fretta." }
];

/** Ripetizioni pronte dell'aggiunta veloce (le altre, e la fine, dal modulo completo nel Calendario). */
const QUICK_REPEATS: readonly RepeatPresetId[] = ["none", "daily", "weekly", "monthlyDay", "yearly", "workdays"];

/** Scelte pronte per l'inizio "YYYY-MM-DDTHH:mm": giorni scritti (vedi repeatPresets); senza data, solo "non si ripete". */
const quickRepeats = (start: string) => {
  const day = start.slice(0, 10);
  if (!isCivilDate(day)) return [{ id: "none" as const, label: describeRule(null), rule: null }];
  return repeatPresets(day).filter((preset) => QUICK_REPEATS.includes(preset.id));
};

const titleField: Record<Mode, { label: string; placeholder: string }> = {
  task: { label: "Cosa devi fare?", placeholder: "Es. Ripassare il capitolo 3 di Patologia" },
  event: { label: "Nome dell'evento", placeholder: "Es. Lezione di Anatomia" },
  session: { label: "Cosa studierai?", placeholder: "Es. Esercizi di Biostatistica" },
  subject: { label: "Nome della materia", placeholder: "Es. Farmacologia speciale" },
  material: { label: "Nome (facoltativo)", placeholder: "Es. Slide lezione 4" }
};

export function QuickAddModal({
  open,
  onClose,
  onSaved,
  initialMode = "task"
}: {
  open: boolean;
  onClose: () => void;
  /** Dopo un salvataggio riuscito: la frase che dice cosa si è creato e dove (la mostra chi apre il modale). */
  onSaved?: (text: string) => void;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  // Prima: new Date().toISOString() -> ora UTC mostrata come locale (eventi creati 1-2h prima).
  const [date, setDate] = useState(() => quickAddDefaults().start);
  // Scadenza dell'attività separata dall'inizio di eventi e studio: parte vuota (senza scadenza).
  const [taskDue, setTaskDue] = useState(() => quickAddDefaults().taskDue);
  const [url, setUrl] = useState("");
  const [taskCreateMode, setTaskCreateMode] = useState<TaskCreateMode>("normal");
  const [estimatedMinutes, setEstimatedMinutes] = useState("45");
  const [actualMinutes, setActualMinutes] = useState("");
  const [repeatId, setRepeatId] = useState<RepeatPresetId>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Chiusura in attesa della risposta a «Scartare le modifiche?».
  const [asking, setAsking] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Esc, tocco fuori e Indietro con un nome o un link scritti chiedono prima di perderli; ✕ e «Annulla» chiudono e basta.
  const dirty = Boolean(title.trim() || url.trim());
  const requestClose = () => {
    if (busy) return false;
    if (dirty) {
      setAsking(true);
      return false;
    }
    onClose();
    return true;
  };
  // Pagina bloccata sotto, Tab che resta qui, Esc solo se è la finestra in cima, focus che torna a chi l'ha aperta.
  useDialogLayer(open, { panelRef, onEscape: requestClose });
  // Indietro (Android, gesto di iOS, browser) chiude il modale come un Drawer, invece di uscire dall'app.
  useBackCloses(open, requestClose);
  const repeats = useMemo(() => quickRepeats(date), [date]);
  const { subjects, addTask, addEvent, addSubject, addAttachment, addExternalAttachment } = useStudyStore();

  // Il modale resta montato: a ogni apertura la data proposta torna "adesso" e il tipo è quello richiesto.
  // Riparte anche vuoto: chiuso con Annulla, ✕ o Esc, prima teneva titolo e «Inizio ora» della volta prima.
  useEffect(() => {
    if (open) {
      reset();
      const defaults = quickAddDefaults();
      setDate(defaults.start);
      setTaskDue(defaults.taskDue);
      setMode(initialMode);
      setRepeatId("none");
      setError("");
      setAsking(false);
    }
  }, [open, initialMode]);

  const submitLabel = useMemo(() => {
    if (mode === "task") {
      if (taskCreateMode === "timer") return "Crea e avvia il cronometro";
      if (taskCreateMode === "completed") return "Salva come fatta";
      return "Crea attività";
    }
    if (mode === "event") return "Aggiungi al calendario";
    if (mode === "session") return "Aggiungi al calendario";
    if (mode === "subject") return "Crea materia";
    return "Salva link";
  }, [mode, taskCreateMode]);
  const currentMode = modes.find((item) => item.id === mode) ?? modes[0];
  const canSubmit = !busy && (mode === "material" ? Boolean(url.trim()) : Boolean(title.trim()));

  const reset = () => {
    setTitle("");
    setSubjectId("");
    setUrl("");
    setEstimatedMinutes("45");
    setActualMinutes("");
    setTaskCreateMode("normal");
    setTaskDue(quickAddDefaults().taskDue);
    setRepeatId("none");
  };

  const submit = async () => {
    if (!title.trim() && mode !== "material") return;
    if (mode === "material" && !url.trim()) {
      setError("Inserisci un link o scegli un file.");
      return;
    }
    // Attività: scadenza facoltativa (campo vuoto = senza scadenza); eventi e studio: inizio obbligatorio.
    const taskDates = quickAddTaskDates(mode === "task" ? taskDue : "", taskCreateMode);
    const start = mode === "task" ? "" : fromDatetimeLocal(date) ?? (mode === "subject" || mode === "material" ? new Date().toISOString() : null);
    if (start === null || !taskDates) {
      setError("Data o ora non valida: controlla il campo e riprova.");
      return;
    }
    // Regola dell'inizio scelto (giorno della settimana e del mese di quella data).
    const repeat = mode === "event" || mode === "session" ? quickRepeats(date).find((preset) => preset.id === repeatId)?.rule ?? null : null;
    setBusy(true);
    setError("");
    setAsking(false);
    const saved: QuickAddSaved =
      mode === "task"
        ? taskCreateMode === "timer"
          ? "taskTimer"
          : taskCreateMode === "completed"
            ? "taskDone"
            : "task"
        : mode === "material"
          ? "link"
          : mode;
    const savedTitle = mode === "material" ? title.trim() || "Link rapido" : title.trim();
    try {
      if (mode === "task") {
        const now = new Date().toISOString();
        const parsedEstimatedMinutes = Math.max(0, Number(estimatedMinutes) || 0);
        const parsedActualMinutes = actualMinutes.trim() ? Math.max(0, Number(actualMinutes) || 0) : undefined;
        await addTask({
          title: title.trim(),
          subjectId: subjectId || undefined,
          dueDate: taskDates.dueDate,
          priority: "medium",
          status: taskCreateMode === "timer" ? "doing" : taskCreateMode === "completed" ? "done" : "todo",
          estimatedMinutes: parsedEstimatedMinutes,
          actualMinutes: taskCreateMode === "timer" ? 0 : parsedActualMinutes,
          completedAt: taskDates.completedAt,
          timerAccumulatedSeconds:
            taskCreateMode === "timer" ? 0 : parsedActualMinutes !== undefined ? Math.round(parsedActualMinutes * 60) : undefined,
          timerStartedAt: taskCreateMode === "timer" ? now : undefined,
          timerLastReminderAt: taskCreateMode === "timer" ? now : undefined
        });
      }
      if (mode === "event") {
        await addEvent({
          title: title.trim(),
          subjectId: subjectId || undefined,
          start,
          end: addHours(new Date(start), 1).toISOString(),
          category: "other",
          color: subjectId ? subjects.find((subject) => subject.id === subjectId)?.color : undefined,
          timeZone: deviceTimeZone(),
          ...(repeat ? { repeat } : {})
        });
      }
      if (mode === "session") {
        // Prima creava una sessione "pianificata" che nessuna vista mostrava: ora è un blocco di
        // studio nel calendario (le sessioni svolte si registrano dal timer o a mano in Studio).
        await addEvent({
          title: title.trim(),
          subjectId: subjectId || undefined,
          start,
          end: new Date(new Date(start).getTime() + 50 * 60_000).toISOString(),
          category: "study",
          color: subjectId ? subjects.find((subject) => subject.id === subjectId)?.color : undefined,
          timeZone: deviceTimeZone(),
          ...(repeat ? { repeat } : {})
        });
      }
      if (mode === "subject") {
        await addSubject({ name: title.trim(), color: "#7CF7C8" });
      }
      if (mode === "material" && url.trim()) {
        const safe = normalizeExternalUrl(url);
        if (!safe) throw new Error("Questo link non funziona: copia l'indirizzo completo, che inizia con https://");
        await addExternalAttachment(safe, title.trim() || "Link rapido");
      }
      reset();
      onClose();
      onSaved?.(QUICK_ADD_TEXT.saved(saved, savedTitle));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Non è stato possibile salvare. Riprova tra un momento.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <m.div
          className="fixed inset-0 z-50 grid grid-cols-1 place-items-end bg-black/40 p-3 backdrop-blur-sm sm:place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          // Tocco sullo sfondo come nei Drawer; il focus resta dov'è se si chiede «Scartare le modifiche?».
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            requestClose();
          }}
        >
          <m.div
            ref={panelRef}
            tabIndex={-1}
            className="soft-panel scrollbar-soft max-h-[85dvh] w-full max-w-xl overflow-y-auto p-4 outline-none sm:p-5"
            initial={{ y: 30, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 30, scale: 0.98 }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-2xl font-black">Cosa vuoi aggiungere?</h2>
                <p className="text-sm text-[var(--muted)]">Scegli il tipo, scrivi il nome e salva. I dettagli puoi aggiungerli dopo.</p>
              </div>
              <IconButton icon="X" label="Chiudi senza salvare" onClick={onClose} />
            </div>

            {/* Pulsanti alti 44 px (tocco comodo) con la pillola compatta dentro: tra le righe niente spazio in più. */}
            <div className="mb-2 flex flex-wrap gap-x-2" role="group" aria-label="Tipo di elemento da aggiungere">
              {modes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  aria-pressed={mode === item.id}
                  title={item.hint}
                  className="inline-flex min-h-11 max-w-full items-center rounded-full"
                >
                  <Pill active={mode === item.id}>
                    <Icon name={item.icon} className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </Pill>
                </button>
              ))}
            </div>
            <p className="mb-4 text-xs font-bold text-[var(--muted)]" aria-live="polite">
              {currentMode.hint}
            </p>

            <form
              className="grid grid-cols-1 gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) void submit();
              }}
            >
              {mode === "task" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Quando la fai?">
                  {([
                    { id: "normal", label: "Da fare", hint: "Più avanti", icon: "Check" },
                    { id: "timer", label: "Inizio ora", hint: "Parte il timer", icon: "Timer" },
                    { id: "completed", label: "Già fatta", hint: "Salvata come fatta", icon: "Archive" }
                  ] as const).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTaskCreateMode(item.id)}
                      aria-pressed={taskCreateMode === item.id}
                      className={`motion-safe flex min-h-14 items-center gap-3 rounded-[22px] border p-3 text-left ${
                        taskCreateMode === item.id
                          ? "border-transparent bg-[var(--accent)] text-[#10131d]"
                          : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      <span className="grid grid-cols-1 h-9 w-9 shrink-0 place-items-center rounded-full bg-black/10">
                        <Icon name={item.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="one-line-safe block text-sm font-black">{item.label}</span>
                        <span className="one-line-safe block text-xs font-bold opacity-70">{item.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mode === "material" ? (
                <Field label="Indirizzo del link">
                  {/* type="text": un link senza «https://» lo completa normalizeExternalUrl, senza il fumetto del browser. */}
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-autofocus={mode === "material" ? true : undefined}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Es. https://ariel.unimi.it/…"
                  />
                </Field>
              ) : null}

              <Field label={titleField[mode].label}>
                <input
                  className={inputClass}
                  data-autofocus={mode !== "material" ? true : undefined}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={titleField[mode].placeholder}
                />
              </Field>

              {mode !== "subject" && mode !== "material" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Selettore a calendario (al posto di datetime-local); vuoto = attività senza scadenza. */}
                  <DateTimeField
                    label={mode === "task" ? (taskCreateMode === "completed" ? "Quando l'hai fatta" : UI_TEXT.dueOptional) : "Quando inizia?"}
                    value={mode === "task" ? taskDue : date}
                    onChange={mode === "task" ? setTaskDue : setDate}
                    optional={mode === "task"}
                    defaultTime={mode === "task" ? "18:00" : undefined}
                  />
                  <Field label="Materia (facoltativa)">
                    <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                      <option value="">Nessuna materia</option>
                      {selectableSubjects(subjects, subjectId).map((subject) => (
                        <option value={subject.id} key={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}

              {mode === "event" || mode === "session" ? (
                <>
                  <Field label={REPEAT_PICKER_TEXT.label}>
                    <select className={inputClass} value={repeatId} onChange={(event) => setRepeatId(event.target.value as RepeatPresetId)}>
                      {repeats.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="-mt-1 text-xs font-bold text-[var(--muted)]">
                    {mode === "event" ? "Dura un'ora" : "Dura 50 minuti"}. {REPEAT_PICKER_TEXT.quickMore}
                  </p>
                </>
              ) : null}

              {mode === "task" ? (
                <div className={`grid grid-cols-1 gap-3 ${taskCreateMode === "completed" ? "sm:grid-cols-2" : ""}`}>
                  <Field label="Quanto pensi di metterci? (minuti)">
                    <input
                      className={inputClass}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={5}
                      value={estimatedMinutes}
                      onChange={(event) => setEstimatedMinutes(event.target.value)}
                    />
                  </Field>
                  {/* Il tempo impiegato serve solo per le attività già fatte: il cronometro lo misura da sé. */}
                  {taskCreateMode === "completed" ? (
                    <Field label="Quanto ci hai messo? (minuti)">
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={5}
                        value={actualMinutes}
                        onChange={(event) => setActualMinutes(event.target.value)}
                        placeholder="Es. 75"
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}

              {mode === "material" ? (
                <div className="grid grid-cols-1 gap-3">
                  <Field label="Oppure carica un file dal dispositivo">
                    <input
                      className={fileInputClass}
                      type="file"
                      accept={FILE_ACCEPT}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setBusy(true);
                        setError("");
                        try {
                          await addAttachment(file);
                          reset();
                          onClose();
                          onSaved?.(QUICK_ADD_TEXT.saved("file", file.name));
                        } catch (fileError) {
                          setError(fileError instanceof Error ? fileError.message : "Non è stato possibile caricare il file. Riprova o scegline un altro.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </Field>
                  <p className="-mt-1 px-1 text-xs font-bold text-[var(--muted)]">{FILE_TEXT.limitHint}</p>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
                  {error}
                </p>
              ) : null}

              {asking ? (
                // Come nei Drawer di modifica: la domanda sul posto, al posto dei pulsanti.
                <UnsavedPrompt
                  title={QUICK_ADD_TEXT.unsavedTitle}
                  text={QUICK_ADD_TEXT.unsavedText}
                  keep={QUICK_ADD_TEXT.unsavedKeep}
                  discard={QUICK_ADD_TEXT.unsavedDiscard}
                  className="mt-2 bg-[var(--surface-soft)]"
                  onKeep={() => setAsking(false)}
                  onDiscard={() => {
                    setAsking(false);
                    onClose();
                  }}
                />
              ) : (
                <div className="mt-2 flex justify-end gap-2">
                  <Button onClick={onClose}>Annulla</Button>
                  <Button variant="primary" icon="Plus" type="submit" disabled={!canSubmit}>
                    {submitLabel}
                  </Button>
                </div>
              )}
            </form>
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
