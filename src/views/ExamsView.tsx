import { useMemo, useState } from "react";
import { format, isBefore, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, studyDaysUntil, subjectColor, subjectName } from "../lib/selectors";
import { EXAM_STATUS_LABEL, formatMinutes } from "../lib/labels";
import { MAX_GRADE, MIN_GRADE, formatAverage, gradeStats, isValidGrade, librettoEntries } from "../lib/grades";
import { readImageFile } from "../lib/files";
import { Button, Field, IconButton, Panel, ProgressBar, SectionTitle, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { GradeDrawer } from "../components/GradeDrawer";

const GRADES = Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, index) => MIN_GRADE + index);

type ExamDraft = {
  subjectId: string;
  date: string;
  preparation: number;
  targetGrade: number;
  status: Exam["status"];
  program: string;
  frequentQuestions: string;
  cover?: string;
  grade: string;
  honors: boolean;
  passFail: boolean;
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
  cover: undefined,
  grade: "",
  honors: false,
  passFail: false
});

const draftFromExam = (exam: Exam): ExamDraft => ({
  subjectId: exam.subjectId,
  date: toDatetimeLocal(exam.date),
  preparation: exam.preparation,
  targetGrade: exam.targetGrade,
  status: exam.status,
  program: exam.program.join("\n"),
  frequentQuestions: exam.frequentQuestions.join("\n"),
  cover: exam.cover,
  grade: exam.grade ? String(exam.grade) : "",
  honors: Boolean(exam.honors),
  passFail: Boolean(exam.passFail)
});

const lines = (value: string) =>
  value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

