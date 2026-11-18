// Colori dei numeri del ripasso, uguali in tutte le schede.

/** Punteggio (0–1): verde da 85%, giallo da 60%, rosso sotto. */
export const scoreTone = (value: number) => (value >= 0.85 ? "text-[var(--success-text)]" : value >= 0.6 ? "text-[var(--warning-text)]" : "text-[var(--danger-text)]");

/** Lo stesso colore come valore CSS (anelli del risultato). */
export const scoreColor = (value: number) => (value >= 0.85 ? "var(--success-text)" : value >= 0.6 ? "var(--warning-text)" : "var(--danger-text)");

/** Filtri a chip (materia, argomento): uguali in Dubbi e Quiz. */
export const FILTER_CHIP =
  "motion-safe inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-extrabold aria-pressed:border-transparent aria-pressed:bg-[var(--accent)] aria-pressed:text-[#10131d]";
export const FILTER_CHIP_IDLE = "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]";

// Stato di una scheda nelle liste: colore solo dove serve agire (in ritardo, oggi, difficile).
export const CARD_STATUS_TONE: Record<string, string> = {
  overdue: "text-[var(--warning-text)]",
  due: "text-[var(--accent-ink)]",
  difficult: "text-[var(--danger-text)]",
  doubtful: "text-[var(--warning-text)]",
  consolidated: "text-[var(--success-text)]",
  new: "text-[var(--muted)]",
  learning: "text-[var(--muted)]"
};
