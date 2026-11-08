import type { AgentCallResult } from "./types";
import { publicAttachment, publicGroup, publicPreferences, publicSubject } from "./project";
import { readAudit, readStoredPolicy } from "../lib/agentLocal";
import { createId, nowIso } from "../lib/id";
import { normalizeExternalUrl } from "../lib/safeUrl";
import { studyMinutesThisWeek, studyStreak, upcomingExams, urgentTasks } from "../lib/selectors";
import { selectPreferences, useStudyStore, type PreferencesPatch } from "../store/useStudyStore";
import type { CalendarEvent, Exam, Goal, Note, StudySession, StudyTopic, Subject, Task } from "../types";

type Args = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
const queryOf = (args: Args) => text(args.query).trim().toLocaleLowerCase("it");
const includes = (query: string, ...parts: Array<string | undefined>) => !query || parts.some((part) => (part ?? "").toLocaleLowerCase("it").includes(query));

const page = <T>(items: T[], args: Args) => {
  const offset = Number(args.offset ?? 0);
  const limit = Number(args.limit ?? 30);
  const slice = items.slice(offset, offset + limit);
  return { total: items.length, count: slice.length, offset, limit, has_more: offset + slice.length < items.length, items: slice };
};

const fail = (code: Extract<AgentCallResult, { ok: false }>["code"], error: string): AgentCallResult => ({ ok: false, code, error });

const ok = (data: Record<string, unknown>): AgentCallResult => {
  const warning = useStudyStore.getState().persistError;
  return warning ? { ok: true, data: { ...data, warning } } : { ok: true, data };
};

const state = () => useStudyStore.getState();

const pick = (args: Args, keys: string[]) => {
  const patch: Record<string, unknown> = {};
  for (const key of keys) if (args[key] !== undefined) patch[key] = args[key];
  return patch;
};

const blankToUndefined = (patch: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) if (patch[key] === "") patch[key] = undefined;
  return patch;
};

async function createdId(key: "tasks" | "events" | "exams" | "sessions" | "goals" | "notes" | "attachments" | "groupResources", run: () => Promise<unknown>) {
  const before = new Set(state()[key].map((item) => item.id));
  await run();
  return state()[key].find((item) => !before.has(item.id))?.id;
}

const requireSubject = (id: unknown) => {
  if (typeof id !== "string" || !id) return null;
  return state().subjects.find((item) => item.id === id) ?? false;
};

