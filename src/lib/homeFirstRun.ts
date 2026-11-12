// Home al primo avvio: mentre la guida «Per iniziare» è in vista, la Home mostra ogni azione una volta
// sola. Puro: la Home passa cosa è vuoto e cosa mostra la guida, qui si decide quali collegamenti restano.
import { DEGREE_PROGRAMS, isDegreeProgramId, type DegreeProgramId } from "./graduation";

export interface HomeLinksInput {
  /** La guida è in vista (non nascosta e non completata). */
  guideVisible: boolean;
  /** Il passo «Scrivi la prima cosa da fare» è ancora da fare: la guida mostra già «Aggiungi un'attività». */
  guideTaskPending: boolean;
  /** Riquadri che mostrano lo stato vuoto (la riga con il collegamento per aggiungere). */
  empty: { today: boolean; next: boolean; exams: boolean; subjects: boolean; goals: boolean; materials: boolean };
}

export interface HomeLinks {
  /** «Aggiungi un impegno» in «Oggi». */
  todayAdd: boolean;
  /** «Aggiungi un impegno» in «Prossimi giorni». */
  upcomingAdd: boolean;
  /** «Aggiungi un'attività» in «Cosa fare adesso». */
  nextAdd: boolean;
  allTasks: boolean;
  allExams: boolean;
  allSubjects: boolean;
  allGoals: boolean;
  allMaterials: boolean;
}

/**
 * Con la guida in vista: il secondo «Aggiungi un impegno» e il secondo «Aggiungi un'attività» spariscono,
 * e così i «Tutti/Tutte…» accanto a un riquadro vuoto (porterebbero a una sezione vuota, già nel menu).
 * Ogni sezione resta a un passo dal menu. Senza la guida la Home resta com'è.
 */
export const homeLinks = ({ guideVisible, guideTaskPending, empty }: HomeLinksInput): HomeLinks => {
  if (!guideVisible) {
    return { todayAdd: true, upcomingAdd: true, nextAdd: true, allTasks: true, allExams: true, allSubjects: true, allGoals: true, allMaterials: true };
  }
  return {
    todayAdd: true,
    // Doppione solo se «Oggi» mostra già lo stesso collegamento.
    upcomingAdd: !empty.today,
    nextAdd: !guideTaskPending,
    allTasks: !empty.next,
    allExams: !empty.exams,
    allSubjects: !empty.subjects,
    allGoals: !empty.goals,
    allMaterials: !empty.materials
  };
};

/** Corso di laurea salvato; senza (o sconosciuto) vale BARB, come nelle Impostazioni. */
export const currentDegree = (value: unknown): DegreeProgramId => (isDegreeProgramId(value) ? value : "barb");

/** Cambio di corso come nelle Impostazioni: CFU totali e sezione del catalogo seguono il corso. */
export const degreePatch = (id: DegreeProgramId) => ({
  degreeProgram: id,
  degreeCfu: DEGREE_PROGRAMS[id].totalCfu,
  showBarb: id === "barb"
});

/** «Scienze biologiche (L-13)»: il nome per esteso e la classe di laurea. */
export const degreeOptionLabel = (id: DegreeProgramId) => {
  const program = DEGREE_PROGRAMS[id];
  return `${program.name} (${program.level.split(" ").pop()})`;
};
