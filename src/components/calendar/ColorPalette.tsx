import { useId } from "react";
import { Icon } from "../Icon";
import { eventColorStyle, relativeLuminance, themeTone } from "../../lib/eventColors";
import { EVENT_PALETTE } from "../../lib/eventEditor";
import { colorName, EVENT_EDITOR_TEXT } from "../../lib/labels";
import { safeCssColor } from "../../lib/sharing";

/** Tema attuale dell'app per le anteprime dei colori. */
export const currentTheme = () => themeTone(typeof document === "undefined" ? undefined : document.documentElement.dataset.theme);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Tavolozza: prima il colore automatico (della tipologia), poi i colori con nome e un selettore
 * libero. Bottoni da 44 px con `aria-pressed`; il nome del colore è detto, non solo mostrato.
 */
export function ColorPalette({
  label,
  value,
  custom,
  autoColor,
  autoLabel,
  onAuto,
  onPick,
  disabled = false
}: {
  label: string;
  /** Colore attuale. */
  value: string;
  /** true se scelto a mano. */
  custom: boolean;
  /** Colore automatico: senza, niente scelta "automatico" (es. "Colori delle tipologie"). */
  autoColor?: string;
  autoLabel?: string;
  onAuto?: () => void;
  onPick: (hex: string) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const current = safeCssColor(value) || "#7CF7C8";
  const swatch = (hex: string, pressed: boolean, name: string, onClick: () => void, extra?: string) => (
    <button
      key={`${name}-${hex}`}
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={`grid h-8 w-8 place-items-center rounded-full border-2 ${pressed ? "border-[var(--text)] ring-2 ring-[var(--surface)]" : "border-[var(--border)]"}`}
        style={{ background: hex }}
      >
        {extra ? <span className="rounded-full bg-black/55 px-1 text-[9px] font-black uppercase text-white">{extra}</span> : null}
        {pressed && !extra ? <Icon name="Check" className={`h-4 w-4 ${relativeLuminance(hex) > 0.4 ? "text-[#10131d]" : "text-white"}`} /> : null}
      </span>
    </button>
  );
  return (
    // fieldset e non label: un tocco sulla scritta non deve scegliere il primo colore.
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{label}</legend>
      <div className="flex flex-wrap items-center gap-0.5">
        {autoColor && onAuto ? swatch(autoColor, !custom, autoLabel ?? label, onAuto, "A") : null}
        {EVENT_PALETTE.map((hex) => swatch(hex, (custom || !autoColor) && same(hex, current), colorName(hex), () => onPick(hex)))}
        <label htmlFor={inputId} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full" title={EVENT_EDITOR_TEXT.colorCustom}>
          <span className="sr-only">{EVENT_EDITOR_TEXT.colorCustom}</span>
          <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-dashed border-[var(--border)] bg-[var(--surface-soft)]">
            <Icon name="Palette" className="h-4 w-4 text-[var(--muted)]" />
          </span>
          <input
            id={inputId}
            type="color"
            disabled={disabled}
            className="sr-only"
            value={/^#[0-9a-f]{6}$/i.test(current) ? current : "#7CF7C8"}
            onChange={(event) => onPick(event.target.value.toUpperCase())}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** Anteprima di un evento nel colore scelto, nel tema attuale (stesso stile del calendario). */
export function ColorPreview({ color, icon, title, meta }: { color: string; icon: string; title: string; meta?: string }) {
  const style = eventColorStyle(color, currentTheme());
  return (
    <div className="min-w-0" aria-hidden="true">
      <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{EVENT_EDITOR_TEXT.colorPreview}</span>
      <div
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-[14px] border-l-4 px-3 py-2 text-sm font-extrabold"
        style={{ background: style.background, borderColor: style.border, color: style.text }}
      >
        <Icon name={icon} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta ? <span className="shrink-0 text-xs font-bold opacity-80">{meta}</span> : null}
      </div>
    </div>
  );
}
