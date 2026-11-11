// Scelte pronte della "Ripetizione" calcolate dalla data d'inizio. Modulo piccolo e a parte:
// "Aggiungi" (nel bundle iniziale) usa solo questo, il resto di repeatPicker resta nel Calendario.
import type { RepeatRule, Weekday } from "../types";
import { REPEAT_PICKER_TEXT } from "./labels";
import { describeRule, weekdayOf, weekdayPosition } from "./repeat";

// Stanno nel motore (servono anche ai piani di modifica); qui per chi li usa con le scelte pronte.
export { weekdayOf, weekdayPosition } from "./repeat";

const WORKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];

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
