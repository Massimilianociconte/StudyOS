import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, useDialogLayer } from "../ui";
import { Icon } from "../Icon";
import type { OccurrenceScope } from "../../lib/repeat";
import type { ScopeOption } from "../../lib/eventEditor";
import { SCOPE_TEXT } from "../../lib/labels";

const SCOPE_ICON: Record<OccurrenceScope, string> = { this: "CircleDot", following: "ChevronRight", all: "Layers" };

/**
 * "Solo questo · Questo e i successivi · Tutti" per un evento che si ripete (modifica, spostamento,
 * eliminazione): ogni scelta dice le sue conseguenze. Finestra sopra il modulo: Esc o Annulla = niente.
 */
export function ScopeChoice({
  heading,
  options,
  danger = false,
  onChoose,
  onCancel
}: {
  heading: string;
  options: ScopeOption[];
  /** Eliminazione: scelte in rosso. */
  danger?: boolean;
  onChoose: (scope: OccurrenceScope) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useDialogLayer(true, { panelRef, areaRef: backdropRef, onEscape: onCancel });

  return createPortal(
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] grid grid-cols-1 place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="soft-panel scrollbar-soft max-h-[90dvh] w-full max-w-lg overflow-y-auto p-4 outline-none sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="safe-text text-xl font-black leading-tight">
              {heading}
            </h2>
            {options.length > 1 ? <p className="mt-1 text-sm font-bold text-[var(--muted)]">{SCOPE_TEXT.intro}</p> : null}
          </div>
          <IconButton icon="X" label={SCOPE_TEXT.cancel} onClick={onCancel} className="h-10 w-10" />
        </div>
        <ul className="grid grid-cols-1 gap-2">
          {options.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                data-autofocus={index === 0 ? true : undefined}
                onClick={() => onChoose(option.id)}
                className={`flex w-full min-w-0 items-start gap-3 rounded-[18px] border p-3 text-left hover:bg-[var(--surface)] ${
                  danger ? "border-[var(--danger-border)]" : "border-[var(--border)]"
                } bg-[var(--surface-soft)]`}
              >
                <Icon name={SCOPE_ICON[option.id]} className={`mt-0.5 h-5 w-5 shrink-0 ${danger ? "text-[var(--danger-text)]" : "text-[var(--accent-ink)]"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-base font-black ${danger ? "text-[var(--danger-text)]" : ""}`}>{option.label}</span>
                  {option.details.map((line) => (
                    <span key={line} className="mt-0.5 block text-sm font-bold text-[var(--muted)]">
                      {line}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end">
          <Button variant="soft" onClick={onCancel}>
            {SCOPE_TEXT.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
