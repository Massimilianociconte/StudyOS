// Proiezione del voto di laurea per i corsi supportati (Università degli Studi di Milano).
// Regole prese SOLO dalle fonti ufficiali indicate in `sources`, verificate il 29/09/2026.
// Voto di base = media ponderata sui CFU × 110 / 30 (entrambi i corsi); poi i punti della
// prova finale e le eventuali maggiorazioni previste da ciascun corso. La lode di laurea e
// gli arrotondamenti non sono calcolati: li decide la commissione.

export type DegreeProgramId = "barb" | "scienze-biologiche";

export interface DegreeSource {
  label: string;
  url: string;
  date: string;
}

export interface DegreeProgram {
  id: DegreeProgramId;
  name: string;
  shortName: string;
  level: string;
  totalCfu: number;
  sources: DegreeSource[];
}

export const DEGREE_PROGRAMS: Record<DegreeProgramId, DegreeProgram> = {
  barb: {
    id: "barb",
    name: "Biologia applicata alla ricerca biomedica",
    shortName: "BARB",
    level: "Laurea magistrale LM-6",
    totalCfu: 120,
    sources: [
      {
        label: "Linee guida per l'attribuzione dei punteggi di laurea magistrale di Biologia",
        url: "https://barb.cdl.unimi.it/it/avviso/avviso-con-dettaglio/linee-guida-lattribuzione-dei-punteggi-di-laurea-magistrale-di-biologia",
        date: "23/04/2026"
      },
      {
        label: "Manifesto degli studi 2026/27 · Caratteristiche della prova finale",
        url: "https://apps.unimi.it/files/manifesti/ita_manifesto_FBGof2_2027.pdf",
        date: "A.A. 2026/27"
      }
    ]
  },
  "scienze-biologiche": {
    id: "scienze-biologiche",
    name: "Scienze biologiche",
    shortName: "Scienze biologiche",
    level: "Laurea triennale L-13",
    totalCfu: 180,
    sources: [
      {
        label: "Voto di laurea · Scienze biologiche",
        url: "https://scienzebiologiche.cdl.unimi.it/it/avviso/avviso-con-dettaglio/voto-di-laurea-0",
        date: "27/02/2025"
      },
      {
        label: "Manifesto degli studi 2026/27 · Caratteristiche della prova finale",
        url: "https://apps.unimi.it/files/manifesti/ita_manifesto_FAIof2_2027.pdf",
        date: "A.A. 2026/27"
      }
    ]
  }
};

export const DEGREE_PROGRAM_IDS = Object.keys(DEGREE_PROGRAMS) as DegreeProgramId[];

export const isDegreeProgramId = (value: unknown): value is DegreeProgramId =>
  typeof value === "string" && value in DEGREE_PROGRAMS;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Voto di base in centodecimi: media ponderata × 110 / 30. */
export const baseScore = (weightedAverage: number) => round2((weightedAverage * 110) / 30);

// --- Scienze biologiche (L-13) ---------------------------------------------------------

/** Voto della prova finale (in trentesimi) → punti da sommare alla base (tabella ufficiale). */
export const sbThesisPoints = (grade: number) => {
  if (!Number.isFinite(grade) || grade < 18) return 0;
  if (grade >= 30) return 8;
  return Math.floor((grade - 18) / 2) + 2; // 18-19 → 2, 20-21 → 3 … 28-29 → 7
};

/** Maggiorazione per le lodi negli esami: 2 → 0,2; 3 → 0,4; 4 → 1 (la tabella si ferma a 4). */
export const sbHonorsPoints = (honors: number) => (honors >= 4 ? 1 : honors === 3 ? 0.4 : honors === 2 ? 0.2 : 0);

// --- Biologia applicata alla ricerca biomedica (LM-6) -------------------------------------

/** Giudizio complessivo della commissione sulla tesi → punti (1–9). */
export const BARB_THESIS_LEVELS: { points: number; label: string }[] = [
  { points: 9, label: "eccellente" },
  { points: 8, label: "molto buono/ottimo" },
  { points: 7, label: "buono" },
  { points: 6, label: "discreto" },
  { points: 5, label: "discreto" },
  { points: 4, label: "più che sufficiente" },
  { points: 3, label: "più che sufficiente" },
  { points: 2, label: "appena sufficiente" },
  { points: 1, label: "appena sufficiente" }
];

