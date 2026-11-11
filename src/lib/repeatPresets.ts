// Scelte pronte della "Ripetizione" calcolate dalla data d'inizio. Modulo piccolo e a parte:
// "Aggiungi" (nel bundle iniziale) usa solo questo, il resto di repeatPicker resta nel Calendario.
import type { RepeatRule, Weekday } from "../types";
import { REPEAT_PICKER_TEXT } from "./labels";
import { describeRule } from "./repeat";
import { civilWeekday, daysInMonth, parseCivil } from "./tz";

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
    // Il giorno della settimana si scrive: la regola resta quella scelta anche se l'inizio della serie è un altro giorno.
    { id: "weekly", rule: { freq: "weekly", byWeekday: [weekday] } },
    { id: "monthlyDay", rule: { freq: "monthly" } }
  ];
  if (position.nth <= 4) rules.push({ id: "monthlyNth", rule: { freq: "monthly", monthly: { by: "weekday", nth: position.nth as 1 | 2 | 3 | 4, weekday } } });
  if (position.last) rules.push({ id: "monthlyLast", rule: { freq: "monthly", monthly: { by: "weekday", nth: -1, weekday } } });
  rules.push({ id: "yearly", rule: { freq: "yearly" } }, { id: "workdays", rule: { freq: "weekly", byWeekday: [...WORKDAYS] } });
  return rules.map(({ id, rule }) => ({ id, rule, label: id === "workdays" ? REPEAT_PICKER_TEXT.workdays : describeRule(rule, start) }));
};