export const executeAgentTool = async (name: string, args: Args): Promise<AgentCallResult> => {
  const current = state();
  if (current.loading) return fail("locked", "StudyOS sta ancora caricando i dati. Riprova tra qualche secondo.");
  if (current.locked) {
    if (name === "studyos_status") return ok({ connected: true, locked: true, message: "Il vault è bloccato. Sblocca StudyOS per leggere o modificare i dati." });
    return fail("locked", "Il vault è bloccato. Sblocca StudyOS e ripeti la richiesta.");
  }

  try {
    switch (name) {
      case "studyos_status":
        return statusResult();
      case "studyos_overview":
        return overviewResult();
      case "studyos_search":
        return searchResult(args);
      case "studyos_list_subjects":
        return listSubjects(args);
      case "studyos_get_subject":
        return one(current.subjects, text(args.id), "Materia non trovata.", (item) => publicSubject(item, true));
      case "studyos_create_subject":
        return createSubject(args);
      case "studyos_update_subject":
        return updateSubject(args);
      case "studyos_list_tasks":
        return listTasks(args);
      case "studyos_get_task":
        return one(current.tasks, text(args.id), "Task non trovata.", (item) => item);
      case "studyos_create_task":
        return createTask(args);
      case "studyos_update_task":
        return updateTask(args);
      case "studyos_delete_task":
        return remove("tasks", text(args.id), "Task non trovata.", () => state().deleteTask(text(args.id)));
      case "studyos_list_events":
        return listEvents(args);
      case "studyos_get_event":
        return one(current.events, text(args.id), "Evento non trovato.", (item) => item);
      case "studyos_create_event":
        return createEvent(args);
      case "studyos_update_event":
        return updateEvent(args);
      case "studyos_delete_event":
        return remove("events", text(args.id), "Evento non trovato.", () => state().deleteEvent(text(args.id)));
      case "studyos_list_exams":
        return listExams(args);
      case "studyos_get_exam":
        return one(current.exams, text(args.id), "Esame non trovato.", (item) => item);
      case "studyos_create_exam":
        return createExam(args);
      case "studyos_update_exam":
        return updateExam(args);
      case "studyos_record_grade":
        return recordGrade(args);
      case "studyos_delete_exam":
        return remove("exams", text(args.id), "Esame non trovato.", () => state().deleteExam(text(args.id)));
      case "studyos_list_sessions":
        return listSessions(args);
      case "studyos_create_session":
        return createSession(args);
      case "studyos_update_session":
        return updateSession(args);
      case "studyos_delete_session":
        return remove("sessions", text(args.id), "Sessione non trovata.", () => state().deleteSession(text(args.id)));
      case "studyos_list_topics":
        return listTopics(args);
      case "studyos_add_topics":
        return addTopics(args);
      case "studyos_review_topic":
        return reviewTopic(args);
      case "studyos_update_topic":
        return updateTopic(args);
      case "studyos_delete_topic":
        return remove("topics", text(args.id), "Argomento non trovato.", () => state().deleteTopic(text(args.id)));
      case "studyos_list_materials":
        return listMaterials(args);
      case "studyos_add_link":
        return addLink(args);
      case "studyos_update_material":
        return updateMaterial(args);
      case "studyos_delete_material":
        return remove("attachments", text(args.id), "Materiale non trovato.", () => state().deleteAttachment(text(args.id)));
      case "studyos_list_notes":
        return listNotes(args);
      case "studyos_get_note":
        return one(current.notes, text(args.id), "Nota non trovata.", (item) => item);
      case "studyos_create_note":
        return createNote(args);
      case "studyos_update_note":
        return updateNote(args);
      case "studyos_delete_note":
        return deleteNote(text(args.id));
      case "studyos_list_goals":
        return listGoals(args);
      case "studyos_create_goal":
        return createGoal(args);
      case "studyos_update_goal":
        return updateGoal(args);
      case "studyos_delete_goal":
        return remove("goals", text(args.id), "Obiettivo non trovato.", async () => undefined);
      case "studyos_get_preferences":
        return ok({ preferences: publicPreferences(selectPreferences(current)) });
      case "studyos_update_preferences":
        return updatePreferences(args);
      case "studyos_list_notifications":
        return listNotifications(args);
      case "studyos_mark_notifications_read":
        return markNotifications(args);
      case "studyos_list_groups":
        return ok(page(current.studyGroups.filter((item) => includes(queryOf(args), item.name, item.description)).map(publicGroup), args));
      case "studyos_list_group_board":
        return groupBoard(args);
      case "studyos_add_group_resource":
        return addGroupResource(args);
      case "studyos_delete_group_resource":
        return deleteGroupResource(text(args.id));
      case "studyos_list_barb_exams":
        return listBarb(args);
      case "studyos_import_barb_exams":
        return importBarb(args);
      case "studyos_timer_status":
        return ok({ timer: timerSnapshot() });
      case "studyos_timer_control":
        return controlTimer(args);
      case "studyos_list_audit":
        return ok({ entries: readAudit(Number(args.limit ?? 20)) });
      default:
        return fail("invalid", `Strumento non eseguibile nell'app: ${name}.`);
    }
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Operazione non riuscita.");
  }
};

