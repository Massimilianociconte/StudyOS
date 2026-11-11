// Modifica di un giorno di una serie con la portata scelta ("Solo questo · Questo e i successivi ·
// Tutti"): le chiamate da fare allo store, la regola con i giorni scritti, e ciò che la modifica fa
// davvero alle date cambiate o annullate da sole (simulata con il motore, per dirlo prima). Puro.
import type { CalendarEvent, RepeatRule } from "../types";
import {
  applyEditPlan,
  expandEvents,
  expandRule,
  isOccurrenceRow,
  legacyProjection,
  normalizeRepeat,
  planDelete,
  planEdit,
  repeatLegacyKey,
  type OccurrenceScope
} from "./repeat";
import { allScopePatch, occurrenceTarget, shiftPatchDays, startDayOf } from "./occurrenceLookup";
import { followingPatch } from "./eventEditor";
import { adaptRuleToStart, weekdayOf, weekdayPosition } from "./repeatPicker";
import { civilAddDays, civilDateOf, civilDaysBetween, daysInMonth, isCivilDate, isValidTimeZone, localMidnight, parseCivil } from "./tz";

type Occurrence = CalendarEvent & { occurrenceDate: string };

export interface OccurrenceCall {
  scope: OccurrenceScope;
  patch: Partial<CalendarEvent>;
}

// ---------------------------------------------------------------------------------------
// Regola con i giorni scritti
// ---------------------------------------------------------------------------------------

/**
 * Regola con i giorni scritti, scelta dal giorno `date`: "ogni settimana" prende il giorno della
 * settimana di quel giorno. Il mensile per giorno e l'annuale non hanno un campo per il giorno: vale
 * l'inizio della serie, che per "Tutti" si sposta su un giorno giusto (vedi `alignedSeriesStart`).
 */
export const explicitRule = (rule: RepeatRule, date: string): RepeatRule =>
  rule.freq === "weekly" && !rule.byWeekday?.length && isCivilDate(date) ? { ...rule, byWeekday: [weekdayOf(date)] } : rule;

/** Il giorno `day` è uno di quelli della regola scelta dal giorno `picked` (senza guardare il passo)? */
const matchesPattern = (rule: RepeatRule, day: string, picked: string) => {
  const parts = parseCivil(day);
  const anchor = parseCivil(picked);
  if (!parts || !anchor) return false;
  if (rule.freq === "daily") return true;
  if (rule.freq === "weekly") return (rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(picked)]).includes(weekdayOf(day));
  if (rule.freq === "yearly") return parts.month === anchor.month && parts.day === anchor.day;
  const monthly = rule.monthly ?? { by: "day" as const };
  const last = daysInMonth(parts.year, parts.month);
  if (monthly.by === "weekday") {
    const position = weekdayPosition(day);
    return weekdayOf(day) === monthly.weekday && (monthly.nth === -1 ? position.last : position.nth === monthly.nth);
  }
  if (monthly.by === "lastDay") return parts.day === last;
  if (monthly.by === "clampDay") return parts.day === anchor.day || (parts.day === last && anchor.day > last);
  return parts.day === anchor.day;
};

/**
 * Primo giorno, dall'inizio della serie `seriesStart` in poi, da cui la regola scelta dal giorno
 * `picked` comincia davvero: un giorno della regola, con lo stesso passo che arriva a `picked`. Così
 * "Ogni settimana il mercoledì" scelto da un mercoledì resta il mercoledì, "Ogni mese il 18" resta il
 * 18, e non resta un primo giorno in più che la regola non ha. `earliest`: si cerca anche da lì, se è
 * prima (la serie spostata indietro: "Tutti" dal lunedì alla domenica tiene la domenica prima).
 */
export const alignedSeriesStart = (rule: RepeatRule, picked: string, seriesStart: string, earliest: string = seriesStart): string => {
  if (!isCivilDate(picked) || !isCivilDate(seriesStart)) return seriesStart;
  const from = isCivilDate(earliest) && earliest < seriesStart ? earliest : seriesStart;
  if (picked <= from) return picked < seriesStart ? picked : seriesStart;
  const open: RepeatRule = { ...rule };
  delete open.end;
  const window = [localMidnight(picked), localMidnight(civilAddDays(picked, 1))] as const;
  for (let day = from; day <= picked; day = civilAddDays(day, 1)) {
    if (!matchesPattern(rule, day, picked)) continue;
    if (expandRule(open, `${day}T12:00`, undefined, window[0], window[1]).some((item) => item.date === picked)) return day;
  }
  return picked;
};

