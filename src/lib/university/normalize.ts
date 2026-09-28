// Normalizzazione — uniforma nomi, date, giorni, orari, edifici, aule, URL, CFU, semestri.
// Funzioni pure, senza I/O, riutilizzabili per qualsiasi corso UNIMI (non solo BARB).

import type { SemesterId } from "./types";

const WEEKDAYS_IT: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
  "lunedi": 1, "lunedì": 1, "lun": 1,
  "martedi": 2, "martedì": 2, "mar": 2,
  "mercoledi": 3, "mercoledì": 3, "mer": 3,
  "giovedi": 4, "giovedì": 4, "gio": 4,
  "venerdi": 5, "venerdì": 5, "ven": 5,
  "sabato": 6, "sab": 6,
  "domenica": 7, "dom": 7,
};

export function normalizeWeekday(raw: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  const key = raw.trim().toLowerCase();
  return WEEKDAYS_IT[key] ?? null;
}

export function weekdayLabel(weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7): string {
  return ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"][weekday - 1];
}

/** "9:30" / "09.30" / "9h30" -> "09:30", null se non valido (mai inventare) */
export function normalizeTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().replace(".", ":").replace("h", ":").match(/^(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "Anatomia dell'UOMO " -> "Anatomia dell'uomo" (title-case leggero, preserva acronimi) */
export function normalizeCourseName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function normalizePersonName(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  // "COGNOME Nome" -> "Nome Cognome"
  if (/^[A-ZÀ-Þ'’\- ]+$/.test(clean) && clean.includes(" ")) return clean; // già maiuscolo: lascia com'è ma trim
  return clean
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function normalizeRoom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean || null;
}

export function normalizeBuilding(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  // Uniforma le sedi note UNIMI Città Studi
  const lower = clean.toLowerCase();
  if (lower.includes("celoria") && lower.includes("26")) return "Via Celoria 26 — Edifici Biologici";
  if (lower.includes("celoria") && lower.includes("20")) return "Via Celoria 20 — Settore Didattico";
  if (lower.includes("golgi")) return "Via Golgi 19 — Edificio Golgi";
  if (lower.includes("mangiagalli")) return "Via Mangiagalli";
  return clean;
}

export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeSemester(raw: string | null | undefined): SemesterId {
  if (!raw) return "non-definito";
  const l = raw.toLowerCase();
  if (l.includes("primo")) return "primo";
  if (l.includes("secondo")) return "secondo";
  if (l.includes("annuale") || l.includes("annual")) return "annuale";
  return "non-definito";
}

export function normalizeCfu(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 60) return null;
  return Math.round(n);
}

/** "BIO/09" (vecchio ordinamento) -> "BIOS-06/A" solo quando la mappatura è nota; altrimenti preserva. */
export function normalizeSsd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (clean === "NN" || clean === "-" || clean === "ND") return null;
  return clean;
}

/** Slug stabile per id corso: "anatomia-dell-uomo" */
export function slugifyCourse(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
