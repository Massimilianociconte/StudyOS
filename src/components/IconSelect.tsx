// Tendina con icone, al posto di <select> dove l'icona aiuta a riconoscere la voce (tipologia
// dell'impegno, materia). Il campo mostra la voce scelta con il suo segno; l'elenco è un popover sotto
// il campo sul computer e un pannello dal basso sul telefono (< 640 px), come il selettore di date.
// Tastiera come un <select>: frecce, Pagina su/giù, Home/End, lettere per saltare alla voce, Invio o
// spazio per scegliere, Esc chiude senza cambiare, Tab chiude e prosegue. Il focus resta sull'elenco
// (aria-activedescendant) e torna al campo alla chiusura.
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { listboxIndexForKey, typeaheadIndex } from "../lib/uiPieces";
import { Icon } from "./Icon";
import { floatingHost, inputClass, useDialogLayer, useFieldLabelId, useFloatingLayer } from "./ui";

export interface IconSelectOption {
  value: string;
  label: string;
  /** Segno a sinistra della voce: icona su riquadro (IconMark) o segno della materia. */
  mark?: ReactNode;
  disabled?: boolean;
}

/** Icona su riquadro neutro, leggibile con il tema chiaro e scuro; stessa misura del segno della materia (sm). */
export function IconMark({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="grid h-6 w-6 shrink-0 grid-cols-1 place-items-center rounded-[8px] bg-[var(--surface-strong)] text-[var(--accent-ink)]">
      <Icon name={name} className="h-3.5 w-3.5" />
    </span>
  );
}

// Tempo entro cui le lettere scritte formano una sola ricerca («ana» e non «a», «n», «a»).
const TYPEAHEAD_MS = 700;

