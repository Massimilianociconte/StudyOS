// Modifica di un giorno di una serie con la portata scelta ("Solo questo · Questo e i successivi ·
// Tutti"): le chiamate da fare allo store, la regola con i giorni scritti, e ciò che la modifica fa
// davvero alle date cambiate o annullate da sole (simulata con il motore, per dirlo prima). Puro.
import type { CalendarEvent, RepeatRule, Weekday } from "../types";
import {
  allDayDays,
  allDayTimes,
  applyEditPlan,
  countBefore,
  expandEvents,
  expandRule,
  isOccurrenceRow,
  laterParts,
  legacyProjection,
  movedRule,
  normalizeRepeat,
  planDelete,
  planEdit,
  repeatLegacyKey,
  sameClock,
  type OccurrenceScope
} from "./repeat";
import { allScopePatch, occurrenceTarget, shiftPatchDays, shownDayOf, startDayOf } from "./occurrenceLookup";
import { followingPatch } from "./eventEditor";
import { weekdayOf, weekdayPosition } from "./repeatPicker";
import { civilAddDays, civilDaysBetween, daysInMonth, isCivilDate, isValidTimeZone, localMidnight, parseCivil } from "./tz";

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

/** Fuso della serie (assente o non valido: quello del dispositivo, come sempre). */
const zoneOf = (event: Pick<CalendarEvent, "timeZone">) => (isValidTimeZone(event.timeZone) ? event.timeZone : undefined);

/**
 * Primo giorno che il motore darebbe alla serie con la modifica `patch` per "Tutti": la sposta dello
 * scarto tra il giorno aperto e il nuovo inizio della modifica (o, dal primo giorno o cambiando
 * "tutto il giorno", prende l'inizio così com'è). `timed`: la modifica con inizio e fine. Il giorno è
 * nel fuso della serie, come `seriesStart` (da un dispositivo in un altro fuso può essere un altro).
 */
