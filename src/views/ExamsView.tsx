import { useMemo, useState } from "react";
import { format, isBefore, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, studyDaysUntil, subjectColor, subjectName } from "../lib/selectors";
import { EXAM_STATUS_LABEL, capitalizeFirst, formatMinutes } from "../lib/labels";
import { MAX_GRADE, MIN_GRADE, formatAverage, gradeStats, isValidGrade, librettoEntries } from "../lib/grades";
import { readImageFile } from "../lib/files";
import { Button, Field, IconButton, Panel, ProgressBar, SectionTitle, Tag, fileInputClass, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { GradeDrawer } from "../components/GradeDrawer";
import { BarbExamCalendar } from "../components/BarbExamCalendar";
import { BarbExamImport } from "../components/BarbExamImport";
import { ShareButton } from "../components/ShareButton";
import { SharedSection } from "../components/SharedSection";
import { Segmented } from "../components/ui";
import { oneOf, useUiState } from "../lib/uiState";

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
  const preferences = useStudyStore(selectPreferences);
  const hasExams = useStudyStore((state) => state.exams.some((exam) => !exam.archived));
  // Chi ha già esami parte dai propri; altrimenti resta la scelta di prima (date ufficiali per BARB).
  const [tab, setTab] = useUiState<"barb" | "personal">(
    "exams.tab",
    () => (hasExams ? "personal" : preferences.showBarb || preferences.degreeProgram === "barb" ? "barb" : "personal"),
    { validate: oneOf("barb", "personal") }
  );
  return <div className="min-w-0">
    <Segmented value={tab} onChange={setTab} label="Quali esami vedere" options={[{ id: "personal", label: "I miei esami", icon: "GraduationCap" }, { id: "barb", label: "Date ufficiali", icon: "CalendarDays", title: "Date ufficiali degli appelli del corso di laurea BARB" }]} className="mb-5" />
    {tab === "barb" ? <BarbExamCalendar /> : <PersonalExamsView />}
  </div>;
}

