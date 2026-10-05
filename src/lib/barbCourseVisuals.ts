import type { BarbCourse } from "./university/types";

/** Deliberate discipline palette and schematic symbols for every catalog activity. */
export const BARB_COURSE_VISUALS = {
  "barb-26-27-anatomia-dell-uomo": { kind: "anatomy", color: "#A7C4E9" },
  "barb-26-27-farmacologia-speciale": { kind: "receptor", color: "#C7B6F0" },
  "barb-26-27-genetica-e-genomica-umana-con-elementi-di-bioinformatica": { kind: "genomics", color: "#8AD5CF" },
  "barb-26-27-patologia": { kind: "pathology", color: "#EBAFC0" },
  "barb-26-27-principi-di-fisiologia": { kind: "physiology", color: "#9FC9EB" },
  "barb-26-27-biostatistica": { kind: "statistics", color: "#A9BCF1" },
  "barb-26-27-accertamento-di-lingua-inglese-livello-b2-3-cfu": { kind: "language", color: "#D0C7EB" },
  "barb-26-27-altre-conoscenze-utili-per-l-inserimento-nel-mondo-del-lavoro": { kind: "career", color: "#B5CBBE" },
  "barb-26-27-antropologia": { kind: "anthropology", color: "#DCC5A5" },
  "barb-26-27-ecotossicologia": { kind: "ecotoxicology", color: "#AAD3AD" },
  "barb-26-27-generazione-di-modelli-di-malattie-umane-e-loro-applicazione": { kind: "disease-model", color: "#C7D4A2" },
  "barb-26-27-meccanismi-molecolari-di-trasduzione-del-segnale-in-biologia-cellulare-e-patolog": { kind: "signaling", color: "#A7D7C5" },
  "barb-26-27-approcci-per-l-identificazione-di-bersagli-farmacologici-nelle-malattie-genetich": { kind: "drug-target", color: "#B5A0DD" },
  "barb-26-27-biochimica-clinica-e-biologia-molecolare-clinica": { kind: "clinical", color: "#94CBD9" },
  "barb-26-27-cellule-staminali-e-medicina-rigenerativa": { kind: "stem-cell", color: "#A4D7BB" },
  "barb-26-27-farmaci-biologici-e-terapie-avanzate": { kind: "biotherapy", color: "#C3B7E8" },
  "barb-26-27-fisiologia-cellulare-e-molecolare": { kind: "cell-physiology", color: "#7FBACB" },
  "barb-26-27-fisiologia-e-farmacologia-del-sistema-endocrino": { kind: "endocrine", color: "#B6BDEF" },
  "barb-26-27-microbiologia-clinica-e-igiene": { kind: "microbiology", color: "#B5D79C" },
  "barb-26-27-neuroanatomia-umana-e-sperimentale": { kind: "brain", color: "#D0BAE9" },
  "barb-26-27-neurofisiologia": { kind: "neuron", color: "#B8C2EE" },
  "barb-26-27-oncologia-sperimentale": { kind: "oncology", color: "#DE91AB" },
  "barb-26-27-patologia-cellulare-e-molecolare": { kind: "cell-pathology", color: "#E9B2B6" },
  "barb-26-27-scienze-epidemiologiche-e-della-prevenzione": { kind: "epidemiology", color: "#9CCFD0" },
  "barb-26-27-basi-molecolari-e-funzionali-dei-disturbi-cardiovascolari-e-metabolici": { kind: "cardiovascular", color: "#EEB8AB" },
  "barb-26-27-biologia-e-basi-molecolari-delle-malattie-neuromuscolari": { kind: "neuromuscular", color: "#D4B9DF" },
  "barb-26-27-biologia-molecolare-applicata-alla-ricerca-biomedica": { kind: "dna", color: "#70BCB5" },
  "barb-26-27-diagnostica-avanzata-di-laboratorio-biosanitario": { kind: "diagnostics", color: "#7FB4CE" },
  "barb-26-27-methods-in-bioinformatics": { kind: "bioinformatics", color: "#9EBDEA" },
  "barb-26-27-microbiologia-cellulare-e-immunologia": { kind: "immunology", color: "#C5D8A4" },
  "barb-26-27-tecniche-avanzate-di-indagine-biomedica": { kind: "microscope", color: "#AACCDD" },
  "barb-26-27-tirocinio-formativo-e-di-orientamento": { kind: "internship", color: "#BCD0BD" },
  "barb-26-27-prova-finale": { kind: "thesis", color: "#C4C9DD" }
} as const;

export type CourseSymbol = (typeof BARB_COURSE_VISUALS)[keyof typeof BARB_COURSE_VISUALS]["kind"] | "patent";
export function courseVisual(course: Pick<BarbCourse, "id" | "name">): { kind: CourseSymbol | "unknown"; color: string } {
  if (course.name.trim().toLowerCase() === "patenting and technology transfer") return { kind: "patent", color: "#D5C39A" };
  return BARB_COURSE_VISUALS[course.id as keyof typeof BARB_COURSE_VISUALS] ?? { kind: "unknown", color: "#B7C7DB" };
}
export const courseColor = (course: Pick<BarbCourse, "id" | "name">) => courseVisual(course).color;