export function IconSelect({
  value,
  options,
  onChange,
  placeholder = "",
  label,
  id: buttonId,
  disabled
}: {
  value: string;
  options: readonly IconSelectOption[];
  onChange: (value: string) => void;
  /** Testo del campo quando nessuna voce corrisponde al valore (es. «Scegli la materia»). */
  placeholder?: string;
  /** Nome per i lettori di schermo e titolo del pannello quando la tendina non sta dentro un Field. */
  label?: string;
  /** Id del campo, per un <label htmlFor> (HelpField). */
  id?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const fieldLabelId = useFieldLabelId();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(-1);
  const [title, setTitle] = useState("");
  const [width, setWidth] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const reduceMotion = useReducedMotion();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const disabledFlags = options.map((option) => Boolean(option.disabled));
  const optionId = (index: number) => `${id}-option-${index}`;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const position = useFloatingLayer(open, close, buttonRef, panelRef, "start", sheet);
  // Telefono: pannello modale (pagina bloccata, Tab dentro, focus all'elenco e poi di nuovo al campo).
  useDialogLayer(open && sheet, { panelRef, areaRef: backdropRef, returnFocusRef: buttonRef });

  const openList = () => {
    if (disabled) return;
    setSheet(!window.matchMedia("(min-width: 640px)").matches);
    setHost(floatingHost(buttonRef.current));
    setWidth(buttonRef.current?.offsetWidth ?? 0);
    setTitle((fieldLabelId ? document.getElementById(fieldLabelId)?.textContent : null) ?? label ?? "");
    setActive(selectedIndex >= 0 && !disabledFlags[selectedIndex] ? selectedIndex : (listboxIndexForKey("Home", -1, disabledFlags) ?? -1));
    typed.current = { text: "", at: 0 };
    setOpen(true);
  };

  // Popover: il focus va all'elenco (sul telefono lo porta useDialogLayer, con data-autofocus).
  useEffect(() => {
    if (open && !sheet) panelRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true });
  }, [open, sheet]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Tab chiude: il focus torna al campo e il giro della pagina riprende da lì.
    if (event.key === "Tab") {
      close(true);
      return;
    }
    const now = Date.now();
    const typing = now - typed.current.at < TYPEAHEAD_MS && typed.current.text !== "";
    if (event.key === "Enter" || (event.key === " " && !typing)) {
      event.preventDefault();
      event.stopPropagation();
      pick(active);
      return;
    }
    const page = Math.max(1, Math.floor((event.currentTarget.clientHeight || 0) / 44) - 1);
    const next = listboxIndexForKey(event.key, active, disabledFlags, page);
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      setActive(next);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const text = (typing ? typed.current.text : "") + event.key;
      typed.current = { text, at: now };
      const found = typeaheadIndex(
        options.map((option) => option.label),
        disabledFlags,
        active,
        text
      );
      event.preventDefault();
      event.stopPropagation();
      if (found !== null) setActive(found);
    }
  };

  const list = (
    <div
      id={`${id}-list`}
      role="listbox"
      tabIndex={-1}
      data-autofocus
      aria-labelledby={fieldLabelId}
      aria-label={fieldLabelId ? undefined : label}
      aria-activedescendant={active >= 0 ? optionId(active) : undefined}
      onKeyDown={onListKeyDown}
      className="group grid grid-cols-1 gap-0.5 outline-none"
    >
      {options.map((option, index) => {
        const chosen = index === selectedIndex;
        const current = index === active;
        return (
          <div
            key={`${index}-${option.value}`}
            id={optionId(index)}
            role="option"
            aria-selected={chosen}
            aria-disabled={option.disabled || undefined}
            onClick={() => pick(index)}
            onPointerMove={() => {
              if (!option.disabled && !current) setActive(index);
            }}
            className={`motion-safe flex min-h-11 min-w-0 items-center gap-2.5 rounded-[14px] px-3 text-sm font-extrabold ${
              option.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"
            } ${current ? "bg-[var(--surface)] group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-[var(--focus-ring)]" : ""}`}
          >
            {option.mark}
            <span className="safe-text min-w-0 flex-1">{option.label}</span>
            {chosen ? <Icon name="Check" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" /> : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={fieldLabelId ? `${fieldLabelId} ${id}-value` : undefined}
        aria-label={fieldLabelId ? undefined : label ? `${label}: ${selected?.label ?? placeholder}` : undefined}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openList();
        }}
        className={`${inputClass} motion-safe flex items-center gap-2 text-left hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {selected?.mark ?? null}
        <span id={`${id}-value`} className={`one-line-safe min-w-0 flex-1 ${selected ? "" : "font-semibold text-[var(--faint)]"}`}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="ChevronDown" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open ? (
            sheet ? (
              <m.div
                ref={backdropRef}
                key="select-sheet"
                className="fixed inset-0 z-[60] flex items-end bg-black/35"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                <m.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`${id}-title`}
                  className="soft-panel scrollbar-soft max-h-[70dvh] w-full overflow-y-auto overscroll-contain rounded-b-none p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none"
                  initial={{ y: reduceMotion ? 0 : 48 }}
                  animate={{ y: 0 }}
                  exit={{ y: reduceMotion ? 0 : 48 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <p id={`${id}-title`} className="one-line-safe mb-2 px-1 text-xs font-black uppercase text-[var(--faint)]">
                    {title}
                  </p>
                  {list}
                </m.div>
              </m.div>
            ) : (
              <m.div
                ref={panelRef}
                key="select-popover"
                className="soft-panel scrollbar-soft fixed z-[60] overflow-y-auto overscroll-contain p-1.5"
                style={{
                  top: position?.top ?? 0,
                  left: position?.left ?? 0,
                  minWidth: width || undefined,
                  width: "max-content",
                  maxWidth: "min(26rem, calc(100vw - 32px))",
                  maxHeight: "min(22rem, calc(100dvh - 32px))"
                }}
                initial={{ opacity: 0, y: reduceMotion ? 0 : position?.side === "top" ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                {list}
              </m.div>
            )
          ) : null}
        </AnimatePresence>,
        host ?? document.body
      )}
    </>
  );
}