const statusResult = (): AgentCallResult => {
  const current = state();
  const preferences = selectPreferences(current);
  return ok({
    connected: true,
    locked: false,
    displayName: preferences.displayName,
    policy: readStoredPolicy(),
    counts: {
      subjects: current.subjects.length,
      tasks: current.tasks.length,
      events: current.events.length,
      exams: current.exams.length,
      sessions: current.sessions.length,
      topics: current.topics.length,
      materials: current.attachments.length,
      goals: current.goals.length,
      groups: current.studyGroups.length
    }
  });
};

const overviewResult = (): AgentCallResult => {
  const current = state();
  const preferences = selectPreferences(current);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86_400_000;
  const today = current.events.filter((event) => {
    const start = Date.parse(event.start);
    const end = Date.parse(event.end);
    return Number.isFinite(start) && Number.isFinite(end) && start < dayEnd && end > dayStart;
  });
  return ok({
    displayName: preferences.displayName,
    weeklyTargetMinutes: preferences.weeklyTargetMinutes,
    studiedMinutesThisWeek: studyMinutesThisWeek(current.sessions),
    streak: studyStreak(current.sessions),
    today: today.slice(0, 8).map((event) => ({ id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay === true, category: event.category })),
    urgentTasks: urgentTasks(current.tasks, 8).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate })),
    upcomingExams: upcomingExams(current.exams, 6).map((exam) => ({ id: exam.id, subjectId: exam.subjectId, date: exam.date, status: exam.status }))
  });
};

const searchResult = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const current = state();
  const hits: Array<{ type: string; id: string; title: string; snippet: string }> = [];
  const push = (type: string, id: string, title: string, snippet = "") => {
    if (includes(query, title, snippet)) hits.push({ type, id, title, snippet: snippet.slice(0, 180) });
  };
  for (const item of current.subjects) push("subject", item.id, item.name, item.teacher);
  for (const item of current.tasks) push("task", item.id, item.title, item.description);
  for (const item of current.events) push("event", item.id, item.title, item.description);
  for (const item of current.exams) push("exam", item.id, item.date, item.program.join(", "));
  for (const item of current.sessions) push("session", item.id, item.title, item.notes);
  for (const item of current.topics) push("topic", item.id, item.title, item.notes);
  for (const item of current.notes) push("note", item.id, item.title, item.body);
  for (const item of current.goals) push("goal", item.id, item.title, item.description);
  for (const item of current.attachments) push("material", item.id, item.name, item.description);
  return ok(page(hits, args));
};

const listSubjects = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().subjects.filter((item) => {
    if (!args.includeArchived && (item.archived || item.status === "archived")) return false;
    if (typeof args.status === "string" && item.status !== args.status) return false;
    return includes(query, item.name, item.teacher);
  });
  return ok(page(items.map((item) => publicSubject(item)), args));
};

const createSubject = async (args: Args): Promise<AgentCallResult> => {
  const id = await state().addSubject({
    name: text(args.name).trim(),
    teacher: text(args.teacher),
    cfu: Number(args.cfu ?? 0),
    semester: text(args.semester),
    status: (args.status as Subject["status"]) ?? "active",
    targetGrade: typeof args.targetGrade === "number" ? args.targetGrade : undefined,
    notes: text(args.notes),
    color: optional(args.color)
  });
  return ok({ id });
};

const updateSubject = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().subjects.some((item) => item.id === id)) return fail("not_found", "Materia non trovata.");
  const patch = blankToUndefined(pick(args, ["name", "teacher", "cfu", "semester", "status", "targetGrade", "notes", "color", "archived", "semesterOverride"]), ["color"]);
  await state().updateSubject(id, patch);
  return ok({ id });
};

const listTasks = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().tasks.filter((item) => {
    if (!args.includeArchived && item.status === "archived") return false;
    if (typeof args.status === "string" && item.status !== args.status) return false;
    if (typeof args.subjectId === "string" && item.subjectId !== args.subjectId) return false;
    return includes(query, item.title, item.description);
  });
  return ok(page(items, args));
};