const seriesFirstDay = (
  patch: Partial<CalendarEvent>,
  { series, date, seriesStart, toggled }: { series: CalendarEvent; date: string; seriesStart: string; toggled: boolean }
) => {
  const timed =
    patch.start !== undefined
      ? patch
      : { ...patch, ...shiftPatchDays({ start: series.start, end: series.end }, civilDaysBetween(seriesStart, date), { allDay: series.allDay === true, zone: zoneOf(series) }) };
  const current = startDayOf(timed.start as string, (timed.allDay ?? series.allDay) === true, zoneOf(series));
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

/**
 * Giorno da cui si è scelta la regola nel modulo: quello dell'inizio mostrato, nel fuso della serie
 * (dove la regola si ripete e dove sta il giorno aperto). Da Tokyo un lunedì sera a Roma è già
 * martedì: conta il lunedì, o un cambio d'ora sposterebbe la regola. Tutto il giorno: le date
 * dell'evento (la modifica a mezzanotte nel suo fuso; senza, il giorno come si vede).
 */
const pickedDay = (item: Occurrence, changes: Partial<CalendarEvent>, series: Pick<CalendarEvent, "allDay" | "timeZone">) => {
  const allDay = (changes.allDay ?? item.allDay ?? series.allDay) === true;
  if (changes.start === undefined && allDay && item.allDay === true) return shownDayOf(item, zoneOf(series));
  return startDayOf(changes.start ?? item.start, allDay, zoneOf(series));
};

// La regola che segue un giorno spostato sta nel motore (vedi `movedRule`): la usano anche i piani.
export { movedRule } from "./repeat";

/**
 * Giorni della settimana di una regola settimanale con più giorni spostati tutti insieme (per dirlo
 * nella scelta: "Tutte le date passano da lun–ven a mar–sab"). Altrimenti niente.
 */
export const weekdayShift = (before: RepeatRule | null | undefined, after: RepeatRule | null | undefined) => {
  const from = before?.freq === "weekly" ? before.byWeekday ?? [] : [];
  const to = after?.freq === "weekly" ? after.byWeekday ?? [] : [];
  if (from.length < 2 || from.length !== to.length || from.join() === to.join()) return undefined;
  return { from: [...from], to: [...to] };
};

/**
 * Regola che la serie prende da sola quando il giorno `date` va al giorno `picked`: "il martedì"
 * diventa "il mercoledì", "il secondo lunedì" il giorno nuovo, "lun–ven" diventa "mar–sab" (vedi
 * `movedRule`). Il modulo scrive già il giorno solo cambiando l'inizio; uno spostamento no.
 */
const followedRule = (series: CalendarEvent, date: string, picked: string) => movedRule(normalizeRepeat(series), date, picked);

/**
 * "Questo e i successivi" con la regola che segue lo spostamento: la parte nuova ha solo le volte
 * rimaste, così una serie di N volte finisce quando finiva prima (le volte prima di `date` restano
 * alla parte vecchia). Una regola scelta a mano non passa di qui.
 */
const remainingCount = (rule: RepeatRule, series: CalendarEvent, date: string): RepeatRule => {
  if (rule.end?.type !== "count") return rule;
  const before = countBefore(normalizeRepeat(series), startDayOf(series.start, series.allDay, zoneOf(series)), date);
  return { ...rule, end: { ...rule.end, count: Math.max(1, rule.end.count - before) } };
};

/**
 * La modifica cambia la regola per scelta? Non se la regola nuova è solo quella che segue il giorno
 * spostato: allora c'è ancora "Solo questo" (e la regola non va su quel giorno da solo).
 */
export const userRuleChange = ({ item, series, changes }: { item: Occurrence; series: CalendarEvent; changes: Partial<CalendarEvent> }) =>
  "repeat" in changes && ruleKey(changes.repeat) !== ruleKey(followedRule(series, occurrenceTarget(item).date, pickedDay(item, changes, series)));

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
}): { calls: OccurrenceCall[]; newStart?: string; weekdays?: { from: Weekday[]; to: Weekday[] } } => {
  const target = occurrenceTarget(item);
  const picked = pickedDay(item, changes, series);
  const chosen = userRuleChange({ item, series, changes });
  const own = chosen ? changes : withoutRepeat(changes);
  if (scope === "this") return { calls: [{ scope, patch: own }] };
  const followed = chosen ? null : followedRule(series, target.date, picked);
  const moved = followed && ruleKey(followed) !== ruleKey(normalizeRepeat(series)) ? { ...own, repeat: followed } : own;
  // Più giorni della settimana spostati insieme: si dice nella scelta.
  const shifted = followed ? weekdayShift(normalizeRepeat(series), followed) : undefined;
  const weekdays = shifted ? { weekdays: shifted } : {};
  const ruled = moved.repeat ? { ...moved, repeat: explicitRule(moved.repeat, picked) } : moved;
  if (scope === "following") {
    const counted = followed && ruled.repeat ? { ...ruled, repeat: remainingCount(ruled.repeat, series, target.date) } : ruled;
    return { calls: [{ scope, patch: followingPatch(shown, counted, target.row) }], ...weekdays };
  }
  let patch = allScopePatch(ruled, { occurrence: item, series, date: target.date });
  let newStart: string | undefined;
  if (ruled.repeat) {
    const seriesStart = startDayOf(series.start, series.allDay, zoneOf(series));
    const toggled = ruled.allDay !== undefined && ruled.allDay !== (series.allDay ?? false);
    const natural = isCivilDate(seriesStart) ? seriesFirstDay(patch, { series, date: target.date, seriesStart, toggled }) : null;
    if (natural) {
      const aligned = alignedSeriesStart(ruled.repeat, picked, seriesStart, natural.first);
      if (aligned !== natural.first) {
        const allDay = (natural.timed.allDay ?? series.allDay) === true;
        patch = shiftPatchDays(natural.timed, civilDaysBetween(natural.first, aligned), { allDay, zone: zoneOf(series) });
      }
      // Si dice solo se il primo giorno cambia davvero (non se torna quello di prima).
      if (aligned !== natural.first && aligned !== seriesStart) newStart = aligned;
    }
  }
  const calls: OccurrenceCall[] = [{ scope: "all", patch }];
  if (target.row) calls.push({ scope: "this", patch: changes });
  return { calls, ...(newStart ? { newStart } : {}), ...weekdays };
};

/**
 * Tutta la serie spostata con il nuovo inizio `start` (evento di un'altra persona trascinato, agente
 * senza giorno): la regola scritta con i giorni della settimana li sposta dello stesso scarto (vedi
 * `movedRule`), nella stessa modifica, con i campi vecchi coerenti (per le app vecchie e per
 * l'impronta della regola). Se il giorno della settimana non cambia, o la regola non lo scrive, solo
 * gli orari.
 */
export const seriesMovePatch = (event: CalendarEvent, start: string, end: string): Partial<CalendarEvent> => {
  const rule = normalizeRepeat(event);
  const zone = zoneOf(event);
  const from = startDayOf(event.start, event.allDay, zone);
  const to = startDayOf(start, event.allDay, zone);
  const next = rule && isCivilDate(from) && isCivilDate(to) ? movedRule(rule, from, to) : null;
  if (!next || ruleKey(next) === ruleKey(rule)) return { start, end };
  const projection = legacyProjection(next, to);
  return { start, end, repeat: next, recurrence: projection.recurrence, recurrenceUntil: projection.recurrenceUntil, repeatLegacy: repeatLegacyKey(projection) };
};

