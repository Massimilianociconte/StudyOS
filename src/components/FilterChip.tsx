import { FILTER_CHIP_TEXT } from "../lib/labels";
import { Icon } from "./Icon";

/**
 * Pillola di un filtro attivo ("In ritardo ✕", "Solo: Analisi ✕"): dice cosa si sta guardando e il
 * tocco la toglie. `color` = pallino della materia.
 */
export function FilterChip({ label, color, onClear }: { label: string; color?: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={FILTER_CHIP_TEXT.clear(label)}
      title={FILTER_CHIP_TEXT.clear(label)}
      className="motion-safe relative inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-[var(--accent-ink)] bg-[var(--surface-soft)] pl-3 pr-2 text-xs font-extrabold text-[var(--text)] after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--surface)]"
    >
      {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      <span className="min-w-0 truncate">{label}</span>
      <Icon name="X" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
    </button>
  );
}
