import { useMemo, useState } from "react";
import { isBefore, parseISO, startOfDay } from "date-fns";
import type { Task } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate, subjectColor, subjectName, urgentTasks } from "../lib/selectors";
import { Button, Field, IconButton, Panel, Pill, ProgressBar, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { useNow } from "../hooks/useNow";
import { formatElapsedSeconds, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";

type TaskMode = "list" | "kanban" | "matrix" | "priority" | "subject" | "deadline" | "focus";

const modes: { id: TaskMode; label: string }[] = [
  { id: "list", label: "Lista" },
  { id: "kanban", label: "Kanban" },
  { id: "matrix", label: "Eisenhower" },
  { id: "priority", label: "Priorita" },
  { id: "subject", label: "Materia" },
  { id: "deadline", label: "Scadenza" },
  { id: "focus", label: "Focus oggi" }
];

const statuses: { id: Task["status"]; label: string }[] = [
  { id: "todo", label: "Da fare" },
  { id: "doing", label: "In corso" },
  { id: "blocked", label: "Bloccato" },
  { id: "done", label: "Completato" },
  { id: "postponed", label: "Rimandato" }
];

export function TasksView() {
  const [mode, setMode] = useState<TaskMode>("list");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const { tasks, subjects, addTask, updateTask, toggleTask, deleteTask } = useStudyStore();
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;

  const sortedTasks = useMemo(() => {
    const list = [...tasks].filter((task) => task.status !== "archived");
    if (mode === "priority" || mode === "focus") return urgentTasks(list, mode === "focus" ? 6 : list.length);
    if (mode === "deadline") {
      return list.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    }
    return list;
  }, [mode, tasks]);

  const createTask = async () => {
    if (!title.trim()) return;
    await addTask({ title: title.trim(), subjectId: subjectId || undefined, priority, importance: priority === "urgent" ? 5 : 3 });
    setTitle("");
  };

  return (
    <div>
      <SectionTitle
        title="Task list"
        subtitle="Una task list concreta: priorita, energia, sottotask, viste operative e piano di oggi."
        action={
          <Button icon="Zap" variant="primary" onClick={() => setMode("focus")}>
            Piano di oggi
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {modes.map((item) => (
          <button key={item.id} type="button" onClick={() => setMode(item.id)}>
            <Pill active={mode === item.id}>{item.label}</Pill>
          </button>
        ))}
      </div>

      <div className={`grid gap-4 ${mode === "kanban" ? "xl:grid-cols-1" : "xl:grid-cols-[1fr_360px]"}`}>
        <Panel>
          {mode === "kanban" ? (
            <Kanban
              tasks={tasks}
              subjects={subjects}
              updateTask={updateTask}
              toggleTask={toggleTask}
              deleteTask={deleteTask}
              onEdit={setEditingTaskId}
            />
          ) : mode === "matrix" ? (
            <Matrix tasks={tasks} subjects={subjects} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} onEdit={setEditingTaskId} />
          ) : mode === "subject" ? (
            <BySubject tasks={tasks} subjects={subjects} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} onEdit={setEditingTaskId} />
          ) : (
            <TaskList
              tasks={sortedTasks}
              subjects={subjects}
              toggleTask={toggleTask}
              updateTask={updateTask}
              deleteTask={deleteTask}
              onEdit={setEditingTaskId}
              focus={mode === "focus"}
            />
          )}
        </Panel>

        <aside className={`grid content-start gap-4 ${mode === "kanban" ? "md:grid-cols-2" : ""}`}>
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Nuova task</h3>
            <div className="grid gap-3">
              <Field label="Titolo">
                <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
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
              <Field label="Priorita">
                <select className={inputClass} value={priority} onChange={(event) => setPriority(event.target.value as Task["priority"])}>
                  <option value="low">Bassa</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </Field>
              <Button icon="Plus" variant="primary" onClick={createTask}>
                Aggiungi task
              </Button>
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Carico</h3>
            <div className="grid grid-cols-2 gap-3">
              <Metric value={tasks.filter((task) => task.status !== "done").length} label="aperte" />
              <Metric value={tasks.filter((task) => task.priority === "urgent").length} label="urgenti" />
              <Metric value={tasks.filter((task) => task.status === "blocked").length} label="bloccate" />
              <Metric value={tasks.reduce((sum, task) => sum + (task.status === "done" ? 0 : task.estimatedMinutes), 0)} label="minuti" />
            </div>
          </Panel>
        </aside>
      </div>

      {editingTask ? (
        <TaskEditorModal
          task={editingTask}
          subjects={subjects}
          onClose={() => setEditingTaskId(null)}
          onSave={updateTask}
          onDelete={async (task) => {
            const label = task.title.length > 80 ? `${task.title.slice(0, 77)}...` : task.title;
            if (!window.confirm(`Eliminare la task "${label}"?`)) return;
            await deleteTask(task.id);
            setEditingTaskId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="quiet-panel p-4">
      <div className="text-3xl font-black">{value}</div>
      <div className="text-xs font-bold text-[var(--muted)]">{label}</div>
    </div>
  );
}

function TaskCard({
  task,
  subjects,
  toggleTask,
  updateTask,
  deleteTask,
  onEdit
}: {
  task: Task;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  toggleTask: (id: string) => Promise<void>;
  updateTask?: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const color = subjectColor(subjects, task.subjectId);
  const overdue = task.dueDate ? isBefore(parseISO(task.dueDate), startOfDay(new Date())) && task.status !== "done" : false;
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);
  const confirmDelete = () => {
    const label = task.title.length > 80 ? `${task.title.slice(0, 77)}...` : task.title;
    if (window.confirm(`Eliminare la task "${label}"?`)) void deleteTask(task.id);
  };
  const changeStatus = (status: Task["status"]) => {
    void updateTask?.(task.id, { status });
  };

  return (
    <article className="quiet-panel min-w-0 overflow-hidden p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            type="button"
            aria-label={task.status === "done" ? "Segna da fare" : "Completa task"}
            onClick={() => toggleTask(task.id)}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-super border ${
              task.status === "done" ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)]"
            }`}
          >
            {task.status === "done" ? <Icon name="Check" className="h-5 w-5" /> : null}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`two-line-safe text-lg font-black ${task.status === "done" ? "text-[var(--faint)] line-through" : ""}`}>
                {task.title}
              </h3>
              <Pill active={task.priority === "urgent"}>{task.priority}</Pill>
              {overdue ? <Pill className="border-red-400/30 text-red-200">in ritardo</Pill> : null}
            </div>
            <p className="three-line-safe mt-1 text-sm text-[var(--muted)]">
              {task.description || subjectName(subjects, task.subjectId)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-3 py-1 text-xs font-black text-[#10131d]" style={{ background: color }}>
                {subjectName(subjects, task.subjectId)}
              </span>
              {task.dueDate ? <Pill>{shortDate(task.dueDate)}</Pill> : null}
              <Pill>{task.estimatedMinutes} min</Pill>
              {timerRunning ? <Pill className="border-[var(--accent)] text-[var(--accent)]">timer {formatElapsedSeconds(elapsedSeconds)}</Pill> : null}
              {task.actualMinutes !== undefined && !timerRunning ? <Pill>{task.actualMinutes} min reali</Pill> : null}
              <Pill>energia {task.energy}</Pill>
            </div>
            {task.subtasks.length > 0 ? (
              <div className="mt-3">
                <ProgressBar
                  value={(task.subtasks.filter((subtask) => subtask.done).length / task.subtasks.length) * 100}
                  color={color}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto sm:flex-col">
          {updateTask ? (
            <select
              className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-black sm:w-auto"
              value={task.status}
              onChange={(event) => changeStatus(event.target.value as Task["status"])}
              aria-label="Cambia stato task"
            >
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          ) : null}
          <Button variant="soft" icon="PenLine" className="min-h-10 px-3" onClick={() => onEdit(task.id)}>
            Modifica
          </Button>
          <Button variant="danger" icon="Trash2" className="min-h-10 px-3" onClick={confirmDelete}>
            Elimina
          </Button>
        </div>
      </div>
    </article>
  );
}

function TaskList({
  tasks,
  subjects,
  toggleTask,
  updateTask,
  deleteTask,
  onEdit,
  focus
}: {
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  toggleTask: (id: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
  focus?: boolean;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-3xl font-black">{focus ? "Piano di oggi" : "Tutte le task"}</h3>
        <Pill>{tasks.length} task</Pill>
      </div>
      <div className="grid gap-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} subjects={subjects} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} onEdit={onEdit} />
        ))}
        {tasks.length === 0 ? (
          <div className="quiet-panel p-8 text-center text-sm font-bold text-[var(--muted)]">
            Nessuna task in questa vista.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Kanban({
  tasks,
  subjects,
  updateTask,
  toggleTask,
  deleteTask,
  onEdit
}: {
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<Task["status"] | null>(null);

  const moveTask = async (taskId: string, status: Task["status"]) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    await updateTask(taskId, { status });
  };

  return (
    <div className="scrollbar-soft -mx-1 overflow-x-auto px-1 pb-2">
      <div className="grid min-w-[1120px] grid-cols-5 gap-4 2xl:min-w-0">
      {statuses.map((status) => (
        <section
          key={status.id}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOverStatus(status.id);
          }}
          onDragLeave={() => setOverStatus((value) => (value === status.id ? null : value))}
          onDrop={async (event) => {
            event.preventDefault();
            const transferredTaskId = event.dataTransfer.getData("text/plain");
            const taskId = transferredTaskId || draggedTaskId;
            if (taskId) await moveTask(taskId, status.id);
            setDraggedTaskId(null);
            setOverStatus(null);
          }}
          className={`quiet-panel min-h-[560px] p-3 transition-colors ${
            overStatus === status.id ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--surface)_70%,var(--accent)_12%)]" : ""
          }`}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-xl font-black">{status.label}</h3>
            <Pill>{tasks.filter((task) => task.status === status.id).length}</Pill>
          </div>
          <div className="space-y-3">
            {tasks
              .filter((task) => task.status === status.id)
              .map((task) => (
                <KanbanTaskCard
                  key={task.id}
                  task={task}
                  subjects={subjects}
                  dragging={draggedTaskId === task.id}
                  onDragStart={(id) => setDraggedTaskId(id)}
                  onDragEnd={() => {
                    setDraggedTaskId(null);
                    setOverStatus(null);
                  }}
                  onToggle={toggleTask}
                  onEdit={onEdit}
                  onDelete={deleteTask}
                />
              ))}
            {tasks.filter((task) => task.status === status.id).length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-[var(--border)] p-4 text-center text-xs font-bold text-[var(--faint)]">
                Trascina qui una task
              </div>
            ) : null}
          </div>
        </section>
      ))}
      </div>
    </div>
  );
}

function KanbanTaskCard({
  task,
  subjects,
  dragging,
  onDragStart,
  onDragEnd,
  onToggle,
  onEdit,
  onDelete
}: {
  task: Task;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onToggle: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const color = subjectColor(subjects, task.subjectId);
  const overdue = task.dueDate ? isBefore(parseISO(task.dueDate), startOfDay(new Date())) && task.status !== "done" : false;
  const done = task.status === "done";
  const timerRunning = isTaskTimerRunning(task);
  const now = useNow(1000, timerRunning);
  const elapsedSeconds = taskElapsedSeconds(task, now);
  const confirmDelete = () => {
    const label = task.title.length > 80 ? `${task.title.slice(0, 77)}...` : task.title;
    if (window.confirm(`Eliminare la task "${label}"?`)) void onDelete(task.id);
  };

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
      className={`motion-safe quiet-panel group min-w-0 cursor-grab overflow-hidden p-4 active:cursor-grabbing ${
        dragging ? "scale-[0.98] opacity-50" : "hover:translate-y-[-2px]"
      }`}
      style={{ boxShadow: `inset 0 3px 0 ${color}` }}
    >
      <div className="mb-3 flex items-start gap-3">
        <button
          type="button"
          aria-label={done ? "Riapri task" : "Completa task"}
          onClick={() => onToggle(task.id)}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-super border ${
            done ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] bg-[var(--surface-soft)]"
          }`}
        >
          {done ? <Icon name="Check" className="h-5 w-5" /> : <Icon name="MoreHorizontal" className="h-4 w-4 text-[var(--faint)]" />}
        </button>
        <div className="min-w-0 flex-1">
          <h4 className={`two-line-safe text-base font-black leading-tight ${done ? "text-[var(--faint)] line-through" : ""}`}>
            {task.title}
          </h4>
          <p className="one-line-safe mt-1 text-xs font-bold text-[var(--muted)]">{subjectName(subjects, task.subjectId)}</p>
        </div>
      </div>

      {task.description ? (
        <p className="three-line-safe mb-3 text-sm text-[var(--muted)]">{task.description}</p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <Pill active={task.priority === "urgent"}>{task.priority}</Pill>
        {overdue ? <Pill className="border-red-400/30 text-red-200">in ritardo</Pill> : null}
        {task.dueDate ? <Pill>{shortDate(task.dueDate)}</Pill> : null}
        {timerRunning ? <Pill className="border-[var(--accent)] text-[var(--accent)]">timer {formatElapsedSeconds(elapsedSeconds)}</Pill> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-black text-[var(--muted)]">
        <div className="rounded-[16px] bg-[var(--surface-soft)] p-2">
          <span className="block text-[var(--faint)]">Stimata</span>
          <span className="text-[var(--text)]">{task.estimatedMinutes} min</span>
        </div>
        <div className="rounded-[16px] bg-[var(--surface-soft)] p-2">
          <span className="block text-[var(--faint)]">{timerRunning ? "Cronometro" : "Effettiva"}</span>
          <span className="text-[var(--text)]">{timerRunning ? formatElapsedSeconds(elapsedSeconds) : `${task.actualMinutes ?? "-"} min`}</span>
        </div>
        <div className="rounded-[16px] bg-[var(--surface-soft)] p-2">
          <span className="block text-[var(--faint)]">Energia</span>
          <span className="text-[var(--text)]">{task.energy}</span>
        </div>
        <div className="rounded-[16px] bg-[var(--surface-soft)] p-2">
          <span className="block text-[var(--faint)]">Imp.</span>
          <span className="text-[var(--text)]">{task.importance}/5</span>
        </div>
      </div>

      {task.subtasks.length > 0 ? (
        <div className="mt-3">
          <ProgressBar
            value={(task.subtasks.filter((subtask) => subtask.done).length / task.subtasks.length) * 100}
            color={color}
          />
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <Button variant="soft" icon="PenLine" className="min-h-10 px-3 text-xs" draggable={false} onClick={() => onEdit(task.id)}>
          Modifica
        </Button>
        <IconButton
          icon="Trash2"
          label={`Elimina task ${task.title}`}
          className="h-10 w-10 bg-red-500/14 text-red-100 hover:bg-red-500/22"
          draggable={false}
          onClick={confirmDelete}
        />
      </div>
    </article>
  );
}

function Matrix({
  tasks,
  subjects,
  toggleTask,
  updateTask,
  deleteTask,
  onEdit
}: {
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  toggleTask: (id: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  const quadrants = [
    { title: "Fai ora", test: (task: Task) => task.importance >= 4 && ["urgent", "high"].includes(task.priority) },
    { title: "Pianifica", test: (task: Task) => task.importance >= 4 && !["urgent", "high"].includes(task.priority) },
    { title: "Delega o riduci", test: (task: Task) => task.importance < 4 && ["urgent", "high"].includes(task.priority) },
    { title: "Rimanda", test: (task: Task) => task.importance < 4 && !["urgent", "high"].includes(task.priority) }
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {quadrants.map((quadrant) => (
        <div className="quiet-panel min-h-[320px] p-4" key={quadrant.title}>
          <h3 className="mb-3 text-xl font-black">{quadrant.title}</h3>
          <div className="space-y-3">
            {tasks
              .filter((task) => task.status !== "done" && quadrant.test(task))
              .map((task) => (
                <TaskCard key={task.id} task={task} subjects={subjects} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} onEdit={onEdit} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BySubject({
  tasks,
  subjects,
  toggleTask,
  updateTask,
  deleteTask,
  onEdit
}: {
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  toggleTask: (id: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  onEdit: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {subjects.map((subject) => (
        <div key={subject.id} className="quiet-panel p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="h-4 w-4 rounded-full" style={{ background: subject.color }} />
            <h3 className="safe-text text-xl font-black">{subject.name}</h3>
          </div>
          <div className="space-y-3">
            {tasks
              .filter((task) => task.subjectId === subject.id)
              .map((task) => (
                <TaskCard key={task.id} task={task} subjects={subjects} toggleTask={toggleTask} updateTask={updateTask} deleteTask={deleteTask} onEdit={onEdit} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