const DAY_MS = 86_400_000;

/**
 * Inizio e fine di `item` (occorrenza come si vede o evento salvato) trascinato di `deltaMs`. Tutto il
 * giorno: gli stessi giorni spostati di quanti giorni si è trascinato (arrotondati: un giorno del
 * cambio d'ora resta un giorno), a mezzanotte nel fuso dell'evento come li salvano i moduli, mai in
 * quello del dispositivo. Con orario: gli istanti spostati. null se non si legge.
 */
export const draggedTimes = (
  item: Pick<CalendarEvent, "start" | "end" | "allDay" | "timeZone"> & { occurrenceKey?: unknown },
  deltaMs: number
): { start: string; end: string } | null => {
  if (!Number.isFinite(deltaMs)) return null;
  if (item.allDay === true) {
    const days = allDayDays(item);
    if (!days) return null;
    const shift = Math.round(deltaMs / DAY_MS);
    return allDayTimes(civilAddDays(days.first, shift), civilAddDays(days.last, shift), zoneOf(item));
  }
  const start = Date.parse(item.start) + deltaMs;
  const end = Date.parse(item.end) + deltaMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
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
  /**
   * Parti successive della famiglia (un "Questo e i successivi" di prima, anche da una serie da cui
   * questa è nata) che la modifica sostituisce: solo con una regola nuova, che vale per tutto il resto.
   */
  absorbed: number;
  /** Date di quelle parti che spariscono (nell'anno dopo il giorno aperto), in ordine. */
  gone: string[];
  /** Ne spariscono anche dopo quell'anno. */
  goneMore: boolean;
  /** Parti successive (divise prima) che una modifica senza regola nuova lascia, con i campi cambiati. */
  laterParts: number;
  /** Di queste, quante tengono un orario loro mentre la modifica cambia l'ora (o i giorni di un tutto il giorno). */
  laterOwnTime: number;
  /** Spostando il giorno: quante si spostano con lui (avevano gli stessi giorni e lo stesso orario). */
  laterMoved: number;
  /** Spostando il giorno: quante restano dove sono (giorni o orario loro). */
  laterOwnDays: number;
  /**
   * Spostando il giorno: giorni (nell'anno dopo) in cui una parte spostata arriva sul giorno di un'altra
   * parte della serie, che resta: quel giorno ci sono tutti e due (nulla sparisce, R1-S1 ter).
   */
  both: string[];
}

/** Giorni dopo quello aperto in cui si cercano le date che spariscono. */
const GONE_WINDOW_DAYS = 366;

/** Serie a cui appartiene un'occorrenza espansa (una riga: la sua serie). */
const ownerOf = (item: CalendarEvent) => (isOccurrenceRow(item) ? (item.seriesId as string) : item.id);

/**
 * Date delle serie `absorbed` (dal giorno `date`, nell'anno dopo) che dopo la modifica non ci sono
 * più: né lo stesso giorno né quello spostato quanto il giorno aperto (`shift`) è una data delle serie
 * toccate. Una lezione spostata con la serie non conta, una che la regola nuova non ha sì. `more`: ne
 * spariscono anche nell'anno dopo (una parte senza fine), così non si dice un elenco come se fosse tutto.
 */
const goneDates = (
  before: readonly CalendarEvent[],
  after: readonly CalendarEvent[],
  absorbed: ReadonlySet<string>,
  touched: ReadonlySet<string>,
  date: string,
  shift: number
) => {
  const from = localMidnight(civilAddDays(date, -1));
  const limit = civilAddDays(date, GONE_WINDOW_DAYS);
  const was = expandEvents(before, from, localMidnight(civilAddDays(date, 2 * GONE_WINDOW_DAYS)))
    .filter((item) => absorbed.has(ownerOf(item)) && item.occurrenceDate >= date)
    .map((item) => item.occurrenceDate);
  const now = new Set(
    expandEvents(after, from, localMidnight(civilAddDays(date, 2 * GONE_WINDOW_DAYS + Math.abs(shift) + 1)))
      .filter((item) => touched.has(ownerOf(item)))
      .map((item) => item.occurrenceDate)
  );
  const gone = [...new Set(was)].filter((day) => !now.has(day) && !now.has(civilAddDays(day, shift))).sort();
  return { dates: gone.filter((day) => day < limit), more: gone.some((day) => day >= limit) };
};

/**
 * Giorni (da `from` a `to`, escluso) in cui dopo la modifica due parti diverse tra `owners` hanno una data e
 * prima no: uno spostamento ha portato una parte sul giorno di un'altra.
 */
