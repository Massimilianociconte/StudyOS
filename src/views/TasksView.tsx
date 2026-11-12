import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { daysUntil, selectableSubjects, subjectColor, subjectName, urgentTasks } from "../lib/selectors";
import { NO_SUBJECT_LABEL, PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_LABEL, capitalizeFirst, formatMinutes } from "../lib/labels";
import { FILTER_CHIP_TEXT, QUICK_TASK_TEXT, TASKS_HELP, TASKS_LIST_TEXT, TASKS_TEXT } from "../lib/labels/tasks";
import { Button, EmptyState, HelpTip, IconButton, PageActions, Panel, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { DateField } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { TaskModal } from "../components/TaskModal";
import { FilterChip } from "../components/FilterChip";
import { useShareAction } from "../components/ShareAction";
import { SharedSection } from "../components/SharedSection";
import { useNow } from "../hooks/useNow";
import { useLinkedUiState } from "../hooks/useLinkedUiState";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";
import { filterTasks, isOpenTask, isOverdueTask, isTaskFilter, sortByPriority, subjectFilterTarget, taskSummary, type TaskFilter } from "../lib/taskFilters";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { priorityText, quickTaskChips, type QuickTaskChip } from "../lib/tasksUi";

type TaskMode = "list" | "kanban" | "matrix" | "subject" | "focus";
type SortMode = "deadline" | "priority" | "recent";
type Subjects = ReturnType<typeof useStudyStore.getState>["subjects"];

const statuses = (["todo", "doing", "blocked", "done", "postponed"] as const).map((id) => ({ id, label: TASK_STATUS_LABEL[id] }));

const VIEWS: { id: TaskMode; label: string; icon: string; title: string }[] = [
  { id: "list", label: "Lista", icon: "List", title: "Tutte le attività, raggruppate per scadenza" },
  { id: "focus", label: "Piano di oggi", icon: "Zap", title: "Solo le 6 attività più urgenti" },
  { id: "subject", label: "Per materia", icon: "BookOpen", title: "Le attività da fare divise per materia" },
  { id: "kanban", label: "Per stato", icon: "LayoutGrid", title: "Colonne Da fare, In corso, Completata…: sposta le attività da una all'altra" },
  { id: "matrix", label: "Urgenza e importanza", icon: "Grid2X2", title: "Quattro riquadri: cosa fare subito, pianificare, ridurre o rimandare" }
];
// Sul telefono nomi brevi e niente icone: a 375 px stanno tutte in una riga, senza nomi tagliati.
const PHONE_VIEWS = VIEWS.map(({ id, title }) => ({ id, title, label: TASKS_LIST_TEXT.viewsShort[id] }));

const isOpen = isOpenTask;

const isOverdue = (task: Task) => isOverdueTask(task);

const dueLabel = (date: string, overdue = false) => {
  const days = daysUntil(date);
  if (days === 0) return "Oggi";
  if (days === 1) return "Domani";
  if (days === -1) return overdue ? "Scaduta ieri" : "Ieri";
  if (days < -1) return overdue ? `Scaduta da ${-days} giorni` : `${-days} giorni fa`;
  if (days < 7) return capitalizeFirst(format(parseISO(date), "EEEE d", { locale: it }));
  return format(parseISO(date), "d MMM", { locale: it });
};

/** Gruppi temporali della lista: ciò che scade prima sta in alto. */
const DUE_BUCKETS: { id: string; title: string; test: (task: Task) => boolean }[] = [
  { id: "overdue", title: "In ritardo", test: (task) => isOverdue(task) },
  { id: "today", title: "Oggi", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) === 0 },
  { id: "tomorrow", title: "Domani", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) === 1 },
  { id: "week", title: "Entro una settimana", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) > 1 && daysUntil(task.dueDate!) <= 7 },
  { id: "later", title: "Più avanti", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) > 7 },
  { id: "nodate", title: "Senza scadenza", test: (task) => !task.dueDate }
];

const byDue = (a: Task, b: Task) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

const stepsText = (task: Task) => {
  const done = task.subtasks.filter((subtask) => subtask.done).length;
  return `${done}/${task.subtasks.length} passaggi`;
};