const createTask = async (args: Args): Promise<AgentCallResult> => {
  const subject = requireSubject(args.subjectId);
  if (subject === false) return fail("not_found", "Materia non trovata.");
  const id = await createdId("tasks", () => state().addTask({
    title: text(args.title).trim(),
    description: text(args.description),
    priority: (args.priority as Task["priority"]) ?? "medium",
    dueDate: optional(args.dueDate),
    subjectId: subject ? subject.id : undefined,
    status: (args.status as Task["status"]) ?? "todo",
    notes: text(args.notes),
    estimatedMinutes: Number(args.estimatedMinutes ?? 0),
    energy: (args.energy as Task["energy"]) ?? "medium",
    difficulty: Number(args.difficulty ?? 3) as Task["difficulty"],
    importance: Number(args.importance ?? 3) as Task["importance"]
  }));
  return ok({ id });
};

const updateTask = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().tasks.some((item) => item.id === id)) return fail("not_found", "Task non trovata.");
  if (args.subjectId) {
    const subject = requireSubject(args.subjectId);
    if (subject === false) return fail("not_found", "Materia non trovata.");
  }
  const patch = blankToUndefined(pick(args, ["title", "description", "priority", "dueDate", "subjectId", "status", "notes", "estimatedMinutes", "energy", "difficulty", "importance"]), ["dueDate", "subjectId"]);
  if (Array.isArray(args.subtasks)) {
    patch.subtasks = args.subtasks.map((item) => {
      const sub = item as { text: string; done?: boolean };
      return { id: createId("subtask"), text: sub.text, done: Boolean(sub.done) };
    });
  }
  await state().updateTask(id, patch as Partial<Task>);
  return ok({ id });
};

const listEvents = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const from = typeof args.from === "string" ? Date.parse(args.from) : undefined;
  const to = typeof args.to === "string" ? Date.parse(args.to) : undefined;
  const items = state().events.filter((item) => {
    const start = Date.parse(item.start);
    if (from !== undefined && Number.isFinite(from) && Date.parse(item.end) < from) return false;
    if (to !== undefined && Number.isFinite(to) && start > to) return false;
    if (typeof args.subjectId === "string" && item.subjectId !== args.subjectId) return false;
    return includes(query, item.title, item.description);
  });
  return ok(page(items, args));
};

const createEvent = async (args: Args): Promise<AgentCallResult> => {
  if (Date.parse(text(args.end)) <= Date.parse(text(args.start))) return fail("invalid", "L'orario di fine deve essere successivo all'inizio.");
  const subject = requireSubject(args.subjectId);
  if (subject === false) return fail("not_found", "Materia non trovata.");
  const id = await createdId("events", () => state().addEvent({
    title: text(args.title).trim(),
    start: text(args.start),
    end: text(args.end),
    category: (args.category as CalendarEvent["category"]) ?? "study",
    description: text(args.description),
    notes: text(args.notes),
    subjectId: subject ? subject.id : undefined,
    allDay: Boolean(args.allDay),
    priority: (args.priority as CalendarEvent["priority"]) ?? "medium",
    recurrence: (args.recurrence as CalendarEvent["recurrence"]) ?? "none",
    recurrenceUntil: optional(args.recurrenceUntil)
  }));
  return ok({ id });
};

const updateEvent = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  const event = state().events.find((item) => item.id === id);
  if (!event) return fail("not_found", "Evento non trovato.");
  const start = text(args.start) || event.start;
  const end = text(args.end) || event.end;
  if (Date.parse(end) <= Date.parse(start)) return fail("invalid", "L'orario di fine deve essere successivo all'inizio.");
  if (args.subjectId) {
    const subject = requireSubject(args.subjectId);
    if (subject === false) return fail("not_found", "Materia non trovata.");
  }
  const patch = blankToUndefined(pick(args, ["title", "start", "end", "category", "description", "notes", "subjectId", "allDay", "priority", "status", "recurrence", "recurrenceUntil"]), ["subjectId", "recurrenceUntil"]);
  await state().updateEvent(id, patch as Partial<CalendarEvent>);
  return ok({ id });
};

