// Scelte della riga "Ripetizione" del modulo evento: scelte pronte calcolate dalla data d'inizio,
// sezione "Personalizza" (modulo ↔ regola) e adattamento quando l'inizio cambia. Tutto puro.
import type { RepeatRule, Weekday } from "../types";
import { REPEAT_PICKER_TEXT, REPEAT_TEXT } from "./labels";
import { describeRule, MAX_COUNT, MAX_INTERVAL, validateRepeat, WEEKDAYS } from "./repeat";
import { civilAddMonths, civilWeekday, daysInMonth, isCivilDate, parseCivil } from "./tz";

const WEEKDAY_BY_NUMBER: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WORKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

/** Giorno della settimana (MO…SU) di una data YYYY-MM-DD. */
export const weekdayOf = (date: string): Weekday => WEEKDAY_BY_NUMBER[civilWeekday(date)] ?? "MO";

/** Quale giorno della settimana nel mese: `nth` 1–5 e se è l'ultimo di quel tipo. */
export const weekdayPosition = (date: string) => {
  const parts = parseCivil(date);
  if (!parts) return { nth: 1, last: false };
  return { nth: Math.ceil(parts.day / 7), last: parts.day + 7 > daysInMonth(parts.year, parts.month) };
};

export type RepeatPresetId = "none" | "daily" | "weekly" | "monthlyDay" | "monthlyNth" | "monthlyLast" | "yearly" | "workdays";

export interface RepeatPreset {
  id: RepeatPresetId;
  label: string;
  rule: RepeatRule | null;
}

/** Scelte pronte per un inizio (YYYY-MM-DD): il "quinto" giorno della settimana diventa "l'ultimo". */
export const repeatPresets = (start: string): RepeatPreset[] => {
  const weekday = weekdayOf(start);
  const position = weekdayPosition(start);
  const rules: { id: RepeatPresetId; rule: RepeatRule | null }[] = [
    { id: "none", rule: null },
    { id: "daily", rule: { freq: "daily" } },
    { id: "weekly", rule: { freq: "weekly" } },
    { id: "monthlyDay", rule: { freq: "monthly" } }
  ];
  if (position.nth <= 4) rules.push({ id: "monthlyNth", rule: { freq: "monthly", monthly: { by: "weekday", nth: position.nth as 1 | 2 | 3 | 4, weekday } } });
  if (position.last) rules.push({ id: "monthlyLast", rule: { freq: "monthly", monthly: { by: "weekday", nth: -1, weekday } } });
  rules.push({ id: "yearly", rule: { freq: "yearly" } }, { id: "workdays", rule: { freq: "weekly", byWeekday: [...WORKDAYS] } });
  return rules.map(({ id, rule }) => ({ id, rule, label: id === "workdays" ? REPEAT_PICKER_TEXT.workdays : describeRule(rule, start) }));
};

/** Forma canonica per confrontare regole scritte in modo diverso ma equivalenti. */
const canonical = (rule: RepeatRule, start: string) => {
  const result = validateRepeat(rule);
  if (!result.ok) return null;
  const clean: RepeatRule = { ...result.rule };
  if (clean.byWeekday?.length === 1 && clean.byWeekday[0] === weekdayOf(start)) delete clean.byWeekday;
  if (clean.monthly?.by === "day") delete clean.monthly;
  if (clean.end?.type === "never") delete clean.end;
  if (clean.yearlyLeap === "feb28") delete clean.yearlyLeap;
  return JSON.stringify(clean);
};

/** Scelta pronta che corrisponde alla regola, "custom" se nessuna. */
export const presetIdOf = (rule: RepeatRule | null | undefined, start: string): RepeatPresetId | "custom" => {
  if (!rule) return "none";
  const key = canonical(rule, start);
  if (!key) return "custom";
  const match = repeatPresets(start).find((preset) => preset.rule && canonical(preset.rule, start) === key);
  return match?.id ?? "custom";
};

/**
 * La data d'inizio cambia: le regole che dipendono dal giorno della settimana dell'inizio (scritte
 * con quel giorno) lo seguono. Le altre si restituiscono così come sono (stesso oggetto).
 */
