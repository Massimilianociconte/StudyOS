import { useEffect, useId, useMemo, useState } from "react";
import { selectableSubjects } from "../lib/selectors";
import { addHours } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, IconButton, Pill, fileInputClass, inputClass } from "./ui";
import { Icon } from "./Icon";
import { fromDatetimeLocal, nextHalfHour, toDatetimeLocal } from "../lib/dates";
import { normalizeExternalUrl } from "../lib/safeUrl";

type Mode = "task" | "event" | "session" | "subject" | "material";
type TaskCreateMode = "normal" | "timer" | "completed";

const modes: { id: Mode; label: string; title: string }[] = [
  { id: "task", label: "Task", title: "Task con scadenza, priorità e cronometro" },
  { id: "event", label: "Evento", title: "Evento nel calendario" },
  { id: "session", label: "Blocco studio", title: "Blocco di studio nel calendario" },
  { id: "subject", label: "Materia", title: "Nuova materia" },
  { id: "material", label: "Materiale", title: "Link o file nei materiali" }
];

export function QuickAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("task");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  // Prima: new Date().toISOString() -> ora UTC mostrata come locale (eventi creati 1-2h prima).
  const [date, setDate] = useState(() => toDatetimeLocal(nextHalfHour()));
  const [url, setUrl] = useState("");
  const [taskCreateMode, setTaskCreateMode] = useState<TaskCreateMode>("normal");
  const [estimatedMinutes, setEstimatedMinutes] = useState("45");
  const [actualMinutes, setActualMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const { subjects, addTask, addEvent, addSubject, addAttachment, addExternalAttachment } = useStudyStore();

  // Il modale resta montato: a ogni apertura la data proposta torna "adesso".
  useEffect(() => {
    if (open) {
      setDate(toDatetimeLocal(nextHalfHour()));
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submitLabel = useMemo(() => {
    if (mode === "task") {
      if (taskCreateMode === "timer") return "Crea e avvia";
      if (taskCreateMode === "completed") return "Registra completata";
      return "Crea task";
    }
    if (mode === "event") return "Crea evento";
    if (mode === "session") return "Pianifica nel calendario";
    if (mode === "subject") return "Crea materia";
    return "Salva materiale";
  }, [mode, taskCreateMode]);

  const reset = () => {
    setTitle("");
    setSubjectId("");
    setUrl("");
    setEstimatedMinutes("45");
    setActualMinutes("");
    setTaskCreateMode("normal");
  };

  const submit = async () => {
    if (!title.trim() && mode !== "material") return;
    if (mode === "material" && !url.trim()) {
      setError("Inserisci un link o scegli un file.");
      return;
    }
    const start = fromDatetimeLocal(date) ?? (mode === "subject" || mode === "material" ? new Date().toISOString() : null);
    if (!start) {
      setError("Data e ora non valide.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "task") {
        const now = new Date().toISOString();
        const parsedEstimatedMinutes = Math.max(0, Number(estimatedMinutes) || 0);
        const parsedActualMinutes = actualMinutes.trim() ? Math.max(0, Number(actualMinutes) || 0) : undefined;
        await addTask({
          title: title.trim(),
          subjectId: subjectId || undefined,
          dueDate: start,
          priority: "medium",
          status: taskCreateMode === "timer" ? "doing" : taskCreateMode === "completed" ? "done" : "todo",
          estimatedMinutes: parsedEstimatedMinutes,
          actualMinutes: taskCreateMode === "timer" ? 0 : parsedActualMinutes,
          completedAt: taskCreateMode === "completed" ? start : undefined,
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
          color: subjectId ? subjects.find((subject) => subject.id === subjectId)?.color : undefined
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
          color: subjectId ? subjects.find((subject) => subject.id === subjectId)?.color : undefined
        });
      }
      if (mode === "subject") {
        await addSubject({ name: title.trim(), color: "#7CF7C8" });
      }
      if (mode === "material" && url.trim()) {
        const safe = normalizeExternalUrl(url);
        if (!safe) throw new Error("Link non valido: usa un indirizzo http(s) completo.");
        await addExternalAttachment(safe, title.trim() || "Link rapido");
      }
      reset();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 backdrop-blur-sm sm:place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <motion.div
            className="soft-panel scrollbar-soft max-h-[85dvh] w-full max-w-xl overflow-y-auto p-4 sm:p-5"
            initial={{ y: 30, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 30, scale: 0.98 }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-2xl font-black">Aggiunta rapida</h2>
                <p className="text-sm text-[var(--muted)]">Crea un elemento senza lasciare la pagina.</p>
              </div>
              <IconButton icon="X" label="Chiudi" onClick={onClose} />
            </div>

            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Tipo di elemento">
              {modes.map((item) => (
                <button key={item.id} type="button" onClick={() => setMode(item.id)} aria-pressed={mode === item.id} title={item.title}>
                  <Pill active={mode === item.id}>{item.label}</Pill>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3">
              {mode === "task" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Tipo di task">
                  {([
                    { id: "normal", label: "Task normale", icon: "Check" },
                    { id: "timer", label: "Con cronometro", icon: "Timer" },
                    { id: "completed", label: "Già completata", icon: "Archive" }
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
                        <span className="one-line-safe block text-xs font-bold opacity-70">
                          {item.id === "timer" ? "Parte subito" : item.id === "completed" ? "Storico manuale" : "Da completare"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              <Field label={mode === "material" ? "Nome o titolo" : "Titolo"}>
                <input
                  className={inputClass}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Es. Ripasso orale economia"
                />
              </Field>

              {mode !== "subject" && mode !== "material" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Materia">
                    <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                      <option value="">Nessuna</option>
                      {selectableSubjects(subjects, subjectId).map((subject) => (
                        <option value={subject.id} key={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Data e ora">
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </Field>
                </div>
              ) : null}

              {mode === "task" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Durata stimata">
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      step={5}
                      value={estimatedMinutes}
                      onChange={(event) => setEstimatedMinutes(event.target.value)}
                    />
                  </Field>
                  <Field label="Durata effettiva">
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      step={5}
                      value={actualMinutes}
                      onChange={(event) => setActualMinutes(event.target.value)}
                      placeholder={taskCreateMode === "completed" ? "Es. 75" : "Opzionale"}
                    />
                  </Field>
                </div>
              ) : null}

              {mode === "material" ? (
                <div className="grid grid-cols-1 gap-3">
                  <Field label="Link esterno">
                    <input
                      className={inputClass}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                  <Field label="File locale">
                    <input
                      className={fileInputClass}
                      type="file"
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
                        } catch (fileError) {
                          setError(fileError instanceof Error ? fileError.message : "File non importato.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </Field>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
                  {error}
                </p>
              ) : null}

              <div className="mt-2 flex justify-end gap-2">
                <Button onClick={onClose}>Annulla</Button>
                <Button
                  variant="primary"
                  icon="Plus"
                  onClick={submit}
                  disabled={busy || (!title.trim() && mode !== "material") || (mode === "material" && !url.trim())}
                >
                  {submitLabel}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