const listExams = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const subjects = state().subjects;
  const items = state().exams.filter((item) => {
    if (typeof args.subjectId === "string" && item.subjectId !== args.subjectId) return false;
    const subject = subjects.find((entry) => entry.id === item.subjectId);
    return includes(query, subject?.name, item.date, item.program.join(" "));
  });
  return ok(page(items, args));
};

const createExam = async (args: Args): Promise<AgentCallResult> => {
  const subject = requireSubject(args.subjectId);
  if (subject === false || subject === null) return fail("not_found", "Materia non trovata.");
  const id = await createdId("exams", () => state().addExam({
    subjectId: subject.id,
    date: text(args.date),
    program: Array.isArray(args.program) ? args.program.map(String) : [],
    preparation: Number(args.preparation ?? 0),
    targetGrade: Number(args.targetGrade ?? 24),
    status: (args.status as Exam["status"]) ?? "planning"
  }));
  return ok({ id });
};

const updateExam = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().exams.some((item) => item.id === id)) return fail("not_found", "Esame non trovato.");
  const patch = pick(args, ["date", "program", "preparation", "targetGrade", "status", "simulations", "frequentQuestions"]);
  await state().updateExam(id, patch as Partial<Exam>);
  return ok({ id });
};

const recordGrade = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().exams.some((item) => item.id === id)) return fail("not_found", "Esame non trovato.");
  const passFail = args.passFail === true;
  if (!passFail && typeof args.grade !== "number") return fail("invalid", "Indica grade da 18 a 30, oppure passFail=true per un'idoneità.");
  await state().updateExam(id, {
    status: "done",
    passFail,
    grade: passFail ? undefined : Number(args.grade),
    honors: passFail ? false : args.honors === true
  });
  return ok({ id, grade: passFail ? null : args.grade, honors: !passFail && args.honors === true, passFail });
};

const listSessions = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().sessions.filter((item) => {
    if (typeof args.status === "string" && item.status !== args.status) return false;
    if (typeof args.subjectId === "string" && item.subjectId !== args.subjectId) return false;
    return includes(query, item.title, item.notes);
  });
  return ok(page(items, args));
};

const createSession = async (args: Args): Promise<AgentCallResult> => {
  const subject = requireSubject(args.subjectId);
  if (subject === false) return fail("not_found", "Materia non trovata.");
  const id = await createdId("sessions", () => state().addSession({
    title: text(args.title).trim(),
    subjectId: subject ? subject.id : undefined,
    template: (args.template as StudySession["template"]) ?? "review",
    plannedMinutes: Number(args.plannedMinutes ?? 50),
    actualMinutes: Number(args.actualMinutes ?? 0),
    start: optional(args.start) ?? nowIso(),
    status: (args.status as StudySession["status"]) ?? "planned",
    topics: Array.isArray(args.topics) ? args.topics.map(String) : [],
    notes: text(args.notes),
    perceivedDifficulty: Number(args.perceivedDifficulty ?? 3) as StudySession["perceivedDifficulty"],
    focusLevel: Number(args.focusLevel ?? 3) as StudySession["focusLevel"]
  }));
  return ok({ id });
};

const updateSession = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().sessions.some((item) => item.id === id)) return fail("not_found", "Sessione non trovata.");
  const patch = pick(args, ["title", "actualMinutes", "plannedMinutes", "status", "notes", "perceivedDifficulty", "focusLevel", "topics"]);
  await state().updateSession(id, patch as Partial<StudySession>);
  return ok({ id });
};

const listTopics = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const today = new Date().toISOString().slice(0, 10);
  const items = state().topics.filter((item) => {
    if (typeof args.subjectId === "string" && item.subjectId !== args.subjectId) return false;
    if (args.dueOnly === true && item.nextReviewDate.slice(0, 10) > today) return false;
    return includes(query, item.title, item.notes);
  });
  return ok(page(items, args));
};

