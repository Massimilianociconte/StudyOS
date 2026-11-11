// Logica pura della vista Corso di laurea (niente DOM né dati BARB, testata con node --test):
// schede e filtri salvati in `useUiState`, riquadri dei semestri e pillole "Nelle tue materie"
// che fanno da filtro.
import { oneOf } from "./uiState";

/** Schede della vista: i valori salvati in `barb.tab` restano tutti validi. */
export const BARB_TABS = ["corsi", "calendario", "docenti", "aule", "fonti", "condivisi"] as const;
export type BarbTab = (typeof BARB_TABS)[number];
export const isBarbTab = oneOf(...BARB_TABS);

export const BARB_SEMESTER_FILTERS = ["tutti", "primo", "secondo", "annuale", "non-definito"] as const;
export type BarbSemesterFilter = (typeof BARB_SEMESTER_FILTERS)[number];
export const isBarbSemesterFilter = oneOf(...BARB_SEMESTER_FILTERS);

/** Filtri degli insegnamenti condivisi da riquadri, pillole e barra dei filtri. */
export type BarbCourseFilter = { semester: BarbSemesterFilter; myPlanOnly: boolean };
export const NO_BARB_FILTER: BarbCourseFilter = { semester: "tutti", myPlanOnly: false };

/** Riquadro del semestre: filtra per quel semestre, un secondo tocco torna a tutti. "Solo le mie" resta com'è. */
export const toggleSemesterFilter = (filter: BarbCourseFilter, semester: BarbSemesterFilter): BarbCourseFilter => ({
  ...filter,
  semester: filter.semester === semester ? "tutti" : semester
});

/** Pillola "Nelle tue materie" attiva: solo le mie materie, di quel semestre ("tutti" = di ogni semestre). */
export const isMineFilterActive = (filter: BarbCourseFilter, semester: BarbSemesterFilter) => filter.myPlanOnly && filter.semester === semester;

/** Pillola "Nelle tue materie": solo le mie materie di quel semestre; un secondo tocco toglie entrambi i filtri. */
export const toggleMineFilter = (filter: BarbCourseFilter, semester: BarbSemesterFilter): BarbCourseFilter =>
  isMineFilterActive(filter, semester) ? NO_BARB_FILTER : { semester, myPlanOnly: true };
