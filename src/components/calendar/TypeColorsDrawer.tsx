import { useState } from "react";
import { Drawer } from "../ui";
import { Icon } from "../Icon";
import { ColorPalette, currentTheme } from "./ColorPalette";
import { EVENT_TYPE_KEYS, eventColorStyle, eventTypeIcon, eventTypeLabel, typeDefaultColor, type EventTypeKey, type TypeColorOverrides } from "../../lib/eventColors";
import { withTypeColor } from "../../lib/eventEditor";
import { TYPE_COLORS_TEXT } from "../../lib/labels";

/**
 * "Colori delle tipologie": una riga per tipologia (icona, colore attuale nel tema attuale,
 * "Predefinito" o "Ripristina"); un tocco apre la tavolozza sotto la riga. Ogni scelta si salva subito.
 */
export function TypeColorsDrawer({
  overrides,
  onSave,
  onClose
}: {
  overrides: TypeColorOverrides;
  /** Preferenza nuova, già ripulita. */
  onSave: (next: TypeColorOverrides) => Promise<void>;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<EventTypeKey | null>(null);
  const [error, setError] = useState("");
  const theme = currentTheme();

  const save = async (type: EventTypeKey, color: string | null) => {
    setError("");
    try {
      await onSave(withTypeColor(overrides, type, color));
    } catch {
      setError(TYPE_COLORS_TEXT.saveFailed);
    }
  };

  return (
    <Drawer open onClose={onClose} title={TYPE_COLORS_TEXT.title}>
      <div className="grid grid-cols-1 gap-3">
        <p className="text-sm font-bold text-[var(--muted)]">{TYPE_COLORS_TEXT.intro}</p>
        <p className="text-xs font-bold text-[var(--faint)]">{TYPE_COLORS_TEXT.subjectNote}</p>
        {error ? (
          <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0">
          {EVENT_TYPE_KEYS.map((type) => {
            const label = eventTypeLabel(type);
            const color = typeDefaultColor(type, { overrides });
            const changed = Boolean(overrides[type]);
            const style = eventColorStyle(color, theme);
            const expanded = open === type;
            const panelId = `type-color-${type}`;
            return (
              <li key={type} className="min-w-0 rounded-[18px] border border-[var(--border)] p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-label={TYPE_COLORS_TEXT.chooseFor(label)}
                    onClick={() => setOpen(expanded ? null : type)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[14px] border-l-4 px-3 py-2 text-left text-sm font-extrabold"
                    style={{ background: style.background, borderColor: style.border, color: style.text }}
                  >
                    <Icon name={eventTypeIcon(type)} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <Icon name="ChevronDown" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                  {changed ? (
                    <button
                      type="button"
                      onClick={() => void save(type, null)}
                      aria-label={TYPE_COLORS_TEXT.resetAria(label)}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-sm font-extrabold text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      <Icon name="RotateCcw" className="h-4 w-4 shrink-0" />
                      {TYPE_COLORS_TEXT.reset}
                    </button>
                  ) : (
                    <span className="shrink-0 px-2 text-xs font-bold text-[var(--faint)]">{TYPE_COLORS_TEXT.isDefault}</span>
                  )}
                </div>
                {expanded ? (
                  <div id={panelId} className="mt-2 min-w-0 px-1">
                    <ColorPalette label={TYPE_COLORS_TEXT.chooseFor(label)} value={color} custom onPick={(hex) => void save(type, hex)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Drawer>
  );
}