export const adaptRuleToStart = (rule: RepeatRule | null | undefined, oldStart: string, newStart: string): RepeatRule | null => {
  if (!rule) return null;
  if (!isCivilDate(oldStart) || !isCivilDate(newStart) || oldStart === newStart) return rule;
  const oldDay = weekdayOf(oldStart);
  const newDay = weekdayOf(newStart);
  if (rule.freq === "weekly" && rule.byWeekday?.length === 1 && rule.byWeekday[0] === oldDay) {
    return oldDay === newDay ? rule : { ...rule, byWeekday: [newDay] };
  }
  if (rule.freq === "monthly" && rule.monthly?.by === "weekday" && rule.monthly.weekday === oldDay) {
    const before = weekdayPosition(oldStart);
    const after = weekdayPosition(newStart);
    const nth = rule.monthly.nth;
    if (nth === -1 && before.last) {
      const next = after.last ? -1 : (Math.min(after.nth, 4) as 1 | 2 | 3 | 4);
      return { ...rule, monthly: { by: "weekday", nth: next, weekday: newDay } };
    }
    if (nth === before.nth) {
      const next = after.nth > 4 ? -1 : (after.nth as 1 | 2 | 3 | 4);
      return { ...rule, monthly: { by: "weekday", nth: next, weekday: newDay } };
    }
  }
  return rule;
};

// ---------------------------------------------------------------------------------------
// Personalizza
// ---------------------------------------------------------------------------------------

export type RepeatUnit = "day" | "week" | "month" | "year";

export interface CustomRepeat {
  unit: RepeatUnit;
  interval: number;
  weekdays: Weekday[];
  /** Mensile: stesso giorno, ultimo giorno del mese, o un giorno della settimana (`nth` + `weekday`). */
  monthly: "day" | "lastDay" | "weekday";
  /** Mensile "stesso giorno": nei mesi senza quel giorno usa l'ultimo invece di saltarli. */
  clamp: boolean;
  nth: 1 | 2 | 3 | 4 | -1;
  weekday: Weekday;
  end: "never" | "until" | "count";
  until: string;
  count: number;
  /** Campi della regola che il modulo non mostra ma non deve perdere. */
  yearlyLeap?: RepeatRule["yearlyLeap"];
  wkst?: Weekday;
}

const UNIT_OF: Record<RepeatRule["freq"], RepeatUnit> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
const FREQ_OF: Record<RepeatUnit, RepeatRule["freq"]> = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };

const startNth = (start: string): 1 | 2 | 3 | 4 | -1 => {
  const position = weekdayPosition(start);
  return position.nth > 4 ? -1 : (position.nth as 1 | 2 | 3 | 4);
};

/** Modulo "Personalizza" a partire dalla regola (o dai valori predefiniti per l'inizio). */
export const customFromRule = (rule: RepeatRule | null | undefined, start: string): CustomRepeat => {
  const weekday = weekdayOf(start);
  const custom: CustomRepeat = {
    unit: rule ? UNIT_OF[rule.freq] : "week",
    interval: rule?.interval ?? 1,
    weekdays: rule?.byWeekday?.length ? [...rule.byWeekday] : [weekday],
    monthly: rule?.monthly?.by === "lastDay" ? "lastDay" : rule?.monthly?.by === "weekday" ? "weekday" : "day",
    clamp: rule?.monthly?.by === "clampDay",
    nth: rule?.monthly?.by === "weekday" ? rule.monthly.nth : startNth(start),
    weekday: rule?.monthly?.by === "weekday" ? rule.monthly.weekday : weekday,
    end: rule?.end?.type ?? "never",
    until: rule?.end?.type === "until" ? rule.end.date : civilAddMonths(start, 1),
    count: rule?.end?.type === "count" ? rule.end.count : 10
  };
  if (rule?.yearlyLeap) custom.yearlyLeap = rule.yearlyLeap;
  if (rule?.wkst) custom.wkst = rule.wkst;
  return custom;
};