function PersonalExamsView() {
  const { exams, subjects, tasks, sessions, topics, addExam, updateExam, deleteExam, addTopics, setActiveView } = useStudyStore();
  const [draft, setDraft] = useState<ExamDraft>(() => emptyDraft(selectableSubjects(subjects)[0]?.id ?? ""));
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
    setMoreOpen(false);
    setFormOpen(true);
  };

  const openEdit = (exam: Exam, patch?: Partial<ExamDraft>) => {
    setMessage("");
    setNotice("");
    setEditingExam(exam);
    setDraft({ ...draftFromExam(exam), ...patch });
    // Le opzioni meno usate restano aperte se l'esame le usa già.
    setMoreOpen(Boolean(exam.frequentQuestions.length || exam.cover));
    setFormOpen(true);
  };

  const saveExam = async () => {
    setMessage("");
    if (!draft.subjectId) {
      setMessage("Scegli la materia dell'esame.");
      return;
    }
    const date = new Date(draft.date);
    if (Number.isNaN(date.getTime())) {
      setMessage("Data non valida: scegli giorno e ora dell'esame.");
      return;
    }

    const grade = draft.grade ? Number(draft.grade) : undefined;
    if (draft.status === "done" && !draft.passFail && grade !== undefined && !isValidGrade(grade)) {
      setMessage(`Voto non valido: scegli un voto da ${MIN_GRADE} a ${MAX_GRADE}.`);
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
    if (!window.confirm(`Eliminare l'esame di "${name}"? Sparisce anche dal calendario e, se ha un voto, dal libretto. Non si può annullare.`)) return;
    await deleteExam(exam.id);
    if (editingExam?.id === exam.id) setFormOpen(false);
  };

  // Un solo pulsante principale per schermata: quando sotto c'è già l'invito ad aggiungere
  // (nessuna materia o nessun esame in arrivo), quello in alto diventa secondario.
  const headerPrimary = subjects.length > 0 && upcoming.length > 0;

  return (
    <div>
      <SectionTitle
        title="I miei esami"
        subtitle="Le date dei tuoi prossimi esami e quanto sei pronto. Voti e medie sono in Libretto e laurea."
        action={
          // Con quattro pulsanti in fila il titolo resterebbe senza spazio: da sm vanno a capo, in riga sola da 2xl.
          <div className="flex flex-wrap items-start gap-2 sm:max-w-[26rem] 2xl:max-w-none">
            <Button icon="Download" variant="ghost" onClick={() => setImportOpen(true)}>Importa appelli ufficiali</Button>
            <Button icon="Award" variant="soft" onClick={() => setGradeOpen(true)}>
              Registra un voto
            </Button>
            <Button icon="Plus" variant={headerPrimary ? "primary" : "soft"} onClick={openCreate}>
              Aggiungi esame
            </Button>
            <ShareButton scopes={["progress"]} label="Condividi i progressi" />
          </div>
        }
      />

      {/* Il libretto completo (medie, voti, proiezione del voto di laurea) è nella sezione Libretto e laurea. */}
      <button
        type="button"
        onClick={() => setActiveView("career")}
        className="soft-panel mb-4 flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-1 p-3 text-left hover:bg-[var(--surface)]"
      >
        <span className="inline-flex items-center gap-2 text-sm font-black">
          <Icon name="Award" className="h-4 w-4 text-[var(--accent-ink)]" /> Libretto e laurea
        </span>
        <span className="text-sm font-bold text-[var(--muted)]">
          Media ponderata <strong className="text-[var(--text)]">{formatAverage(stats.weighted)}</strong>
        </span>
        <span className="text-sm font-bold text-[var(--muted)]">
          <strong className="text-[var(--text)]">{stats.cfuEarned}</strong> CFU
        </span>
        <span className="text-sm font-bold text-[var(--muted)]">
          {stats.passed} {stats.passed === 1 ? "esame superato" : "esami superati"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-black text-[var(--accent-ink)]">
          Vedi voti e medie <Icon name="ChevronRight" className="h-3.5 w-3.5" />
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
              <h3 className="text-2xl font-black">Ancora nessuna materia</h3>
              <p className="safe-text mt-1 text-sm text-[var(--muted)]">Ogni esame appartiene a una materia: aggiungi prima la materia, poi la data dell'esame.</p>
            </div>
            <Button icon="BookOpen" variant="primary" onClick={() => setActiveView("subjects")}>
              Vai a Materie
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          {toRecord.length ? (
            <section className="mb-4" aria-label="Esami con data trascorsa di cui registrare l'esito">
              <h3 className="mb-2 px-1 text-xs font-black uppercase text-[var(--warning-text)]">Data trascorsa: registra l'esito · {toRecord.length}</h3>
              <ul className="soft-panel grid grid-cols-1 gap-0.5 p-2">
                {toRecord.map((exam) => (
                  <li key={exam.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-[16px] px-2.5 py-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColor(subjects, exam.subjectId) }} />
                    <button type="button" onClick={() => openEdit(exam)} className="min-w-0 flex-1 basis-40 text-left">
                      <span className="one-line-safe block text-sm font-extrabold">{subjectName(subjects, exam.subjectId)}</span>
                      <span className="block text-xs font-bold text-[var(--muted)]">{format(parseISO(exam.date), "d MMMM yyyy", { locale: it })} · com'è andata?</span>
                    </button>
                    <Button variant="soft" icon="Award" onClick={() => openEdit(exam, { status: "done" })}>
                      Registra l'esito
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
                <h3 className="text-xl font-black">Ancora nessun esame in arrivo</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">Aggiungi la data del prossimo esame: qui vedrai i giorni che mancano e quanto sei pronto.</p>
                <Button className="mt-4" icon="Plus" variant="primary" onClick={openCreate}>
                  Aggiungi esame
                </Button>
              </div>
            </Panel>
          )}
        </>
      )}

      {importOpen && <BarbExamImport onClose={() => setImportOpen(false)} />}
      <GradeDrawer
        open={gradeOpen}
        subjects={subjects}
        exams={exams}
        onClose={() => setGradeOpen(false)}
        onSaved={(text) => {
          setGradeOpen(false);
          setNotice(`${text} Medie e voto di laurea sono in Libretto e laurea.`);
        }}
      />

      {formOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
          role="dialog"
          aria-modal="true"
          aria-label={editingExam ? "Modifica esame" : "Aggiungi esame"}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFormOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setFormOpen(false);
          }}
        >
          <section className="soft-panel scrollbar-soft max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="safe-text text-2xl font-black">{editingExam ? "Modifica esame" : "Aggiungi esame"}</h3>
                <p className="two-line-safe text-sm text-[var(--muted)]">Bastano materia e data: l'esame comparirà anche nel tuo Calendario.</p>
              </div>
              <IconButton icon="X" label="Chiudi" className="h-10 w-10" onClick={() => setFormOpen(false)} />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Materia">
                  <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                    <option value="">Scegli la materia</option>
                    {selectableSubjects(subjects, draft.subjectId).map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Giorno e ora dell'esame">
                  <input className={inputClass} type="datetime-local" value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="A che punto sei">
                  <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Exam["status"] }))}>
                    {(Object.keys(EXAM_STATUS_LABEL) as Exam["status"][]).map((status) => (
                      <option key={status} value={status}>
                        {EXAM_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Preparazione (%)">
                  <input className={inputClass} type="number" min={0} max={100} value={draft.preparation} onChange={(event) => setDraft((value) => ({ ...value, preparation: Number(event.target.value) }))} />
                </Field>
                <Field label="Voto obiettivo (18–30)">
                  <input className={inputClass} type="number" min={18} max={30} value={draft.targetGrade} onChange={(event) => setDraft((value) => ({ ...value, targetGrade: Number(event.target.value) }))} />
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
                    Idoneità (senza voto)
                  </label>
                </div>
              ) : null}

              <Field label="Programma (facoltativo)">
                <textarea className={`${inputClass} min-h-28 py-3`} value={draft.program} onChange={(event) => setDraft((value) => ({ ...value, program: event.target.value }))} placeholder="Un argomento per riga (Es. Glicolisi)" />
              </Field>

              <details className="quiet-panel p-3" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
                <summary className="cursor-pointer text-sm font-extrabold">Altre opzioni: domande frequenti e copertina</summary>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <Field label="Domande frequenti (facoltative)">
                    <textarea className={`${inputClass} min-h-24 py-3`} value={draft.frequentQuestions} onChange={(event) => setDraft((value) => ({ ...value, frequentQuestions: event.target.value }))} placeholder="Una domanda per riga" />
                  </Field>

                  <Field label="Immagine di copertina (facoltativa)">
                    <input
                      className={fileInputClass}
                      type="file"
                      accept="image/*"
                      onChange={async (event) => {
                        try {
                          const cover = await readImageFile(event.target.files?.[0]);
                          if (cover) setDraft((value) => ({ ...value, cover }));
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : "Immagine non valida: scegli un altro file.");
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
                        <p className="font-black">Copertina scelta</p>
                        <p className="text-sm text-[var(--muted)]">La vedi sulla scheda dell'esame.</p>
                      </div>
                      <Button variant="danger" icon="Trash2" onClick={() => setDraft((value) => ({ ...value, cover: undefined }))}>
                        Rimuovi copertina
                      </Button>
                    </div>
                  ) : null}
                </div>
              </details>

              {message ? <p role="alert" className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">{message}</p> : null}

              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {editingExam ? (
                  <Button variant="danger" icon="Trash2" onClick={() => removeExam(editingExam)}>
                    Elimina esame
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

      <SharedSection entityTypes={["exam"]} title="Progressi condivisi con te" />
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
            {capitalizeFirst(format(parseISO(exam.date), "EEEE d MMMM · HH:mm", { locale: it }))}
            {exam.cover ? ` · ${remaining} ${remaining === 1 ? "giorno" : "giorni"}` : ""}
          </p>
        </button>
        <IconButton icon="PenLine" label={`Modifica esame di ${name}`} className="h-9 w-9" onClick={onEdit} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Tag>{EXAM_STATUS_LABEL[exam.status]}</Tag>
        <Tag>Voto obiettivo {exam.targetGrade}</Tag>
        {risk ? (
          <span
            title={risk === "alto" ? "Mancano meno di 10 giorni e la preparazione è sotto il 70%." : "Mancano meno di 20 giorni e la preparazione è sotto il 55%."}
            className={`inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-black ${
              risk === "alto" ? "bg-[var(--danger-bg)] text-[var(--danger-text)]" : "bg-[var(--warning-bg)] text-[var(--warning-text)]"
            }`}
          >
            {risk === "alto" ? "Sei indietro" : "Un po' indietro"}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-black">
          <span className="text-[var(--faint)] uppercase">Quanto sei pronto</span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label={`Abbassa la preparazione per ${name} del 5%`} onClick={() => onPrep(-5)} className="relative grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] after:absolute after:-inset-2 after:content-[''] hover:bg-[var(--surface)]">
              −
            </button>
            <span className="w-10 text-center tabular-nums">{exam.preparation}%</span>
            <button type="button" aria-label={`Alza la preparazione per ${name} del 5%`} onClick={() => onPrep(5)} className="relative grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] after:absolute after:-inset-2 after:content-[''] hover:bg-[var(--surface)]">
              +
            </button>
          </span>
        </div>
        <ProgressBar value={exam.preparation} color={color} />
      </div>

      <p className="mt-3 text-xs font-bold text-[var(--muted)]">
        {openTasks} attività da fare · {formatMinutes(studiedMinutes)} di studio · {topics} {topics === 1 ? "argomento" : "argomenti"} da ripassare
      </p>

      {program.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {program.map((topic, index) => (
            <Tag key={`${topic}-${index}`}>{topic}</Tag>
          ))}
          {exam.program.length > program.length ? <Tag>+{exam.program.length - program.length}</Tag> : null}
        </div>
      ) : (
        <p className="mt-3 text-xs font-bold text-[var(--faint)]">Programma non ancora inserito: aggiungilo modificando l'esame.</p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        {exam.program.length ? (
          <button type="button" onClick={onImportProgram} title="Aggiunge ogni argomento del programma agli argomenti da ripassare" className="inline-flex min-h-8 items-center gap-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
            <Icon name="Brain" className="h-3.5 w-3.5" /> Aggiungi il programma al ripasso
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