const bothDays = (before: readonly CalendarEvent[], after: readonly CalendarEvent[], owners: ReadonlySet<string>, from: string, to: string) => {
  const doubled = (events: readonly CalendarEvent[]) => {
    const byDay = new Map<string, Set<string>>();
    for (const item of expandEvents(events, localMidnight(from), localMidnight(to))) {
      const owner = ownerOf(item);
      if (!owners.has(owner)) continue;
      const list = byDay.get(item.occurrenceDate) ?? new Set<string>();
      list.add(owner);
      byDay.set(item.occurrenceDate, list);
    }
    return new Set([...byDay].filter(([, list]) => list.size > 1).map(([day]) => day));
  };
  const was = doubled(before);
  return [...doubled(after)].filter((day) => !was.has(day)).sort();
};

/** Gli eventi dopo le chiamate, come le farebbe lo store (stesse funzioni, stesso ordine). */
export const simulateOccurrenceEdit = (events: readonly CalendarEvent[], seriesId: string, date: string, calls: readonly OccurrenceCall[], now = new Date().toISOString()) => {
  let current: CalendarEvent[] = [...events];
  const touched = new Set<string>([seriesId]);
  const absorbedIds = new Set<string>();
  for (const call of calls) {
    const series = current.find((event) => event.id === seriesId && !isOccurrenceRow(event));
    if (!series) break;
    const plan = planEdit(series, current, date, call.scope, call.patch, { now });
    const byId = new Map(current.map((event) => [event.id, event]));
    for (const id of plan.deletes) {
      const gone = byId.get(id);
      if (!gone || isOccurrenceRow(gone)) continue;
      touched.add(id);
      if (id !== seriesId) absorbedIds.add(id);
    }
    for (const put of plan.puts) if (!isOccurrenceRow(put)) touched.add(put.id);
    current = applyEditPlan(current, plan).events;
  }
  return { events: current, touched, absorbed: absorbedIds.size, absorbedIds };
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
  // Di quanti giorni si sposta il giorno aperto (nel fuso della serie): le altre date si spostano allo stesso modo.
  const series = events.find((event) => event.id === target.seriesId && !isOccurrenceRow(event)) ?? item;
  const picked = pickedDay(item, changes, series);
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
  const impact: ScopeImpact = {
    changedLost: 0,
    changedGone: 0,
    cancelledLost: 0,
    kept: 0,
    ownLost: false,
    absorbed: after.absorbed,
    gone: [],
    goneMore: false,
    laterParts: 0,
    laterOwnTime: 0,
    laterMoved: 0,
    laterOwnDays: 0,
    both: []
  };
  if (scope === "following" && after.absorbed) {
    const gone = goneDates(events, after.events, after.absorbedIds, after.touched, target.date, shift);
    impact.gone = gone.dates;
    impact.goneMore = gone.more;
  } else if (scope === "following") {
    // Senza regola nuova le parti successive restano (R1-S1): quante, quante tengono un orario loro
    // e, spostando il giorno, quante si spostano con lui.
    const later = laterParts(events, target.seriesId, target.date);
    impact.laterParts = later.length;
    const part = after.events.find((event) => event.id === `${target.seriesId}~${target.date}` && !isOccurrenceRow(event)) ?? after.events.find((event) => event.id === target.seriesId);
    if (later.length && part && !sameClock(part, series)) impact.laterOwnTime = later.filter((event) => !sameClock(event, series)).length;
    if (later.length && shift) {
      const dayOf = (event: CalendarEvent) => startDayOf(event.start, event.allDay, zoneOf(event));
      impact.laterMoved = later.filter((event) => {
        const next = after.events.find((item) => item.id === event.id && !isOccurrenceRow(item));
        return next !== undefined && dayOf(next) !== dayOf(event);
      }).length;
      impact.laterOwnDays = later.length - impact.laterMoved;
    }
    if (shift) {
      // Le parti della famiglia che la modifica tocca, quelle dopo e quelle da cui la serie è nata.
      const owners = new Set([...after.touched, ...later.map((event) => event.id)]);
      const byId = new Map(events.filter((event) => !isOccurrenceRow(event)).map((event) => [event.id, event]));
      for (let id = series.splitFrom; typeof id === "string" && byId.has(id) && !owners.has(id); id = byId.get(id)?.splitFrom) owners.add(id);
      const from = civilAddDays(shift < 0 ? civilAddDays(target.date, shift) : target.date, -1);
      impact.both = bothDays(events, after.events, owners, from, civilAddDays(target.date, GONE_WINDOW_DAYS + Math.abs(shift)));
    }
  }
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
  const start = startDayOf(series.start, series.allDay, zoneOf(series));
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
