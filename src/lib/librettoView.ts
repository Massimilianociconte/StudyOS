// Libretto e laurea: ordine del libretto, colore dei voti e barra del voto di laurea.
// Logica pura (testata in tests/librettoView.test.mjs): la vista resta solo disegno.

import type { LibrettoEntry } from "./grades";

export const LIBRETTO_SORTS = ["recent", "grade", "cfu"] as const;
export type LibrettoSort = (typeof LIBRETTO_SORTS)[number];

/** Voto con cui confrontare: la lode sopra il 30, l'idoneità sotto ogni voto. */
const rank = (entry: Pick<LibrettoEntry, "grade" | "honors" | "passFail">) =>
  entry.passFail ? 0 : (entry.grade ?? 0) + (entry.honors ? 0.5 : 0);

const byDate = (a: Pick<LibrettoEntry, "date">, b: Pick<LibrettoEntry, "date">) => b.date.localeCompare(a.date);

/** Esami superati nell'ordine scelto; a parità, il più recente prima. Non cambia l'elenco ricevuto. */
export const sortLibretto = <T extends Pick<LibrettoEntry, "date" | "cfu" | "grade" | "honors" | "passFail">>(entries: readonly T[], sort: LibrettoSort): T[] => {
  const list = [...entries];
  if (sort === "grade") return list.sort((a, b) => rank(b) - rank(a) || byDate(a, b));
  if (sort === "cfu") return list.sort((a, b) => b.cfu - a.cfu || rank(b) - rank(a) || byDate(a, b));
  return list.sort(byDate);
};

/**
 * Quanto accento nel riquadro del voto (percentuale di color-mix): più alto il voto, più pieno.
 * Massimo 36%: il numero resta leggibile (testo normale) in tema chiaro e scuro.
 */
export const gradeTint = (entry: Pick<LibrettoEntry, "grade" | "honors" | "passFail">) => {
  if (entry.passFail || entry.grade === undefined) return 8;
  const clamped = Math.min(30, Math.max(18, entry.grade));
  return Math.round(10 + ((clamped - 18) / 12) * 22) + (entry.honors ? 4 : 0);
};

/** Il voto di laurea va da 66 a 110: la barra parte da lì. */
export const GAUGE_MIN = 66;
export const GAUGE_MAX = 110;

const percentOf = (value: number) => Math.min(100, Math.max(0, ((value - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100));

/** Tratto pieno fino alla stima e, se c'è una parte «fino a», tratto chiaro fino al massimo. */
export const gaugeSpan = (capped: number, cappedMax: number) => {
  const sure = percentOf(capped);
  return { sure, upTo: Math.max(sure, percentOf(cappedMax)) };
};

/** Punti che mancano al 110 con le ipotesi scelte (null = ci arrivi già). */
export const pointsToTop = (total: number) => (total >= GAUGE_MAX ? null : Math.round((GAUGE_MAX - total) * 100) / 100);