export function TasksView() {
  const [mode, setMode] = useUiState<TaskMode>("tasks.mode", "list", { validate: oneOf("list", "kanban", "matrix", "subject", "focus") });
  const [sort, setSort] = useUiState<SortMode>("tasks.sort", "deadline", { validate: oneOf("deadline", "priority", "recent") });
  // Chiavi che altre schermate scrivono per portare qui: attività aperta, filtro, materia.
  const [editingTaskId, setEditingTaskId] = useLinkedUiState<string | null>("tasks.editing", null, { validate: isNullableString });
  const [filter, setFilter] = useLinkedUiState<TaskFilter>("tasks.filter", "all", { validate: isTaskFilter });
  const [subjectId, setSubjectId] = useLinkedUiState<string | null>("tasks.subject", null, { validate: isNullableString });
  const [createOpen, setCreateOpen] = useState(false);
  const { tasks, subjects, addTask, updateTask, toggleTask, deleteTask, setActiveView } = useStudyStore();
  const share = useShareAction(["tasks"]);
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;
  const hasAnyTask = tasks.length > 0;
  const subjectFilter = subjectFilterTarget(subjects, subjectId);

  // Materia del filtro che non c'è più (eliminata): il filtro si toglie invece di nascondere tutto.
  useEffect(() => {
    if (subjectId && !subjectFilter) setSubjectId(null);
  }, [subjectId, subjectFilter, setSubjectId]);

  // Attività da aprire che non c'è più (eliminata altrove): si dimentica invece di restare in memoria.
  useEffect(() => {
    if (editingTaskId && !editingTask) setEditingTaskId(null);
  }, [editingTaskId, editingTask, setEditingTaskId]);

  const visible = useMemo(() => tasks.filter((task) => task.status !== "archived"), [tasks]);
  const ofSubject = useMemo(() => filterTasks(visible, "all", subjectFilter?.id ?? null), [visible, subjectFilter?.id]);
  // Archiviate: fuori dall'elenco, ma ritrovabili (e ripristinabili) in fondo alla lista.
  const archived = useMemo(
    () => filterTasks(tasks.filter((task) => task.status === "archived"), "all", subjectFilter?.id ?? null),
    [tasks, subjectFilter?.id]
  );
  const shown = useMemo(() => filterTasks(ofSubject, filter, null), [ofSubject, filter]);
  const open = shown.filter(isOpen);
  // Il riepilogo conta la materia scelta ma non "in ritardo / urgenti": quei numeri sono i pulsanti dei filtri.
  const summary = taskSummary(ofSubject);
  const filtered = filter !== "all" || Boolean(subjectFilter);
  const clearFilters = () => {
    setFilter("all");
    setSubjectId(null);
  };

  const confirmDelete = async (task: Task) => {
    const label = task.title.length > 80 ? `${task.title.slice(0, 77)}…` : task.title;
    const steps = task.subtasks.length ? ` e ${task.subtasks.length === 1 ? "il suo passaggio" : `i suoi ${task.subtasks.length} passaggi`}` : "";
    if (!window.confirm(`Eliminare l'attività «${label}»${steps}? Non potrai recuperarla.`)) return false;
    await deleteTask(task.id);
    return true;
  };

  const rowActions: RowActions = {
    subjects,
    onToggle: (id) => void toggleTask(id),
    onStatus: (id, status) => void updateTask(id, { status }),
    onEdit: setEditingTaskId,
    onDelete: (task) => void confirmDelete(task)
  };

  const newTaskButton = (
    <Button icon="Plus" variant="primary" onClick={() => setCreateOpen(true)}>
      {TASKS_TEXT.newTask}
    </Button>
  );
  const emptyFiltered = (
    <EmptyState
      icon="Search"
      title={TASKS_TEXT.filteredEmptyTitle}
      body={TASKS_TEXT.filteredEmptyBody}
      action={
        <Button variant="soft" icon="X" onClick={clearFilters}>
          {TASKS_TEXT.clearFilters}
        </Button>
      }
    />
  );
  const backToList = (
    <EmptyState
      icon="Check"
      title={TASKS_TEXT.noneHereTitle}
      body={TASKS_TEXT.noneHereBody}
      action={
        <Button variant="soft" icon="List" onClick={() => setMode("list")}>
          {TASKS_TEXT.backToList}
        </Button>
      }
    />
  );

  return (
    <div>
      <SectionTitle
        title="Attività"
        subtitle="Segna cosa devi fare, con scadenza e priorità, e spunta ogni attività quando l'hai finita."
        action={
          <PageActions
            primary={
              hasAnyTask ? (
                // Sul telefono ci sono già l'aggiunta rapida e il "+" in basso: qui solo da tablet in su.
                <Button icon="Plus" variant="primary" onClick={() => setCreateOpen(true)} className="hidden md:inline-flex">
                  {TASKS_TEXT.newTask}
                </Button>
              ) : undefined
            }
            more={share.action ? [share.action] : []}
          />
        }
      />
      {share.element}

      {!hasAnyTask ? (
        <EmptyState
          icon="Check"
          title={TASKS_TEXT.emptyTitle}
          body={TASKS_TEXT.emptyBody}
          action={
            <>
              {newTaskButton}
              <Button variant="soft" icon="CalendarDays" onClick={() => setActiveView("calendar")}>
                {TASKS_TEXT.fromCalendar}
              </Button>
            </>
          }
        />
      ) : (
        <>
          <TaskSummaryLine summary={summary} filter={filter} onFilter={setFilter} />
          {filtered ? (
            <div role="group" aria-label={TASKS_TEXT.activeFilters} className="mb-3 flex flex-wrap items-center gap-2 px-1">
              {filter !== "all" ? <FilterChip label={TASKS_TEXT.filterName[filter]} onClear={() => setFilter("all")} /> : null}
              {subjectFilter ? (
                <FilterChip label={FILTER_CHIP_TEXT.only(subjectFilter.name)} color={subjectFilter.color} onClear={() => setSubjectId(null)} />
              ) : null}
            </div>
          ) : null}

          <QuickTaskBar subjects={subjects} onAdd={addTask} defaultSubjectId={subjectFilter?.id ?? ""} filtered={filtered} />

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            {/* Telefono: riga intera con i nomi brevi; il "?" passa alla riga sotto, accanto all'ordine. */}
            <div className="w-full md:hidden">
              <Segmented label={TASKS_TEXT.views} value={mode} onChange={setMode} size="sm" className="min-w-0" options={PHONE_VIEWS} />
            </div>
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <div className="hidden min-w-0 md:flex">
                <Segmented label={TASKS_TEXT.views} value={mode} onChange={setMode} className="min-w-0" options={VIEWS} />
              </div>
              <HelpTip {...TASKS_HELP.views} />
            </div>
            {mode === "list" ? (
              <label className="flex items-center gap-2 text-xs font-black text-[var(--muted)]">
                {TASKS_TEXT.sortBy}
                <select
                  className="min-h-11 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-xs font-black text-[var(--text)]"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortMode)}
                >
                  <option value="deadline">Scadenza</option>
                  <option value="priority">Priorità</option>
                  <option value="recent">Aggiunte di recente</option>
                </select>
              </label>
            ) : null}
          </div>

          {mode === "list" ? (
            <GroupedList tasks={shown} archived={archived} sort={sort} actions={rowActions} onNew={() => setCreateOpen(true)} empty={filtered ? emptyFiltered : null} />
          ) : null}
          {mode === "focus" ? (
            <Panel>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-xl font-black">{TASKS_TEXT.focusTitle}</h3>
                <HelpTip {...TASKS_HELP.focus} />
              </div>
              {!open.length && filtered ? emptyFiltered : <RowList tasks={urgentTasks(open, 6)} actions={rowActions} empty="Niente di urgente: goditi la giornata." />}
            </Panel>
          ) : null}
          {mode === "kanban" ? <Kanban tasks={shown} actions={rowActions} updateTask={updateTask} /> : null}
          {mode === "matrix" ? (open.length ? <Matrix tasks={open} actions={rowActions} /> : filtered ? emptyFiltered : backToList) : null}
          {mode === "subject" ? (open.length ? <BySubject tasks={shown} actions={rowActions} /> : filtered ? emptyFiltered : backToList) : null}
        </>
      )}

      {editingTask ? (
        <TaskEditorModal
          task={editingTask}
          subjects={subjects}
          onClose={() => setEditingTaskId(null)}
          onSave={updateTask}
          onDelete={async (task) => {
            if (await confirmDelete(task)) setEditingTaskId(null);
          }}
        />
      ) : null}
      {createOpen ? <TaskModal onClose={() => setCreateOpen(false)} onCreate={(draft) => addTask(draft)} /> : null}

      <SharedSection entityTypes={["task"]} />
    </div>
  );
}

