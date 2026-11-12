import { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from "react";
import type { Attachment, Subject } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { daysUntil, shortDate } from "../lib/selectors";
import { readCoverImage } from "../lib/files";
import { isDateToDecide } from "../lib/examOutcome";
import { librettoEntries } from "../lib/grades";
import { GradeDrawer } from "../components/GradeDrawer";
import { ATTACHMENT_KIND_ICON, SUBJECT_STATUS_LABEL, attachmentKind, formatMinutes } from "../lib/labels";
import { SUBJECT_REMOVE_TEXT, SUBJECTS_HELP, SUBJECTS_TEXT } from "../lib/labels/subjects";
import { Button, Drawer, EmptyState, Field, HelpTip, IconButton, PageActions, ProgressBar, SectionTitle, Segmented, StatTile, Tag, inputClass, type PageAction } from "../components/ui";
import { HelpField } from "../components/HelpField";
import { InlineConfirm } from "../components/InlineConfirm";
import { Icon } from "../components/Icon";
import { CourseIcon } from "../components/CourseIcon";
import { BarbExamAvailability, BarbExamSessions } from "../components/BarbExamSessions";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { resolveBarbCourse } from "../lib/university/examSessions";
import { subjectSemester, SEMESTER_LABEL, SEMESTER_TONE, SEMESTER_IDS, type SemesterId } from "../lib/semesters";
import { TopicManager } from "../components/TopicManager";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { goToView, useLinkedUiState } from "../hooks/useLinkedUiState";
import { cfuBySemester, isArchivedSubject, nextSubjectColor, otherStatuses, semesterFilterOptions, subjectMenuItems, type SemesterFilter } from "../lib/subjectCards";
import { safeCssColor } from "../lib/sharing";

const SWATCHES = ["#7CF7C8", "#9FB7FF", "#F7A8C4", "#FFD37C", "#C8A2FF", "#7FE3F5", "#FFAE7C", "#A6E3A1"];
// Nomi leggibili dei colori per i lettori di schermo (i codici esadecimali non dicono nulla).
const SWATCH_NAMES: Record<string, string> = {
  "#7CF7C8": "verde acqua",
  "#9FB7FF": "blu",
  "#F7A8C4": "rosa",
  "#FFD37C": "giallo",
  "#C8A2FF": "lilla",
  "#7FE3F5": "azzurro",
  "#FFAE7C": "arancione",
  "#A6E3A1": "verde"
};
const swatchLabel = (swatch: string) => `Colore ${SWATCH_NAMES[swatch] ?? swatch}`;
// Icona di ogni stato nel menu "⋯" della scheda.
const STATUS_ICON: Record<Subject["status"], string> = {
  "not-started": "CircleDot",
  active: "PlayCircle",
  review: "RotateCcw",
  "exam-ready": "GraduationCap",
  completed: "Check",
  archived: "Archive"
};
const subjectColor = (subject: Subject) => safeCssColor(subject.color) || "var(--accent)";
// Studio della materia (grafico con recharts): si carica solo aprendo il dettaglio.
const SubjectStudyStats = lazy(() => import("../components/SubjectStudyStats"));

/** Porta all'esame aperto in Esami (la sezione legge `exams.editing`). */
const openExam = (examId: string) => goToView("exams", [["exams.editing", examId, "tab"]]);

type StoreState = ReturnType<typeof useStudyStore.getState>;

const subjectStats = (subject: Subject, state: Pick<StoreState, "tasks" | "sessions" | "exams" | "attachments">) => {
  const subjectTasks = state.tasks.filter((task) => task.subjectId === subject.id && task.status !== "archived");
  const openTasks = subjectTasks.filter((task) => task.status !== "done");
  const completed = subjectTasks.length - openTasks.length;
  const studyMinutes = state.sessions
    .filter((session) => session.subjectId === subject.id && session.status === "completed")
    .reduce((sum, session) => sum + session.actualMinutes, 0);
  const exam = state.exams
    .filter((item) => item.subjectId === subject.id && item.status !== "done")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const materials = state.attachments.filter((attachment) => attachment.linkedEntityType === "subject" && attachment.linkedEntityId === subject.id);
  // Preparazione: quella dell'esame se esiste, altrimenti avanzamento delle task della materia.
  const progress = exam ? exam.preparation : subjectTasks.length ? Math.round((completed / subjectTasks.length) * 100) : 0;
  return { subjectTasks, openTasks, studyMinutes, exam, materials, progress };
};

export function SubjectsView() {
  // Letta anche quando un'altra sezione porta qui una materia da aprire (es. dalla Home).
  const [openId, setOpenId] = useLinkedUiState<string | null>("subjects.open", null, { validate: isNullableString });
  const [showArchived, setShowArchived] = useUiState("subjects.showArchived", false);
  const [semester, setSemester] = useUiState<SemesterFilter>("subjects.semester", "tutti", { validate: oneOf("tutti", ...SEMESTER_IDS) });
  const [showCompleted, setShowCompleted] = useUiState("subjects.showCompleted", false);
  const { subjects, tasks, sessions, exams, topics, attachments, addSubject, updateSubject, deleteSubject, setActiveView } = useStudyStore();
  const showBarb = useStudyStore((state) => selectPreferences(state).showBarb);
  const state = { tasks, sessions, exams, attachments };
  // Ultima materia archiviata (dalla scheda o dal dettaglio): «Annulla» le rende lo stato di prima per qualche secondo.
  const [archivedNotice, setArchivedNotice] = useState<{ id: string; name: string; previous: Subject["status"] } | null>(null);
  // La scheda archiviata sparisce col suo menu: il focus va su «Annulla», e finché resta lì l'avviso non si chiude.
  const noticeRef = useRef<HTMLDivElement>(null);
  const [noticeFocused, setNoticeFocused] = useState(false);

  useEffect(() => {
    if (!archivedNotice || noticeFocused) return;
    const timer = window.setTimeout(() => setArchivedNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [archivedNotice, noticeFocused]);

  useEffect(() => {
    if (!archivedNotice) return;
    // Dopo il Drawer, che alla chiusura rimette il focus dove l'aveva preso.
    const frame = window.requestAnimationFrame(() => noticeRef.current?.querySelector("button")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [archivedNotice]);

  const open = subjects.find((subject) => subject.id === openId) ?? null;
  // Materia da aprire che non c'è più (eliminata altrove): si dimentica invece di restare in memoria.
  useEffect(() => {
    if (openId && !open) setOpenId(null);
  }, [openId, open, setOpenId]);

  const archiveSubject = (subject: Subject) => {
    setArchivedNotice({ id: subject.id, name: subject.name, previous: subject.status });
    void updateSubject(subject.id, { status: "archived" });
  };
  const undoArchive = () => {
    if (!archivedNotice) return;
    void updateSubject(archivedNotice.id, { status: archivedNotice.previous });
    setArchivedNotice(null);
    setNoticeFocused(false);
  };
  const restoreSubject = (subject: Subject) => void updateSubject(subject.id, { status: "active", archived: false });
  // «Superata»: prima il voto (o l'idoneità) nel libretto, poi la materia passa tra le Superate.
  const [gradeFor, setGradeFor] = useState<string | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [gradeNotice, setGradeNotice] = useState("");
  const completeSubject = (subject: Subject) => {
    setGradeNotice("");
    // Già nel libretto (voto registrato da Esami o dal Libretto): basta lo stato.
    if (librettoEntries(exams, subjects).some((entry) => entry.subjectId === subject.id)) {
      void updateSubject(subject.id, { status: "completed" });
      return;
    }
    setGradeFor(subject.id);
    setGradeOpen(true);
  };
  // Archiviate: si eliminano per sempre, con una conferma che dice cosa si perde.
  const deleteText = (subject: Subject) => {
    const subjectExams = exams.filter((exam) => exam.subjectId === subject.id);
    const graded = subjectExams.filter((exam) => typeof exam.grade === "number" || exam.passFail).length;
    const topicCount = topics.filter((topic) => topic.subjectId === subject.id).length;
    return SUBJECT_REMOVE_TEXT.confirm(subject.name, subjectExams.length, graded, topicCount);
  };
  const deleteForever = async (subject: Subject) => {
    if (openId === subject.id) setOpenId(null);
    await deleteSubject(subject.id);
  };

  const active = subjects.filter((subject) => !isArchivedSubject(subject) && subject.status !== "completed");
  // Materie superate (anche quelle registrate dal libretto): fuori dalla griglia principale.
  const completed = subjects.filter((subject) => !isArchivedSubject(subject) && subject.status === "completed");
  const archived = subjects.filter(isArchivedSubject);
  const visible = active.filter((subject) => semester === "tutti" || subjectSemester(subject) === semester);
  const totalCfu = active.reduce((sum, subject) => sum + (subject.cfu || 0), 0);
  const semesterOptions = semesterFilterOptions(active.map((subject) => subjectSemester(subject)), semester);
  const bySemester = cfuBySemester(active.map((subject) => ({ semester: subjectSemester(subject), cfu: subject.cfu })));

  const card = (subject: Subject) => (
    <SubjectCard
      key={subject.id}
      subject={subject}
      stats={subjectStats(subject, state)}
      onOpen={() => setOpenId(subject.id)}
      onStatus={(status) => void updateSubject(subject.id, { status })}
      onComplete={() => completeSubject(subject)}
      onArchive={() => archiveSubject(subject)}
      onRestore={() => restoreSubject(subject)}
      deleteText={isArchivedSubject(subject) ? deleteText(subject) : ""}
      onDelete={() => deleteForever(subject)}
    />
  );

  const group = (label: string, items: Subject[], expanded: boolean, toggle: () => void, help?: { title: string; text: string }) =>
    items.length ? (
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="flex min-h-8 items-center gap-2 text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
          >
            <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
            {label} · {items.length}
          </button>
          {help ? <HelpTip {...help} /> : null}
        </div>
        {expanded ? (
          <div className="grid grid-cols-1 gap-3 opacity-75 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">{items.map(card)}</div>
        ) : null}
      </div>
    ) : null;

  return (
    <div>
      <SectionTitle
        title="Materie"
        subtitle={active.length ? SUBJECTS_TEXT.subtitle(active.length, totalCfu, bySemester) : SUBJECTS_TEXT.subtitleEmpty}
        action={
          // Secondo modo per aggiungere materie: sceglierle dal piano del corso. Quando l'elenco è
          // vuoto lo stesso invito è nel riquadro sotto, per non mostrarlo due volte.
          showBarb && active.length ? (
            <Button variant="soft" icon="Landmark" onClick={() => setActiveView("barb")}>
              {SUBJECTS_TEXT.chooseFromCourse}
            </Button>
          ) : undefined
        }
      />

      <NewSubjectBar onAdd={async (name) => void (await addSubject({ name, color: nextSubjectColor(subjects, SWATCHES), status: "active", icon: "BookOpen" }))} />

      {/* Un solo filtro, con i conteggi: compare solo quando c'è davvero da scegliere fra più semestri. */}
      {active.length > 0 && (semesterOptions.length > 2 || semester !== "tutti") ? (
        <Segmented className="mb-4" label={SUBJECTS_TEXT.semesterFilter} value={semester} options={semesterOptions} onChange={setSemester} />
      ) : null}

      {/* Sempre presente: il lettore di schermo annuncia l'archiviazione appena compare il testo. */}
      <div role="status" aria-live="polite">
        {archivedNotice ? (
          <div
            ref={noticeRef}
            className="soft-panel mb-4 flex flex-wrap items-center gap-2 p-2.5"
            onFocus={() => setNoticeFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setNoticeFocused(false);
            }}
          >
            <Icon name="Archive" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <p className="safe-text min-w-0 flex-1 text-sm font-bold">{SUBJECT_REMOVE_TEXT.archived(archivedNotice.name)}</p>
            <Button variant="soft" icon="RotateCcw" onClick={undoArchive}>
              {SUBJECT_REMOVE_TEXT.undo}
            </Button>
          </div>
        ) : null}
        {gradeNotice ? (
          <p className="mb-4 rounded-[18px] border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm font-bold text-[var(--success-text)]">{gradeNotice}</p>
        ) : null}
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon="BookOpen"
          title={SUBJECTS_TEXT.emptyTitle}
          body={showBarb ? SUBJECTS_TEXT.emptyBodyCourse : SUBJECTS_TEXT.emptyBody}
          // Un'azione sola: il nome si scrive nella barra qui sopra («Aggiungi materia»), qui resta
          // solo l'altro modo, il piano del corso.
          action={
            showBarb ? (
              <Button variant="primary" icon="Landmark" onClick={() => setActiveView("barb")}>
                {SUBJECTS_TEXT.chooseFromCourse}
              </Button>
            ) : undefined
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="CalendarDays"
          title={SUBJECTS_TEXT.noneInSemesterTitle}
          body={SUBJECTS_TEXT.noneInSemesterBody}
          action={
            <Button variant="soft" onClick={() => setSemester("tutti")}>
              {SUBJECTS_TEXT.showAll}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">{visible.map(card)}</div>
      )}

      {group(SUBJECTS_TEXT.completed, completed, showCompleted, () => setShowCompleted((value) => !value))}
      {group(SUBJECTS_TEXT.archivedGroup, archived, showArchived, () => setShowArchived((value) => !value), SUBJECTS_HELP.archive)}

      <SubjectDrawer
        subject={open}
        onClose={() => setOpenId(null)}
        onArchive={(subject) => {
          setOpenId(null);
          archiveSubject(subject);
        }}
        onRestore={restoreSubject}
      />
      <GradeDrawer
        open={gradeOpen}
        subjectId={gradeFor}
        subjects={subjects}
        exams={exams}
        onClose={() => setGradeOpen(false)}
        onSaved={(text) => {
          setGradeOpen(false);
          setGradeNotice(text);
        }}
      />
    </div>
  );
}

/** Solo il nome: il colore lo sceglie l'app (il primo libero) e si cambia nel dettaglio della materia. */
function NewSubjectBar({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onAdd(name.trim());
    setName("");
  };
  return (
    <form onSubmit={submit} className="soft-panel mb-4 flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">{SUBJECTS_TEXT.nameField}</span>
        <Icon name="Plus" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
        <input id="new-subject-name" className={`${inputClass} pl-10`} value={name} onChange={(event) => setName(event.target.value)} placeholder={SUBJECTS_TEXT.namePlaceholder} />
      </label>
      <Button type="submit" variant="primary" icon="Plus" disabled={!name.trim()}>
        {SUBJECTS_TEXT.add}
      </Button>
    </form>
  );
}

/**
 * Scheda di una materia: tutta la scheda apre il dettaglio (il pulsante del nome copre la scheda con
 * `after:`), mentre il menu "⋯", la pillola dell'esame e la conferma stanno sopra (`relative z-10`).
 */
function SubjectCard({
  subject,
  stats,
  onOpen,
  onStatus,
  onComplete,
  onArchive,
  onRestore,
  onDelete,
  deleteText
}: {
  subject: Subject;
  stats: ReturnType<typeof subjectStats>;
  onOpen: () => void;
  onStatus: (status: Subject["status"]) => void;
  /** «Superata»: chiede il voto (la materia diventa superata quando l'esito è salvato). */
  onComplete: () => void;
  /** Materie non archiviate: archivia subito (l'elenco offre «Annulla»). */
  onArchive: () => void;
  onRestore: () => void;
  /** Materie archiviate: elimina per sempre dopo la conferma sul posto con `deleteText`. */
  onDelete: () => Promise<void>;
  deleteText: string;
}) {
  const course = resolveBarbCourse(subject, BARB_DATASET.courses);
  const semester = subjectSemester(subject);
  const color = subjectColor(subject);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const exam = stats.exam;
  const examPill = exam ? (isDateToDecide(exam) ? SUBJECTS_TEXT.examPillToDecide : SUBJECTS_TEXT.examPill(shortDate(exam.date), daysUntil(exam.date))) : "";

  const [choosing, setChoosing] = useState(false);
  const backToMenu = () => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  const closeChooser = () => {
    setChoosing(false);
    // Il riquadro sparisce: il focus torna al menu da cui era partito.
    backToMenu();
  };
  const menu = subjectMenuItems(subject).map((item): PageAction => {
    switch (item.kind) {
      case "status":
        return { label: SUBJECTS_TEXT.markAs(SUBJECT_STATUS_LABEL[item.status]), icon: STATUS_ICON[item.status], onClick: () => onStatus(item.status) };
      case "complete":
        return { label: SUBJECTS_TEXT.markPassed, icon: STATUS_ICON.completed, onClick: onComplete };
      case "other":
        return {
          label: SUBJECTS_TEXT.otherStatus,
          icon: "MoreHorizontal",
          onClick: () => {
            setConfirming(false);
            setChoosing(true);
          }
        };
      case "archive":
        return { label: SUBJECT_REMOVE_TEXT.archive, icon: "Archive", onClick: onArchive };
      case "restore":
        return { label: SUBJECTS_TEXT.restore, icon: "RotateCcw", onClick: onRestore };
      case "delete":
        return {
          label: SUBJECT_REMOVE_TEXT.deleteForever,
          icon: "Trash2",
          danger: true,
          onClick: () => {
            setChoosing(false);
            setConfirming(true);
          }
        };
    }
  });

  return (
    <article className="quiet-panel motion-safe relative flex min-w-0 flex-col p-3.5 hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border))]">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 grid-cols-1 place-items-center overflow-hidden rounded-super" style={{ background: color }}>
          {subject.cover ? <img src={subject.cover} alt="" className="h-full w-full object-cover" /> : course ? <CourseIcon course={course} className="h-9 w-9 text-[#172333]" /> : <Icon name={subject.icon} className="h-5 w-5 text-[#10131d]" />}
        </span>
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="min-w-0 flex-1 self-center text-left after:absolute after:inset-0 after:rounded-[var(--radius-sm)] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-[3px] focus-visible:after:outline-offset-2 focus-visible:after:outline-[color-mix(in_srgb,var(--accent)_62%,transparent)]"
        >
          <h3 className="two-line-safe text-base font-black leading-snug">{subject.name}</h3>
          <p className="one-line-safe text-xs font-bold text-[var(--muted)]">{subject.teacher || "Docente non indicato"}</p>
        </button>
        <div ref={menuRef} className="relative z-10 -mr-1 -mt-1 shrink-0" role="group" aria-label={SUBJECTS_TEXT.cardMenu(subject.name)}>
          <PageActions more={menu} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-[var(--muted)]">
        <Tag>{SUBJECT_STATUS_LABEL[subject.status]}</Tag>
        {/* Semestre sconosciuto: nessuna etichetta «Da definire» (si sceglie nel dettaglio). */}
        {semester !== "non-definito" ? <Tag color={SEMESTER_TONE[semester]}>{SEMESTER_LABEL[semester]}</Tag> : null}
        <span>{subject.cfu} CFU</span>
        <span>{stats.openTasks.length} attività da fare</span>
        {/* Come in Statistiche: «50 min», «1 h 15 min» (stesso formato, stessi numeri). */}
        <span>{formatMinutes(stats.studyMinutes)} di studio</span>
        {stats.materials.length ? (
          <span className="inline-flex items-center gap-1" title={`${stats.materials.length} ${stats.materials.length === 1 ? "materiale" : "materiali"}`}>
            <Icon name="Paperclip" className="h-3 w-3" />
            {stats.materials.length}
          </span>
        ) : null}
      </div>

      {course ? <BarbExamAvailability course={course} /> : null}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-black">
          <span className="text-[var(--faint)] uppercase">{exam ? "Preparazione all'esame" : "Attività completate"}</span>
          <span>{stats.progress}%</span>
        </div>
        <ProgressBar value={stats.progress} color={color} />
      </div>

      {exam ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => openExam(exam.id)}
            aria-label={`${examPill}: ${SUBJECTS_TEXT.openExam(subject.name)}`}
            className="motion-safe relative z-10 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-soft)] px-3 text-xs font-black hover:bg-[var(--surface)]"
          >
            <Icon name="GraduationCap" className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]" />
            <span className="min-w-0 truncate">{examPill}</span>
            <Icon name="ChevronRight" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          </button>
        </div>
      ) : null}

      {choosing ? (
        <div
          role="group"
          aria-label={SUBJECTS_TEXT.otherStatusTitle(subject.name)}
          className="relative z-10 mt-3 rounded-[18px] bg-[var(--surface-soft)] p-3"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            closeChooser();
          }}
        >
          <p className="safe-text text-sm font-bold">{SUBJECTS_TEXT.otherStatusTitle(subject.name)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {otherStatuses(subject).map((status, index) => (
              <Button
                key={status}
                variant="soft"
                icon={STATUS_ICON[status]}
                autoFocus={index === 0}
                onClick={() => {
                  setChoosing(false);
                  onStatus(status);
                }}
              >
                {SUBJECT_STATUS_LABEL[status]}
              </Button>
            ))}
            <Button variant="ghost" onClick={closeChooser}>
              {SUBJECTS_TEXT.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="relative z-10 mt-3">
          <InlineConfirm
            text={deleteText}
            confirmLabel={SUBJECT_REMOVE_TEXT.deleteForever}
            icon="Trash2"
            busy={deleting}
            onCancel={() => {
              setConfirming(false);
              // La conferma sparisce: il focus torna al menu da cui era partita.
              menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            }}
            onConfirm={() => {
              setDeleting(true);
              void onDelete().finally(() => setDeleting(false));
            }}
          />
        </div>
      ) : null}
    </article>
  );
}

function SubjectDrawer({
  subject,
  onClose,
  onArchive,
  onRestore
}: {
  subject: Subject | null;
  onClose: () => void;
  /** Come dalla scheda: subito, il dettaglio si chiude e l'elenco offre «Annulla». */
  onArchive: (subject: Subject) => void;
  onRestore: (subject: Subject) => void;
}) {
  const { tasks, sessions, exams, attachments, subjects, updateSubject, addAttachment, updateAttachment, deleteAttachment } = useStudyStore();
  const [draft, setDraft] = useState({ name: "", teacher: "", cfu: "6", semester: "", targetGrade: "", color: SWATCHES[0], notes: "" });
  // Dati come sono salvati: il confronto dice se chiudere perderebbe qualcosa.
  const [saved, setSaved] = useState(draft);
  // Chiusura (✕, Esc, tocco fuori, Archivia) in attesa della risposta a «Scartare le modifiche?».
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const fail = (text: string) => setFeedback({ text, error: true });
  const ok = (text: string) => setFeedback({ text, error: false });

  useEffect(() => {
    if (!subject) return;
    const next = {
      name: subject.name,
      teacher: subject.teacher,
      cfu: String(subject.cfu ?? 6),
      semester: subject.semesterOverride ?? "ufficiale",
      targetGrade: subject.targetGrade ? String(subject.targetGrade) : "",
      color: subject.color,
      notes: subject.notes
    };
    setDraft(next);
    setSaved(next);
    setPending(null);
    setFeedback(null);
    setEditingAttachment(null);
  }, [subject?.id]);

  // Copertina, file e argomenti si salvano subito; nome, CFU, colore e note solo con «Salva modifiche».
  const dirty = Boolean(subject) && JSON.stringify(draft) !== JSON.stringify(saved);
  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };

  const course = subject ? resolveBarbCourse(subject, BARB_DATASET.courses) : null;
  const stats = subject ? subjectStats(subject, { tasks, sessions, exams, attachments }) : null;

  const save = async () => {
    if (!subject) return;
    if (!draft.name.trim()) {
      fail("Scrivi il nome della materia.");
      return;
    }
    const cfu = Number(draft.cfu);
    const targetGrade = draft.targetGrade.trim() ? Number(draft.targetGrade) : undefined;
    if (!Number.isFinite(cfu) || cfu < 0 || cfu > 60) {
      fail("CFU non validi: scrivi un numero da 0 a 60.");
      return;
    }
    if (targetGrade !== undefined && (!Number.isFinite(targetGrade) || targetGrade < 18 || targetGrade > 31)) {
      fail("Voto obiettivo non valido: da 18 a 30 (31 = 30 e lode).");
      return;
    }
    await updateSubject(subject.id, {
      name: draft.name.trim(),
      teacher: draft.teacher.trim(),
      universityCourseId: course?.id ?? subject.universityCourseId,
      cfu,
      semester: draft.semester === "ufficiale" ? (course?.semester ?? subject.semester) : draft.semester,
      semesterOverride: draft.semester === "ufficiale" ? undefined : draft.semester as SemesterId,
      targetGrade,
      color: draft.color,
      notes: draft.notes
    });
    const next = { ...draft, name: draft.name.trim(), teacher: draft.teacher.trim() };
    setDraft(next);
    setSaved(next);
    setPending(null);
    ok("Modifiche salvate.");
  };

  const archived = subject ? isArchivedSubject(subject) : false;
  const showTasks = (id: string) => goToView("tasks", [["tasks.subject", id, "tab"], ["tasks.filter", "all", "tab"]]);

  return (
    <Drawer
      open={Boolean(subject)}
      onClose={() => guard(onClose)}
      title={subject?.name ?? ""}
      eyebrow={
        subject ? (
          <>
            {course ? <span className="grid h-10 w-10 grid-cols-1 place-items-center rounded-xl" style={{ background: subjectColor(subject) }}><CourseIcon course={course} className="h-8 w-8 text-[#172333]" /></span> : <span className="h-3 w-3 rounded-full" style={{ background: subjectColor(subject) }} />}
            {subjectSemester(subject) !== "non-definito" ? <Tag color={SEMESTER_TONE[subjectSemester(subject)]}>{SEMESTER_LABEL[subjectSemester(subject)]}</Tag> : null}
            <Tag>{SUBJECT_STATUS_LABEL[subject.status]}</Tag>
            <Tag>{subject.cfu} CFU</Tag>
          </>
        ) : null
      }
      footer={
        subject && pending ? (
          // Stesso schema degli altri moduli: chiudere con dati cambiati chiede prima, sul posto.
          <div role="group" aria-label={SUBJECTS_TEXT.unsavedTitle} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
            <p className="text-sm font-black">{SUBJECTS_TEXT.unsavedTitle}</p>
            <p className="text-sm font-bold text-[var(--muted)]">{SUBJECTS_TEXT.unsavedText}</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="soft" onClick={() => setPending(null)} autoFocus>
                {SUBJECTS_TEXT.unsavedKeep}
              </Button>
              <Button
                variant="danger"
                icon="X"
                onClick={() => {
                  const action = pending;
                  setDraft(saved);
                  setPending(null);
                  action();
                }}
              >
                {SUBJECTS_TEXT.unsavedDiscard}
              </Button>
            </div>
          </div>
        ) : subject ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Come dalla scheda: archiviare è subito e si annulla dall'elenco, niente finestra di conferma. */}
            <span className="inline-flex items-center gap-1">
              <Button variant="soft" icon={archived ? "RotateCcw" : "Archive"} onClick={() => (archived ? onRestore(subject) : guard(() => onArchive(subject)))}>
                {archived ? SUBJECTS_TEXT.restoreSubject : SUBJECTS_TEXT.archiveSubject}
              </Button>
              <HelpTip {...SUBJECTS_HELP.archive} />
            </span>
            <span className="flex-1" />
            {feedback ? (
              <span role={feedback.error ? "alert" : "status"} className={`text-xs font-bold ${feedback.error ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>
                {feedback.text}
              </span>
            ) : null}
            <Button variant="primary" icon="Check" onClick={() => void save()}>
              Salva modifiche
            </Button>
          </div>
        ) : null
      }
    >
      {subject && stats ? (
        <div className="grid grid-cols-1 gap-5">
          {/* I numeri che portano altrove sono pulsanti: "Da fare" → Attività della materia, "Esame tra" → l'esame. */}
          <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            <div className="col-span-2 min-w-0 min-[420px]:col-span-1">
              <StatTile label="Ore di studio" value={formatMinutes(stats.studyMinutes)} />
            </div>
            <StatTile label="Da fare" value={stats.openTasks.length} onClick={() => showTasks(subject.id)} />
            {stats.exam && isDateToDecide(stats.exam) ? (
              <StatTile label={SUBJECTS_TEXT.examIn} value={SUBJECTS_TEXT.examToDecide} onClick={() => openExam(stats.exam!.id)} />
            ) : stats.exam ? (
              <StatTile
                label={daysUntil(stats.exam.date) < 0 ? SUBJECTS_TEXT.examPast : SUBJECTS_TEXT.examIn}
                value={SUBJECTS_TEXT.examInValue(daysUntil(stats.exam.date))}
                hint={shortDate(stats.exam.date)}
                onClick={() => openExam(stats.exam!.id)}
              />
            ) : (
              <StatTile label={SUBJECTS_TEXT.examIn} value="—" />
            )}
          </div>

          {course ? <BarbExamSessions course={course} /> : null}

          <Suspense fallback={null}>
            <SubjectStudyStats subject={subject} />
          </Suspense>

          <section className="grid grid-cols-1 gap-3">
            <h4 className="text-xs font-black uppercase text-[var(--faint)]">Dati della materia</h4>
            <Field label="Nome">
              <input className={inputClass} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Docente (facoltativo)">
                <input className={inputClass} value={draft.teacher} onChange={(event) => setDraft((value) => ({ ...value, teacher: event.target.value }))} placeholder="Es. Mario Rossi" />
              </Field>
              <HelpField label="Semestre" help={SUBJECTS_HELP.semester}>
                {(id) => (
                  <select id={id} className={inputClass} value={draft.semester} onChange={(event) => setDraft((value) => ({ ...value, semester: event.target.value }))}>
                    <option value="ufficiale">{course ? `Dal piano ufficiale: ${SEMESTER_LABEL[course.semester]}` : `Periodo attuale: ${SEMESTER_LABEL[subjectSemester(subject)]}`}</option>
                    {SEMESTER_IDS.map((semesterId) => <option key={semesterId} value={semesterId}>{SEMESTER_LABEL[semesterId]}</option>)}
                  </select>
                )}
              </HelpField>
              <HelpField label="CFU" help={SUBJECTS_HELP.cfu}>
                {(id) => <input id={id} className={inputClass} type="number" min={0} max={60} value={draft.cfu} onChange={(event) => setDraft((value) => ({ ...value, cfu: event.target.value }))} />}
              </HelpField>
              <Field label="Voto obiettivo (facoltativo)">
                <input
                  className={inputClass}
                  type="number"
                  min={18}
                  max={31}
                  value={draft.targetGrade}
                  onChange={(event) => setDraft((value) => ({ ...value, targetGrade: event.target.value }))}
                  placeholder="Es. 28"
                />
              </Field>
            </div>
            {/* fieldset e non label: dentro un label il primo colore diventerebbe "il" campo e un tocco sulla scritta lo sceglierebbe. */}
            <fieldset className="min-w-0">
              <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">Colore</legend>
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={swatchLabel(swatch)}
                    title={swatchLabel(swatch)}
                    aria-pressed={draft.color.toLowerCase() === swatch.toLowerCase()}
                    onClick={() => setDraft((value) => ({ ...value, color: swatch }))}
                    className={`h-8 w-8 rounded-full border-2 ${draft.color.toLowerCase() === swatch.toLowerCase() ? "border-[var(--text)]" : "border-transparent"}`}
                    style={{ background: swatch }}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Colore personalizzato"
                  value={draft.color.startsWith("#") ? draft.color : "#7CF7C8"}
                  onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))}
                  className="h-8 w-10 rounded-full border border-[var(--border)] bg-transparent p-0.5"
                />
              </div>
            </fieldset>
            <Field label="Note (facoltative)">
              <textarea className={`${inputClass} min-h-20 py-3`} value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} placeholder="Es. Ricevimento il martedì alle 14" />
            </Field>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase text-[var(--faint)]">Materiali · {stats.materials.length}</h4>
              <div className="flex flex-wrap justify-end gap-1.5">
                <label className="motion-safe inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                  <Icon name="Upload" className="h-3.5 w-3.5" /> Carica un file
                  <input
                    type="file"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setFeedback(null);
                      try {
                        await addAttachment(file, { type: "subject", id: subject.id });
                      } catch (error) {
                        fail(error instanceof Error ? error.message : "File non caricato: riprova o scegli un altro file.");
                      }
                    }}
                  />
                </label>
                <label className="motion-safe inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                  <Icon name="Image" className="h-3.5 w-3.5" /> {subject.cover ? "Cambia copertina" : "Copertina"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (event) => {
                      try {
                        const cover = await readCoverImage(event.target.files?.[0]);
                        if (cover) await updateSubject(subject.id, { cover });
                      } catch (error) {
                        fail(error instanceof Error ? error.message : "Immagine non valida: scegli un altro file.");
                      } finally {
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                {subject.cover ? (
                  <button
                    type="button"
                    onClick={() => void updateSubject(subject.id, { cover: undefined })}
                    className="min-h-8 rounded-full px-3 text-xs font-black text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                  >
                    Rimuovi copertina
                  </button>
                ) : null}
              </div>
            </div>
            {stats.materials.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {stats.materials.map((attachment) =>
                  editingAttachment?.id === attachment.id ? (
                    <li key={attachment.id}>
                      <AttachmentInlineEditor
                        attachment={attachment}
                        onCancel={() => setEditingAttachment(null)}
                        onSave={async (patch) => {
                          await updateAttachment(attachment.id, patch);
                          setEditingAttachment(null);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={attachment.id} className="group flex min-w-0 items-center gap-2 rounded-[14px] px-2 py-1.5 hover:bg-[var(--surface-soft)]">
                      <Icon name={ATTACHMENT_KIND_ICON[attachmentKind(attachment)]} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                      <span className="one-line-safe min-w-0 flex-1 text-sm font-bold">{attachment.name}</span>
                      <IconButton icon="PenLine" label={`Modifica ${attachment.name}`} className="h-8 w-8 bg-transparent" onClick={() => setEditingAttachment(attachment)} />
                      <IconButton
                        icon="Trash2"
                        label={`Elimina ${attachment.name}`}
                        className="h-8 w-8 bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                        onClick={() => {
                          const label = attachment.name.length > 80 ? `${attachment.name.slice(0, 79)}…` : attachment.name;
                          if (window.confirm(`Eliminare "${label}"? Il materiale viene tolto dall'app e non si può recuperare.`)) void deleteAttachment(attachment.id);
                        }}
                      />
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">Ancora nessun materiale: carica qui dispense, appunti o slide di questa materia.</p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase text-[var(--faint)]">Attività da fare · {stats.openTasks.length}</h4>
              <button
                type="button"
                onClick={() => showTasks(subject.id)}
                className="inline-flex min-h-8 items-center gap-1 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
              >
                {SUBJECTS_TEXT.allTasks}
                <Icon name="ChevronRight" className="h-3.5 w-3.5" />
              </button>
            </div>
            {stats.openTasks.length ? (
              <ul className="grid grid-cols-1 gap-0.5">
                {stats.openTasks.slice(0, 8).map((task) => (
                  <li key={task.id}>
                    {/* Ogni attività si apre in Attività (la sezione legge `tasks.editing`). */}
                    <button
                      type="button"
                      onClick={() => goToView("tasks", [["tasks.editing", task.id, "tab"]])}
                      aria-label={SUBJECTS_TEXT.openTask(task.title)}
                      className="motion-safe flex min-h-10 w-full min-w-0 items-center gap-2 rounded-[12px] px-2 text-left text-sm hover:bg-[var(--surface-soft)]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: subjectColor(subject) }} />
                      <span className="one-line-safe min-w-0 flex-1 font-bold">{task.title}</span>
                      {task.dueDate ? <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{shortDate(task.dueDate)}</span> : null}
                      <Icon name="ChevronRight" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">{SUBJECTS_TEXT.noTasks}</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Argomenti da ripassare</h4>
            <TopicManager subjects={subjects} subjectId={subject.id} />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function AttachmentInlineEditor({
  attachment,
  onCancel,
  onSave
}: {
  attachment: Attachment;
  onCancel: () => void;
  onSave: (patch: Partial<Attachment>) => Promise<void>;
}) {
  const [name, setName] = useState(attachment.name);
  const [description, setDescription] = useState(attachment.description);
  const [tags, setTags] = useState(attachment.tags.join(", "));
  return (
    <div className="grid grid-cols-1 gap-2 rounded-[16px] bg-[var(--surface-soft)] p-3">
      <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome del materiale" />
      <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrizione (facoltativa)" aria-label="Descrizione (facoltativa)" />
      <input className={inputClass} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Etichette separate da virgola (Es. appunti, esame)" aria-label="Etichette separate da virgola (facoltative)" />
      <div className="flex justify-end gap-2">
        <Button variant="soft" onClick={onCancel} className="min-h-9">
          Annulla
        </Button>
        <Button
          variant="primary"
          icon="Check"
          className="min-h-9"
          disabled={!name.trim()}
          onClick={() =>
            void onSave({
              name: name.trim(),
              description: description.trim(),
              tags: tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }
        >
          Salva modifiche
        </Button>
      </div>
    </div>
  );
}
