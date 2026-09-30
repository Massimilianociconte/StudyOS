import { useMemo, useState, type FormEvent } from "react";
import { format, isBefore, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { daysUntil, selectableSubjects, subjectColor, subjectName, urgentTasks } from "../lib/selectors";
import { PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_LABEL, capitalizeFirst, formatMinutes } from "../lib/labels";
import { Button, EmptyState, IconButton, Panel, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { useNow } from "../hooks/useNow";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";

type TaskMode = "list" | "kanban" | "matrix" | "subject" | "focus";
type SortMode = "deadline" | "priority" | "recent";
type Subjects = ReturnType<typeof useStudyStore.getState>["subjects"];

const statuses: { id: Task["status"]; label: string }[] = [
  { id: "todo", label: "Da fare" },
  { id: "doing", label: "In corso" },
  { id: "blocked", label: "Bloccata" },
  { id: "done", label: "Completata" },
  { id: "postponed", label: "Rimandata" }
];

const isOpen = (task: Task) => task.status !== "done" && task.status !== "archived";

const isOverdue = (task: Task) => (task.dueDate ? isBefore(parseISO(task.dueDate), startOfDay(new Date())) && isOpen(task) : false);

const dueLabel = (date: string) => {
  const days = daysUntil(date);
  if (days === 0) return "Oggi";
  if (days === 1) return "Domani";
  if (days === -1) return "Ieri";
  if (days < -1) return `${-days} giorni fa`;
  if (days < 7) return capitalizeFirst(format(parseISO(date), "EEEE d", { locale: it }));
  return format(parseISO(date), "d MMM", { locale: it });
};

/** Gruppi temporali della lista: ciò che scade prima sta in alto. */
const DUE_BUCKETS: { id: string; title: string; test: (task: Task) => boolean }[] = [
  { id: "overdue", title: "In ritardo", test: (task) => isOverdue(task) },
  { id: "today", title: "Oggi", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) === 0 },
  { id: "tomorrow", title: "Domani", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) === 1 },
  { id: "week", title: "Prossimi 7 giorni", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) > 1 && daysUntil(task.dueDate!) <= 7 },
  { id: "later", title: "Più avanti", test: (task) => Boolean(task.dueDate) && daysUntil(task.dueDate!) > 7 },
  { id: "nodate", title: "Senza scadenza", test: (task) => !task.dueDate }
];

const byDue = (a: Task, b: Task) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

export function TasksView() {
  const [mode, setMode] = useUiState<TaskMode>("tasks.mode", "list", { validate: oneOf("list", "kanban", "matrix", "subject", "focus") });
  const [sort, setSort] = useUiState<SortMode>("tasks.sort", "deadline", { validate: oneOf("deadline", "priority", "recent") });
  const [editingTaskId, setEditingTaskId] = useUiState<string | null>("tasks.editing", null, { scope: "tab", validate: isNullableString });
  const { tasks, subjects, addTask, updateTask, toggleTask, deleteTask } = useStudyStore();
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;

  const visible = useMemo(() => tasks.filter((task) => task.status !== "archived"), [tasks]);
  const open = visible.filter(isOpen);

  const confirmDelete = async (task: Task) => {
    const label = task.title.length > 80 ? `${task.title.slice(0, 77)}...` : task.title;
    if (!window.confirm(`Eliminare la task "${label}"?`)) return false;
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

  const stats = [
    { label: "Aperte", value: String(open.length), tone: "var(--accent)" },
    { label: "In ritardo", value: String(open.filter(isOverdue).length), tone: "var(--accent-3)" },
    { label: "Urgenti", value: String(open.filter((task) => task.priority === "urgent").length), tone: "var(--warning)" },
    { label: "Lavoro stimato", value: formatMinutes(open.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0)), tone: "var(--accent-2)" }
  ];

  return (
    <div>
      <SectionTitle title="Task" subtitle="Scadenze, priorità e sottotask in un colpo d'occhio. Clicca una task per modificarla." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="quiet-panel flex items-center gap-3 p-3.5">
            <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: stat.tone }} />
            <div className="min-w-0">
              <p className="truncate text-xl font-black leading-tight">{stat.value}</p>
              <p className="truncate text-xs font-bold text-[var(--muted)]">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <QuickTaskBar subjects={subjects} onAdd={addTask} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Vista task"
          value={mode}
          onChange={setMode}
          options={[
            { id: "list", label: "Lista", icon: "List" },
            { id: "kanban", label: "Kanban", icon: "LayoutGrid" },
            { id: "matrix", label: "Eisenhower", icon: "Grid2X2" },
            { id: "subject", label: "Per materia", icon: "BookOpen" },
            { id: "focus", label: "Focus oggi", icon: "Zap" }
          ]}
        />
        {mode === "list" ? (
          <label className="flex items-center gap-2 text-xs font-black text-[var(--muted)]">
            Ordina
            <select
              className="min-h-11 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-xs font-black text-[var(--text)]"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
            >
              <option value="deadline">Per scadenza</option>
              <option value="priority">Per priorità</option>
              <option value="recent">Più recenti</option>
            </select>
          </label>
        ) : null}
      </div>

      {mode === "list" ? <GroupedList tasks={visible} sort={sort} actions={rowActions} /> : null}
      {mode === "focus" ? (
        <Panel>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-xl font-black">Piano di oggi</h3>
            <span className="text-xs font-bold text-[var(--muted)]">Le 6 task con scadenza e priorità più pressanti</span>
          </div>
          <RowList tasks={urgentTasks(open, 6)} actions={rowActions} empty="Niente di urgente: goditi la giornata." />
        </Panel>
      ) : null}
      {mode === "kanban" ? <Kanban tasks={visible} actions={rowActions} updateTask={updateTask} /> : null}
      {mode === "matrix" ? <Matrix tasks={open} actions={rowActions} /> : null}
      {mode === "subject" ? <BySubject tasks={visible} actions={rowActions} /> : null}

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
    </div>
  );
}