export interface ProjectionInput {
  program: DegreeProgramId;
  weightedAverage: number | null;
  /** Numero di esami superati con lode (conta solo per Scienze biologiche). */
  honors: number;
  /** Scienze biologiche: voto della prova finale in trentesimi. BARB: punti della tesi 1–9. */
  thesis: number;
  /** Scienze biologiche: Erasmus svolto almeno al 70%. BARB: tesi o almeno 3 esami all'estero. */
  abroad: boolean;
}

export interface ProjectionPart {
  label: string;
  /** Punti certi secondo le regole. */
  points: number;
  /** Punti massimi quando la maggiorazione è a discrezione della commissione ("fino a"). */
  upTo?: number;
}

export interface GraduationProjection {
  base: number;
  parts: ProjectionPart[];
  /** Totale senza le maggiorazioni discrezionali. */
  total: number;
  /** Totale con le maggiorazioni discrezionali al massimo. */
  totalMax: number;
  /** Voto verbalizzabile stimato (massimo 110): la lode non è calcolabile. */
  capped: number;
  cappedMax: number;
  /** BARB: totale se il punto per l'estero fosse aggiuntivo ai 9 (lettura del manifesto). */
  manifestoTotal?: number;
  notes: string[];
}

export const projectGraduation = (input: ProjectionInput): GraduationProjection | null => {
  if (input.weightedAverage === null || !Number.isFinite(input.weightedAverage)) return null;
  const base = baseScore(input.weightedAverage);
  const parts: ProjectionPart[] = [];
  const notes: string[] = [];
  let manifestoTotal: number | undefined;

  if (input.program === "scienze-biologiche") {
    const grade = Math.min(30, Math.max(18, Math.round(input.thesis)));
    parts.push({ label: `Prova finale (${grade === 30 ? "30 o 30 e lode" : `${grade}/30`})`, points: sbThesisPoints(grade) });
    const honors = sbHonorsPoints(input.honors);
    if (honors) parts.push({ label: `${input.honors} lodi negli esami`, points: honors });
    if (input.abroad) {
      parts.push({ label: "Erasmus svolto almeno al 70%", points: 0, upTo: 1 });
      notes.push("Il punto per l'Erasmus è facoltativo (\"può essere attribuito fino a 1 punto\").");
    }
    if (input.honors > 4) notes.push("La tabella ufficiale delle lodi si ferma a 4 (1 punto): oltre non sono previsti punti in più.");
  } else {
    const thesis = Math.min(9, Math.max(1, Math.round(input.thesis)));
    const withAbroad = input.abroad ? Math.min(9, thesis + 1) : thesis;
    parts.push({ label: `Tesi e discussione (${thesis} ${thesis === 1 ? "punto" : "punti"})`, points: thesis });
    if (input.abroad) {
      parts.push({ label: "Tesi o 3 esami all'estero (entro i 9 punti)", points: withAbroad - thesis });
      manifestoTotal = round2(base + thesis + 1);
      notes.push(
        "Le linee guida del 23/04/2026 contano il punto per l'estero entro i 9 punti della tesi; il manifesto 2026/27 lo indica come punto per la carriera in aggiunta."
      );
    }
    notes.push("Le lodi negli esami non danno punti e non rendono automatica la lode di laurea.");
  }

  const fixed = parts.reduce((sum, part) => sum + part.points, 0);
  const optional = parts.reduce((sum, part) => sum + (part.upTo ?? 0), 0);
  const total = round2(base + fixed);
  const totalMax = round2(base + fixed + optional);
  return {
    base,
    parts,
    total,
    totalMax,
    capped: Math.min(110, total),
    cappedMax: Math.min(110, totalMax),
    manifestoTotal,
    notes
  };
};

/** Media ponderata minima perché base + punti previsti arrivino a `target` (es. 110). */
export const averageNeededFor = (target: number, extraPoints: number) => round2(((target - extraPoints) * 30) / 110);

/**
 * Media necessaria negli esami che mancano (CFU `remainingCfu`) per arrivare alla media
 * ponderata `targetAverage`, dati la somma voto×CFU e i CFU già registrati. null se non ci
 * sono CFU rimanenti.
 */
export const averageNeededOnRemaining = (weightedSum: number, earnedCfu: number, remainingCfu: number, targetAverage: number) => {
  if (remainingCfu <= 0) return null;
  return round2((targetAverage * (earnedCfu + remainingCfu) - weightedSum) / remainingCfu);
};