const addTopics = async (args: Args): Promise<AgentCallResult> => {
  const topics = (args.topics as Array<{ subjectId: string; title: string; notes?: string }>);
  for (const topic of topics) {
    if (requireSubject(topic.subjectId) === false) return fail("not_found", "Una delle materie indicate non esiste.");
  }
  const added = await state().addTopics(topics.map((topic) => ({ subjectId: topic.subjectId, title: topic.title.trim(), notes: topic.notes ?? "" })));
  return ok({ added });
};

const reviewTopic = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().topics.some((item) => item.id === id)) return fail("not_found", "Argomento non trovato.");
  await state().reviewTopic(id, args.rating as "again" | "hard" | "good" | "easy");
  const topic = state().topics.find((item) => item.id === id);
  return ok({ id, nextReviewDate: topic?.nextReviewDate, intervalDays: topic?.intervalDays });
};

const updateTopic = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().topics.some((item) => item.id === id)) return fail("not_found", "Argomento non trovato.");
  const patch = pick(args, ["title", "notes", "difficulty", "comprehension"]);
  await state().updateTopic(id, patch as Partial<StudyTopic>);
  return ok({ id });
};

const listMaterials = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().attachments.filter((item) => {
    if (typeof args.linkedEntityId === "string" && item.linkedEntityId !== args.linkedEntityId) return false;
    return includes(query, item.name, item.description);
  });
  return ok(page(items.map(publicAttachment), args));
};

const addLink = async (args: Args): Promise<AgentCallResult> => {
  const url = normalizeExternalUrl(text(args.url));
  if (!url) return fail("invalid", "Link non ammesso. Usa http, https o mailto.");
  const id = await createdId("attachments", () => state().addExternalAttachment(url, text(args.name).trim(), text(args.description)));
  return ok({ id, url });
};

const updateMaterial = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().attachments.some((item) => item.id === id)) return fail("not_found", "Materiale non trovato.");
  await state().updateAttachment(id, pick(args, ["name", "description"]));
  return ok({ id });
};

const listNotes = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().notes.filter((item) => includes(query, item.title, item.body)).map((item) => ({ ...item, body: item.body.slice(0, 180) }));
  return ok(page(items, args));
};

const mutateNotes = async (notes: Note[]) => {
  useStudyStore.setState({ notes });
  await state().retryPersist();
};

const createNote = async (args: Args): Promise<AgentCallResult> => {
  const now = nowIso();
  const created: Note = {
    id: createId("note"),
    createdAt: now,
    updatedAt: now,
    archived: false,
    tags: [],
    title: text(args.title).trim(),
    body: text(args.body),
    linkedEntityType: optional(args.linkedEntityType) as Note["linkedEntityType"],
    linkedEntityId: optional(args.linkedEntityId)
  };
  await mutateNotes([created, ...state().notes]);
  return ok({ id: created.id });
};

const updateNote = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().notes.some((item) => item.id === id)) return fail("not_found", "Nota non trovata.");
  const patch = pick(args, ["title", "body"]);
  await mutateNotes(state().notes.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item)));
  return ok({ id });
};

const deleteNote = async (id: string): Promise<AgentCallResult> => {
  if (!state().notes.some((item) => item.id === id)) return fail("not_found", "Nota non trovata.");
  await mutateNotes(state().notes.filter((item) => item.id !== id));
  return ok({ id, deleted: true });
};

const listGoals = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().goals.filter((item) => {
    if (typeof args.status === "string" && item.status !== args.status) return false;
    return includes(query, item.title, item.description);
  });
  return ok(page(items, args));
};

const createGoal = async (args: Args): Promise<AgentCallResult> => {
  const id = await createdId("goals", () => state().addGoal({
    title: text(args.title).trim(),
    description: text(args.description),
    category: (args.category as Goal["category"]) ?? "study",
    deadline: optional(args.deadline),
    progress: Number(args.progress ?? 0),
    metric: text(args.metric) || "%",
    notes: text(args.notes)
  }));
  return ok({ id });
};

