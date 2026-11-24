// Campi di una materia: le stesse regole per il modulo «Nuova materia», il dettaglio della materia e gli
// strumenti degli agenti (crea e aggiorna). Logica pura (node --test).
import type { Subject } from "../types";

// Gli stessi di SEMESTER_IDS (lib/semesters), ripetuti qui: quel modulo carica il catalogo BARB, che il
// catalogo degli strumenti e il connettore remoto non devono portarsi dietro. Un test controlla che coincidano.
export const SUBJECT_SEMESTER_IDS = ["primo", "secondo", "annuale", "non-definito"] as const;

/**
 * Icone tra cui scegliere per una materia (nomi del registro di src/components/Icon.tsx). Le materie
 * del catalogo hanno la loro icona del corso (`barb:<id>`), che resta finché non se ne sceglie un'altra.
 */
export const SUBJECT_ICONS = [
  { id: "BookOpen", label: "Libro" },
  { id: "Brain", label: "Cervello" },
  { id: "Dna", label: "DNA" },
  { id: "Microscope", label: "Microscopio" },
  { id: "FlaskConical", label: "Laboratorio" },
  { id: "TestTube", label: "Provetta" },
  { id: "Atom", label: "Atomo" },
  { id: "Stethoscope", label: "Medicina" },
  { id: "HeartPulse", label: "Cuore" },
  { id: "Pill", label: "Farmaci" },
  { id: "Bone", label: "Osso" },
  { id: "Leaf", label: "Natura" },
  { id: "Sigma", label: "Matematica" },
  { id: "Calculator", label: "Calcolo" },
  { id: "LineChart", label: "Statistica" },
  { id: "Binary", label: "Informatica" },
  { id: "Code", label: "Codice" },
  { id: "Cpu", label: "Elettronica" },
  { id: "Globe", label: "Mondo" },
  { id: "Languages", label: "Lingue" },
  { id: "Landmark", label: "Storia" },
  { id: "Scale", label: "Diritto" },
  { id: "Coins", label: "Economia" },
  { id: "Palette", label: "Arte" },
  { id: "Music", label: "Musica" },
  { id: "PenTool", label: "Scrittura" },
  { id: "Users", label: "Società" },
  { id: "Lightbulb", label: "Idee" }
] as const;

export type SubjectIconId = (typeof SUBJECT_ICONS)[number]["id"];

export const SUBJECT_ICON_IDS: readonly string[] = SUBJECT_ICONS.map((icon) => icon.id);

/** Stati che si scelgono creando o modificando (archiviare ha il suo pulsante). */
export const SUBJECT_EDITABLE_STATUSES = ["not-started", "active", "review", "exam-ready", "completed"] as const satisfies readonly Subject["status"][];

/** Valori di un modulo o di una chiamata: tutti facoltativi, si controllano solo quelli presenti. */
export interface SubjectFieldsInput {
  name?: unknown;
  teacher?: unknown;
  cfu?: unknown;
  targetGrade?: unknown;
  color?: unknown;
  icon?: unknown;
  status?: unknown;
  semesterOverride?: unknown;
}

export const SUBJECT_FIELD_ERRORS = {
  name: "Scrivi il nome della materia.",
  nameLong: "Nome troppo lungo: al massimo 160 caratteri.",
  teacherLong: "Docente troppo lungo: al massimo 160 caratteri.",
  cfu: "CFU non validi: scrivi un numero da 0 a 60.",
  targetGrade: "Voto obiettivo non valido: da 18 a 30 (31 = 30 e lode).",
  color: "Colore non valido: usa un codice come #38BDF8.",
  icon: "Icona non disponibile: scegline una dell'elenco.",
  status: "Stato non valido.",
  semester: "Semestre non valido: primo, secondo, annuale o non-definito."
} as const;

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/**
 * Primo problema dei campi presenti, o `null`. `requireName`: creando il nome è obbligatorio; modificando
 * si controlla solo se c'è. Il testo è per la persona (e per l'agente, che lo riferisce).
 */
