// Colori e icone per tipologia di evento (puri, senza React): colore predefinito di ogni tipologia,
// colore scelto a mano o automatico (anche per gli eventi salvati prima), stile leggibile (contrasto
// AA) in tema chiaro e scuro, preferenze dell'utente ripulite.
import type { CalendarEvent } from "../types";
import { EVENT_CATEGORY_LABEL, EVENT_TYPE_EXTRA_LABEL } from "./labels";
import { safeCssColor } from "./sharing";

/** Ricorrenze annuali (compleanni, anniversari) e festività calcolate: non sono categorie salvate. */
export type OccasionKind = "birthday" | "anniversary" | "holiday";
export type EventTypeKey = CalendarEvent["category"] | "vacation" | OccasionKind;

/**
 * Colore predefinito di ogni tipologia (design §8): Esame rosso, Palestra bianco, Personale verde,
 * Vacanza giallo, Compleanno viola, festività grigio chiaro; le altre un colore proprio. "Altro" tiene
 * il verde acqua che l'app dava in automatico, così gli eventi di prima non cambiano aspetto.
 */
export const EVENT_TYPE_COLORS: Record<EventTypeKey, string> = {
  study: "#14B8A6",
  lesson: "#3B82F6",
  lab: "#06B6D4",
  exam: "#EF4444",
  review: "#D946EF",
  deadline: "#F97316",
  project: "#6366F1",
  gym: "#FFFFFF",
  personal: "#22C55E",
  work: "#B45309",
  relax: "#A3E635",
  other: "#7CF7C8",
  vacation: "#FACC15",
  birthday: "#A855F7",
  anniversary: "#EC4899",
  holiday: "#D4D4D4"
};

/** Icona per tipologia (nomi di Icon.tsx): oltre al colore, per chi non distingue i colori. */
export const EVENT_TYPE_ICON: Record<EventTypeKey, string> = {
  study: "Timer",
  lesson: "Presentation",
  lab: "FlaskConical",
  exam: "GraduationCap",
  review: "RotateCcw",
  deadline: "AlarmClock",
  project: "Layers",
  gym: "Dumbbell",
  personal: "User",
  work: "Briefcase",
  relax: "Coffee",
  other: "CalendarDays",
  vacation: "Luggage",
  birthday: "Cake",
  anniversary: "Heart",
  holiday: "PartyPopper"
};

export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPE_COLORS) as EventTypeKey[];

/** Il colore che l'app dava in automatico agli eventi senza materia prima dei colori per tipologia. */
export const LEGACY_AUTO_COLOR = "#7CF7C8";

/** Tipologie che con una materia prendono il colore della materia (come prima). */
export const SUBJECT_COLORED_TYPES: readonly EventTypeKey[] = ["lesson", "study", "lab", "review"];

const OCCASIONS: readonly string[] = ["birthday", "anniversary", "holiday"];

// Solo chiavi proprie: "toString" o "__proto__" non sono tipologie.
const isTypeKey = (value: unknown): value is EventTypeKey => typeof value === "string" && Object.prototype.hasOwnProperty.call(EVENT_TYPE_COLORS, value);

/** Tipologia di un evento: la ricorrenza (compleanno, festività…) vince sulla categoria; sconosciuta = "other". */
export function eventTypeKey({ category, occasionKind }: { category: string; occasionKind?: string }): EventTypeKey {
  if (occasionKind && OCCASIONS.includes(occasionKind)) return occasionKind as EventTypeKey;
  return isTypeKey(category) ? category : "other";
}

export function eventTypeLabel(type: EventTypeKey): string {
  const labels: Record<string, string> = { ...EVENT_TYPE_EXTRA_LABEL, ...EVENT_CATEGORY_LABEL };
  return labels[type] ?? EVENT_CATEGORY_LABEL.other;
}

export const eventTypeIcon = (type: EventTypeKey) => EVENT_TYPE_ICON[type] ?? EVENT_TYPE_ICON.other;

export type TypeColorOverrides = Partial<Record<EventTypeKey, string>>;

/**
 * Colore della tipologia: con una materia, Lezione, Studio, Laboratorio e Ripasso prendono il suo
 * colore; altrimenti la preferenza dell'utente per la tipologia, poi il predefinito.
 */
export function typeDefaultColor(type: EventTypeKey, { subjectColor, overrides }: { subjectColor?: string; overrides?: TypeColorOverrides } = {}) {
  const subject = safeCssColor(subjectColor);
  if (subject && SUBJECT_COLORED_TYPES.includes(type)) return subject;
  return safeCssColor(overrides?.[type]) || EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.other;
}

/**
 * Colore con cui mostrare un evento.
 * - `colorCustom === true`: colore scelto a mano, resta anche cambiando tipologia.
 * - `colorCustom === false`: colore della tipologia (preferenze dell'utente comprese).
 * - `colorCustom` assente (eventi salvati prima): se il colore è quello che l'app assegnava da sola
 *   (#7CF7C8 o il colore della materia) segue la tipologia, altrimenti era scelto a mano e resta.
 */
