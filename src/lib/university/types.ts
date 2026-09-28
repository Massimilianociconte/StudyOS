// University Data Layer — tipi canonici.
// BARB è la prima implementazione concreta di un'infrastruttura riutilizzabile.
// Ogni record importante conserva la provenienza (sourceUrl, retrievedAt, ...).
// Mai inventare dati: i campi non verificati restano null e vengono mostrati come "non disponibile".

export type SemesterId = "primo" | "secondo" | "annuale" | "non-definito";

export type CourseCharacter = "obbligatorio" | "opzionale-scelta-guidata" | "scelta-libera" | "lingua" | "altre-conoscenze" | "tirocinio-tesi";

export interface DataProvenance {
  /** URL ufficiale esatto da cui proviene il dato */
  sourceUrl: string;
  /** Titolo della pagina/documento fonte, quando noto */
  sourceTitle?: string;
  /** Tipologia di fonte: pagina corso, piano didattico, manifesto PDF, portale orari, ecc. */
  sourceType:
    | "piano-didattico"
    | "manifesto-pdf"
    | "scheda-corso"
    | "scheda-insegnamento"
    | "pagina-docente"
    | "calendario-didattico"
    | "orario-lezioni"
    | "easyacademy"
    | "ariel"
    | "regolamento"
    | "dipartimento"
    | "contatti-ufficiali"
    | "pdf-orari-ufficiale"
    | "altro-ufficiale";
  /** Quando il dato è stato recuperato */
  retrievedAt: string;
  /** Ultima verifica contro la fonte */
  lastVerifiedAt: string;
  /** true se il dominio è nella whitelist UNIMI */
  officialSource: boolean;
  /** 0..1 — 1 solo per dati confermati da fonte primaria recente */
  confidence: number;
  /** Hash del contenuto grezzo da cui il dato deriva (per aggiornamenti differenziali) */
  contentHash?: string;
  /** Nota libera: es. incongruenza tra fonti, pagina obsoleta, dato in attesa PDF */
  provenanceNote?: string;
}

export interface BarbTeacher {
  id: string;
  /** Nome come pubblicato da UNIMI ("Cognome Nome"): non riordinato per non sbagliare i cognomi composti */
  displayName: string;
  /** Email @unimi.it quando pubblicata ufficialmente, altrimenti null (mai dedotta) */
  email: string | null;
  /** Pagina personale UNIMI, quando nota */
  unimiProfileUrl: string | null;
  /** SSD di afferenza quando pubblicato, altrimenti null */
  ssd: string | null;
  /** Insegnamenti collegati (id corso) */
  courseIds: string[];
  role?: string | null;
  department?: string | null;
  phone?: string | null;
  office?: string | null;
  officeHours?: string | null;
  officeHoursPlace?: string | null;
  website?: string | null;
  provenance: DataProvenance;
}

export interface ScheduleRule {
  id: string;
  /** 1=Lun ... 7=Dom (ISO) */
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  room: string | null;
  building: string | null;
  site: string | null;
  /** Validità della regola ricorrente */
  validFrom: string | null; // ISO date
  validTo: string | null;
  provenance: DataProvenance;
}

export interface ScheduleException {
  id: string;
  date: string; // ISO date
  startTime: string | null;
  endTime: string | null;
  room: string | null;
  building: string | null;
  site: string | null;
  kind: "cancellazione" | "spostamento" | "lezione-straordinaria" | "cambio-aula" | "altro";
  note: string | null;
  provenance: DataProvenance;
}

export interface BarbCourse {
  id: string;
  /** Nome ufficiale italiano come da piano didattico */
  name: string;
  englishName: string | null;
  /** Codice insegnamento quando pubblicato (molte schede UNIMI non lo espongono: resta null) */
  code: string | null;
  cfu: number;
  /** Ore totali da piano didattico */
  totalHours: number | null;
  /** Anno di corso 1|2, null se non pubblicato esplicitamente */
  year: 1 | 2 | null;
  semester: SemesterId;
  /** Gruppo di scelta guidata: "gruppo-1" | "gruppo-2" | "gruppo-3" | null per obbligatori */
  choiceGroup: string | null;
  character: CourseCharacter;
  ssd: string[]; // es. ["BIOS-06/A"]; [] se NN / non disponibile
  language: "Italiano" | "Inglese" | null;
  responsibleTeacherId: string | null;
  teacherIds: string[];
  /** Dettagli didattici: restano null finché non verificati da scheda ufficiale */
  syllabus: string | null;
  learningGoals: string | null;
  prerequisites: string | null;
  examMode: string | null;
  /** Campi estesi dalla scheda insegnamento ufficiale (sync docenti/dettagli) */
  /** false = scheda ufficiale "Edizione non erogata" nell'A.A.; null/assente = non verificato */
  offered?: boolean | null;
  offeringNote?: string | null;
  expectedOutcomes?: string | null;
  teachingMethods?: string | null;
  references?: string | null;
  examDetails?: string | null;
  grading?: string | null;
  scheduleUrl?: string | null;
  officialPageUrl: string | null;
  arielUrl: string | null;
  schedule: ScheduleRule[];
  exceptions: ScheduleException[];
  provenance: DataProvenance;
  /** Incongruenze rilevate tra fonti ufficiali (mai risolte silenziosamente) */
  conflicts: Array<{
    field: string;
    values: Array<{ value: string; sourceUrl: string; retrievedAt: string }>;
    note: string;
  }>;
}

