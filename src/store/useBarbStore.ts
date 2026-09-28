// Store BARB — dataset verificato (seed + overlay sincronizzato) con mirror in IndexedDB.
// Lo scraping NON scrive mai qui: l'overlay arriva nel bundle dopo `barb:apply`.
// Prima: bulkPut del seed a ogni apertura della vista e righe obsolete mai rimosse
// (corsi rinominati restavano duplicati). Ora il mirror viene riscritto solo quando
// cambia la versione del dataset, in un'unica transazione.

import { create } from "zustand";
import { BARB_DATASET, BARB_DATASET_VERSION } from "../data/university/barb.dataset";
import { db, getMeta, setMeta } from "../lib/db";
import type { BarbCourse, BarbTeacher, BarbSemesterInfo, UniversitySyncLog } from "../lib/university/types";

const MIRROR_KEY = "barb:datasetVersion";

interface BarbState {
  ready: boolean;
  courses: BarbCourse[];
  teachers: BarbTeacher[];
  semesters: BarbSemesterInfo[];
  syncLogs: UniversitySyncLog[];
  init: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;

const syncMirror = async () => {
  const mirrored = await getMeta<string>(MIRROR_KEY);
  if (mirrored === BARB_DATASET_VERSION) return;
  await db.transaction("rw", [db.barbCourses, db.barbTeachers, db.meta], async () => {
    await db.barbCourses.clear();
    await db.barbTeachers.clear();
    await db.barbCourses.bulkPut(BARB_DATASET.courses.map((course) => ({ ...course, _key: course.id })));
    await db.barbTeachers.bulkPut(BARB_DATASET.teachers.map((teacher) => ({ ...teacher, _key: teacher.id })));
    await setMeta(MIRROR_KEY, BARB_DATASET_VERSION);
  });
};

const lastRunLog = (): UniversitySyncLog[] => {
  const run = BARB_DATASET.lastRun;
  if (!run) return [];
  return [
    {
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      scope: (run.scope.split(":")[0] as UniversitySyncLog["scope"]) ?? "all",
      urlsCrawled: Object.keys(BARB_DATASET.sourceStates ?? {}),
      recordsAdded: 0,
      recordsChanged: run.changes,
      recordsRemoved: 0,
      recordsRejected: 0,
      errors: [],
      notes: `${run.pages} pagine ufficiali · ${run.errors} errori`
    }
  ];
};

export const useBarbStore = create<BarbState>((set) => ({
  ready: false,
  courses: [],
  teachers: [],
  semesters: [],
  syncLogs: [],

  init: async () => {
    if (initPromise) return initPromise;
    // I dati sono nel bundle: la vista è pronta subito, il mirror IndexedDB è best-effort.
    set({
      ready: true,
      courses: BARB_DATASET.courses,
      teachers: BARB_DATASET.teachers,
      semesters: BARB_DATASET.semesters,
      syncLogs: lastRunLog()
    });
    initPromise = syncMirror().catch(() => undefined).finally(() => {
      initPromise = null;
    });
    return initPromise;
  }
}));

export const BARB_META = {
  degreeName: BARB_DATASET.degreeName,
  degreeClass: BARB_DATASET.degreeClass,
  degreeCode: BARB_DATASET.degreeCode,
  academicYear: BARB_DATASET.academicYear,
  exportedAt: BARB_DATASET.exportedAt,
  syncedAt: BARB_DATASET.syncedAt ?? null,
  contacts: BARB_DATASET.contacts,
  sources: BARB_DATASET.sources,
  roles: BARB_DATASET.roles ?? [],
  timetable: BARB_DATASET.timetable ?? null,
  sourceStates: BARB_DATASET.sourceStates ?? {},
  lastRun: BARB_DATASET.lastRun ?? null
};
