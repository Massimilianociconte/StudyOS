// Divisione esatta di un intervallo di pagine (studyos_split_pages). Logica pura, senza store né rete.
//
// Gli agenti, quando pianificano lo studio («pp. 120–180 in 4 giorni»), sbagliavano i conti a mano:
// intervalli spostati di una pagina, ultima pagina contata due volte, totali che non tornavano.
// Qui le regole sono una sola:
// - gli intervalli sono inclusivi: da 10 a 20 sono 11 pagine (to - from + 1);
// - le parti sono contigue, senza buchi né sovrapposizioni, e la loro somma è il totale;
// - con un numero di parti il resto va alle prime (61 pagine in 4 = 16, 15, 15, 15);
// - con perPart ogni parte ha perPart pagine, l'ultima il resto;
// - i giorni sono date civili YYYY-MM-DD: nessun fuso, il cambio d'ora non sposta niente.

import { civilDayNumber, civilFromDayNumber, civilWeekday, isCivilDate } from "../lib/tz";

export const SPLIT_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type SplitWeekday = (typeof SPLIT_WEEKDAYS)[number];

/** Pagina più alta accettata (un libro, una dispensa, un volume di atlante). */
export const SPLIT_MAX_PAGE = 100_000;
/** Parti (o giorni) al massimo: un anno. */
export const SPLIT_MAX_PARTS = 366;

export interface PageSplitInput {
  from: number;
  to: number;
  parts?: number;
  perPart?: number;
  /** Primo giorno (YYYY-MM-DD). Con endDate: una parte per ogni giorno utile; senza: date alle parti in ordine. */
  startDate?: string;
  /** Ultimo giorno compreso (YYYY-MM-DD). */
  endDate?: string;
  /** Giorni della settimana da saltare (es. SA e SU). */
  skipWeekdays?: readonly string[];
  /** Solo questi giorni della settimana (es. MO, WE, FR). */
  days?: readonly string[];
  /** Etichette delle parti, in ordine (es. capitoli). */
  labels?: readonly string[];
}

export interface PagePart {
  /** 1 = prima parte. */
  index: number;
  from: number;
  to: number;
  /** to - from + 1. */
  pages: number;
  date?: string;
  weekday?: string;
  label?: string;
  /** «pp. 120–135 (16 pagine)», pronto per titolo o descrizione. */
  text: string;
}

export type PageSplitResult =
  | { ok: true; from: number; to: number; totalPages: number; partCount: number; parts: PagePart[]; summary: string }
  | { ok: false; error: string };

/** 0 = domenica, come civilWeekday. */
const WEEKDAY_BY_INDEX: readonly SplitWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_NAME: Record<SplitWeekday, string> = {
  MO: "lunedì",
  TU: "martedì",
  WE: "mercoledì",
  TH: "giovedì",
  FR: "venerdì",
  SA: "sabato",
  SU: "domenica"
};

/** Numero di pagine di un intervallo inclusivo. */
export const pageCount = (from: number, to: number) => to - from + 1;

/** «p. 7 (1 pagina)» oppure «pp. 120–134 (15 pagine)»: trattino lungo, conteggio inclusivo. */
export const pageRangeText = (from: number, to: number) =>
  from === to ? `p. ${from} (1 pagina)` : `pp. ${from}–${to} (${pageCount(from, to)} pagine)`;

const fail = (error: string): PageSplitResult => ({ ok: false, error });

const isPage = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= SPLIT_MAX_PAGE;

const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

const weekdaySet = (values: readonly string[] | undefined, field: string): Set<SplitWeekday> | string => {
  const set = new Set<SplitWeekday>();
  for (const value of values ?? []) {
    if (!(SPLIT_WEEKDAYS as readonly string[]).includes(value)) return `${field} accetta solo ${SPLIT_WEEKDAYS.join(", ")}.`;
    set.add(value as SplitWeekday);
  }
  return set;
};

/** Pagine di ogni parte: con `parts` il resto va alle prime, con `perPart` l'ultima prende il resto. */
const sizesFor = (total: number, mode: { parts: number } | { perPart: number }) => {
  if ("perPart" in mode) {
    const count = Math.ceil(total / mode.perPart);
    return Array.from({ length: count }, (_, index) => (index < count - 1 ? mode.perPart : total - mode.perPart * (count - 1)));
  }
  const base = Math.floor(total / mode.parts);
  const extra = total % mode.parts;
  return Array.from({ length: mode.parts }, (_, index) => base + (index < extra ? 1 : 0));
};

/**
 * Divide [from, to] (inclusivo) in parti contigue. Una sola modalità:
 * - `parts`: quante parti;
 * - `perPart`: quante pagine per parte;
 * - `startDate` + `endDate`: una parte per giorno utile (salvo `skipWeekdays`, solo `days`).
 * Con `startDate` senza `endDate`, `parts` o `perPart` ricevono i giorni utili in ordine.
 */