export interface BarbSemesterInfo {
  id: SemesterId;
  label: string;
  /** Date ufficiali da calendari-e-orari, null se non pubblicate */
  startDate: string | null;
  endDate: string | null;
  /** Stato pubblicazione orari */
  scheduleStatus: "pubblicato" | "in-attesa-pdf" | "non-pubblicato";
  scheduleNote: string;
  provenance: DataProvenance;
}

export interface UniversitySyncLog {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  scope: "all" | "courses" | "teachers" | "schedule" | "contacts" | "check-updates";
  urlsCrawled: string[];
  recordsAdded: number;
  recordsChanged: number;
  recordsRemoved: number;
  recordsRejected: number;
  errors: Array<{ url: string; message: string; stage: string }>;
  notes: string | null;
}

export interface BarbDataset {
  version: 1;
  exportedAt: string;
  degreeName: string;
  degreeClass: string;
  degreeCode: string;
  academicYear: string;
  courses: BarbCourse[];
  teachers: BarbTeacher[];
  semesters: BarbSemesterInfo[];
  contacts: Array<{ label: string; value: string; url: string | null }>;
  sources: Array<{ label: string; url: string; kind: string }>;
  /** Presenti solo dopo una sincronizzazione applicata (overlay) */
  roles?: UniversityRole[];
  timetable?: UniversitySyncedData["timetable"];
  syncedAt?: string | null;
  sourceStates?: Record<string, SyncedSourceState>;
  lastRun?: UniversitySyncedData["lastRun"];
}

export interface UniversityRole {
  role: string;
  people: Array<{ name: string; url: string | null }>;
}

export interface UniversityContact {
  label: string;
  value: string;
  url: string | null;
}

/** Stato di una pagina ufficiale all'ultima sincronizzazione (per aggiornamenti differenziali). */
export interface SyncedSourceState {
  url: string;
  title: string | null;
  statusCode: number | null;
  contentHash: string | null;
  fetchedAt: string;
}

export interface SyncedCoursePatch {
  /** Campi verificati sulla fonte ufficiale che sovrascrivono il seed */
  fields: Partial<Omit<BarbCourse, "id" | "provenance" | "conflicts" | "schedule" | "exceptions">>;
  schedule?: ScheduleRule[];
  exceptions?: ScheduleException[];
  provenance: DataProvenance;
  conflicts?: BarbCourse["conflicts"];
}

/**
 * Overlay prodotto dalla pipeline (Firecrawl locale -> parser -> validazione -> revisione)
 * e applicato sopra il seed statico. Scritto SOLO da `npm run barb:apply` / `--apply`.
 */
export interface UniversitySyncedData {
  version: 1;
  provider: string;
  generatedAt: string;
  cohort: { label: string; manifestoUrl: string | null; curriculum: string | null } | null;
  semesters: Array<Pick<BarbSemesterInfo, "id" | "startDate" | "endDate" | "scheduleStatus" | "scheduleNote" | "provenance">>;
  courses: Record<string, SyncedCoursePatch>;
  /** Attività presenti nel piano ufficiale ma assenti nel seed */
  addedCourses: BarbCourse[];
  /** Id del seed non più presenti nel piano ufficiale (mai rimossi in automatico) */
  missingCourseIds: string[];
  teachers: BarbTeacher[];
  roles: UniversityRole[];
  contacts: UniversityContact[];
  timetable: {
    status: "pubblicato" | "non-pubblicato" | "non-verificato";
    checkedAt: string | null;
    source: string | null;
    lessons: number;
    note: string | null;
  };
  sources: Record<string, SyncedSourceState>;
  lastRun: {
    id: string;
    scope: string;
    startedAt: string;
    finishedAt: string;
    pages: number;
    errors: number;
    changes: number;
  } | null;
  /** Esito della pipeline usato per impedire apply di acquisizioni parziali. */
  acquisition?: { runId: string; scope: string; startedAt: string; finishedAt: string; status: "complete" | "incomplete"; pages: number; errors: number; validationErrors: number };
}