export const subjectFieldsProblem = (input: SubjectFieldsInput, options: { requireName?: boolean } = {}): string | null => {
  if (input.name !== undefined || options.requireName) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return SUBJECT_FIELD_ERRORS.name;
    if (name.length > 160) return SUBJECT_FIELD_ERRORS.nameLong;
  }
  if (typeof input.teacher === "string" && input.teacher.trim().length > 160) return SUBJECT_FIELD_ERRORS.teacherLong;
  if (input.cfu !== undefined) {
    const cfu = Number(input.cfu);
    if (input.cfu === "" || input.cfu === null || !Number.isFinite(cfu) || cfu < 0 || cfu > 60) return SUBJECT_FIELD_ERRORS.cfu;
  }
  if (input.targetGrade !== undefined && input.targetGrade !== null && input.targetGrade !== "") {
    const grade = Number(input.targetGrade);
    if (!Number.isInteger(grade) || grade < 18 || grade > 31) return SUBJECT_FIELD_ERRORS.targetGrade;
  }
  if (input.color !== undefined && input.color !== "" && !(typeof input.color === "string" && HEX.test(input.color.trim()))) return SUBJECT_FIELD_ERRORS.color;
  if (input.icon !== undefined && input.icon !== "" && !(typeof input.icon === "string" && (SUBJECT_ICON_IDS.includes(input.icon) || input.icon.startsWith("barb:")))) return SUBJECT_FIELD_ERRORS.icon;
  if (input.status !== undefined && !(SUBJECT_EDITABLE_STATUSES as readonly unknown[]).includes(input.status) && input.status !== "archived") return SUBJECT_FIELD_ERRORS.status;
  if (input.semesterOverride !== undefined && input.semesterOverride !== null && !(SUBJECT_SEMESTER_IDS as readonly unknown[]).includes(input.semesterOverride)) return SUBJECT_FIELD_ERRORS.semester;
  return null;
};

/** Colori proposti (il primo libero va alla materia nuova). */
export const SUBJECT_SWATCHES = ["#7CF7C8", "#9FB7FF", "#F7A8C4", "#FFD37C", "#C8A2FF", "#7FE3F5", "#FFAE7C", "#A6E3A1"] as const;

/** Stati che si scelgono nel modulo: «Completata» passa dal voto (Superata), «Archiviata» dal suo pulsante. */
export const SUBJECT_FORM_STATUSES = ["not-started", "active", "review", "exam-ready"] as const satisfies readonly Subject["status"][];

/**
 * Modulo di una materia (nuova o da modificare): testo dei campi come li scrive la persona.
 * `semester`: "ufficiale" = quello del piano (materia del catalogo) o del testo salvato; altrimenti un
 * semestre scelto (`semesterOverride`).
 */
export interface SubjectDraft {
  name: string;
  teacher: string;
  cfu: string;
  semester: string;
  targetGrade: string;
  color: string;
  icon: string;
  status: Subject["status"];
  notes: string;
}

export const newSubjectDraft = (color: string): SubjectDraft => ({
  name: "",
  teacher: "",
  cfu: "6",
  semester: "ufficiale",
  targetGrade: "",
  color,
  icon: "BookOpen",
  status: "active",
  notes: ""
});

export const subjectDraftOf = (subject: Subject): SubjectDraft => ({
  name: subject.name,
  teacher: subject.teacher,
  cfu: String(subject.cfu ?? 6),
  semester: subject.semesterOverride ?? "ufficiale",
  targetGrade: subject.targetGrade ? String(subject.targetGrade) : "",
  color: subject.color,
  icon: subject.icon || "BookOpen",
  status: subject.status,
  notes: subject.notes
});

/** Primo problema del modulo, o `null`: le stesse regole degli strumenti degli agenti, più i CFU obbligatori. */
export const subjectDraftProblem = (draft: SubjectDraft): string | null => {
  // Campo vuoto (o testo che il campo numerico non accetta): non vale 0, che cambierebbe le medie del libretto.
  if (!draft.name.trim()) return SUBJECT_FIELD_ERRORS.name;
  if (!draft.cfu.trim()) return SUBJECT_FIELD_ERRORS.cfu;
  return subjectFieldsProblem(
    {
      name: draft.name,
      teacher: draft.teacher,
      cfu: draft.cfu.replace(",", "."),
      targetGrade: draft.targetGrade.trim() || undefined,
      color: draft.color,
      icon: draft.icon,
      status: draft.status,
      semesterOverride: draft.semester === "ufficiale" ? undefined : draft.semester
    },
    { requireName: true }
  );
};

/**
 * Campi da salvare. `officialSemester`: semestre del piano per una materia del catalogo (con «ufficiale»
 * il testo del semestre torna quello del piano); `currentSemester`: il testo salvato finora.
 */
export const subjectFieldsFromDraft = (draft: SubjectDraft, options: { officialSemester?: string; currentSemester?: string } = {}): Partial<Subject> => {
  const official = draft.semester === "ufficiale";
  return {
    name: draft.name.trim(),
    teacher: draft.teacher.trim(),
    cfu: Number(draft.cfu.replace(",", ".")),
    semester: official ? (options.officialSemester ?? options.currentSemester ?? "Semestre") : draft.semester,
    semesterOverride: official ? undefined : (draft.semester as Subject["semesterOverride"]),
    targetGrade: draft.targetGrade.trim() ? Number(draft.targetGrade) : undefined,
    color: draft.color,
    icon: draft.icon || "BookOpen",
    status: draft.status,
    notes: draft.notes
  };
};