/** Regola dal modulo "Personalizza": omette ciò che coincide con il predefinito. */
export const ruleFromCustom = (custom: CustomRepeat, start: string): RepeatRule => {
  const rule: RepeatRule = { freq: FREQ_OF[custom.unit] };
  if (custom.interval !== 1) rule.interval = custom.interval;
  if (custom.unit === "week") {
    const days = WEEKDAYS.filter((day) => custom.weekdays.includes(day));
    if (days.length && !(days.length === 1 && days[0] === weekdayOf(start))) rule.byWeekday = days;
    if (custom.wkst && custom.wkst !== "MO") rule.wkst = custom.wkst;
  }
  if (custom.unit === "month") {
    if (custom.monthly === "lastDay") rule.monthly = { by: "lastDay" };
    else if (custom.monthly === "weekday") rule.monthly = { by: "weekday", nth: custom.nth, weekday: custom.weekday };
    else if (custom.clamp) rule.monthly = { by: "clampDay" };
  }
  if (custom.unit === "year" && custom.yearlyLeap && custom.yearlyLeap !== "feb28") rule.yearlyLeap = custom.yearlyLeap;
  if (custom.end === "until") rule.end = { type: "until", date: custom.until };
  else if (custom.end === "count") rule.end = { type: "count", count: custom.count };
  return rule;
};

const isIntIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** Primo errore del modulo "Personalizza", "" se va bene. */
export const customError = (custom: CustomRepeat, start: string) => {
  if (!isIntIn(custom.interval, 1, MAX_INTERVAL)) return REPEAT_PICKER_TEXT.intervalInvalid;
  if (custom.unit === "week" && !custom.weekdays.length) return REPEAT_PICKER_TEXT.weekdaysMissing;
  if (custom.end === "until" && (!isCivilDate(custom.until) || (isCivilDate(start) && custom.until < start))) return REPEAT_PICKER_TEXT.untilInvalid;
  if (custom.end === "count" && !isIntIn(custom.count, 1, MAX_COUNT)) return REPEAT_PICKER_TEXT.countInvalid;
  return "";
};

export interface MonthlyChoice {
  id: string;
  label: string;
  monthly: CustomRepeat["monthly"];
  nth?: CustomRepeat["nth"];
  weekday?: Weekday;
}

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const monthlyTail = (rule: RepeatRule, start: string) => capitalize(describeRule(rule, start).slice(REPEAT_TEXT.monthly.length + 1));

/**
 * Giorni del mese proponibili per un inizio: lo stesso giorno, il suo giorno della settimana
 * (secondo giovedì, ultimo giovedì) e l'ultimo giorno del mese se l'inizio lo è. La scelta
 * attuale resta sempre tra le opzioni, anche se non corrisponde più all'inizio.
 */
export const monthlyChoices = (start: string, current?: CustomRepeat): MonthlyChoice[] => {
  const parts = parseCivil(start);
  if (!parts) return [];
  const weekday = weekdayOf(start);
  const position = weekdayPosition(start);
  const choices: MonthlyChoice[] = [{ id: "day", label: REPEAT_PICKER_TEXT.monthlyDay(parts.day), monthly: "day" }];
  const addWeekday = (nth: CustomRepeat["nth"], day: Weekday) => {
    const id = `weekday:${nth}:${day}`;
    if (choices.some((choice) => choice.id === id)) return;
    choices.push({ id, label: monthlyTail({ freq: "monthly", monthly: { by: "weekday", nth, weekday: day } }, start), monthly: "weekday", nth, weekday: day });
  };
  if (position.nth <= 4) addWeekday(position.nth as 1 | 2 | 3 | 4, weekday);
  if (position.last) addWeekday(-1, weekday);
  if (current?.monthly === "weekday") addWeekday(current.nth, current.weekday);
  if (parts.day === daysInMonth(parts.year, parts.month) || current?.monthly === "lastDay") {
    choices.push({ id: "lastDay", label: REPEAT_PICKER_TEXT.monthlyLastDay, monthly: "lastDay" });
  }
  return choices;
};

/** Id della scelta mensile del modulo (per il gruppo di opzioni). */
export const monthlyChoiceId = (custom: CustomRepeat) =>
  custom.monthly === "weekday" ? `weekday:${custom.nth}:${custom.weekday}` : custom.monthly;