function QuickTaskBar({ subjects, onAdd }: { subjects: Subjects; onAdd: ReturnType<typeof useStudyStore.getState>["addTask"] }) {
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [dueDate, setDueDate] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const due = dueDate ? new Date(`${dueDate}T18:00`) : undefined;
    await onAdd({
      title: title.trim(),
      subjectId: subjectId || undefined,
      priority,
      importance: priority === "urgent" ? 5 : 3,
      dueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : undefined
    });
    setTitle("");
  };

  const selectClass = "min-h-11 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-bold text-[var(--text)]";

  return (
    // Una riga sola solo da xl: su tablet il titolo ha una riga intera e i filtri stanno sotto.
    <form onSubmit={submit} className="soft-panel mb-4 grid grid-cols-1 gap-2 p-2.5 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:items-center">
      <label className="relative block min-w-0">
        <span className="sr-only">Nuova task</span>
        <Icon name="Plus" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
        <input
          id="quick-task-title"
          className={`${inputClass} pl-10`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Aggiungi una task e premi Invio"
        />
      </label>
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] xl:contents">
        <select className={`${selectClass} min-w-0 xl:max-w-[200px]`} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} aria-label="Materia">
          <option value="">Nessuna materia</option>
          {selectableSubjects(subjects, subjectId).map((subject) => (
            <option value={subject.id} key={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
        <select className={`${selectClass} min-w-0`} value={priority} onChange={(event) => setPriority(event.target.value as Task["priority"])} aria-label="Priorità">
          {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
            <option key={key} value={key}>
              {PRIORITY_LABEL[key]}
            </option>
          ))}
        </select>
        <input className={`${selectClass} min-w-0`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Scadenza" />
        <button
          type="submit"
          disabled={!title.trim()}
          className="motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-extrabold text-[#10131d] disabled:opacity-50 min-[480px]:col-span-3 sm:col-span-1"
        >
          <Icon name="Plus" className="h-4 w-4" /> Aggiungi
        </button>
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
  const overdue = isOverdue(task);
  const completedLate = isTaskCompletedLate(task);
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);
  const subtasksDone = task.subtasks.filter((subtask) => subtask.done).length;

  return (
    <li className={`group flex min-w-0 items-center gap-3 rounded-[18px] px-2.5 py-2 hover:bg-[var(--surface-soft)] ${done ? "opacity-60" : ""}`}>
      <button
        type="button"
        aria-label={done ? `Segna "${task.title}" da fare` : `Completa "${task.title}"`}
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
            <span className={`inline-flex items-center gap-1 ${overdue ? "text-[var(--danger-text)]" : ""}`}>
              <Icon name="CalendarDays" className="h-3 w-3" />
              {dueLabel(task.dueDate)}
            </span>
          ) : null}
          {task.subjectId ? (
            <span className="inline-flex min-w-0 max-w-[220px] items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(actions.subjects, task.subjectId) }} />
              <span className="truncate">{subjectName(actions.subjects, task.subjectId)}</span>
            </span>
          ) : null}
          {task.estimatedMinutes ? <span>{formatMinutes(task.estimatedMinutes)}</span> : null}
          {task.subtasks.length ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="Check" className="h-3 w-3" />
              {subtasksDone}/{task.subtasks.length}
            </span>
          ) : null}
          {timerRunning ? (
            <span className="inline-flex items-center gap-1 text-[var(--accent-ink)]">
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
          {PRIORITY_LABEL[task.priority]}
        </span>
      ) : null}

      {!compact ? (
        <select
          className="hidden min-h-8 shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 text-xs font-black md:block"
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

function GroupedList({ tasks, sort, actions }: { tasks: Task[]; sort: SortMode; actions: RowActions }) {
  const [showDone, setShowDone] = useUiState("tasks.showDone", false);
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
            title: sort === "priority" ? "Per priorità" : "Più recenti",
            items: sort === "priority" ? urgentTasks(open, open.length) : [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          }
        ];

  return (
    <Panel>
      {open.length === 0 ? (
        <EmptyState
          icon="Check"
          title="Nessuna task aperta"
          body="Aggiungine una qui sopra: titolo, materia, priorità e scadenza."
          action={
            <Button
              variant="primary"
              icon="Plus"
              onClick={() => document.getElementById("quick-task-title")?.focus()}
            >
              Nuova task
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.title}>
              <h3
                className={`mb-1 flex items-center gap-2 px-2.5 text-xs font-black uppercase ${
                  group.id === "overdue" ? "text-[var(--danger-text)]" : "text-[var(--faint)]"
                }`}
              >
                {group.title}
                <span className="rounded-full bg-[var(--surface-strong)] px-1.5 text-[11px] text-[var(--muted)]">{group.items.length}</span>
              </h3>
              <RowList tasks={group.items} actions={actions} />
            </section>
          ))}
        </div>
      )}
      {done.length ? (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            aria-expanded={showDone}
            className="flex min-h-11 w-full items-center gap-2 rounded-[14px] px-2.5 py-1.5 text-left text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
          >
            <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${showDone ? "rotate-90" : ""}`} />
            Completate
            <span className="rounded-full bg-[var(--surface-strong)] px-1.5 text-[11px] text-[var(--muted)]">{done.length}</span>
          </button>
          {showDone ? <RowList tasks={done} actions={actions} /> : null}
        </div>
      ) : null}
    </Panel>
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
                <span className="rounded-full bg-[var(--surface-strong)] px-2 text-xs font-black">{items.length}</span>
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
                  <div className="rounded-[18px] border border-dashed border-[var(--border)] p-4 text-center text-xs font-bold text-[var(--faint)]">Trascina o sposta qui una task</div>
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
  const subtasksDone = task.subtasks.filter((subtask) => subtask.done).length;

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
          aria-label={done ? `Riapri "${task.title}"` : `Completa "${task.title}"`}
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
        {task.dueDate ? <span className={overdue ? "text-[var(--danger-text)]" : ""}>{dueLabel(task.dueDate)}</span> : null}
        {!done ? (
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
            {PRIORITY_LABEL[task.priority]}
          </span>
        ) : null}
        {task.estimatedMinutes ? <span>{formatMinutes(task.estimatedMinutes)}</span> : null}
        {task.subtasks.length ? (
          <span>
            {subtasksDone}/{task.subtasks.length}
          </span>
        ) : null}
        {timerRunning ? (
          <span className="inline-flex items-center gap-1 text-[var(--accent-ink)]">
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {quadrants.map((quadrant) => {
        const items = tasks.filter(quadrant.test).sort(byDue);
        return (
          <section className="soft-panel min-h-[220px] p-3" key={quadrant.title} aria-label={quadrant.title}>
            <div className="mb-2 flex items-baseline gap-2 px-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: quadrant.tone }} />
              <h3 className="text-base font-black">{quadrant.title}</h3>
              <span className="text-xs font-bold text-[var(--faint)]">{quadrant.hint}</span>
              <span className="ml-auto rounded-full bg-[var(--surface-strong)] px-2 text-xs font-black">{items.length}</span>
            </div>
            <RowList tasks={items} actions={actions} compact empty="Nessuna task" />
          </section>
        );
      })}
    </div>
  );
}

function BySubject({ tasks, actions }: { tasks: Task[]; actions: RowActions }) {
  const open = tasks.filter(isOpen);
  const groups = [
    ...actions.subjects.map((subject) => ({ id: subject.id, name: subject.name, color: subject.color, items: open.filter((task) => task.subjectId === subject.id) })),
    {
      id: "none",
      name: "Senza materia",
      color: "var(--faint)",
      items: open.filter((task) => !task.subjectId || !actions.subjects.some((subject) => subject.id === task.subjectId))
    }
  ].filter((group) => group.items.length);

  if (!groups.length) return <Panel><p className="p-6 text-center text-sm font-bold text-[var(--muted)]">Nessuna task aperta.</p></Panel>;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {groups.map((group) => (
        <section key={group.id} className="soft-panel p-3" aria-label={group.name}>
          <div className="mb-2 flex items-center gap-2 px-2.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: group.color }} />
            <h3 className="one-line-safe text-base font-black">{group.name}</h3>
            <span className="ml-auto rounded-full bg-[var(--surface-strong)] px-2 text-xs font-black">{group.items.length}</span>
          </div>
          <RowList tasks={group.items.sort(byDue)} actions={actions} compact />
        </section>
      ))}
    </div>
  );
}