/**
 * Primo giorno che il motore darebbe alla serie con la modifica `patch` per "Tutti": la sposta dello
 * scarto tra il giorno aperto e il nuovo inizio della modifica (o, dal primo giorno o cambiando
 * "tutto il giorno", prende l'inizio così com'è). `timed`: la modifica con inizio e fine.
 */
const seriesFirstDay = (
  patch: Partial<CalendarEvent>,
  { series, date, seriesStart, toggled }: { series: CalendarEvent; date: string; seriesStart: string; toggled: boolean }
) => {
  const timed = patch.start !== undefined ? patch : { ...patch, ...shiftPatchDays({ start: series.start, end: series.end }, civilDaysBetween(seriesStart, date)) };
  const current = civilDateOf(new Date(timed.start as string));
  if (!isCivilDate(current)) return null;
  return { timed, first: toggled || date === seriesStart ? current : civilAddDays(seriesStart, civilDaysBetween(date, current)) };
};

/** Confronto di regole che non guarda l'ordine dei campi (né quelli vuoti). */
const ruleKey = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(ruleKey).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${key}:${ruleKey(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const withoutRepeat = (changes: Partial<CalendarEvent>): Partial<CalendarEvent> => {
  if (!("repeat" in changes)) return changes;
  const rest = { ...changes };
  delete rest.repeat;
  return rest;
};

/** Giorno da cui si è scelta la regola nel modulo: quello dell'inizio mostrato (ora locale). */
const pickedDay = (item: Pick<CalendarEvent, "start">, changes: Partial<CalendarEvent>) => {
  const start = new Date(changes.start ?? item.start);
  return Number.isNaN(start.getTime()) ? "" : civilDateOf(start);
};

/**
 * Regola che la serie prende da sola quando il giorno `date` va al giorno `picked`: "il martedì"
 * diventa "il mercoledì", "il secondo lunedì" il giorno nuovo (vedi `adaptRuleToStart`). Il modulo la
 * scrive già cambiando l'inizio; uno spostamento no.
 */
const followedRule = (series: CalendarEvent, date: string, picked: string) => {
  const rule = normalizeRepeat(series);
  return isCivilDate(date) && isCivilDate(picked) ? adaptRuleToStart(rule, date, picked) : rule;
};

/**
 * La modifica cambia la regola per scelta? Non se la regola nuova è solo quella che segue il giorno
 * spostato: allora c'è ancora "Solo questo" (e la regola non va su quel giorno da solo).
 */
export const userRuleChange = ({ item, series, changes }: { item: Occurrence; series: CalendarEvent; changes: Partial<CalendarEvent> }) =>
  "repeat" in changes && ruleKey(changes.repeat) !== ruleKey(followedRule(series, occurrenceTarget(item).date, pickedDay(item, changes)));

/**
 * Chiamate a `editOccurrence(serie, giorno, portata, modifica)` per salvare la modifica `changes` del
 * giorno `item` con la portata `scope`. `shown`: tutto ciò che il giorno mostra (per "Questo e i
 * successivi" da un giorno cambiato da solo). "Tutti" da un giorno cambiato da solo: la serie, poi quel
 * giorno, se esiste ancora. Con una regola nuova i giorni si scrivono (`explicitRule`) e con "Tutti" la
 * serie parte dal primo giorno giusto (`newStart`, se non è quello dello spostamento). Spostando un
 * giorno a un altro giorno della settimana, la regola scritta lo segue con "Questo e i successivi" e
 * "Tutti"; "Solo questo" non porta mai una regola.
 */
export const occurrenceEditCalls = ({
  item,
  series,
  scope,
  changes,
  shown = {}
}: {
  item: Occurrence;
  series: CalendarEvent;
  scope: OccurrenceScope;
  changes: Partial<CalendarEvent>;
  shown?: Partial<CalendarEvent>;
}): { calls: OccurrenceCall[]; newStart?: string } => {
  const target = occurrenceTarget(item);
  const picked = pickedDay(item, changes);
  const chosen = userRuleChange({ item, series, changes });
  const own = chosen ? changes : withoutRepeat(changes);
  if (scope === "this") return { calls: [{ scope, patch: own }] };
  const followed = chosen ? null : followedRule(series, target.date, picked);
  const moved = followed && ruleKey(followed) !== ruleKey(normalizeRepeat(series)) ? { ...own, repeat: followed } : own;
  const ruled = moved.repeat ? { ...moved, repeat: explicitRule(moved.repeat, picked) } : moved;
  if (scope === "following") return { calls: [{ scope, patch: followingPatch(shown, ruled, target.row) }] };
  let patch = allScopePatch(ruled, { occurrence: item, series, date: target.date });
  let newStart: string | undefined;
  if (ruled.repeat) {
    const seriesStart = startDayOf(series.start, series.allDay, isValidTimeZone(series.timeZone) ? series.timeZone : undefined);
    const toggled = ruled.allDay !== undefined && ruled.allDay !== (series.allDay ?? false);
    const natural = isCivilDate(seriesStart) ? seriesFirstDay(patch, { series, date: target.date, seriesStart, toggled }) : null;
    if (natural) {
      const aligned = alignedSeriesStart(ruled.repeat, picked, seriesStart, natural.first);
      if (aligned !== natural.first) patch = shiftPatchDays(natural.timed, civilDaysBetween(natural.first, aligned));
      // Si dice solo se il primo giorno cambia davvero (non se torna quello di prima).
      if (aligned !== natural.first && aligned !== seriesStart) newStart = aligned;
    }
  }
  const calls: OccurrenceCall[] = [{ scope: "all", patch }];
  if (target.row) calls.push({ scope: "this", patch: changes });
  return { calls, ...(newStart ? { newStart } : {}) };
};

/**
 * Tutta la serie spostata con il nuovo inizio `start` (evento di un'altra persona trascinato, agente
 * senza giorno): la regola scritta con il giorno della settimana segue il giorno nuovo, nella stessa
 * modifica, con i campi vecchi coerenti (per le app vecchie e per l'impronta della regola). Se il
 * giorno della settimana non cambia, o la regola non lo scrive, solo gli orari.
 */
export const seriesMovePatch = (event: CalendarEvent, start: string, end: string): Partial<CalendarEvent> => {
  const rule = normalizeRepeat(event);
  const zone = isValidTimeZone(event.timeZone) ? event.timeZone : undefined;
  const from = startDayOf(event.start, event.allDay, zone);
  const to = startDayOf(start, event.allDay, zone);
  const next = rule && isCivilDate(from) && isCivilDate(to) ? adaptRuleToStart(rule, from, to) : null;
  if (!next || ruleKey(next) === ruleKey(rule)) return { start, end };
  const projection = legacyProjection(next, to);
  return { start, end, repeat: next, recurrence: projection.recurrence, recurrenceUntil: projection.recurrenceUntil, repeatLegacy: repeatLegacyKey(projection) };
};

// ---------------------------------------------------------------------------------------
// Che cosa fa davvero (per dirlo prima di salvare)
// ---------------------------------------------------------------------------------------

/** Ciò che la modifica fa alle date cambiate o annullate da sole, simulata con il motore. */
export interface ScopeImpact {
  /** Giorni cambiati da soli che perdono la modifica (tornano come il resto della serie). */
  changedLost: number;
  /** Giorni cambiati da soli che escono dalla serie (la regola nuova non li ha): spariscono, con la modifica. */
  changedGone: number;
  /** Giorni annullati che tornano nel calendario (un annullato che esce dalla serie non torna: non conta). */
  cancelledLost: number;
  /** Giorni cambiati o annullati da soli che restano così. */
  kept: number;
  /** Il giorno aperto era cambiato da solo e perde la sua modifica. */
  ownLost: boolean;
  /** Divisioni successive (un "Questo e i successivi" di prima) che la modifica sostituisce. */
  absorbed: number;
}

/** Gli eventi dopo le chiamate, come le farebbe lo store (stesse funzioni, stesso ordine). */
export const simulateOccurrenceEdit = (events: readonly CalendarEvent[], seriesId: string, date: string, calls: readonly OccurrenceCall[], now = new Date().toISOString()) => {
  let current: CalendarEvent[] = [...events];
  const touched = new Set<string>([seriesId]);
  let absorbed = 0;
  for (const call of calls) {
    const series = current.find((event) => event.id === seriesId && !isOccurrenceRow(event));
    if (!series) break;
    const plan = planEdit(series, current, date, call.scope, call.patch, { now });
    const byId = new Map(current.map((event) => [event.id, event]));
    for (const id of plan.deletes) {
      const gone = byId.get(id);
      if (!gone || isOccurrenceRow(gone)) continue;
      touched.add(id);
      if (id !== seriesId) absorbed += 1;
    }
    for (const put of plan.puts) if (!isOccurrenceRow(put)) touched.add(put.id);
    current = applyEditPlan(current, plan).events;
  }
  return { events: current, touched, absorbed };
};

/**
 * Che cosa fa la modifica `calls` del giorno `item` ai giorni cambiati o annullati da soli. Una data
 * cambiata resta se la sua riga resta, o se una riga nuova (passata a una serie divisa) ha lo stesso
 * giorno e lo stesso stato. Con "Questo e i successivi" contano solo i giorni dopo quello aperto, che
 * porta con sé ciò che mostra. Una data che perde la riga "torna" solo se la serie nuova ha ancora quel
 * giorno, spostato quanto il giorno aperto (`changes`: la modifica del modulo); se no esce dalla serie.
 */
export const scopeImpact = (
  events: readonly CalendarEvent[],
  item: Occurrence,
  scope: OccurrenceScope,
  calls: readonly OccurrenceCall[],
  now?: string,
  changes: Partial<CalendarEvent> = {}
): ScopeImpact => {
  const target = occurrenceTarget(item);
  const after = simulateOccurrenceEdit(events, target.seriesId, target.date, calls, now);
  // Di quanti giorni si sposta il giorno aperto: le altre date si spostano allo stesso modo.
  const picked = pickedDay(item, changes);
  const shift = isCivilDate(picked) ? civilDaysBetween(target.date, picked) : 0;
  const masters = after.events.filter((event) => !isOccurrenceRow(event));
  const inSeries = (date: string) => {
    const day = civilAddDays(date, shift);
    return expandEvents(masters, localMidnight(civilAddDays(day, -2)), localMidnight(civilAddDays(day, 3))).some(
      (occurrence) => occurrence.occurrenceDate === day && after.touched.has(occurrence.id)
    );
  };
  const beforeIds = new Set(events.map((event) => event.id));
  const afterIds = new Set(after.events.map((event) => event.id));
  const fresh = after.events.filter((event) => isOccurrenceRow(event) && !beforeIds.has(event.id));
  const rows = events.filter(
    (event) => isOccurrenceRow(event) && isCivilDate(event.originalDate) && after.touched.has(event.seriesId as string) && (scope !== "following" || (event.originalDate as string) >= target.date)
  );
  const impact: ScopeImpact = { changedLost: 0, changedGone: 0, cancelledLost: 0, kept: 0, ownLost: false, absorbed: after.absorbed };
  for (const row of rows) {
    const own = target.row && row.id === item.id;
    if (own && scope === "following") continue;
    const lost = !afterIds.has(row.id) && !fresh.some((next) => next.originalDate === row.originalDate && Boolean(next.cancelled) === Boolean(row.cancelled));
    if (own) impact.ownLost = lost;
    else if (!lost) impact.kept += 1;
    else if (!inSeries(row.originalDate as string)) {
      if (!row.cancelled) impact.changedGone += 1;
    } else if (row.cancelled) impact.cancelledLost += 1;
    else impact.changedLost += 1;
  }
  return impact;
};

/** Le date che "Tutti" tocca: una parte di una serie divisa (dal suo primo giorno, fino al giorno prima della parte dopo). */
export interface SeriesSpan {
  /** Primo giorno della serie (o della parte). */
  start?: string;
  /** Primo giorno, se la serie è una parte nata da "Questo e i successivi". */
  from?: string;
  /** Ultimo giorno, se una parte successiva la ferma. */
  until?: string;
  /** Le date toccate comprendono giorni passati. */
  past: boolean;
  /** Serie che "Tutti" elimina: più di una se la serie è stata divisa. */
  parts: number;
}

export const seriesSpan = (events: readonly CalendarEvent[], seriesId: string, date: string, today: string): SeriesSpan => {
  const series = events.find((event) => event.id === seriesId && !isOccurrenceRow(event));
  if (!series) return { past: false, parts: 1 };
  const start = startDayOf(series.start, series.allDay, isValidTimeZone(series.timeZone) ? series.timeZone : undefined);
  const parent = typeof series.splitFrom === "string" && series.splitFrom ? series.splitFrom : undefined;
  // Parti dopo: le figlie della serie e le sorelle che partono dopo di lei.
  const cuts = events
    .filter((event) => !isOccurrenceRow(event) && !event.archived && event.id !== seriesId && (event.splitFrom === seriesId || (parent !== undefined && event.splitFrom === parent)))
    .map((event) => event.originalDate)
    .filter((day): day is string => isCivilDate(day) && day > start)
    .sort();
  const deleted = planDelete(events, seriesId, date, "all", { includeSplits: true }).deletes;
  const byId = new Map(events.map((event) => [event.id, event]));
  const parts = Math.max(1, deleted.filter((id) => byId.has(id) && !isOccurrenceRow(byId.get(id) as CalendarEvent)).length);
  return {
    ...(isCivilDate(start) ? { start } : {}),
    ...(parent && isCivilDate(start) ? { from: start } : {}),
    ...(cuts.length ? { until: civilAddDays(cuts[0], -1) } : {}),
    past: isCivilDate(start) && start < today,
    parts
  };
};
