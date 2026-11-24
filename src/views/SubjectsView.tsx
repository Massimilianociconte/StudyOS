import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Subject } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { daysUntil, shortDate } from "../lib/selectors";
import { readCoverImage } from "../lib/files";
import { isDateToDecide } from "../lib/examOutcome";
import { librettoEntries, recordedSubjectIds } from "../lib/grades";
import { isGradePending, openExamOf, programToAdd, reviewStatus, subjectProgress } from "../lib/subjectProgress";
import { EXAMS_NEW_FOR_KEY, examLinkPlan } from "../lib/examsUi";
import { PROGRESS_TEXT } from "../lib/labels/progress";
import { SubjectProgressPanel } from "../components/SubjectProgressPanel";
import { GradeDrawer } from "../components/GradeDrawer";
import { ATTACHMENT_KIND_ICON, FILE_TEXT, SUBJECT_STATUS_LABEL, attachmentKind, formatMinutes } from "../lib/labels";
import { SUBJECT_FORM_TEXT, SUBJECT_REMOVE_TEXT, SUBJECT_SORT_TEXT, SUBJECTS_HELP, SUBJECTS_TEXT } from "../lib/labels/subjects";
import { Button, Drawer, EmptyState, HelpTip, IconButton, PageActions, SectionTitle, Segmented, StatTile, Tag, inputClass, type PageAction } from "../components/ui";
import { InlineConfirm } from "../components/InlineConfirm";
import { UnsavedPrompt } from "../components/UnsavedPrompt";
import { LinkedNotes } from "../components/NoteDrawer";
import { Icon } from "../components/Icon";
import { CourseIcon } from "../components/CourseIcon";
import { BarbExamAvailability, BarbExamSessions } from "../components/BarbExamSessions";
import { SubjectGroupExams } from "../components/groupExams/SubjectGroupExams";
import { draftFromBarbForSubject, type SessionDraft } from "../lib/groupExamForm";
import { useGroupExamStore } from "../store/useGroupExamStore";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { resolveBarbCourse } from "../lib/university/examSessions";
import { subjectSemester, SEMESTER_LABEL, SEMESTER_TONE, SEMESTER_IDS } from "../lib/semesters";
import { TopicManager } from "../components/TopicManager";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { goToView, useLinkedUiState } from "../hooks/useLinkedUiState";
import { SubjectDuplicates } from "../components/SubjectDuplicates";
import { SubjectFields } from "../components/SubjectFields";
import { SubjectFormModal } from "../components/SubjectFormModal";
import { SUBJECT_FORM_STATUSES, SUBJECT_SWATCHES, newSubjectDraft, subjectDraftOf, subjectDraftProblem, subjectFieldsFromDraft, type SubjectDraft } from "../lib/subjectFields";
import { SubjectDuplicateError } from "../lib/subjectIdentity";
import { cfuBySemester, isArchivedSubject, otherStatuses, semesterFilterOptions, subjectMenuItems, type SemesterFilter } from "../lib/subjectCards";
import { safeCssColor } from "../lib/sharing";
import { safeHref } from "../lib/safeUrl";
import { FILE_STATES, fileStateText, useMaterialFiles, useOpenMaterial } from "../components/MaterialFile";
import { FILE_ACCEPT } from "../lib/attachments";
import { COURSE_INK, DARK_INK, inkOn } from "../lib/subjectInk";
import { EXAM_DATE_LATER, SUBJECT_SORTS, mergeSubsetOrder, sortSubjects, validSubjectOrder, validSubjectSort, type SubjectSort, type SubjectSortKeys } from "../lib/subjectSort";
import { IconMark, IconSelect } from "../components/IconSelect";
import { SubjectOrderDrawer } from "../components/SubjectOrderDrawer";

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
/** Inchiostro dell'icona sul colore della materia (anche un colore scuro scelto a mano); le icone del corso hanno il loro blu scuro. */
const iconInk = (subject: Subject, course: boolean) => inkOn(subject.color, course ? COURSE_INK : DARK_INK);
// Icona di ogni criterio nella tendina «Ordina».
const SORT_ICON: Record<SubjectSort, string> = {
  custom: "ListOrdered",
  exam: "CalendarClock",
  name: "ArrowDownAZ",
  "cfu-desc": "ArrowDownWideNarrow",
  "cfu-asc": "ArrowUpNarrowWide",
  progress: "Gauge"
};
const SORT_OPTIONS = SUBJECT_SORTS.map((mode) => ({ value: mode, label: SUBJECT_SORT_TEXT.options[mode], mark: <IconMark name={SORT_ICON[mode]} /> }));
const idsOf = (list: readonly Subject[]) => list.map((subject) => subject.id);
// Studio della materia (grafico con recharts): si carica solo aprendo il dettaglio.
const SubjectStudyStats = lazy(() => import("../components/SubjectStudyStats"));

