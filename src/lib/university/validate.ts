// Validazione + hash + reconcile — sicurezza contro dati errati.
// Regole: whitelist domini, controllo URL, controllo date, formati, mai inventare,
// pagine obsolete segnalate, nessun overwrite cieco (reconcile esplicito).

import { isOfficialUnimiUrl } from "./officialSources";
import { normalizeCfu, normalizeTime } from "./normalize";
import type { BarbCourse, BarbDataset } from "./types";

export interface ValidationIssue {
  level: "error" | "warning";
  field: string;
  message: string;
}

export function validateCourse(course: BarbCourse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!course.name || course.name.trim().length < 3) {
    issues.push({ level: "error", field: "name", message: "Nome ufficiale mancante o troppo corto." });
  }
  if (normalizeCfu(course.cfu) === null) {
    issues.push({ level: "error", field: "cfu", message: `CFU non valido: ${String(course.cfu)}` });
  }
  const urls: Array<[string, string | null]> = [
    ["provenance.sourceUrl", course.provenance.sourceUrl],
    ["officialPageUrl", course.officialPageUrl],
    ["arielUrl", course.arielUrl],
  ];
  for (const [field, url] of urls) {
    if (url && !isOfficialUnimiUrl(url) && field !== "arielUrl") {
      issues.push({ level: "error", field, message: `URL non ufficiale: ${url}` });
    }
    if (url && field === "arielUrl" && !/unimi\.it/i.test(url)) {
      issues.push({ level: "warning", field, message: `Ariel non UNIMI? ${url}` });
    }
  }
  if (!course.provenance.officialSource) {
    issues.push({ level: "error", field: "provenance.officialSource", message: "Fonte non ufficiale." });
  }
  if (!course.provenance.retrievedAt || Number.isNaN(Date.parse(course.provenance.retrievedAt))) {
    issues.push({ level: "error", field: "provenance.retrievedAt", message: "retrievedAt mancante." });
  }
  for (const rule of course.schedule) {
    if (!normalizeTime(rule.startTime) || !normalizeTime(rule.endTime)) {
      issues.push({ level: "error", field: `schedule.${rule.id}`, message: "Orario non valido." });
    }
    if (rule.startTime >= rule.endTime) {
      issues.push({ level: "error", field: `schedule.${rule.id}`, message: "Inizio >= fine." });
    }
  }
  if (course.conflicts.length > 0) {
    issues.push({ level: "warning", field: "conflicts", message: `${course.conflicts.length} incongruenze tra fonti da risolvere manualmente.` });
  }
  return issues;
}

/** Hash stabile (FNV-1a 32bit -> hex) del contenuto canonico: per diff incrementale senza dipendenze. */
export function contentHash(canonical: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function canonicalCourseForHash(course: BarbCourse): string {
  return JSON.stringify({
    name: course.name,
    cfu: course.cfu,
    semester: course.semester,
    ssd: [...course.ssd].sort(),
    language: course.language,
    teachers: [...course.teacherIds].sort(),
    schedule: course.schedule.map((r) => [r.weekday, r.startTime, r.endTime, r.room, r.building, r.site]),
    exceptions: course.exceptions.map((e) => [e.date, e.startTime, e.endTime, e.room, e.kind]),
  });
}

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

/** Confronta due snapshot dello stesso corso: ritorna i campi cambiati (per sync differenziale). */
export function diffCourses(before: BarbCourse, after: BarbCourse): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const cmp = (field: string, a: unknown, b: unknown) => {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) diffs.push({ field, before: sa, after: sb });
  };
  cmp("name", before.name, after.name);
  cmp("cfu", before.cfu, after.cfu);
  cmp("semester", before.semester, after.semester);
  cmp("ssd", before.ssd, after.ssd);
  cmp("language", before.language, after.language);
  cmp("teacherIds", before.teacherIds, after.teacherIds);
  cmp("schedule", before.schedule, after.schedule);
  cmp("exceptions", before.exceptions, after.exceptions);
  cmp("examMode", before.examMode, after.examMode);
  return diffs;
}

/**
 * Reconciliation: se due fonti ufficiali divergono, NON sovrascrivere silenziosamente.
 * - Vince la fonte con priority più alta (più specifica/recente);
 * - il valore perdente viene conservato in `conflicts` con provenienza.
 */
