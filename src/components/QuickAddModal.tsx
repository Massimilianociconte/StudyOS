import { useMemo, useState } from "react";
import { addHours } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, IconButton, Pill, inputClass } from "./ui";
import { Icon } from "./Icon";

type Mode = "task" | "event" | "session" | "subject" | "material";
type TaskCreateMode = "normal" | "timer";

const modes: { id: Mode; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "event", label: "Evento" },
  { id: "session", label: "Sessione" },
  { id: "subject", label: "Materia" },
  { id: "material", label: "Materiale" }
];

export function QuickAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("task");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [url, setUrl] = useState("");
  const [taskCreateMode, setTaskCreateMode] = useState<TaskCreateMode>("normal");
  const [busy, setBusy] = useState(false);
  const { subjects, addTask, addEvent, addSession, addSubject, addAttachment, addExternalAttachment } = useStudyStore();

  const submitLabel = useMemo(() => {
    if (mode === "task") return taskCreateMode === "timer" ? "Crea e avvia" : "Crea task";
    if (mode === "event") return "Crea evento";
    if (mode === "session") return "Pianifica";
    if (mode === "subject") return "Crea materia";
    return "Salva materiale";
  }, [mode, taskCreateMode]);

  const reset = () => {
    setTitle("");
    setSubjectId("");
    setUrl("");
  };

  const submit = async () => {
    if (!title.trim() && mode !== "material") return;
    setBusy(true);
    try {
      const start = new Date(date).toISOString();
      if (mode === "task") {
        const now = new Date().toISOString();
        await addTask({
          title: title.trim(),
          subjectId: subjectId || undefined,
          dueDate: start,
          priority: "medium",
          status: taskCreateMode === "timer" ? "doing" : "todo",
          actualMinutes: taskCreateMode === "timer" ? 0 : undefined,
          timerStartedAt: taskCreateMode === "timer" ? now : undefined,
          timerAccumulatedSeconds: taskCreateMode === "timer" ? 0 : undefined,
          timerLastReminderAt: taskCreateMode === "timer" ? now : undefined
        });
      }
      if (mode === "event") {
        await addEvent({
          title: title.trim(),
          subjectId: subjectId || undefined,
          start,
          end: addHours(new Date(start), 1).toISOString(),
          category: "study"
        });
      }
      if (mode === "session") {
        await addSession({ title: title.trim(), subjectId: subjectId || undefined, start, plannedMinutes: 50 });
      }
      if (mode === "subject") {
        await addSubject({ name: title.trim(), color: "var(--accent)" });
      }
      if (mode === "material" && url.trim()) {
        await addExternalAttachment(url.trim(), title.trim() || "Link rapido");
      }
      reset();
      onClose();
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
        >
          <motion.div
            className="soft-panel scrollbar-soft max-h-[85vh] w-full max-w-xl overflow-y-auto p-4 sm:p-5"
            initial={{ y: 30, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 30, scale: 0.98 }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Quick add</h2>
                <p className="text-sm text-[var(--muted)]">Cattura subito, sistema dopo.</p>
              </div>
              <IconButton icon="MoreHorizontal" label="Chiudi" onClick={onClose} />
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {modes.map((item) => (
                <button key={item.id} type="button" onClick={() => setMode(item.id)}>
                  <Pill active={mode === item.id}>{item.label}</Pill>
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              {mode === "task" ? (
                <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Tipo di task">
                  {([
                    { id: "normal", label: "Task normale", icon: "Check" },
                    { id: "timer", label: "Con cronometro", icon: "Timer" }
                  ] as const).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTaskCreateMode(item.id)}
                      className={`motion-safe flex min-h-14 items-center gap-3 rounded-[22px] border p-3 text-left ${
                        taskCreateMode === item.id
                          ? "border-transparent bg-[var(--accent)] text-[#10131d]"
                          : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/10">
                        <Icon name={item.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="one-line-safe block text-sm font-black">{item.label}</span>
                        <span className="one-line-safe block text-xs font-bold opacity-70">
                          {item.id === "timer" ? "parte subito" : "da completare"}
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Materia">
                    <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                      <option value="">Nessuna</option>
                      {subjects.map((subject) => (
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

              {mode === "material" ? (
                <div className="grid gap-3">
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
                      className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-sm file:font-black file:text-[#10131d]`}
                      type="file"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setBusy(true);
                        await addAttachment(file);
                        setBusy(false);
                        reset();
                        onClose();
                      }}
                    />
                  </Field>
                </div>
              ) : null}

              <div className="mt-2 flex justify-end gap-2">
                <Button onClick={onClose}>Annulla</Button>
                <Button variant="primary" icon="Plus" onClick={submit} disabled={busy || (!title.trim() && mode !== "material")}>
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