/** Porta all'esame aperto in Esami (la sezione legge `exams.editing`). */
const openExam = (examId: string) => goToView("exams", [["exams.editing", examId, "tab"]]);

type StoreState = ReturnType<typeof useStudyStore.getState>;

/** Collegamenti del pannello dei progressi, come dalla scheda d'esame: attività della materia, argomenti in Studio. */
const openLinked = (target: "tasks" | "topics", subjectId: string) => {
  const plan = examLinkPlan(target, subjectId);
  goToView(plan.view, plan.writes.map((write) => [write.key, write.value, write.scope] as const));
};
/** «Aggiungi l'esame» per una materia senza esame: Esami apre il modulo con la materia già scelta. */
const addExamFor = (subjectId: string) => goToView("exams", [[EXAMS_NEW_FOR_KEY, subjectId, "tab"]]);

const subjectStats = (subject: Subject, state: Pick<StoreState, "tasks" | "sessions" | "exams" | "attachments" | "topics">) => {
  const subjectTasks = state.tasks.filter((task) => task.subjectId === subject.id && task.status !== "archived");
  const openTasks = subjectTasks.filter((task) => task.status !== "done");
  const studyMinutes = state.sessions
    .filter((session) => session.subjectId === subject.id && session.status === "completed")
    .reduce((sum, session) => sum + session.actualMinutes, 0);
  const materials = state.attachments.filter((attachment) => attachment.linkedEntityType === "subject" && attachment.linkedEntityId === subject.id);
  // Tre indicatori distinti (src/lib/subjectProgress.ts): avanzamento delle attività, preparazione
  // dell'esame da sostenere, ripasso. Stesso calcolo della regola dello store: al 100% del progresso
  // (la preparazione con un esame, altrimenti le attività) la materia passa a «Completata».
  // `exam`: l'esame da preparare; `pendingExam`: uno già passato senza esito (niente barra, «da registrare»).
  const { progress, exam, pendingExam, activity } = subjectProgress(subject.id, state.tasks, state.exams);
  const review = reviewStatus(subject.id, state.topics);
  const program = exam?.program.length ? { toAdd: programToAdd(subject.id, exam.program, state.topics).length, total: exam.program.length } : null;
  return { subjectTasks, openTasks, studyMinutes, exam, pendingExam, materials, progress, activity, review, program };
};

type ProgressActions = {
  /** ± sulla preparazione dell'esame da sostenere (lo stesso numero di Esami). */
  onPrep: (delta: number) => void;
  onAddExam: () => void;
  /** Argomenti del programma dell'esame nel ripasso (quelli già presenti non si duplicano). */
  onImportProgram: () => void;
  onOpenTasks: () => void;
  onOpenReview: () => void;
};

/**
 * Azioni del pannello dei progressi per una materia, uguali nella scheda e nel dettaglio: la
 * preparazione si scrive sull'esame da sostenere (updateExam, quindi anche la regola del 100%), gli
 * argomenti del programma con addTopics. `guard` avvolge gli spostamenti (il dettaglio chiede prima
 * di perdere modifiche non salvate).
 */
const progressActionsFor = (onNotice: (text: string) => void, guard: (action: () => void) => void = (action) => action()) =>
  (subject: Subject): ProgressActions => ({
    onPrep: (delta) => {
      const state = useStudyStore.getState();
      const exam = subjectProgress(subject.id, state.tasks, state.exams).exam;
      if (!exam) return;
      void state.updateExam(exam.id, { preparation: Math.max(0, Math.min(100, exam.preparation + delta)) });
    },
    onAddExam: () => guard(() => addExamFor(subject.id)),
    onImportProgram: () => {
      const state = useStudyStore.getState();
      const exam = subjectProgress(subject.id, state.tasks, state.exams).exam;
      if (!exam) return;
      void state.addTopics(exam.program.map((title) => ({ title, subjectId: subject.id }))).then((added) => onNotice(PROGRESS_TEXT.programAdded(added, subject.name)));
    },
    onOpenTasks: () => guard(() => openLinked("tasks", subject.id)),
    onOpenReview: () => guard(() => openLinked("topics", subject.id))
  });

