// Applica l'overlay sincronizzato (barb.synced.json) sopra il seed verificato a mano.
// Funzione pura: usata dalla PWA (dataset mostrato) e dalla CLI (validazione pre-apply).

import type { BarbCourse, BarbDataset, BarbTeacher, UniversitySyncedData } from "./types";

export const emptySyncedData = (provider: string): UniversitySyncedData => ({
  version: 1,
  provider,
  generatedAt: new Date(0).toISOString(),
  cohort: null,
  semesters: [],
  courses: {},
  addedCourses: [],
  missingCourseIds: [],
  teachers: [],
  roles: [],
  contacts: [],
  timetable: { status: "non-verificato", checkedAt: null, source: null, lessons: 0, note: null },
  sources: {},
  lastRun: null
});

const MISSING_NOTE = "Attività non più presente nel piano didattico ufficiale all'ultima sincronizzazione: verificare.";

export function mergeUniversityDataset(base: BarbDataset, synced: UniversitySyncedData | null | undefined): BarbDataset {
  if (!synced) return base;
  const missing = new Set(synced.missingCourseIds);

  const courses: BarbCourse[] = base.courses.map((course) => {
    const patch = synced.courses[course.id];
    let next: BarbCourse = course;
    if (patch) {
      next = {
        ...course,
        ...patch.fields,
        schedule: patch.schedule ?? course.schedule,
        exceptions: patch.exceptions ?? course.exceptions,
        provenance: patch.provenance ?? course.provenance,
        conflicts: [...course.conflicts, ...(patch.conflicts ?? [])]
      };
    }
    if (missing.has(course.id) && !next.conflicts.some((conflict) => conflict.note === MISSING_NOTE)) {
      next = { ...next, conflicts: [...next.conflicts, { field: "piano-didattico", values: [], note: MISSING_NOTE }] };
    }
    return next;
  });
  const known = new Set(courses.map((course) => course.id));
  for (const added of synced.addedCourses) {
    if (!known.has(added.id)) courses.push(added);
  }

  const teachersById = new Map<string, BarbTeacher>(base.teachers.map((teacher) => [teacher.id, teacher]));
  for (const teacher of synced.teachers) teachersById.set(teacher.id, { ...teachersById.get(teacher.id), ...teacher });

  const semesters = base.semesters.map((semester) => {
    const patch = synced.semesters.find((item) => item.id === semester.id);
    return patch ? { ...semester, ...patch, label: semester.label } : semester;
  });

  const syncedLabels = new Set(synced.contacts.map((contact) => contact.label.toLowerCase()));
  const contacts = [...synced.contacts, ...base.contacts.filter((contact) => !syncedLabels.has(contact.label.toLowerCase()))];

  const sources = [...base.sources];
  if (synced.cohort?.manifestoUrl && !sources.some((source) => source.url === synced.cohort?.manifestoUrl)) {
    sources.push({ label: `Manifesto degli studi (${synced.cohort.label})`, url: synced.cohort.manifestoUrl, kind: "manifesto-pdf" });
  }

  return {
    ...base,
    courses,
    teachers: [...teachersById.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "it")),
    semesters,
    contacts,
    sources,
    roles: synced.roles.length ? synced.roles : base.roles,
    timetable: synced.timetable,
    syncedAt: synced.lastRun?.finishedAt ?? (synced.generatedAt !== new Date(0).toISOString() ? synced.generatedAt : null),
    sourceStates: synced.sources,
    lastRun: synced.lastRun
  };
}
