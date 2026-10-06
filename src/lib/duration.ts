export type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";

/**
 * Unità con fattore di conversione in minuti. Giorni/settimane/mesi sono giornate
 * di studio (8 h/giorno, 5 giorni/settimana, 20 giorni/mese): la stima resta in
 * minuti nel modello dati, l'equivalenza è dichiarata nella UI.
 */
export const DURATION_UNITS: { id: DurationUnit; label: string; minutes: number }[] = [
  { id: "minutes", label: "Minuti", minutes: 1 },
  { id: "hours", label: "Ore", minutes: 60 },
  { id: "days", label: "Giorni", minutes: 480 },
  { id: "weeks", label: "Settimane", minutes: 2400 },
  { id: "months", label: "Mesi", minutes: 9600 }
];

export const durationToMinutes = (value: number, unit: DurationUnit) =>
  Math.max(0, Math.round(value * (DURATION_UNITS.find((item) => item.id === unit)?.minutes ?? 1)));

/** Sceglie l'unità più leggibile per un totale di minuti (30 min, 2 ore, 3 giorni…). */
export const minutesToDuration = (minutes: number): { value: string; unit: DurationUnit } => {
  const total = Math.max(0, Math.round(minutes));
  for (let index = DURATION_UNITS.length - 1; index >= 0; index -= 1) {
    const unit = DURATION_UNITS[index];
    if (total >= unit.minutes && total % unit.minutes === 0) return { value: String(total / unit.minutes), unit: unit.id };
  }
  return { value: String(total), unit: "minutes" };
};
