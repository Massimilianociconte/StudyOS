import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, useBackCloses, useDialogLayer } from "../ui";
import { Icon } from "../Icon";
import type { OccurrenceScope } from "../../lib/repeat";
import type { ScopeOption } from "../../lib/eventEditor";
import { SCOPE_TEXT } from "../../lib/labels/calendar";

const SCOPE_ICON: Record<OccurrenceScope, string> = { this: "CircleDot", following: "ChevronRight", all: "Layers" };

/**
 * "Solo questo · Questo e i successivi · Tutti" per un evento che si ripete (modifica, spostamento,
 * eliminazione): ogni scelta ha una riga breve (quali date), gli avvisi sempre visibili (ciò che si
 * perde, sparisce, raddoppia, si sposta o torna) e «Dettagli» con il resto; avvisi e dettagli sono la
 * descrizione accessibile della scelta. Finestra sopra il modulo: Esc o Annulla = niente.
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
  // «Dettagli» aperti: le scelte mostrano una riga breve, le conseguenze per intero si aprono qui.
  const [open, setOpen] = useState<OccurrenceScope[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useDialogLayer(true, { panelRef, areaRef: backdropRef, onEscape: onCancel });
  // Indietro come Esc e Annulla: niente scelta, il modulo sotto resta aperto con le sue modifiche.
  useBackCloses(true, () => {
    onCancel();
    return true;
  });

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
          <IconButton icon="X" label={SCOPE_TEXT.cancel} onClick={onCancel} />
        </div>
        <ul className="grid grid-cols-1 gap-2">
          {options.map((option, index) => {
            const id = `${titleId}-${option.id}`;
            const expanded = open.includes(option.id);
            const more = option.details.filter((line) => !option.warnings.includes(line));
            return (
              <li key={option.id} className={`rounded-[18px] border bg-[var(--surface-soft)] ${danger ? "border-[var(--danger-border)]" : "border-[var(--border)]"}`}>
                {/* Nome: la scelta e la riga breve. Descrizione: gli avvisi (sempre visibili) e i dettagli, anche chiusi. */}
                <button
                  type="button"
                  data-autofocus={index === 0 ? true : undefined}
                  aria-labelledby={`${id}-label ${id}-summary`}
                  aria-describedby={`${id}-warnings ${id}-details`}
                  onClick={() => onChoose(option.id)}
                  className="flex min-h-11 w-full min-w-0 items-start gap-3 rounded-[18px] p-3 pb-1.5 text-left hover:bg-[var(--surface)]"
                >
                  <Icon name={SCOPE_ICON[option.id]} className={`mt-0.5 h-5 w-5 shrink-0 ${danger ? "text-[var(--danger-text)]" : "text-[var(--accent-ink)]"}`} />
                  <span className="min-w-0 flex-1">
                    <span id={`${id}-label`} className={`block text-base font-black ${danger ? "text-[var(--danger-text)]" : ""}`}>
                      {option.label}
                    </span>
                    <span id={`${id}-summary`} className="mt-0.5 block text-sm font-bold text-[var(--muted)]">
                      {option.summary}
                    </span>
                    {/* Ciò che si perde, sparisce, raddoppia, si sposta o torna: mai dietro «Dettagli». */}
                    <span id={`${id}-warnings`} className="block">
                      {option.warnings.map((line) => (
                        <span key={line} className="mt-1.5 flex items-start gap-1.5 text-sm font-bold text-[var(--warning-text)]">
                          <Icon name="AlertTriangle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0">{line}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
                {more.length ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`${id}-details`}
                    onClick={() => setOpen((list) => (list.includes(option.id) ? list.filter((scope) => scope !== option.id) : [...list, option.id]))}
                    className="ml-9 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-xs font-black text-[var(--accent-ink)] hover:bg-[var(--surface)]"
                  >
                    {SCOPE_TEXT.details}
                    <Icon name="ChevronDown" className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                ) : null}
                {/* Chiuso: display none (resta nella descrizione accessibile della scelta). */}
                <div id={`${id}-details`} className={`${expanded ? "grid" : "hidden"} grid-cols-1 gap-1 px-3 pb-3 pl-11`}>
                  {more.map((line) => (
                    <p key={line} className="text-sm font-bold text-[var(--muted)]">
                      {line}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
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