/**
 * Una riga al posto dei 4 riquadri: "12 da fare · 3 in ritardo · 2 urgenti · 6 h previste". I numeri
 * in ritardo e urgenti sono pulsanti che applicano il filtro (`tasks.filter`); a zero restano testo.
 */
function TaskSummaryLine({
  summary,
  filter,
  onFilter
}: {
  summary: ReturnType<typeof taskSummary>;
  filter: TaskFilter;
  onFilter: (filter: TaskFilter) => void;
}) {
  const toggle = (id: Exclude<TaskFilter, "all">, count: number, text: string, tone: string) => {
    const active = filter === id;
    if (!count && !active) return <span>{text}</span>;
    return (
      <button
        type="button"
        aria-pressed={active}
        title={TASKS_TEXT.filterAria[id]}
        onClick={() => onFilter(active ? "all" : id)}
        className={`motion-safe relative rounded-full font-black underline decoration-dotted decoration-2 underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-solid aria-pressed:bg-[var(--surface-strong)] aria-pressed:px-2 aria-pressed:no-underline ${tone}`}
      >
        {text}
      </button>
    );
  };
  const dot = <span aria-hidden="true">·</span>;
  return (
    <div role="group" aria-label={TASKS_TEXT.summary} className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm font-bold text-[var(--muted)]">
      <span className="font-black text-[var(--text)]">{TASKS_TEXT.open(summary.open)}</span>
      {dot}
      {toggle("overdue", summary.overdue, TASKS_TEXT.overdue(summary.overdue), summary.overdue ? "text-[var(--danger-text)]" : "")}
      {dot}
      {toggle("urgent", summary.urgent, TASKS_TEXT.urgent(summary.urgent), summary.urgent ? "text-[var(--warning-text)]" : "")}
      {summary.minutes ? (
        <>
          {dot}
          <span>{TASKS_TEXT.planned(summary.minutes)}</span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Aggiunta rapida: un campo solo, Invio per aggiungere. "Dettagli" apre materia, priorità e scadenza.
 * Con il filtro per materia attivo la nuova attività prende quella materia (così compare nell'elenco).
 * A "Dettagli" chiuso le scelte diverse da quelle di base restano visibili come pillole con ✕, anche
 * dopo l'aggiunta: valgono per le prossime attività finché non le togli.
 */
function QuickTaskBar({
  subjects,
  onAdd,
  defaultSubjectId,
  filtered
}: {
  subjects: Subjects;
  onAdd: ReturnType<typeof useStudyStore.getState>["addTask"];
  defaultSubjectId: string;
  filtered: boolean;
}) {
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState(defaultSubjectId);
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [dueDate, setDueDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [added, setAdded] = useState("");

  useEffect(() => setSubjectId(defaultSubjectId), [defaultSubjectId]);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(""), 6000);
    return () => window.clearTimeout(timer);
  }, [added]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    const due = dueDate ? new Date(`${dueDate}T18:00`) : undefined;
    await onAdd({
      title: text,
      subjectId: subjectId || undefined,
      priority,
      importance: priority === "urgent" ? 5 : 3,
      dueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : undefined
    });
    setTitle("");
    setAdded(filtered ? TASKS_TEXT.addedFiltered(text) : "");
  };

  const selectClass = "min-h-11 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-bold text-[var(--text)]";
  const chips = detailsOpen ? [] : quickTaskChips({ subjectId, priority, dueDate }, defaultSubjectId, subjects);
  const clearChip = (id: QuickTaskChip["id"]) => {
    if (id === "subject") setSubjectId(defaultSubjectId);
    if (id === "priority") setPriority("medium");
    if (id === "due") setDueDate("");
  };

  return (
    <form onSubmit={submit} aria-label={TASKS_TEXT.quickAdd} className="soft-panel mb-4 p-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">{TASKS_TEXT.quickAddField}</span>
          <Icon name="Plus" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
          <input
            id="quick-task-title"
            className={`${inputClass} pl-10`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={TASKS_TEXT.quickAddPlaceholder}
            enterKeyHint="done"
          />
        </label>
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls="quick-task-details"
          title={TASKS_TEXT.detailsAria}
          onClick={() => setDetailsOpen((value) => !value)}
          className="motion-safe inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-black text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] aria-expanded:bg-[var(--surface-strong)] aria-expanded:text-[var(--text)]"
        >
          {TASKS_TEXT.details}
          <Icon name="ChevronDown" className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </button>
        {/* Il primario della pagina è "Nuova attività": qui l'aggiunta veloce resta secondaria. */}
        {/* Solo icona sul telefono: "!" perché px-4 e gap-2 di Button vincerebbero, e l'icona resterebbe fuori centro. */}
        <Button type="submit" variant="soft" icon="Plus" disabled={!title.trim()} aria-label={TASKS_TEXT.add} className="w-11 shrink-0 !gap-0 !px-0 sm:w-auto sm:!gap-2 sm:!px-4">
          <span className="hidden sm:inline">{TASKS_TEXT.add}</span>
        </Button>
      </div>
      {detailsOpen ? (
        <div id="quick-task-details" className="mt-2 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          <select className={`${selectClass} min-w-0`} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} aria-label={TASKS_TEXT.subjectOptional}>
            <option value="">{TASKS_TEXT.noSubject}</option>
            {selectableSubjects(subjects, subjectId).map((subject) => (
              <option value={subject.id} key={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
          <select className={`${selectClass} min-w-0`} value={priority} onChange={(event) => setPriority(event.target.value as Task["priority"])} aria-label={TASKS_TEXT.priority}>
            {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
              <option key={key} value={key}>
                {priorityText(key)}
              </option>
            ))}
          </select>
          <DateField label={TASKS_TEXT.dueOptional} value={dueDate} onChange={setDueDate} optional compact />
        </div>
      ) : null}
      {chips.length ? (
        <div role="group" aria-label={QUICK_TASK_TEXT.applied} className="mt-1.5 flex flex-wrap items-center gap-2 px-1 pb-0.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => clearChip(chip.id)}
              aria-label={QUICK_TASK_TEXT.clear(chip.label)}
              title={QUICK_TASK_TEXT.clear(chip.label)}
              // Pillola alta 32 px, area di tocco 44 px (after:).
              className="motion-safe relative inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] pl-3 pr-2 text-xs font-extrabold text-[var(--text)] after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--surface)]"
            >
              {chip.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: chip.color }} /> : null}
              <span className="min-w-0 truncate">{chip.label}</span>
              <Icon name="X" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
            </button>
          ))}
        </div>
      ) : null}
      {/* Sempre presente: il lettore di schermo annuncia il testo appena compare. */}
      <div role="status" aria-live="polite">
        {added ? <p className="mt-1.5 px-2 text-xs font-bold text-[var(--muted)]">{added}</p> : null}
      </div>
    </form>
  );
}

interface RowActions {
  subjects: Subjects;
  onToggle: (id: string) => void;
  onStatus: (id: string, status: Task["status"]) => void;
  onEdit: (id: string) => void;
  onDelete: (task: Task) => void;
}

function TaskRow({ task, actions, compact }: { task: Task; actions: RowActions; compact?: boolean }) {
  const done = task.status === "done";
  const archivedRow = task.status === "archived";
  const overdue = isOverdue(task);
  const completedLate = isTaskCompletedLate(task);
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);

  return (
    <li className={`group flex min-w-0 items-center gap-3 rounded-[18px] px-2.5 py-2 hover:bg-[var(--surface-soft)] ${done || archivedRow ? "opacity-60" : ""}`}>
      <button
        type="button"
        aria-label={done ? `Segna «${task.title}» come da fare` : `Segna «${task.title}» come fatta`}
        title={done ? "Segna come da fare" : "Segna come fatta"}
        onClick={() => actions.onToggle(task.id)}
        className={`motion-safe relative grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 after:absolute after:-inset-2.5 after:content-[""] ${
          done ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--faint)] hover:border-[var(--accent)]"
        }`}
        style={!done && task.subjectId ? { borderColor: subjectColor(actions.subjects, task.subjectId) } : undefined}
      >
        {done ? <Icon name="Check" className="h-3.5 w-3.5" /> : null}
      </button>

      <button type="button" onClick={() => actions.onEdit(task.id)} className="min-w-0 flex-1 text-left">
        <span className={`one-line-safe block text-sm font-extrabold ${done ? "line-through" : ""}`} title={task.title}>
          {task.title}
        </span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-bold text-[var(--muted)]">
          {task.dueDate ? (
            <span className={`inline-flex items-center gap-1 ${overdue ? "text-[var(--danger-text)]" : ""}`} title="Scadenza">
              <Icon name="CalendarDays" className="h-3 w-3" />
              {dueLabel(task.dueDate, overdue)}
            </span>
          ) : null}
          {task.subjectId ? (
            <span className="inline-flex min-w-0 max-w-[220px] items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(actions.subjects, task.subjectId) }} />
              <span className="truncate">{subjectName(actions.subjects, task.subjectId)}</span>
            </span>
          ) : null}
          {task.estimatedMinutes ? <span>{formatMinutes(task.estimatedMinutes)} previsti</span> : null}
          {task.subtasks.length ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="Check" className="h-3 w-3" />
              {stepsText(task)}
            </span>
          ) : null}
          {timerRunning ? (
            <span className="inline-flex items-center gap-1 text-[var(--accent-ink)]" title="Timer in corso">
              <Icon name="Timer" className="h-3 w-3" /> {formatElapsedSeconds(elapsedSeconds)}
            </span>
          ) : null}
          {completedLate ? <span className="text-[var(--warning-text)]">Completata in ritardo</span> : null}
          {!compact && (task.status === "doing" || task.status === "blocked" || task.status === "postponed") ? (
            <span className="text-[var(--text)]">{TASK_STATUS_LABEL[task.status]}</span>
          ) : null}
        </span>
      </button>

      {!done ? (
        <span className="hidden shrink-0 items-center gap-1.5 text-xs font-black text-[var(--muted)] sm:inline-flex">
          <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
          {priorityText(task.priority)}
        </span>
      ) : null}

      {archivedRow ? (
        // Archiviata: il menu degli stati non la prevede; si rimette tra le attività da fare da qui.
        <Button variant="soft" icon="RotateCcw" onClick={() => actions.onStatus(task.id, "todo")} title={TASKS_LIST_TEXT.restoreAria(task.title)} aria-label={TASKS_LIST_TEXT.restoreAria(task.title)} className="shrink-0 !px-3 !text-xs">
          {TASKS_LIST_TEXT.restore}
        </Button>
      ) : !compact ? (
        <select
          className="hidden min-h-11 shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 text-xs font-black md:block"
          value={task.status}
          onChange={(event) => actions.onStatus(task.id, event.target.value as Task["status"])}
          aria-label={`Stato di "${task.title}"`}
        >
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.label}
            </option>
          ))}
        </select>
      ) : null}

      <span className="hidden shrink-0 items-center gap-1 transition-opacity can-hover:opacity-0 can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100 md:flex">
        <IconButton icon="PenLine" label={`Modifica "${task.title}"`} className="relative h-8 w-8 bg-transparent after:absolute after:-inset-1.5 after:content-['']" onClick={() => actions.onEdit(task.id)} />
        <IconButton
          icon="Trash2"
          label={`Elimina "${task.title}"`}
          className="relative h-8 w-8 bg-transparent text-[var(--danger-text)] after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--danger-bg)]"
          onClick={() => actions.onDelete(task)}
        />
      </span>
    </li>
  );
}