export function SubjectsView() {
  // Letta anche quando un'altra sezione porta qui una materia da aprire (es. dalla Home).
  const [openId, setOpenId] = useLinkedUiState<string | null>("subjects.open", null, { validate: isNullableString });
  const [showArchived, setShowArchived] = useUiState("subjects.showArchived", false);
  const [semester, setSemester] = useUiState<SemesterFilter>("subjects.semester", "tutti", { validate: oneOf("tutti", ...SEMESTER_IDS) });
  const [showCompleted, setShowCompleted] = useUiState("subjects.showCompleted", false);
  const [showPending, setShowPending] = useUiState("subjects.showPending", true);
  const { subjects, tasks, sessions, exams, topics, attachments, updateSubject, deleteSubject, setActiveView } = useStudyStore();
  const showBarb = useStudyStore((state) => selectPreferences(state).showBarb);
  // Ordine delle materie (preferenze dell'account): un criterio o l'ordine proprio, fatto in «Riordina».
  const sortPref = useStudyStore((state) => selectPreferences(state).subjectSort);
  const orderPref = useStudyStore((state) => selectPreferences(state).subjectOrder);
  const updatePreferences = useStudyStore((state) => state.updatePreferences);
  const sortMode = validSubjectSort(sortPref);
  const order = useMemo(() => validSubjectOrder(orderPref), [orderPref]);
  const [reordering, setReordering] = useState(false);
  const state = { tasks, sessions, exams, attachments, topics };
  // Esito di «Aggiungi al ripasso» dal pannello dei progressi.
  const [reviewNotice, setReviewNotice] = useState("");
  const progressActions = progressActionsFor(setReviewNotice);
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

  // «Nuova materia»: il modulo completo (nome e Invio bastano, il resto in «Altri dettagli»).
  const [creating, setCreating] = useState(false);
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

  // Chiavi dei criteri: esame da preparare (data da decidere dopo le date) e avanzamento.
  const sortKeys: SubjectSortKeys = {
    order,
    examDate: (id) => {
      const exam = openExamOf(id, exams);
      return exam ? (isDateToDecide(exam) ? EXAM_DATE_LATER : exam.date) : undefined;
    },
    progress: (id) => subjectProgress(id, tasks, exams).progress
  };
  const sorted = (list: readonly Subject[], mode: SubjectSort = sortMode) => sortSubjects(list, mode, sortKeys);
  const active = sorted(subjects.filter((subject) => !isArchivedSubject(subject) && subject.status !== "completed"));
  // Completate senza voto nel libretto (al 100% o segnate a mano): in alto, finché il voto non c'è.
  const recorded = useMemo(() => recordedSubjectIds(exams), [exams]);
  const pendingGrade = sorted(subjects.filter((subject) => !isArchivedSubject(subject) && isGradePending(subject, recorded)));
  // Materie superate (anche quelle registrate dal libretto): fuori dalla griglia principale.
  const completed = sorted(subjects.filter((subject) => !isArchivedSubject(subject) && subject.status === "completed" && !isGradePending(subject, recorded)));
  const archived = sorted(subjects.filter(isArchivedSubject));
  const visible = active.filter((subject) => semester === "tutti" || subjectSemester(subject) === semester);
  const totalCfu = active.reduce((sum, subject) => sum + (subject.cfu || 0), 0);
  const semesterOptions = semesterFilterOptions(active.map((subject) => subjectSemester(subject)), semester);
  const showSemester = active.length > 0 && (semesterOptions.length > 2 || semester !== "tutti");
  const bySemester = cfuBySemester(active.map((subject) => ({ semester: subjectSemester(subject), cfu: subject.cfu })));

  const card = (subject: Subject) => (
    <SubjectCard
      key={subject.id}
      subject={subject}
      stats={subjectStats(subject, state)}
      gradePending={isGradePending(subject, recorded)}
      onOpen={() => setOpenId(subject.id)}
      onStatus={(status) => void updateSubject(subject.id, { status })}
      onComplete={() => completeSubject(subject)}
      onArchive={() => archiveSubject(subject)}
      onRestore={() => restoreSubject(subject)}
      deleteText={isArchivedSubject(subject) ? deleteText(subject) : ""}
      onDelete={() => deleteForever(subject)}
      {...progressActions(subject)}
    />
  );

  const group = (label: string, items: Subject[], expanded: boolean, toggle: () => void, help?: { title: string; text: string }, top = false) =>
    items.length ? (
      <div className={top ? "mb-4" : "mt-6"}>
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="flex min-h-11 items-center gap-2 text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
          >
            <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
            {label} · {items.length}
          </button>
          {help ? <HelpTip {...help} /> : null}
        </div>
        {expanded ? (
          // In alto (voto da registrare) le schede sono da usare: niente velatura.
          <div className={`grid grid-cols-1 gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))] ${top ? "" : "opacity-75"}`}>{items.map(card)}</div>
        ) : null}
      </div>
    ) : null;

  return (
    <div>
      <SectionTitle
        title="Materie"
        subtitle={active.length ? SUBJECTS_TEXT.subtitle(active.length, totalCfu, bySemester) : SUBJECTS_TEXT.subtitleEmpty}
        action={
          <>
            {/* Secondo modo per aggiungere materie: sceglierle dal piano del corso. Quando l'elenco è
                vuoto lo stesso invito è nel riquadro sotto, per non mostrarlo due volte. */}
            {showBarb && active.length ? (
              <Button variant="soft" icon="Landmark" onClick={() => setActiveView("barb")}>
                {SUBJECTS_TEXT.chooseFromCourse}
              </Button>
            ) : null}
            <Button variant="primary" icon="Plus" onClick={() => setCreating(true)}>
              {SUBJECTS_TEXT.add}
            </Button>
          </>
        }
      />

      <SubjectDuplicates onMerged={(keepId, dropId) => (openId === dropId ? setOpenId(keepId) : undefined)} />

      {group(SUBJECTS_TEXT.pendingGroup, pendingGrade, showPending, () => setShowPending((value) => !value), SUBJECTS_HELP.pendingGrade, true)}

      {/* Semestre (un solo filtro, con i conteggi: solo quando c'è davvero da scegliere) e ordine delle materie. */}
      {showSemester || active.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {showSemester ? <Segmented label={SUBJECTS_TEXT.semesterFilter} value={semester} options={semesterOptions} onChange={setSemester} /> : null}
          {active.length > 1 ? (
            <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
              <span aria-hidden="true" className="shrink-0 text-xs font-black uppercase text-[var(--faint)]">
                {SUBJECT_SORT_TEXT.label}
              </span>
              <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
                <IconSelect
                  value={sortMode}
                  options={SORT_OPTIONS}
                  label={SUBJECT_SORT_TEXT.selectLabel}
                  onChange={(value) => void updatePreferences({ subjectSort: validSubjectSort(value) })}
                />
              </div>
              {/* Sul telefono solo l'icona, per lasciare il posto alla tendina. */}
              <span className="sm:hidden">
                <IconButton icon="GripVertical" label={SUBJECT_SORT_TEXT.reorderTitle} onClick={() => setReordering(true)} />
              </span>
              <span className="hidden sm:block">
                <Button variant="soft" icon="GripVertical" onClick={() => setReordering(true)}>
                  {SUBJECT_SORT_TEXT.reorder}
                </Button>
              </span>
            </div>
          ) : null}
        </div>
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
        {reviewNotice ? (
          <p className="mb-4 rounded-[18px] border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm font-bold text-[var(--success-text)]">{reviewNotice}</p>
        ) : null}
      </div>

      {active.length === 0 && pendingGrade.length ? null : active.length === 0 ? (
        <EmptyState
          icon="BookOpen"
          title={SUBJECTS_TEXT.emptyTitle}
          body={showBarb ? SUBJECTS_TEXT.emptyBodyCourse : SUBJECTS_TEXT.emptyBody}
          // «Nuova materia» è già in alto: qui resta solo l'altro modo, il piano del corso.
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

      {reordering ? (
        <SubjectOrderDrawer
          subjects={active}
          initial={idsOf(active)}
          seed={(mode) => idsOf(sorted(active, mode))}
          detail={(subject) => {
            const exam = openExamOf(subject.id, exams);
            const when = !exam ? SUBJECT_SORT_TEXT.noExam : isDateToDecide(exam) ? SUBJECTS_TEXT.examPillToDecide : SUBJECTS_TEXT.examPill(shortDate(exam.date), daysUntil(exam.date));
            return `${SUBJECT_SORT_TEXT.cfu(subject.cfu || 0)} · ${when}`;
          }}
          onClose={() => setReordering(false)}
          onSave={(ids) => {
            // Le materie superate e archiviate tengono il loro posto nell'ordine completo.
            const full = idsOf(sortSubjects(subjects, "custom", { order }));
            void updatePreferences({ subjectOrder: mergeSubsetOrder(full, ids), subjectSort: "custom" });
            setReordering(false);
          }}
        />
      ) : null}

      {creating ? <SubjectFormModal onClose={() => setCreating(false)} onCreated={() => undefined} onOpenExisting={(id) => setOpenId(id)} /> : null}

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

/**
 * Scheda di una materia: tutta la scheda apre il dettaglio (il pulsante del nome copre la scheda con
 * `after:`), mentre il menu "⋯", la pillola dell'esame e la conferma stanno sopra (`relative z-10`).
 */
function SubjectCard({
  subject,
  stats,
  gradePending,
  onOpen,
  onStatus,
  onComplete,
  onArchive,
  onRestore,
  onDelete,
  deleteText,
  ...progress
}: ProgressActions & {
  subject: Subject;
  stats: ReturnType<typeof subjectStats>;
  /** «Completata» senza voto nel libretto: etichetta «Voto da registrare» e pulsante «Registra il voto». */
  gradePending: boolean;
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
  // La pillola porta all'esame da preparare o, se non c'è, a quello passato con l'esito da registrare.
  const exam = stats.exam ?? stats.pendingExam;
  const examPill = exam ? (isDateToDecide(exam) ? SUBJECTS_TEXT.examPillToDecide : SUBJECTS_TEXT.examPill(shortDate(exam.date), daysUntil(exam.date))) : "";

  const [choosing, setChoosing] = useState(false);
  const backToMenu = () => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  const closeChooser = () => {
    setChoosing(false);
    // Il riquadro sparisce: il focus torna al menu da cui era partito.
    backToMenu();
  };
  const menu = subjectMenuItems(subject, gradePending).map((item): PageAction => {
    switch (item.kind) {
      case "status":
        return { label: SUBJECTS_TEXT.markAs(SUBJECT_STATUS_LABEL[item.status]), icon: STATUS_ICON[item.status], onClick: () => onStatus(item.status) };
      case "complete":
        return { label: gradePending ? SUBJECTS_TEXT.recordGrade : SUBJECTS_TEXT.markPassed, icon: STATUS_ICON.completed, onClick: onComplete };
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
        <span className="grid h-11 w-11 shrink-0 grid-cols-1 place-items-center overflow-hidden rounded-super" style={{ background: color, color: iconInk(subject, Boolean(course)) }}>
          {subject.cover ? <img src={subject.cover} alt="" className="h-full w-full object-cover" /> : course ? <CourseIcon course={course} className="h-9 w-9" /> : <Icon name={subject.icon} className="h-5 w-5" />}
        </span>
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="min-w-0 flex-1 self-center text-left after:absolute after:inset-0 after:rounded-[var(--radius-sm)] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-[3px] focus-visible:after:outline-offset-2 focus-visible:after:outline-[color:var(--focus-ring)]"
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
        {gradePending ? <Tag color="var(--warning)">{SUBJECTS_TEXT.pendingTag}</Tag> : null}
        {/* Semestre sconosciuto: nessuna etichetta «Da definire» (si sceglie nel dettaglio). */}
        {semester !== "non-definito" ? <Tag color={SEMESTER_TONE[semester]}>{SEMESTER_LABEL[semester]}</Tag> : null}
        <span>{subject.cfu} CFU</span>
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
      {/* Tre indicatori distinti, modificabili sul posto (sopra il pulsante che apre la scheda). */}
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <SubjectProgressPanel
          name={subject.name}
          color={color}
          activity={stats.activity}
          preparation={stats.exam ? { value: stats.exam.preparation, onChange: progress.onPrep } : null}
          pendingOutcome={!stats.exam && stats.pendingExam ? { date: shortDate(stats.pendingExam.date), onOpen: () => openExam(stats.pendingExam!.id) } : null}
          onAddExam={isArchivedSubject(subject) ? undefined : progress.onAddExam}
          review={stats.review}
          program={stats.program ? { ...stats.program, onAdd: progress.onImportProgram } : null}
          onOpenTasks={progress.onOpenTasks}
          onOpenReview={progress.onOpenReview}
        />
      </div>

      {gradePending ? (
        <div className="mt-3">
          <Button variant="primary" icon="GraduationCap" className="relative z-10" onClick={onComplete} aria-label={SUBJECTS_TEXT.recordGradeAria(subject.name)}>
            {SUBJECTS_TEXT.recordGrade}
          </Button>
        </div>
      ) : null}

      {exam ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => openExam(exam.id)}
            aria-label={`${examPill}: ${SUBJECTS_TEXT.openExam(subject.name)}`}
            className="motion-safe relative z-10 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-soft)] px-3 text-xs font-black hover:bg-[var(--surface)]"
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
  const { tasks, sessions, exams, attachments, topics, subjects, updateSubject, addAttachment, updateAttachment, deleteAttachment } = useStudyStore();
  const [draft, setDraft] = useState<SubjectDraft>(() => newSubjectDraft(SUBJECT_SWATCHES[0]));
  // Dati come sono salvati: il confronto dice se chiudere perderebbe qualcosa.
  const [saved, setSaved] = useState(draft);
  // Chiusura (✕, Esc, tocco fuori, Archivia) in attesa della risposta a «Scartare le modifiche?».
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const [confirmingMaterial, setConfirmingMaterial] = useState<string | null>(null);
  // Argomento o materiale in modifica (salvati a parte) con cambi non salvati: anche loro chiedono prima di chiudere.
  const [topicDirty, setTopicDirty] = useState(false);
  const [materialDirty, setMaterialDirty] = useState(false);
  const fail = (text: string) => setFeedback({ text, error: true });
  // File dei materiali: copia locale o download dall'account (src/lib/attachmentSync.ts).
  const files = useMaterialFiles();
  const opener = useOpenMaterial();
  useEffect(() => {
    if (opener.error) fail(opener.error);
  }, [opener.error]);
  const ok = (text: string) => setFeedback({ text, error: false });

  useEffect(() => {
    if (!subject) return;
    const next = subjectDraftOf(subject);
    setDraft(next);
    setSaved(next);
    setPending(null);
    setFeedback(null);
    setEditingAttachment(null);
    setConfirmingMaterial(null);
  }, [subject?.id]);

  // Copertina, file e argomenti si salvano subito; nome, CFU, colore e note solo con «Salva modifiche».
  const draftDirty = Boolean(subject) && JSON.stringify(draft) !== JSON.stringify(saved);
  const dirty = draftDirty || (Boolean(subject) && (topicDirty || materialDirty));
  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };

  const course = subject ? resolveBarbCourse(subject, BARB_DATASET.courses) : null;
  // «Aggiungi al gruppo» da un appello ufficiale: la sezione degli appelli del gruppo apre il modulo.
  const [groupDraft, setGroupDraft] = useState<SessionDraft | null>(null);
  const hasExamGroups = useGroupExamStore((state) => state.groups.length > 0);
  const stats = subject ? subjectStats(subject, { tasks, sessions, exams, attachments, topics }) : null;
  const gradePending = subject ? isGradePending(subject, recordedSubjectIds(exams)) : false;

  const save = async () => {
    if (!subject) return;
    // Stesse regole di «Nuova materia» e degli strumenti degli agenti (src/lib/subjectFields.ts).
    const problem = subjectDraftProblem(draft);
    if (problem) {
      fail(problem);
      return;
    }
    const fields = subjectFieldsFromDraft(draft, { officialSemester: course?.semester, currentSemester: subject.semester });
    try {
      await updateSubject(subject.id, {
        ...fields,
        universityCourseId: course?.id ?? subject.universityCourseId,
        // Completata o archiviata: lo stato si cambia dalla scheda (Superata chiede il voto), non da qui.
        status: (SUBJECT_FORM_STATUSES as readonly string[]).includes(subject.status) ? fields.status : subject.status
      });
    } catch (problem) {
      fail(problem instanceof SubjectDuplicateError ? problem.message : SUBJECT_FORM_TEXT.saveError);
      return;
    }
    const next = { ...draft, name: draft.name.trim(), teacher: draft.teacher.trim() };
    setDraft(next);
    setSaved(next);
    setPending(null);
    ok("Modifiche salvate.");
  };

  const archived = subject ? isArchivedSubject(subject) : false;
  // Andare in un'altra sezione chiude il dettaglio: con modifiche non salvate prima si chiede.
  const showTasks = (id: string) => guard(() => goToView("tasks", [["tasks.subject", id, "tab"], ["tasks.filter", "all", "tab"]]));
  const showExam = (examId: string) => guard(() => openExam(examId));
  const showMaterials = (id: string) =>
    guard(() => goToView("materials", [["materials.subject", id, "device"], ["materials.kind", "all", "device"], ["materials.query", "", "tab"]]));
  // Stesso pannello della scheda: ± sulla preparazione, «Aggiungi al ripasso», collegamenti (con la guardia).
  const progress = subject ? progressActionsFor(ok, guard)(subject) : null;

  return (
    <Drawer
      open={Boolean(subject)}
      onClose={() => guard(onClose)}
      title={subject?.name ?? ""}
      eyebrow={
        subject ? (
          <>
            {course ? <span className="grid h-10 w-10 grid-cols-1 place-items-center rounded-xl" style={{ background: subjectColor(subject), color: iconInk(subject, true) }}><CourseIcon course={course} className="h-8 w-8" /></span> : <span className="h-3 w-3 rounded-full" style={{ background: subjectColor(subject) }} />}
            {subjectSemester(subject) !== "non-definito" ? <Tag color={SEMESTER_TONE[subjectSemester(subject)]}>{SEMESTER_LABEL[subjectSemester(subject)]}</Tag> : null}
            <Tag>{SUBJECT_STATUS_LABEL[subject.status]}</Tag>
            {gradePending ? <Tag color="var(--warning)">{SUBJECTS_TEXT.pendingTag}</Tag> : null}
            <Tag>{subject.cfu} CFU</Tag>
          </>
        ) : null
      }
      footer={
        subject && pending ? (
          // Stesso schema degli altri moduli: chiudere con dati cambiati chiede prima, sul posto.
          <div role="group" aria-label={SUBJECTS_TEXT.unsavedTitle} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
            <p className="text-sm font-black">{SUBJECTS_TEXT.unsavedTitle}</p>
            <p className="text-sm font-bold text-[var(--muted)]">{draftDirty ? SUBJECTS_TEXT.unsavedText : SUBJECTS_TEXT.unsavedItemText}</p>
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
              <StatTile label={SUBJECTS_TEXT.examIn} value={SUBJECTS_TEXT.examToDecide} onClick={() => showExam(stats.exam!.id)} />
            ) : stats.exam ?? stats.pendingExam ? (
              <StatTile
                label={daysUntil((stats.exam ?? stats.pendingExam)!.date) < 0 ? SUBJECTS_TEXT.examPast : SUBJECTS_TEXT.examIn}
                value={SUBJECTS_TEXT.examInValue(daysUntil((stats.exam ?? stats.pendingExam)!.date))}
                hint={shortDate((stats.exam ?? stats.pendingExam)!.date)}
                onClick={() => showExam((stats.exam ?? stats.pendingExam)!.id)}
              />
            ) : (
              <StatTile label={SUBJECTS_TEXT.examIn} value="—" />
            )}
          </div>

          {progress ? (
            <section className="quiet-panel p-3.5" aria-label={SUBJECTS_TEXT.progressTitle}>
              <SubjectProgressPanel
                name={subject.name}
                color={subjectColor(subject)}
                activity={stats.activity}
                preparation={stats.exam ? { value: stats.exam.preparation, onChange: progress.onPrep } : null}
                pendingOutcome={!stats.exam && stats.pendingExam ? { date: shortDate(stats.pendingExam.date), onOpen: () => showExam(stats.pendingExam!.id) } : null}
                onAddExam={archived ? undefined : progress.onAddExam}
                review={stats.review}
                program={stats.program ? { ...stats.program, onAdd: progress.onImportProgram } : null}
                onOpenTasks={progress.onOpenTasks}
                onOpenReview={progress.onOpenReview}
              />
            </section>
          ) : null}

          {course ? <BarbExamSessions course={course} onAddToGroup={hasExamGroups ? (session) => setGroupDraft(draftFromBarbForSubject(session, course.name, subject)) : undefined} /> : null}
          <SubjectGroupExams subject={subject} draft={groupDraft} onDraftUsed={() => setGroupDraft(null)} />

          <Suspense fallback={null}>
            <SubjectStudyStats subject={subject} />
          </Suspense>

          <section className="grid grid-cols-1 gap-3">
            <h4 className="text-xs font-black uppercase text-[var(--faint)]">Dati della materia</h4>
            <SubjectFields
              idPrefix={`subject-${subject.id}`}
              draft={draft}
              onChange={(patch) => setDraft((value) => ({ ...value, ...patch }))}
              officialSemesterLabel={course ? `Dal piano ufficiale: ${SEMESTER_LABEL[course.semester]}` : `Periodo attuale: ${SEMESTER_LABEL[subjectSemester({ ...subject, semesterOverride: undefined })]}`}
              collapsed={false}
              courseIcon={course ? <CourseIcon course={course} className="h-8 w-8" /> : undefined}
              showStatus={(SUBJECT_FORM_STATUSES as readonly string[]).includes(subject.status)}
            />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase text-[var(--faint)]">Materiali · {stats.materials.length}</h4>
              <div className="flex flex-wrap justify-end gap-1.5">
                <label className="motion-safe inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                  <Icon name="Upload" className="h-3.5 w-3.5" /> Carica un file
                  <input
                    type="file"
                    accept={FILE_ACCEPT}
                    title={FILE_TEXT.limitHint}
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
                <label className="motion-safe inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
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
                    className="min-h-11 rounded-full px-3 text-xs font-black text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                  >
                    Rimuovi copertina
                  </button>
                ) : null}
              </div>
            </div>
            {stats.materials.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {stats.materials.map((attachment) => {
                  if (editingAttachment?.id === attachment.id) {
                    return (
                      <li key={attachment.id}>
                        <AttachmentInlineEditor
                          attachment={attachment}
                          onDirtyChange={setMaterialDirty}
                          onCancel={() => setEditingAttachment(null)}
                          onSave={async (patch) => {
                            await updateAttachment(attachment.id, patch);
                            setEditingAttachment(null);
                          }}
                        />
                      </li>
                    );
                  }
                  // Come in Materiali: un link si apre in un'altra scheda, un file si scarica.
                  const fileState = files.stateOf(attachment);
                  const download = FILE_STATES.has(fileState);
                  const href = !download && attachment.externalUrl ? safeHref(attachment.externalUrl) : undefined;
                  const status = fileStateText(fileState, files.status.errors.get(attachment.id));
                  const deleteId = `subject-material-delete-${attachment.id}`;
                  const rowClass = "flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-sm font-bold underline-offset-2 hover:underline";
                  return (
                    <li key={attachment.id} className="grid grid-cols-1 gap-1.5">
                      <div className="group flex min-w-0 items-center gap-1 rounded-[14px] pl-2 hover:bg-[var(--surface-soft)]">
                        <Icon name={ATTACHMENT_KIND_ICON[attachmentKind(attachment)]} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" aria-label={SUBJECTS_TEXT.openMaterial(attachment.name)} className={rowClass}>
                            <span className="one-line-safe min-w-0">{attachment.name}</span>
                            <Icon name="ExternalLink" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                          </a>
                        ) : download ? (
                          <button
                            type="button"
                            onClick={() => {
                              setFeedback(null);
                              void opener.open(attachment);
                            }}
                            aria-label={SUBJECTS_TEXT.downloadMaterial(attachment.name)}
                            aria-busy={opener.openingId === attachment.id}
                            className={rowClass}
                          >
                            <span className="min-w-0">
                              <span className="one-line-safe block">{attachment.name}</span>
                              {status ? <span className="one-line-safe block text-xs font-bold text-[var(--muted)] no-underline">{status}</span> : null}
                            </span>
                            <Icon name="Download" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                          </button>
                        ) : (
                          <span className="one-line-safe min-w-0 flex-1 px-1 text-sm font-bold">{attachment.name}</span>
                        )}
                        <IconButton icon="PenLine" label={SUBJECTS_TEXT.editMaterial(attachment.name)} className="bg-transparent" onClick={() => setEditingAttachment(attachment)} />
                        <IconButton
                          id={deleteId}
                          icon="Trash2"
                          label={SUBJECTS_TEXT.removeMaterial(attachment.name)}
                          aria-expanded={confirmingMaterial === attachment.id}
                          className="bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                          onClick={() => setConfirmingMaterial(attachment.id)}
                        />
                      </div>
                      {confirmingMaterial === attachment.id ? (
                        <InlineConfirm
                          text={SUBJECTS_TEXT.removeMaterialConfirm(attachment.name.length > 80 ? `${attachment.name.slice(0, 79)}…` : attachment.name)}
                          confirmLabel={SUBJECTS_TEXT.removeMaterialYes}
                          icon="Trash2"
                          onCancel={() => {
                            setConfirmingMaterial(null);
                            window.requestAnimationFrame(() => document.getElementById(deleteId)?.focus());
                          }}
                          onConfirm={() => {
                            setConfirmingMaterial(null);
                            void deleteAttachment(attachment.id);
                          }}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">Ancora nessun materiale: carica qui dispense, appunti o slide di questa materia.</p>
            )}
            <button
              type="button"
              onClick={() => showMaterials(subject.id)}
              className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
            >
              {SUBJECTS_TEXT.seeInMaterials}
              <Icon name="ChevronRight" className="h-3.5 w-3.5" />
            </button>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase text-[var(--faint)]">Attività da fare · {stats.openTasks.length}</h4>
              <button
                type="button"
                onClick={() => showTasks(subject.id)}
                className="inline-flex min-h-11 items-center gap-1 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
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
                      onClick={() => guard(() => goToView("tasks", [["tasks.editing", task.id, "tab"]]))}
                      aria-label={SUBJECTS_TEXT.openTask(task.title)}
                      className="motion-safe flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[12px] px-2 text-left text-sm hover:bg-[var(--surface-soft)]"
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

          {/* Note collegate alla materia (create da un agente): niente se non ce ne sono. */}
          <LinkedNotes entityType="subject" id={subject.id} />

          <section>
            <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Argomenti da ripassare</h4>
            <TopicManager subjects={subjects} subjectId={subject.id} onDirtyChange={setTopicDirty} />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function AttachmentInlineEditor({
  attachment,
  onCancel,
  onSave,
  onDirtyChange
}: {
  attachment: Attachment;
  onCancel: () => void;
  onSave: (patch: Partial<Attachment>) => Promise<void>;
  /** Cambi non salvati: il dettaglio della materia chiede prima di chiudere. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // I campi com'erano all'apertura: una sync nel frattempo non rende «cambiato» il materiale.
  const [initial] = useState(() => ({ name: attachment.name, description: attachment.description, tags: attachment.tags.join(", ") }));
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [tags, setTags] = useState(initial.tags);
  const [asking, setAsking] = useState(false);
  const dirty = name !== initial.name || description !== initial.description || tags !== initial.tags;
  const report = useRef(onDirtyChange);
  useEffect(() => {
    report.current = onDirtyChange;
  });
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => report.current?.(false), []);
  return (
    <div className="grid grid-cols-1 gap-2 rounded-[16px] bg-[var(--surface-soft)] p-3">
      <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome del materiale" />
      <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrizione (facoltativa)" aria-label="Descrizione (facoltativa)" />
      <input className={inputClass} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Etichette separate da virgola (Es. appunti, esame)" aria-label="Etichette separate da virgola (facoltative)" />
      {asking && dirty ? (
        <UnsavedPrompt
          className="bg-[var(--surface)]"
          title={SUBJECTS_TEXT.unsavedTitle}
          text={SUBJECTS_TEXT.materialUnsavedText}
          keep={SUBJECTS_TEXT.unsavedKeep}
          discard={SUBJECTS_TEXT.unsavedDiscard}
          onKeep={() => setAsking(false)}
          onDiscard={onCancel}
        />
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="soft" onClick={() => (dirty ? setAsking(true) : onCancel())}>
            {SUBJECTS_TEXT.cancel}
          </Button>
          <Button
            variant="primary"
            icon="Check"
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
            {SUBJECTS_TEXT.saveChanges}
          </Button>
        </div>
      )}
    </div>
  );
}