export const splitPages = (input: PageSplitInput): PageSplitResult => {
  const { from, to } = input;
  if (!isPage(from) || !isPage(to)) return fail(`from e to devono essere numeri interi di pagina da 1 a ${SPLIT_MAX_PAGE}.`);
  if (to < from) return fail(`to (${to}) deve essere uguale o successivo a from (${from}).`);
  const total = pageCount(from, to);

  const hasParts = input.parts !== undefined;
  const hasPerPart = input.perPart !== undefined;
  const hasStart = input.startDate !== undefined && input.startDate !== "";
  const hasEnd = input.endDate !== undefined && input.endDate !== "";
  if (hasEnd && !hasStart) return fail("endDate richiede startDate.");
  if (hasStart && !isCivilDate(input.startDate)) return fail("startDate deve essere una data YYYY-MM-DD.");
  if (hasEnd && !isCivilDate(input.endDate)) return fail("endDate deve essere una data YYYY-MM-DD.");
  if (hasStart && hasEnd && (hasParts || hasPerPart)) {
    return fail("Con startDate ed endDate le parti sono i giorni utili: non passare anche parts o perPart.");
  }
  if (!(hasStart && hasEnd)) {
    if (hasParts && hasPerPart) return fail("Indica parts oppure perPart, non tutti e due.");
    if (!hasParts && !hasPerPart) return fail("Indica parts, perPart oppure startDate ed endDate.");
  }
  if (hasParts && !isCount(input.parts, SPLIT_MAX_PARTS)) return fail(`parts deve essere un intero da 1 a ${SPLIT_MAX_PARTS}.`);
  if (hasPerPart && !isCount(input.perPart, SPLIT_MAX_PAGE)) return fail(`perPart deve essere un intero da 1 a ${SPLIT_MAX_PAGE}.`);

  const skip = weekdaySet(input.skipWeekdays, "skipWeekdays");
  if (typeof skip === "string") return fail(skip);
  const only = weekdaySet(input.days, "days");
  if (typeof only === "string") return fail(only);
  if (!hasStart && (skip.size || only.size)) return fail("skipWeekdays e days valgono solo con startDate.");
  const usable = (weekday: SplitWeekday) => (!only.size || only.has(weekday)) && !skip.has(weekday);
  if (hasStart && !SPLIT_WEEKDAYS.some(usable)) return fail("Con questi skipWeekdays e days non resta nessun giorno della settimana.");

  // Giorni utili da startDate: al massimo `limit`, e con endDate solo fino a quel giorno compreso.
  const usableDays = (limit: number, last?: string) => {
    const out: string[] = [];
    const first = civilDayNumber(input.startDate as string);
    const end = last ? civilDayNumber(last) : Number.POSITIVE_INFINITY;
    for (let day = first; day <= end && out.length < limit; day += 1) {
      const civil = civilFromDayNumber(day);
      if (usable(WEEKDAY_BY_INDEX[civilWeekday(civil)])) out.push(civil);
    }
    return out;
  };

  let sizes: number[];
  let dates: string[] = [];
  if (hasStart && hasEnd) {
    const span = civilDayNumber(input.endDate as string) - civilDayNumber(input.startDate as string);
    if (span < 0) return fail(`endDate (${input.endDate}) deve essere uguale o successiva a startDate (${input.startDate}).`);
    if (span + 1 > SPLIT_MAX_PARTS) return fail(`Da startDate a endDate al massimo ${SPLIT_MAX_PARTS} giorni.`);
    dates = usableDays(SPLIT_MAX_PARTS, input.endDate);
    if (!dates.length) return fail("Nessun giorno utile tra startDate ed endDate con i giorni scelti.");
    if (dates.length > total) {
      return fail(`Le pagine sono ${total} (${pageRangeText(from, to)}) e i giorni utili ${dates.length}: ogni giorno deve avere almeno una pagina. Accorcia il periodo o salta dei giorni.`);
    }
    sizes = sizesFor(total, { parts: dates.length });
  } else if (hasParts) {
    const parts = input.parts as number;
    if (parts > total) {
      return fail(`Le pagine sono ${total} (${pageRangeText(from, to)}), meno delle parti (${parts}): ogni parte deve avere almeno una pagina. Usa meno parti.`);
    }
    sizes = sizesFor(total, { parts });
  } else {
    sizes = sizesFor(total, { perPart: input.perPart as number });
    if (sizes.length > SPLIT_MAX_PARTS) return fail(`Verrebbero ${sizes.length} parti, oltre il massimo di ${SPLIT_MAX_PARTS}: aumenta perPart.`);
  }
  if (hasStart && !hasEnd) dates = usableDays(sizes.length);

  const labels = input.labels ?? [];
  if (labels.length > sizes.length) return fail(`labels ha ${labels.length} etichette ma le parti sono ${sizes.length}.`);

  const parts: PagePart[] = [];
  let next = from;
  for (const [index, pages] of sizes.entries()) {
    const start = next;
    const end = start + pages - 1;
    next = end + 1;
    const date = dates[index];
    const label = typeof labels[index] === "string" ? labels[index].trim() : "";
    parts.push({
      index: index + 1,
      from: start,
      to: end,
      pages,
      ...(date ? { date, weekday: WEEKDAY_NAME[WEEKDAY_BY_INDEX[civilWeekday(date)]] } : {}),
      ...(label ? { label } : {}),
      text: pageRangeText(start, end)
    });
  }
  const count = parts.length;
  const summary = `${pageRangeText(from, to)} in ${count === 1 ? "1 parte" : `${count} parti`}: ${sizes.join(" + ")} = ${total} pagine.`;
  return { ok: true, from, to, totalPages: total, partCount: count, parts, summary };
};
