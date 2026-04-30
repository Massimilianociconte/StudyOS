import { useMemo, useState } from "react";
import type { Exam } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { daysUntil, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { readImageFile } from "../lib/files";
import { Button, Field, Panel, Pill, ProgressBar, ProgressRing, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";

type ExamDraft = {
  subjectId: string;
  date: string;
  preparation: number;
  targetGrade: number;
  status: Exam["status"];
  program: string;
  frequentQuestions: string;
  cover?: string;
};

const toDatetimeLocal = (date?: string) => {
  const value = date ? new Date(date) : new Date();
  value.setHours(value.getHours() || 9, value.getMinutes(), 0, 0);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const emptyDraft = (subjectId = ""): ExamDraft => ({
  subjectId,
  date: toDatetimeLocal(),
  preparation: 0,
  targetGrade: 28,
  status: "planning",
  program: "",
  frequentQuestions: "",
  cover: undefined
});

const draftFromExam = (exam: Exam): ExamDraft => ({
  subjectId: exam.subjectId,
  date: toDatetimeLocal(exam.date),
  preparation: exam.preparation,
  targetGrade: exam.targetGrade,
  status: exam.status,
  program: exam.program.join("\n"),
  frequentQuestions: exam.frequentQuestions.join("\n"),
  cover: exam.cover
});

const lines = (value: string) =>
  value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

export function ExamsView() {
  const { exams, subjects, tasks, sessions, topics, addExam, updateExam, deleteExam, setActiveView } = useStudyStore();
  const [draft, setDraft] = useState<ExamDraft>(() => emptyDraft(subjects[0]?.id ?? ""));
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const sorted = useMemo(() => [...exams].sort((a, b) => a.date.localeCompare(b.date)), [exams]);

  const openCreate = () => {
    setMessage("");
    setEditingExam(null);
    setDraft(emptyDraft(subjects[0]?.id ?? ""));
    setFormOpen(true);
  };

  const openEdit = (exam: Exam) => {
    setMessage("");
    setEditingExam(exam);
    setDraft(draftFromExam(exam));
    setFormOpen(true);
  };

  const saveExam = async () => {
    setMessage("");
    if (!draft.subjectId) {
      setMessage("Seleziona una materia per l'esame.");
      return;
    }
    const date = new Date(draft.date);
    if (Number.isNaN(date.getTime())) {
      setMessage("Data esame non valida.");
      return;
    }

    const payload = {
      subjectId: draft.subjectId,
      date: date.toISOString(),
      preparation: Math.max(0, Math.min(100, draft.preparation)),
      targetGrade: Math.max(18, Math.min(30, draft.targetGrade)),
      status: draft.status,
      program: lines(draft.program),
      frequentQuestions: lines(draft.frequentQuestions),
      cover: draft.cover
    };

    if (editingExam) {
      await updateExam(editingExam.id, payload);
    } else {
      await addExam(payload);
    }
    setFormOpen(false);
  };

  const removeExam = async (exam: Exam) => {
    const name = subjectName(subjects, exam.subjectId);
    if (!window.confirm(`Eliminare l'esame di "${name}"?`)) return;
    await deleteExam(exam.id);
    if (editingExam?.id === exam.id) setFormOpen(false);
  };

  return (
    <div>
      <SectionTitle
        title="Esami"
        subtitle="Piano esame con countdown, preparazione, rischio di ritardo, task e ripassi collegati."
        action={
          <div className="flex gap-2">
            <Button icon="CalendarDays" variant="soft" onClick={() => setActiveView("calendar")}>
              Calendario
            </Button>
            <Button icon="Plus" variant="primary" onClick={openCreate}>
              Nuovo esame
            </Button>
          </div>
        }
      />

      {subjects.length === 0 ? (
        <Panel>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Prima crea una materia</h3>
              <p className="safe-text mt-1 text-sm text-[var(--muted)]">Gli esami sono collegati a una materia, cosi calendario e dashboard restano coerenti.</p>
            </div>
            <Button icon="BookOpen" variant="primary" onClick={() => setActiveView("subjects")}>
              Vai a Materie
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((exam) => {
            const color = subjectColor(subjects, exam.subjectId);
            const remaining = daysUntil(exam.date);
            const relatedTasks = tasks.filter((task) => task.subjectId === exam.subjectId && task.status !== "done");
            const relatedSessions = sessions.filter((session) => session.subjectId === exam.subjectId);
            const relatedTopics = topics.filter((topic) => topic.subjectId === exam.subjectId);
            const plannedHours = Math.round(relatedSessions.reduce((sum, session) => sum + session.plannedMinutes, 0) / 60);
            const risk = remaining < 10 && exam.preparation < 70 ? "alto" : remaining < 20 && exam.preparation < 55 ? "medio" : "basso";

            return (
              <Panel key={exam.id}>
                <div className="flex flex-col gap-5 md:flex-row">
                  <div className="md:w-44">
                    {exam.cover ? (
                      <div className="mb-4 aspect-square overflow-hidden rounded-super bg-[var(--surface-soft)]">
                        <img src={exam.cover} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <ProgressRing value={exam.preparation} label="pronto" color={color} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-[var(--faint)]">Piano esame</p>
                        <h3 className="two-line-safe text-3xl font-black">{subjectName(subjects, exam.subjectId)}</h3>
                        <p className="text-sm font-bold text-[var(--muted)]">{shortDate(exam.date)}</p>
                      </div>
                      <Pill active={risk === "alto"}>rischio {risk}</Pill>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Metric label="giorni" value={Math.max(0, remaining)} />
                      <Metric label="task" value={relatedTasks.length} />
                      <Metric label="ore pian." value={plannedHours} />
                      <Metric label="ripassi" value={relatedTopics.length} />
                    </div>

                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between text-xs font-black">
                        <span>Preparazione</span>
                        <span>{exam.preparation}%</span>
                      </div>
                      <ProgressBar value={exam.preparation} color={color} />
                    </div>

                    <div className="mt-5 grid gap-2">
                      {exam.program.slice(0, 5).map((topic, index) => (
                        <div key={`${topic}-${index}`} className="flex min-w-0 items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] p-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black" style={{ background: color, color: "#10131d" }}>
                            {index + 1}
                          </span>
                          <span className="two-line-safe text-sm font-bold">{topic}</span>
                        </div>
                      ))}
                      {exam.program.length === 0 ? (
                        <p className="rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">Programma non ancora inserito.</p>
                      ) : null}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button
                        variant="soft"
                        icon="ChevronRight"
                        onClick={() => updateExam(exam.id, { preparation: Math.min(100, exam.preparation + 5) })}
                      >
                        +5% prep
                      </Button>
                      <Button variant="soft" icon="PenLine" onClick={() => openEdit(exam)}>
                        Modifica
                      </Button>
                      <Button variant="danger" icon="Trash2" onClick={() => removeExam(exam)}>
                        Elimina
                      </Button>
                      <Button variant="ghost" icon="Timer" onClick={() => setActiveView("study")}>
                        Pianifica studio
                      </Button>
                    </div>
                  </div>
                </div>
              </Panel>
            );
          })}
          {sorted.length === 0 ? (
            <Panel className="lg:col-span-2">
              <div className="text-center">
                <Icon name="GraduationCap" className="mx-auto mb-3 h-10 w-10 text-[var(--accent)]" />
                <h3 className="text-2xl font-black">Nessun esame ancora</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">Crea il primo esame per vederlo anche nel calendario.</p>
                <Button className="mt-4" icon="Plus" variant="primary" onClick={openCreate}>
                  Nuovo esame
                </Button>
              </div>
            </Panel>
          ) : null}
        </div>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
          <section className="soft-panel scrollbar-soft max-h-[88vh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="safe-text text-2xl font-black">{editingExam ? "Modifica esame" : "Nuovo esame"}</h3>
                <p className="two-line-safe text-sm text-[var(--muted)]">La data appare automaticamente anche nel calendario.</p>
              </div>
              <Button variant="ghost" icon="X" onClick={() => setFormOpen(false)}>
                Chiudi
              </Button>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Materia">
                  <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                    <option value="">Seleziona</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data e ora">
                  <input className={inputClass} type="datetime-local" value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Preparazione">
                  <input className={inputClass} type="number" min={0} max={100} value={draft.preparation} onChange={(event) => setDraft((value) => ({ ...value, preparation: Number(event.target.value) }))} />
                </Field>
                <Field label="Voto obiettivo">
                  <input className={inputClass} type="number" min={18} max={30} value={draft.targetGrade} onChange={(event) => setDraft((value) => ({ ...value, targetGrade: Number(event.target.value) }))} />
                </Field>
                <Field label="Stato">
                  <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Exam["status"] }))}>
                    <option value="planning">Pianificazione</option>
                    <option value="studying">Studio</option>
                    <option value="reviewing">Ripasso</option>
                    <option value="ready">Pronto</option>
                    <option value="done">Fatto</option>
                  </select>
                </Field>
              </div>

              <Field label="Programma">
                <textarea className={`${inputClass} min-h-28 py-3`} value={draft.program} onChange={(event) => setDraft((value) => ({ ...value, program: event.target.value }))} placeholder="Un argomento per riga" />
              </Field>

              <Field label="Domande frequenti">
                <textarea className={`${inputClass} min-h-24 py-3`} value={draft.frequentQuestions} onChange={(event) => setDraft((value) => ({ ...value, frequentQuestions: event.target.value }))} placeholder="Una domanda per riga" />
              </Field>

              <Field label="Copertina opzionale">
                <input
                  className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-sm file:font-black file:text-[#10131d]`}
                  type="file"
                  accept="image/*"
                  onChange={async (event) => {
                    try {
                      const cover = await readImageFile(event.target.files?.[0]);
                      if (cover) setDraft((value) => ({ ...value, cover }));
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Immagine non valida.");
                    } finally {
                      event.target.value = "";
                    }
                  }}
                />
              </Field>

              {draft.cover ? (
                <div className="quiet-panel flex items-center gap-3 p-3">
                  <img src={draft.cover} alt="" className="h-16 w-16 rounded-[18px] object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="font-black">Copertina personalizzata</p>
                    <p className="text-sm text-[var(--muted)]">Visibile nella scheda esame.</p>
                  </div>
                  <Button variant="danger" icon="Trash2" onClick={() => setDraft((value) => ({ ...value, cover: undefined }))}>
                    Rimuovi
                  </Button>
                </div>
              ) : null}

              {message ? <p className="rounded-[18px] border border-amber-400/30 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">{message}</p> : null}

              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {editingExam ? (
                  <Button variant="danger" icon="Trash2" onClick={() => removeExam(editingExam)}>
                    Elimina
                  </Button>
                ) : null}
                <Button variant="soft" onClick={() => setFormOpen(false)}>
                  Annulla
                </Button>
                <Button variant="primary" icon="Check" onClick={saveExam}>
                  Salva esame
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[20px] bg-[var(--surface-soft)] p-3">
      <div className="flex items-center gap-2">
        <Icon name="CircleDot" className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="text-2xl font-black">{value}</span>
      </div>
      <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
    </div>
  );
}