const updateGoal = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  if (!state().goals.some((item) => item.id === id)) return fail("not_found", "Obiettivo non trovato.");
  const patch = blankToUndefined(pick(args, ["title", "description", "progress", "status", "deadline", "notes", "metric"]), ["deadline"]);
  await state().updateGoal(id, patch as Partial<Goal>);
  return ok({ id });
};

const updatePreferences = async (args: Args): Promise<AgentCallResult> => {
  const patch = pick(args, ["displayName", "weeklyTargetMinutes", "degreeCfu", "showBarb", "degreeProgram", "sbThesisGrade", "barbThesisPoints", "abroad"]);
  if (!Object.keys(patch).length) return fail("invalid", "Indica almeno un campo da aggiornare.");
  await state().updatePreferences(patch as PreferencesPatch);
  return ok({ preferences: publicPreferences(selectPreferences(state())) });
};

const listNotifications = (args: Args): AgentCallResult => {
  const query = queryOf(args);
  const items = state().notifications.filter((item) => {
    if (args.unreadOnly === true && item.readAt) return false;
    return includes(query, item.title, item.body);
  }).map((item) => ({ id: item.id, kind: item.kind, title: item.title, body: item.body, readAt: item.readAt, linkView: item.linkView, createdAt: item.createdAt }));
  return ok(page(items, args));
};

const markNotifications = async (args: Args): Promise<AgentCallResult> => {
  if (args.all === true) {
    await state().markAllNotificationsRead();
    return ok({ all: true });
  }
  const id = text(args.id);
  if (!state().notifications.some((item) => item.id === id)) return fail("not_found", "Notifica non trovata.");
  await state().markNotificationRead(id);
  return ok({ id });
};

const groupBoard = (args: Args): AgentCallResult => {
  const groupId = text(args.groupId);
  const group = state().studyGroups.find((item) => item.id === groupId);
  if (!group) return fail("not_found", "Gruppo non trovato.");
  const limit = Number(args.limit ?? 30);
  return ok({
    group: publicGroup(group),
    resources: state().groupResources.filter((item) => item.groupId === groupId).slice(0, limit).map((item) => ({
      id: item.id, kind: item.kind, title: item.title, url: item.url, body: item.body, pinned: item.pinned, addedByDisplayName: item.addedByDisplayName, updatedAt: item.updatedAt
    })),
    activities: state().groupActivities.filter((item) => item.groupId === groupId).slice(0, limit).map((item) => ({
      id: item.id, actorDisplayName: item.actorDisplayName, text: item.text, createdAt: item.createdAt
    }))
  });
};

const addGroupResource = async (args: Args): Promise<AgentCallResult> => {
  const group = state().studyGroups.find((item) => item.id === text(args.groupId));
  if (!group) return fail("not_found", "Gruppo non trovato.");
  let url: string | undefined;
  if (args.kind === "link") {
    const safe = normalizeExternalUrl(text(args.url));
    if (!safe) return fail("invalid", "Per un link serve un indirizzo http, https o mailto.");
    url = safe;
  }
  const { getActor, pushSharedResource, logSharedActivity } = await import("../lib/groupSync");
  const actor = await getActor();
  const id = await state().addGroupResource({
    groupId: group.id,
    kind: args.kind as "link" | "note",
    title: text(args.title).trim(),
    url,
    body: text(args.body),
    addedByUserId: actor.userId,
    addedByDisplayName: actor.displayName
  });
  const resource = state().groupResources.find((item) => item.id === id);
  if (resource) await pushSharedResource(resource).catch(() => undefined);
  await logSharedActivity(group.id, actor.displayName, `ha pubblicato «${text(args.title).trim()}»`).catch(() => undefined);
  return ok({ id });
};