export function ExamsView() {
  const { exams, subjects, tasks, sessions, topics, addExam, updateExam, deleteExam, addTopics, setActiveView } = useStudyStore();
  const [draft, setDraft] = useState<ExamDraft>(() => emptyDraft(selectableSubjects(subjects)[0]?.id ?? ""));
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const sorted = useMemo(() => [...exams].sort((a, b) => a.date.localeCompare(b.date)), [exams]);
  const today = startOfDay(new Date());
  const upcoming = sorted.filter((exam) => exam.status !== "done" && !isBefore(parseISO(exam.date), today));
  // Data passata ma esito non registrato: vanno chiusi con voto (o riprogrammati).
  const toRecord = sorted.filter((exam) => exam.status !== "done" && isBefore(parseISO(exam.date), today)).reverse();
  const entries = useMemo(() => librettoEntries(exams, subjects), [exams, subjects]);
  const stats = gradeStats(entries);

  const importProgram = async (exam: Exam) => {
    const added = await addTopics(exam.program.map((title) => ({ title, subjectId: exam.subjectId })));
    setNotice(
      added
        ? `${added} ${added === 1 ? "argomento aggiunto" : "argomenti aggiunti"} al ripasso di ${subjectName(subjects, exam.subjectId)}: li trovi in Studio.`
        : "Tutti gli argomenti del programma sono già nel ripasso."
    );
  };

  const openCreate = () => {
    setMessage("");
    setEditingExam(null);
    setDraft(emptyDraft(selectableSubjects(subjects)[0]?.id ?? ""));
    setFormOpen(true);
  };

  const openEdit = (exam: Exam, patch?: Partial<ExamDraft>) => {
    setMessage("");
    setNotice("");
    setEditingExam(exam);
    setDraft({ ...draftFromExam(exam), ...patch });
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

    const grade = draft.grade ? Number(draft.grade) : undefined;
    if (draft.status === "done" && !draft.passFail && grade !== undefined && !isValidGrade(grade)) {
      setMessage(`Voto non valido: da ${MIN_GRADE} a ${MAX_GRADE}.`);
      return;
    }
    const done = draft.status === "done";
    const payload = {
      subjectId: draft.subjectId,
      date: date.toISOString(),
      preparation: done ? 100 : Math.max(0, Math.min(100, draft.preparation)),
      targetGrade: Math.max(18, Math.min(30, draft.targetGrade)),
      status: draft.status,
      program: lines(draft.program),
      frequentQuestions: lines(draft.frequentQuestions),
      cover: draft.cover,
      grade: done && !draft.passFail ? grade : undefined,
      honors: done && !draft.passFail && grade === MAX_GRADE ? draft.honors : false,
      passFail: done ? draft.passFail : false
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
        subtitle="Esami in arrivo con countdown, preparazione e programma. Voti e medie sono nel Libretto."
        action={
          <div className="flex flex-wrap gap-2">
            <Button icon="Award" variant="soft" onClick={() => setGradeOpen(true)} disabled={!subjects.length}>
              Registra voto
            </Button>
            <Button icon="Plus" variant="primary" onClick={openCreate}>
              Nuovo esame
            </Button>
          </div>
        }
      />

      {/* Il libretto completo (medie, voti, proiezione del voto di laurea) è nella sezione Libretto. */}
      <button
        type="button"
        onClick={() => setActiveView("career")}
        className="soft-panel mb-4 flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-1 p-3 text-left hover:bg-[var(--surface)]"
      >
        <span className="inline-flex items-center gap-2 text-sm font-black">
          <Icon name="Award" className="h-4 w-4 text-[var(--accent-ink)]" /> Libretto
        </span>
        <span className="text-sm font-bold text-[var(--muted)]">
          media ponderata <strong className="text-[var(--text)]">{formatAverage(stats.weighted)}</strong>
        </span>
        <span className="text-sm font-bold text-[var(--muted)]">
          <strong className="text-[var(--text)]">{stats.cfuEarned}</strong> CFU
        </span>
        <span className="text-sm font-bold text-[var(--muted)]">
          {stats.passed} {stats.passed === 1 ? "esame superato" : "esami superati"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-black text-[var(--accent-ink)]">
          Medie e voto di laurea <Icon name="ChevronRight" className="h-3.5 w-3.5" />
        </span>
      </button>

      {notice ? (
        <p role="status" className="mb-4 rounded-[18px] border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm font-bold text-[var(--success-text)]">
          {notice}
        </p>
      ) : null}

      {subjects.length === 0 ? (
        <Panel>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Prima crea una materia</h3>
              <p className="safe-text mt-1 text-sm text-[var(--muted)]">Gli esami sono collegati a una materia, così calendario, libretto e dashboard restano coerenti.</p>
            </div>
            <Button icon="BookOpen" variant="primary" onClick={() => setActiveView("subjects")}>
              Vai a Materie
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          {toRecord.length ? (
            <section className="mb-4" aria-label="Esami da registrare">
              <h3 className="mb-2 px-1 text-xs font-black uppercase text-[var(--warning-text)]">Esito da registrare · {toRecord.length}</h3>
              <ul className="soft-panel grid grid-cols-1 gap-0.5 p-2">
                {toRecord.map((exam) => (
                  <li key={exam.id} className="flex min-w-0 items-center gap-3 rounded-[16px] px-2.5 py-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColor(subjects, exam.subjectId) }} />
                    <button type="button" onClick={() => openEdit(exam)} className="min-w-0 flex-1 text-left">
                      <span className="one-line-safe block text-sm font-extrabold">{subjectName(subjects, exam.subjectId)}</span>
                      <span className="block text-xs font-bold text-[var(--muted)]">{format(parseISO(exam.date), "d MMMM yyyy", { locale: it })} · data passata</span>
                    </button>
                    <Button variant="soft" icon="Award" onClick={() => openEdit(exam, { status: "done" })}>
                      Registra esito
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {upcoming.length ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
              {upcoming.map((exam) => (
                <ExamCard
                  key={exam.id}
                  exam={exam}
                  color={subjectColor(subjects, exam.subjectId)}
                  name={subjectName(subjects, exam.subjectId)}
                  openTasks={tasks.filter((task) => task.subjectId === exam.subjectId && task.status !== "done" && task.status !== "archived").length}
                  studiedMinutes={sessions
                    .filter((session) => session.subjectId === exam.subjectId && session.status === "completed")
                    .reduce((sum, session) => sum + session.actualMinutes, 0)}
                  topics={topics.filter((topic) => topic.subjectId === exam.subjectId && !topic.archived).length}
                  onPrep={(delta) => void updateExam(exam.id, { preparation: Math.max(0, Math.min(100, exam.preparation + delta)) })}
                  onEdit={() => openEdit(exam)}
                  onImportProgram={() => void importProgram(exam)}
                  onStudy={() => setActiveView("study")}
                />
              ))}
            </div>
          ) : (
            <Panel>
              <div className="text-center">
                <Icon name="GraduationCap" className="mx-auto mb-3 h-10 w-10 text-[var(--accent-ink)]" />
                <h3 className="text-xl font-black">Nessun esame in arrivo</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">Aggiungi la data del prossimo appello: comparirà anche nel calendario e nella dashboard.</p>
                <Button className="mt-4" icon="Plus" variant="primary" onClick={openCreate}>
                  Nuovo esame
                </Button>
              </div>
            </Panel>
          )}
        </>
      )}

      <GradeDrawer
        open={gradeOpen}
        subjects={subjects}
        exams={exams}
        onClose={() => setGradeOpen(false)}
        onSaved={(text) => {
          setGradeOpen(false);
          setNotice(`${text} Medie e proiezione sono nel Libretto.`);
        }}
      />

      {formOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
          <section className="soft-panel scrollbar-soft max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="safe-text text-2xl font-black">{editingExam ? "Modifica esame" : "Nuovo esame"}</h3>
                <p className="two-line-safe text-sm text-[var(--muted)]">La data appare automaticamente anche nel calendario.</p>
              </div>
              <IconButton icon="X" label="Chiudi" className="h-10 w-10" onClick={() => setFormOpen(false)} />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Materia">
                  <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                    <option value="">Seleziona</option>
                    {selectableSubjects(subjects, draft.subjectId).map((subject) => (
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Preparazione">
                  <input className={inputClass} type="number" min={0} max={100} value={draft.preparation} onChange={(event) => setDraft((value) => ({ ...value, preparation: Number(event.target.value) }))} />
                </Field>
                <Field label="Voto obiettivo">
                  <input className={inputClass} type="number" min={18} max={30} value={draft.targetGrade} onChange={(event) => setDraft((value) => ({ ...value, targetGrade: Number(event.target.value) }))} />
                </Field>
                <Field label="Stato">
                  <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Exam["status"] }))}>
                    {(Object.keys(EXAM_STATUS_LABEL) as Exam["status"][]).map((status) => (
                      <option key={status} value={status}>
                        {EXAM_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {draft.status === "done" ? (
                <div className="grid grid-cols-1 gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                  <Field label="Voto">
                    <select
                      className={inputClass}
                      value={draft.passFail ? "" : draft.grade}
                      disabled={draft.passFail}
                      onChange={(event) => setDraft((value) => ({ ...value, grade: event.target.value, honors: event.target.value === String(MAX_GRADE) && value.honors }))}
                    >
                      <option value="">{draft.passFail ? "Senza voto" : "Non ancora registrato"}</option>
                      {GRADES.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={draft.honors}
                      disabled={draft.passFail || draft.grade !== String(MAX_GRADE)}
                      onChange={(event) => setDraft((value) => ({ ...value, honors: event.target.checked }))}
                    />
                    Lode
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={draft.passFail}
                      onChange={(event) => setDraft((value) => ({ ...value, passFail: event.target.checked, honors: false }))}
                    />
                    Idoneità
                  </label>
                </div>
              ) : null}

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

              {message ? <p className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">{message}</p> : null}

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

function ExamCard({
  exam,
  color,
  name,
  openTasks,
  studiedMinutes,
  topics,
  onPrep,
  onEdit,
  onImportProgram,
  onStudy
}: {
  exam: Exam;
  color: string;
  name: string;
  openTasks: number;
  studiedMinutes: number;
  topics: number;
  onPrep: (delta: number) => void;
  onEdit: () => void;
  onImportProgram: () => void;
  onStudy: () => void;
}) {
  const remaining = studyDaysUntil(exam.date);
  const risk = remaining < 10 && exam.preparation < 70 ? "alto" : remaining < 20 && exam.preparation < 55 ? "medio" : null;
  const program = exam.program.slice(0, 6);
  return (
    <article className="quiet-panel flex min-w-0 flex-col p-4" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
      <div className="flex items-start gap-3">
        {exam.cover ? (
          <img src={exam.cover} alt="" className="h-14 w-14 shrink-0 rounded-[16px] object-cover" />
        ) : (
          <div className="grid grid-cols-1 h-14 w-14 shrink-0 place-items-center rounded-[16px] text-center" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}>
            <span className="text-xl font-black leading-none tabular-nums">{remaining}</span>
            <span className="text-[10px] font-black uppercase text-[var(--muted)]">{remaining === 1 ? "giorno" : "giorni"}</span>
          </div>
        )}
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <h3 className="two-line-safe text-lg font-black leading-tight">{name}</h3>
          <p className="text-xs font-bold text-[var(--muted)]">
            {format(parseISO(exam.date), "EEEE d MMMM · HH:mm", { locale: it })}
            {exam.cover ? ` · ${remaining} ${remaining === 1 ? "giorno" : "giorni"}` : ""}
          </p>
        </button>
        <IconButton icon="PenLine" label={`Modifica esame di ${name}`} className="h-9 w-9" onClick={onEdit} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Tag>{EXAM_STATUS_LABEL[exam.status]}</Tag>
        <Tag>obiettivo {exam.targetGrade}</Tag>
        {risk ? (
          <span
            className={`inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-black ${
              risk === "alto" ? "bg-[var(--danger-bg)] text-[var(--danger-text)]" : "bg-[var(--warning-bg)] text-[var(--warning-text)]"
            }`}
          >
            rischio {risk}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-black">
          <span className="text-[var(--faint)] uppercase">Preparazione</span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Riduci preparazione del 5%" onClick={() => onPrep(-5)} className="grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] hover:bg-[var(--surface)]">
              −
            </button>
            <span className="w-10 text-center tabular-nums">{exam.preparation}%</span>
            <button type="button" aria-label="Aumenta preparazione del 5%" onClick={() => onPrep(5)} className="grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] hover:bg-[var(--surface)]">
              +
            </button>
          </span>
        </div>
        <ProgressBar value={exam.preparation} color={color} />
      </div>

      <p className="mt-3 text-xs font-bold text-[var(--muted)]">
        {openTasks} {openTasks === 1 ? "task aperta" : "task aperte"} · {formatMinutes(studiedMinutes)} di studio · {topics} {topics === 1 ? "argomento" : "argomenti"} in ripasso
      </p>

      {program.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {program.map((topic, index) => (
            <Tag key={`${topic}-${index}`}>{topic}</Tag>
          ))}
          {exam.program.length > program.length ? <Tag>+{exam.program.length - program.length}</Tag> : null}
        </div>
      ) : (
        <p className="mt-3 text-xs font-bold text-[var(--faint)]">Programma non ancora inserito.</p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        {exam.program.length ? (
          <button type="button" onClick={onImportProgram} className="inline-flex min-h-8 items-center gap-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
            <Icon name="Brain" className="h-3.5 w-3.5" /> Programma nel ripasso
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onStudy} className="inline-flex min-h-8 items-center gap-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
          <Icon name="Timer" className="h-3.5 w-3.5" /> Studia
        </button>
      </div>
    </article>
  );
}
