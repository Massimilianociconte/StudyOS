import { useMemo, useState } from "react";
import { addHours } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, IconButton, Pill, inputClass } from "./ui";

type Mode = "task" | "event" | "session" | "subject" | "material";

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
  const [busy, setBusy] = useState(false);
  const { subjects, addTask, addEvent, addSession, addSubject, addAttachment, addExternalAttachment } = useStudyStore();

  const submitLabel = useMemo(() => {
    if (mode === "task") return "Crea task";
    if (mode === "event") return "Crea evento";
    if (mode === "session") return "Pianifica";
    if (mode === "subject") return "Crea materia";
    return "Salva materiale";
  }, [mode]);

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
        await addTask({ title: title.trim(), subjectId: subjectId || undefined, dueDate: start, priority: "medium" });
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