export function resolveEventColor({
  category,
  occasionKind,
  subjectColor,
  color,
  colorCustom,
  overrides
}: {
  category: string;
  occasionKind?: string;
  subjectColor?: string;
  color?: string;
  colorCustom?: boolean;
  overrides?: TypeColorOverrides;
}): string {
  const fallback = typeDefaultColor(eventTypeKey({ category, occasionKind }), { subjectColor, overrides });
  const own = safeCssColor(color);
  if (colorCustom === true) return own || fallback;
  if (colorCustom === false || !own) return fallback;
  const automatic = [LEGACY_AUTO_COLOR, safeCssColor(subjectColor)].filter(Boolean).map((value) => value.toLowerCase());
  return automatic.includes(own.toLowerCase()) ? fallback : own;
}

/* ------------------------------------------------------------------ */
/* Contrasto e stile                                                   */
/* ------------------------------------------------------------------ */

type Rgb = [number, number, number];

/** "#rgb", "#rgba", "#rrggbb" o "#rrggbbaa" → [r, g, b] (l'alfa si ignora); null se non è un colore. */
function rgbOf(hex: string): Rgb | null {
  const color = safeCssColor(hex).slice(1);
  if (!color) return null;
  const full = color.length <= 4 ? [...color.slice(0, 3)].map((digit) => digit + digit).join("") : color.slice(0, 6);
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16)) as Rgb;
}

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Mescola `a` e `b` (canali sRGB): `weight` = quota di `a`. */
export function mixHex(a: string, b: string, weight: number) {
  const x = rgbOf(a) ?? [0, 0, 0];
  const y = rgbOf(b) ?? [0, 0, 0];
  return toHex([0, 1, 2].map((index) => x[index] * weight + y[index] * (1 - weight)) as Rgb);
}

/** Luminanza relativa WCAG 2 (0 = nero, 1 = bianco). */
export function relativeLuminance(hex: string) {
  const rgb = rgbOf(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapporto di contrasto WCAG 2 (1 … 21). */
export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Avvicina `start` a `toward` a piccoli passi finché ha almeno `target` di contrasto con ogni colore di `against`. */
function ensureContrast(start: string, against: string[], target: number, toward: string) {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixHex(toward, start, step / 20);
    if (against.every((color) => contrastRatio(candidate, color) >= target)) return candidate;
  }
  return mixHex(toward, start, 1);
}

export type EventTheme = "light" | "dark";

/** Tema dell'app (`data-theme`): "light" è chiaro, tutto il resto ("dark", "focus", assente) scuro. */
export const themeTone = (dataTheme: string | undefined | null): EventTheme => (dataTheme === "light" ? "light" : "dark");

// Pagina (--bg-2) e testo (--text) dei due temi: lo stile si calcola su questi, con colori pieni.
const THEMES = {
  dark: { page: "#171A27", text: "#F8FBFF", toward: "#FFFFFF" },
  light: { page: "#FFFAF2", text: "#16181F", toward: "#16181F" }
} as const;

/**
 * Stile di un evento del colore `hex`: fondo tinto, bordo e testo, tutti esadecimali pieni. Il testo ha
 * sempre almeno 4,5:1 sul fondo (AA), il bordo almeno 3:1 su fondo e pagina. Tema scuro: fondo scuro
 * tinto, bordo del colore, testo chiaro. Tema chiaro: fondo chiaro tinto; i colori chiari (bianco,
 * giallo, grigio chiaro…) hanno un fondo tenue ma visibile, il bordo scurito e il testo scuro.
 * Colore non valido: quello di "Altro".
 */
export function eventColorStyle(hex: string, theme: EventTheme): { background: string; border: string; text: string } {
  const rgb = rgbOf(hex);
  const color = rgb ? toHex(rgb) : EVENT_TYPE_COLORS.other;
  const { page, text, toward } = THEMES[theme];
  let background: string;
  if (theme === "dark") {
    background = mixHex(color, page, 0.26);
  } else {
    // I colori chiari quasi spariscono sulla pagina chiara: più tinta, e un velo scuro se ancora non si vede.
    const tint = mixHex(color, page, relativeLuminance(color) > 0.5 ? 0.45 : 0.2);
    background = contrastRatio(tint, page) >= 1.08 ? tint : ensureContrast(tint, [page], 1.08, toward);
  }
  return {
    background,
    border: ensureContrast(color, [background, page], 3, toward),
    text: ensureContrast(text, [background], 4.5, toward)
  };
}

/* ------------------------------------------------------------------ */
/* Preferenze                                                          */
/* ------------------------------------------------------------------ */

/**
 * Preferenza "Colori delle tipologie" (sincronizzata, quindi da non fidarsi): solo tipologie note e
 * colori esadecimali (`safeCssColor`), il resto si scarta.
 */
export function sanitizeTypeColorOverrides(value: unknown): TypeColorOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean: TypeColorOverrides = {};
  for (const [key, color] of Object.entries(value)) {
    if (!isTypeKey(key)) continue;
    const safe = safeCssColor(color);
    if (safe) clean[key] = safe;
  }
  return clean;
}