export function reconcileField<T>(args: {
  field: string;
  current: T;
  incoming: T;
  currentSource: { sourceUrl: string; retrievedAt: string };
  incomingSource: { sourceUrl: string; retrievedAt: string };
  incomingWins: boolean;
}): { value: T; conflict: BarbCourse["conflicts"][number] | null } {
  if (JSON.stringify(args.current) === JSON.stringify(args.incoming)) {
    return { value: args.current, conflict: null };
  }
  if (args.incomingWins) {
    return {
      value: args.incoming,
      conflict: {
        field: args.field,
        values: [
          { value: JSON.stringify(args.current), sourceUrl: args.currentSource.sourceUrl, retrievedAt: args.currentSource.retrievedAt },
          { value: JSON.stringify(args.incoming), sourceUrl: args.incomingSource.sourceUrl, retrievedAt: args.incomingSource.retrievedAt },
        ],
        note: "Valore precedente conservato: fonti ufficiali divergenti, vince la fonte più specifica/recente.",
      },
    };
  }
  return {
    value: args.current,
    conflict: {
      field: args.field,
      values: [
        { value: JSON.stringify(args.incoming), sourceUrl: args.incomingSource.sourceUrl, retrievedAt: args.incomingSource.retrievedAt },
      ],
      note: "Nuovo valore scartato: fonte meno specifica/recente. Conservato per revisione.",
    },
  };
}

export interface DatasetIssue extends ValidationIssue {
  scope: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validazione dell'intero dataset (seed + overlay): usata prima di ogni `--apply`
 * e da `npm run barb:validate`. Gli errori bloccano l'applicazione dell'overlay.
 */
export function validateDataset(dataset: BarbDataset): DatasetIssue[] {
  const issues: DatasetIssue[] = [];
  const push = (scope: string, level: ValidationIssue["level"], field: string, message: string) =>
    issues.push({ scope, level, field, message });

  const ids = new Set<string>();
  const names = new Map<string, string>();
  const teacherIds = new Set(dataset.teachers.map((teacher) => teacher.id));

  for (const course of dataset.courses) {
    if (ids.has(course.id)) push(course.id, "error", "id", "Id corso duplicato.");
    ids.add(course.id);
    const key = course.name.trim().toLowerCase();
    if (names.has(key)) push(course.id, "warning", "name", `Nome duplicato di ${names.get(key)}.`);
    names.set(key, course.id);
    for (const issue of validateCourse(course)) push(course.id, issue.level, issue.field, issue.message);
    for (const id of course.teacherIds) {
      if (!teacherIds.has(id)) push(course.id, "error", "teacherIds", `Docente ${id} non presente nell'elenco docenti.`);
    }
    if (course.responsibleTeacherId && !teacherIds.has(course.responsibleTeacherId)) {
      push(course.id, "error", "responsibleTeacherId", `Responsabile ${course.responsibleTeacherId} non presente.`);
    }
    if (course.year !== null && course.year !== 1 && course.year !== 2) push(course.id, "error", "year", "Anno di corso non valido.");
  }

  const teacherSeen = new Set<string>();
  for (const teacher of dataset.teachers) {
    if (teacherSeen.has(teacher.id)) push(teacher.id, "error", "id", "Id docente duplicato.");
    teacherSeen.add(teacher.id);
    if (!teacher.displayName?.trim()) push(teacher.id, "error", "displayName", "Nome docente mancante.");
    if (teacher.email && !/^[a-z0-9._%+-]+@unimi\.it$/i.test(teacher.email)) {
      push(teacher.id, "error", "email", `Email non istituzionale: ${teacher.email}`);
    }
    for (const [field, url] of [["unimiProfileUrl", teacher.unimiProfileUrl], ["provenance.sourceUrl", teacher.provenance.sourceUrl]] as const) {
      if (url && !isOfficialUnimiUrl(url)) push(teacher.id, "error", field, `URL non ufficiale: ${url}`);
    }
  }

  for (const semester of dataset.semesters) {
    const { startDate, endDate } = semester;
    if (startDate && !ISO_DATE.test(startDate)) push(semester.id, "error", "startDate", `Data non valida: ${startDate}`);
    if (endDate && !ISO_DATE.test(endDate)) push(semester.id, "error", "endDate", `Data non valida: ${endDate}`);
    if (startDate && endDate && startDate >= endDate) push(semester.id, "error", "dates", "Inizio >= fine.");
  }
  const primo = dataset.semesters.find((semester) => semester.id === "primo");
  const secondo = dataset.semesters.find((semester) => semester.id === "secondo");
  if (primo?.endDate && secondo?.startDate && primo.endDate >= secondo.startDate) {
    push("semestri", "error", "dates", "Il secondo semestre inizia prima della fine del primo.");
  }

  for (const source of dataset.sources) {
    if (!isOfficialUnimiUrl(source.url)) push("sources", "error", source.label, `Fonte non ufficiale: ${source.url}`);
  }
  for (const contact of dataset.contacts) {
    if (contact.url && !isOfficialUnimiUrl(contact.url)) push("contacts", "error", contact.label, `Link non ufficiale: ${contact.url}`);
  }
  return issues;
}