function RowList({ tasks, actions, compact, empty }: { tasks: Task[]; actions: RowActions; compact?: boolean; empty?: string }) {
  if (!tasks.length) {
    return empty ? <p className="rounded-[18px] border border-dashed border-[var(--border)] p-4 text-center text-sm font-bold text-[var(--faint)]">{empty}</p> : null;
  }
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} actions={actions} compact={compact} />
      ))}
    </ul>
  );
}

function GroupedList({
  tasks,
  archived,
  sort,
  actions,
  onNew,
  empty
}: {
  tasks: Task[];
  /** Archiviate (stessa materia del filtro): in fondo, dietro «Mostra le archiviate». */
  archived: Task[];
  sort: SortMode;
  actions: RowActions;
  onNew: () => void;
  /** Con un filtro attivo e nulla da mostrare: lo stato vuoto che toglie i filtri. */
  empty: ReactNode;
}) {
  const [showDone, setShowDone] = useUiState("tasks.showDone", false);
  const [showArchived, setShowArchived] = useUiState("tasks.showArchived", false, { validate: (value) => typeof value === "boolean" });
  const open = tasks.filter(isOpen);
  const done = tasks
    .filter((task) => task.status === "done")
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));

  const groups =
    sort === "deadline"
      ? DUE_BUCKETS.map((bucket) => ({ ...bucket, items: open.filter(bucket.test).sort(byDue) })).filter((group) => group.items.length)
      : [
          {
            id: sort,
            title: sort === "priority" ? "Dalla priorità più alta" : "Aggiunte di recente",
            items: sort === "priority" ? sortByPriority(open) : [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          }
        ];

  return (
    <Panel>
      {open.length === 0 && empty ? (
        empty
      ) : open.length === 0 ? (
        <EmptyState
          icon="Check"
          title="Hai fatto tutto"
          body={done.length ? "Non ti resta nessuna attività da fare. Quelle completate sono qui sotto." : "Non ti resta nessuna attività da fare."}
          action={
            <Button variant="soft" icon="Plus" onClick={onNew}>
              Nuova attività
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {groups.map((group) => (
            <section key={group.id} aria-label={`${group.title}: ${group.items.length} da fare`}>
              <h3
                className={`mb-1 flex items-center gap-2 px-2.5 text-xs font-black uppercase ${
                  group.id === "overdue" ? "text-[var(--danger-text)]" : "text-[var(--faint)]"
                }`}
              >
                {group.title}
                <span className="rounded-full bg-[var(--surface-strong)] px-1.5 text-[11px] text-[var(--muted)]" title={`${group.items.length} da fare`}>{group.items.length}</span>
              </h3>
              <RowList tasks={group.items} actions={actions} />
            </section>
          ))}
        </div>
      )}
      {done.length || archived.length ? (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          {done.length ? (
            <>
              <ShowMoreToggle open={showDone} onToggle={() => setShowDone((value) => !value)} count={done.length}>
                {showDone ? "Nascondi le completate" : "Mostra le completate"}
              </ShowMoreToggle>
              {showDone ? <RowList tasks={done} actions={actions} /> : null}
            </>
          ) : null}
          {archived.length ? (
            <>
              <ShowMoreToggle open={showArchived} onToggle={() => setShowArchived((value) => !value)} count={archived.length}>
                {showArchived ? TASKS_LIST_TEXT.hideArchived : TASKS_LIST_TEXT.showArchived}
              </ShowMoreToggle>
              {showArchived ? <RowList tasks={archived} actions={actions} /> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function ShowMoreToggle({ open, onToggle, count, children }: { open: boolean; onToggle: () => void; count: number; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-h-11 w-full items-center gap-2 rounded-[14px] px-2.5 py-1.5 text-left text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
    >
      <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      {children}
      <span className="rounded-full bg-[var(--surface-strong)] px-1.5 text-[11px] text-[var(--muted)]">{count}</span>
    </button>
  );
}

function Kanban({
  tasks,
  actions,
  updateTask
}: {
  tasks: Task[];
  actions: RowActions;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<Task["status"] | null>(null);

  const moveTask = async (taskId: string, status: Task["status"]) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    await updateTask(taskId, { status });
  };

  return (
    // Colonne da 230 px con scorrimento orizzontale a scatto: su tablet si sfoglia col dito.
    <div className="scrollbar-soft -mx-1 snap-x snap-proximity overflow-x-auto px-1 pb-2">
      <div className="grid auto-cols-[minmax(230px,1fr)] grid-flow-col gap-3">
        {statuses.map((status) => {
          const items = tasks.filter((task) => task.status === status.id).sort(byDue);
          return (
            <section
              key={status.id}
              aria-label={status.label}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOverStatus(status.id);
              }}
              onDragLeave={() => setOverStatus((value) => (value === status.id ? null : value))}
              onDrop={async (event) => {
                event.preventDefault();
                const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
                if (taskId) await moveTask(taskId, status.id);
                setDraggedTaskId(null);
                setOverStatus(null);
              }}
              className={`quiet-panel flex min-h-[420px] snap-start flex-col p-2.5 transition-colors ${
                overStatus === status.id ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--surface)_70%,var(--accent)_12%)]" : ""
              }`}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2 px-1.5 pt-1">
                <h3 className="text-sm font-black uppercase text-[var(--muted)]">{status.label}</h3>
                <span className="rounded-full bg-[var(--surface-strong)] px-2 text-xs font-black" title={`${items.length} attività`}>{items.length}</span>
              </div>
              <div className="grid grid-cols-1 content-start gap-2">
                {items.map((task) => (
                  <KanbanTaskCard
                    key={task.id}
                    task={task}
                    actions={actions}
                    dragging={draggedTaskId === task.id}
                    onDragStart={(id) => setDraggedTaskId(id)}
                    onDragEnd={() => {
                      setDraggedTaskId(null);
                      setOverStatus(null);
                    }}
                  />
                ))}
                {items.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-[var(--border)] p-4 text-center text-xs font-bold text-[var(--faint)]">Trascina qui un'attività o cambiane lo stato dal menu</div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KanbanTaskCard({
  task,
  actions,
  dragging,
  onDragStart,
  onDragEnd
}: {
  task: Task;
  actions: RowActions;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const color = subjectColor(actions.subjects, task.subjectId);
  const overdue = isOverdue(task);
  const done = task.status === "done";
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      className={`motion-safe group min-w-0 cursor-grab rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3 active:cursor-grabbing ${
        dragging ? "scale-[0.98] opacity-50" : "hover:-translate-y-0.5"
      }`}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={done ? `Segna «${task.title}» come da fare` : `Segna «${task.title}» come fatta`}
          title={done ? "Segna come da fare" : "Segna come fatta"}
          onClick={() => actions.onToggle(task.id)}
          className={`relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 after:absolute after:-inset-3 after:content-[""] ${
            done ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--faint)] hover:border-[var(--accent)]"
          }`}
        >
          {done ? <Icon name="Check" className="h-3 w-3" /> : null}
        </button>
        <button type="button" draggable={false} onClick={() => actions.onEdit(task.id)} className="min-w-0 flex-1 text-left">
          <h4 className={`three-line-safe text-sm font-extrabold leading-snug ${done ? "text-[var(--faint)] line-through" : ""}`}>{task.title}</h4>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-7 text-[11px] font-bold text-[var(--muted)]">
        {task.subjectId ? <Tag color={color}>{subjectName(actions.subjects, task.subjectId)}</Tag> : null}
        {task.dueDate ? <span className={overdue ? "text-[var(--danger-text)]" : ""} title="Scadenza">{dueLabel(task.dueDate, overdue)}</span> : null}
        {!done ? (
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
            {priorityText(task.priority)}
          </span>
        ) : null}
        {task.estimatedMinutes ? <span>{formatMinutes(task.estimatedMinutes)} previsti</span> : null}
        {task.subtasks.length ? <span>{stepsText(task)}</span> : null}
        {timerRunning ? (
          <span className="inline-flex items-center gap-1 text-[var(--accent-ink)]" title="Timer in corso">
            <Icon name="Timer" className="h-3 w-3" /> {formatElapsedSeconds(elapsedSeconds)}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1 transition-opacity can-hover:opacity-0 can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100">
        {/* Alternativa al trascinamento, che su molti tablet touch non è disponibile. */}
        <select
          className="mr-auto min-h-11 max-w-[140px] rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 text-[11px] font-black text-[var(--muted)]"
          value={task.status}
          onChange={(event) => actions.onStatus(task.id, event.target.value as Task["status"])}
          aria-label={`Sposta "${task.title}" in un'altra colonna`}
          draggable={false}
        >
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.label}
            </option>
          ))}
        </select>
        <IconButton
          icon="PenLine"
          label={`Modifica "${task.title}"`}
          className="relative h-7 w-7 bg-transparent after:absolute after:-inset-2 after:content-['']"
          draggable={false}
          onClick={() => actions.onEdit(task.id)}
        />
        <IconButton
          icon="Trash2"
          label={`Elimina "${task.title}"`}
          className="relative h-7 w-7 bg-transparent text-[var(--danger-text)] after:absolute after:-inset-2 after:content-[''] hover:bg-[var(--danger-bg)]"
          draggable={false}
          onClick={() => actions.onDelete(task)}
        />
      </div>
    </article>
  );
}

function Matrix({ tasks, actions }: { tasks: Task[]; actions: RowActions }) {
  const urgent = (task: Task) => task.priority === "urgent" || task.priority === "high";
  const quadrants = [
    { title: "Fai ora", hint: "Importante e urgente", tone: "var(--accent-3)", test: (task: Task) => task.importance >= 4 && urgent(task) },
    { title: "Pianifica", hint: "Importante, non urgente", tone: "var(--accent)", test: (task: Task) => task.importance >= 4 && !urgent(task) },
    { title: "Delega o riduci", hint: "Urgente, poco importante", tone: "var(--warning)", test: (task: Task) => task.importance < 4 && urgent(task) },
    { title: "Rimanda", hint: "Né urgente né importante", tone: "var(--faint)", test: (task: Task) => task.importance < 4 && !urgent(task) }
  ];
  return (
    <div>
      {/* La regola dei riquadri sta nell'aiuto "?" invece che in una frase sempre visibile. */}
      <div className="mb-3 px-1">
        <HelpTip {...TASKS_HELP.matrix} label={TASKS_TEXT.howItWorks} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {quadrants.map((quadrant) => {
          const items = tasks.filter(quadrant.test).sort(byDue);
          return (
            <section className="soft-panel min-h-[220px] p-3" key={quadrant.title} aria-label={quadrant.title}>
              <div className="mb-2 flex items-baseline gap-2 px-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: quadrant.tone }} />
                <h3 className="text-base font-black">{quadrant.title}</h3>
                <span className="text-xs font-bold text-[var(--faint)]">{quadrant.hint}</span>
                <span className="ml-auto rounded-full bg-[var(--surface-strong)] px-2 text-xs font-black" title={`${items.length} da fare`}>{items.length}</span>
              </div>
              <RowList tasks={items} actions={actions} compact empty="Nessuna attività qui" />
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BySubject({ tasks, actions }: { tasks: Task[]; actions: RowActions }) {
  const open = tasks.filter(isOpen);
  const groups = [
    ...actions.subjects.map((subject) => ({ id: subject.id, name: subject.name, color: subject.color, items: open.filter((task) => task.subjectId === subject.id) })),
    {
      id: "none",
      name: NO_SUBJECT_LABEL,
      color: "var(--faint)",
      items: open.filter((task) => !task.subjectId || !actions.subjects.some((subject) => subject.id === task.subjectId))
    }
  ].filter((group) => group.items.length);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {groups.map((group) => (
        <section key={group.id} className="soft-panel p-3" aria-label={group.name}>
          <div className="mb-2 flex items-center gap-2 px-2.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: group.color }} />
            <h3 className="one-line-safe text-base font-black">{group.name}</h3>
            <span className="ml-auto rounded-full bg-[var(--surface-strong)] px-2 text-xs font-black" title={`${group.items.length} da fare`}>{group.items.length}</span>
          </div>
          <RowList tasks={group.items.sort(byDue)} actions={actions} compact />
        </section>
      ))}
    </div>
  );
}