const deleteGroupResource = async (id: string): Promise<AgentCallResult> => {
  if (!state().groupResources.some((item) => item.id === id)) return fail("not_found", "Risorsa non trovata.");
  const { deleteSharedResource } = await import("../lib/groupSync");
  await state().deleteGroupResource(id);
  await deleteSharedResource(id).catch(() => undefined);
  return ok({ id, deleted: true });
};

const listBarb = async (args: Args): Promise<AgentCallResult> => {
  const { BARB_EXAM_COURSES, BARB_EXAM_SESSIONS, BARB_EXAM_DATA } = await import("../lib/university/examSessions");
  const names = new Map(BARB_EXAM_COURSES.map((course) => [course.id, course.name]));
  const query = queryOf(args);
  const items = BARB_EXAM_SESSIONS.filter((session) => {
    if (typeof args.courseId === "string" && session.courseId !== args.courseId) return false;
    if (typeof args.from === "string" && session.date < args.from) return false;
    if (typeof args.to === "string" && session.date > args.to) return false;
    return includes(query, names.get(session.courseId), session.date, session.type ?? undefined, session.location ?? undefined);
  }).map((session) => ({
    id: session.id,
    courseId: session.courseId,
    courseName: names.get(session.courseId) ?? session.courseId,
    date: session.date,
    time: session.time,
    type: session.type,
    location: session.location
  }));
  return ok({ ...page(items, args), checkedAt: BARB_EXAM_DATA.checkedAt, note: "Sono solo gli appelli verificati nel dataset. L'assenza di una data non significa che l'esame non esista." });
};

const importBarb = async (args: Args): Promise<AgentCallResult> => {
  const ids = new Set((args.ids as string[]));
  const { BARB_EXAM_SESSIONS } = await import("../lib/university/examSessions");
  const selected = BARB_EXAM_SESSIONS.filter((session) => ids.has(session.id));
  if (!selected.length) return fail("not_found", "Nessun appello ufficiale con questi id. Leggili da studyos_list_barb_exams.");
  const result = await state().importBarbExamSessions(selected);
  return ok({ ...result, requested: ids.size });
};

const timerSnapshot = () => {
  const timer = state().timer;
  const remainingSeconds = timer.running && timer.endsAt ? Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000)) : timer.remainingSeconds;
  return { mode: timer.mode, running: timer.running, remainingSeconds, durationSeconds: timer.durationSeconds, label: timer.label };
};

const controlTimer = (args: Args): AgentCallResult => {
  const store = state();
  if (args.action === "start") {
    if (typeof args.mode !== "string") return fail("invalid", "Per avviare il timer indica mode: classic, pomodoro o deep-focus.");
    store.startStudyTimer(args.mode as "classic" | "pomodoro" | "deep-focus");
  } else if (args.action === "toggle") store.toggleStudyTimer();
  else store.resetStudyTimer(typeof args.mode === "string" ? args.mode as "classic" | "pomodoro" | "deep-focus" : undefined);
  return ok({ timer: timerSnapshot() });
};

const one = <T extends { id: string }>(items: T[], id: string, missing: string, project: (item: T) => unknown): AgentCallResult => {
  const item = items.find((entry) => entry.id === id);
  if (!item) return fail("not_found", missing);
  return ok({ item: project(item) as Record<string, unknown> });
};

const remove = async (key: "tasks" | "events" | "exams" | "sessions" | "topics" | "attachments" | "goals", id: string, missing: string, run: () => Promise<void>): Promise<AgentCallResult> => {
  const collection = state()[key] as Array<{ id: string }>;
  if (!collection.some((item) => item.id === id)) return fail("not_found", missing);
  if (key === "goals") {
    useStudyStore.setState({ goals: state().goals.filter((item) => item.id !== id) });
    await state().retryPersist();
    return ok({ id, deleted: true });
  }
  await run();
  return ok({ id, deleted: true });
};
