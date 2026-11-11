import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type PropsWithChildren,
  type ReactNode,
  type RefObject
} from "react";
import { Icon } from "./Icon";
import { UI_TEXT } from "../lib/labels";
import { menuIndexForKey, placeFloating, type FloatingAlign, type FloatingPosition } from "../lib/uiPieces";
import { applyStyles, canScrollToward, createLayerStack, createScrollLock, lockStyles, scrollbarWidthOf } from "../lib/scrollLock";

export function Button({
  children,
  icon,
  variant = "ghost",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  variant?: "primary" | "ghost" | "soft" | "danger";
}) {
  const variants = {
    primary: "bg-[var(--accent)] text-[#10131d] shadow-lift hover:scale-[1.02]",
    ghost: "bg-transparent text-[var(--text)] hover:bg-[var(--surface)]",
    soft: "bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]",
    danger: "bg-[var(--danger-bg)] text-[var(--danger-text)] hover:bg-[var(--danger-bg-hover)]"
  };

  return (
    <button
      type="button"
      className={`motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 ${variants[variant]} ${className}`}
      {...props}
    >
      {icon ? <Icon name={icon} className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`motion-safe grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:scale-[1.03] hover:bg-[var(--surface)] ${className}`}
      {...props}
    >
      <Icon name={icon} className="h-4.5 w-4.5" />
    </button>
  );
}

export function Panel({
  children,
  className = "",
  accent
}: PropsWithChildren<{ className?: string; accent?: string }>) {
  return (
    <m.section
      className={`soft-panel min-w-0 p-[var(--pad)] ${className}`}
      style={accent ? ({ "--panel-accent": accent } as React.CSSProperties) : undefined}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
    >
      {children}
    </m.section>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="min-w-0 text-balance text-2xl font-black leading-tight [overflow-wrap:break-word] md:text-3xl xl:text-4xl">{title}</h2>
        {subtitle ? <p className="safe-text mt-1 max-w-2xl text-sm font-medium text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 empty:hidden">{action}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  active,
  className = ""
}: PropsWithChildren<{ active?: boolean; className?: string }>) {
  return (
    <span
      className={`inline-flex min-h-8 max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border px-3 text-xs font-extrabold ${
        active
          ? "border-transparent bg-[var(--accent)] text-[#10131d]"
          : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, color = "var(--accent)", label }: { value: number; color?: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-[var(--surface-strong)]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label ?? "Progresso"}
    >
      <m.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  label,
  color = "var(--accent)"
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;

  return (
    <div className="relative grid aspect-square w-full max-w-[180px] place-items-center rounded-super bg-[var(--surface-soft)]">
      <svg viewBox="0 0 108 108" className="absolute inset-0 h-full w-full rotate-[-90deg]">
        <circle cx="54" cy="54" r={radius} fill="none" stroke="var(--surface-strong)" strokeWidth="10" />
        <m.circle
          cx="54"
          cy="54"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </svg>
      <div className="relative text-center">
        <div className="text-3xl font-black">{Math.round(value)}%</div>
        <div className="text-xs font-bold text-[var(--muted)]">{label}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  className = ""
}: PropsWithChildren<{ label: string; className?: string }>) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-bold text-[var(--text)] placeholder:text-[var(--faint)]";

/** Su un `fieldset disabled` (sola lettura): i campi si vedono attenuati e non invitano al clic. */
export const DIMMED_DISABLED_FIELDS =
  "[&_input:disabled]:cursor-not-allowed [&_input:disabled]:opacity-60 [&_select:disabled]:cursor-not-allowed [&_select:disabled]:opacity-60 [&_textarea:disabled]:cursor-not-allowed [&_textarea:disabled]:opacity-60";

// Il pulsante "Scegli file" (h-8) resta centrato con lo stesso margine di 5px sopra, sotto e a
// sinistra: 2px di bordo + 10px di padding + 32px = 44px, come gli altri campi.
export const fileInputClass = `${inputClass} cursor-pointer py-[5px] pl-[5px] file:mr-3 file:h-8 file:cursor-pointer file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-3 file:text-sm file:font-black file:text-[#10131d]`;

export function EmptyState({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="quiet-panel grid place-items-center p-8 text-center">
      <Icon name={icon} className="mb-3 h-8 w-8 text-[var(--accent-ink)]" />
      <h3 className="safe-text text-lg font-black">{title}</h3>
      <p className="safe-text mt-1 max-w-sm text-sm text-[var(--muted)]">{body}</p>
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Selettore a segmenti (viste, filtri): un solo valore attivo, navigabile da tastiera. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className = ""
}: {
  value: T;
  options: readonly { id: T; label: string; count?: number; icon?: string; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Su tablet e telefoni le schede possono non stare in riga: la sfumatura ai bordi indica
  // che la barra scorre e la scheda attiva viene sempre portata in vista.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = { left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 };
      setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [options.length]);

  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !active) return;
    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < el.scrollLeft) el.scrollTo({ left: start - 12 });
    else if (end > el.scrollLeft + el.clientWidth) el.scrollTo({ left: end - el.clientWidth + 12 });
  }, [value]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent 0, black 28px" : "black 0"}, ${edges.right ? "black calc(100% - 28px), transparent 100%" : "black 100%"})`
      : undefined;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = options.findIndex((option) => option.id === value);
    const next = options[(index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
    event.preventDefault();
    onChange(next.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={`no-scrollbar relative inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-1 ${className}`}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            title={option.title}
            onClick={() => onChange(option.id)}
            // Area di tocco alta 44 px; la pillola visibile resta compatta (before:) e sta dietro al testo.
            className={`motion-safe relative inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-extrabold before:absolute before:inset-x-0 before:rounded-full before:content-[''] ${
              size === "sm" ? "px-3 text-xs before:inset-y-1.5" : "px-3.5 text-sm before:inset-y-1"
            } ${
              active
                ? "text-[#10131d] before:bg-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--text)] hover:before:bg-[var(--surface)]"
            }`}
          >
            {option.icon ? <Icon name={option.icon} className="relative h-3.5 w-3.5" /> : null}
            <span className="relative">{option.label}</span>
            {option.count !== undefined ? (
              <span className={`relative rounded-full px-1.5 text-[11px] ${active ? "bg-black/10" : "bg-[var(--surface-strong)]"}`}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Etichetta compatta con pallino colorato (materia, priorità, categoria). */
export function Tag({ children, color, className = "" }: PropsWithChildren<{ color?: string; className?: string }>) {
  return (
    <span
      className={`inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-soft)] px-2 text-[11px] font-extrabold text-[var(--muted)] ${className}`}
    >
      {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

const MODAL_SELECTOR = '[aria-modal="true"]';

// Pagina bloccata finché almeno una finestra è aperta (contatore: le finestre una dentro l'altra,
// come la data dentro il modulo evento, non la sbloccano chiudendosi).
const pageScrollLock = createScrollLock({ lock: lockPage });
// Dove si può scorrere al tocco: solo dentro la finestra in cima.
const scrollAreas = createLayerStack<() => HTMLElement | null>();
// Finestre aperte, dalla più vecchia alla più recente: Esc e Tab li gestisce solo quella in cima (es.
// "Invita" sopra il dettaglio del gruppo, o il selettore della data sopra il modulo evento).
const dialogLayers = createLayerStack<null>();

const TEXT_ENTRY = "input, textarea, select, [contenteditable='true']";

const lastModal = () => {
  const modals = document.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
  return modals[modals.length - 1] ?? null;
};

/** Il gesto scorre qualcosa dentro la finestra in cima? Se no si blocca: la pagina sotto non si muove. */
function touchCanScroll(target: EventTarget | null, dx: number, dy: number) {
  if (!(target instanceof Element)) return false;
  const area = scrollAreas.top()?.() ?? lastModal();
  if (!area || !area.contains(target)) return false;
  // Nei campi di testo il dito sposta il cursore e seleziona: mai bloccato.
  if (target.closest(TEXT_ENTRY)) return true;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  for (let element: Element | null = target; element; element = element === area ? null : element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const style = getComputedStyle(element);
    if (/(auto|scroll|overlay)/.test(vertical ? style.overflowY : style.overflowX) && canScrollToward(element, dx, dy)) return true;
  }
  return false;
}

/**
 * Blocca la pagina: `html` non scorre (posizione e pezzi sticky restano dove sono, nessun salto),
 * la barra di scorrimento del computer è compensata, al tocco (iOS compreso) scorre solo il contenuto
 * della finestra in cima e senza rimbalzi. Restituisce lo sblocco, che rimette tutto com'era.
 */
function lockPage() {
  const html = document.documentElement;
  const body = document.body;
  const scroll = { left: window.scrollX, top: window.scrollY };
  const styles = lockStyles({
    scrollbarWidth: scrollbarWidthOf(window.innerWidth, html.clientWidth),
    bodyPaddingRight: Number.parseFloat(getComputedStyle(body).paddingRight) || 0
  });
  const restoreHtml = applyStyles(html, styles.html);
  const restoreBody = applyStyles(body, styles.body);
  let last = { x: 0, y: 0 };
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch) last = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchMove = (event: TouchEvent) => {
    // Due dita: zoom, mai bloccato.
    const touch = event.touches[0];
    if (!touch || event.touches.length > 1) return;
    const dx = touch.clientX - last.x;
    const dy = touch.clientY - last.y;
    last = { x: touch.clientX, y: touch.clientY };
    if (event.cancelable && !touchCanScroll(event.target, dx, dy)) event.preventDefault();
  };
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  return () => {
    document.removeEventListener("touchstart", onTouchStart, { capture: true });
    document.removeEventListener("touchmove", onTouchMove, { capture: true });
    restoreBody();
    restoreHtml();
    if (window.scrollX !== scroll.left || window.scrollY !== scroll.top) window.scrollTo({ ...scroll, behavior: "instant" });
  };
}

/**
 * Blocca lo scorrimento della pagina finché `active` è vero. Annidabile: si sblocca solo quando si
 * chiude l'ultima finestra. `areaRef`: dove si può ancora scorrere al tocco (lo sfondo della finestra o
 * il pannello); senza, la finestra `aria-modal` più recente. Da usare in ogni finestra fatta a mano.
 */
export function useScrollLock(active: boolean, areaRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const area = scrollAreas.push(() => areaRef?.current ?? null);
    const release = pageScrollLock.acquire();
    return () => {
      scrollAreas.remove(area);
      release();
    };
  }, [active, areaRef]);
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Finestra modale: pagina bloccata (`useScrollLock`), focus all'apertura sull'elemento del pannello
 * con `data-autofocus` (altrimenti sul pannello), Tab che resta nel pannello, Esc (`onEscape`) e Tab
 * gestiti solo dalla finestra in cima, focus che torna a chi l'ha aperta alla chiusura. Ascolto in
 * bolla su window: fumetti, menu e selettori aperti dentro la finestra fermano Esc prima (in
 * cattura) e chiudono solo sé stessi.
 */
export function useDialogLayer(
  open: boolean,
  {
    panelRef,
    areaRef,
    onEscape,
    returnFocusRef
  }: {
    panelRef: RefObject<HTMLElement | null>;
    areaRef?: RefObject<HTMLElement | null>;
    onEscape?: () => void;
    /** Chi riceve il focus alla chiusura al posto dell'elemento attivo all'apertura (es. il campo che ha aperto il selettore). */
    returnFocusRef?: RefObject<HTMLElement | null>;
  }
) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useScrollLock(open, areaRef ?? panelRef);

  useEffect(() => {
    if (!open) return;
    const token = dialogLayers.push(null);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel)?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (!dialogLayers.isTop(token)) return;
      if (event.key === "Escape") {
        escapeRef.current?.();
        return;
      }
      // Tab resta dentro il pannello (aria-modal): niente focus sugli elementi della pagina sotto.
      const panel = panelRef.current;
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null && element.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      dialogLayers.remove(token);
      (returnFocusRef?.current ?? previousFocus)?.focus({ preventScroll: true });
    };
  }, [open, panelRef, returnFocusRef]);
}

/**
 * Pannello laterale per i dettagli: a destra su desktop, foglio dal basso su mobile.
 * Esc o click fuori chiudono; lo scroll della pagina resta bloccato finché è aperto.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  headerExtra,
  footer,
  children,
  width = "max-w-[640px]",
  dismissOutside = true
}: PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** false: click fuori ed Esc non chiudono (resta la X): per contenuti che non si possono rivedere. */
  dismissOutside?: boolean;
}>) {
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const outsideRef = useRef(dismissOutside);
  outsideRef.current = dismissOutside;
  // Su mobile è un foglio che sale dal basso, su desktop un pannello che entra da destra.
  const offset = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches ? { x: 40 } : { y: 60 };

  // Lo sfondo è l'area dove si scorre al tocco: contiene anche fumetti e selettori aperti nel pannello.
  useDialogLayer(open, {
    panelRef,
    areaRef: backdropRef,
    onEscape: () => {
      if (outsideRef.current) closeRef.current();
    }
  });

  // Portal su body: un drawer aperto dentro un altro non resta confinato nel pannello sotto.
  // role="dialog" sullo sfondo a tutto schermo, come le altre finestre: HelpTip e menu si montano
  // qui dentro (non inerti per gli screen reader) senza essere ritagliati dal pannello.
  return createPortal(
    <AnimatePresence>
      {open ? (
        <m.div
          ref={backdropRef}
          key="drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/45 backdrop-blur-sm sm:items-stretch sm:p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && dismissOutside) onClose();
          }}
        >
          <m.div
            ref={panelRef}
            tabIndex={-1}
            className={`soft-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none outline-none sm:max-h-none sm:rounded-b-[var(--radius)] ${width}`}
            initial={{ ...offset, opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={{ ...offset, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <header className="flex items-start gap-3 border-b border-[var(--border)] p-4 sm:p-5">
              <div className="min-w-0 flex-1">
                {eyebrow ? <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{eyebrow}</div> : null}
                <h2 id={titleId} className="safe-text text-xl font-black leading-tight sm:text-2xl">
                  {title}
                </h2>
                {headerExtra ? <div className="mt-1.5">{headerExtra}</div> : null}
              </div>
              <IconButton icon="X" label="Chiudi" onClick={onClose} className="h-10 w-10" />
            </header>
            <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
            {footer ? <footer className="safe-bottom border-t border-[var(--border)] p-3 sm:p-4">{footer}</footer> : null}
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/**
 * Dove montare fumetti e menu: dentro la finestra modale aperta che contiene il pulsante (fuori da un
 * aria-modal gli screen reader li ignorano), altrimenti su body. Le finestre dell'app (Drawer e
 * modali) hanno aria-modal sullo sfondo fixed a tutto schermo e senza overflow: lì un fumetto fixed
 * non viene ritagliato e le coordinate restano quelle dello schermo.
 */
export const floatingHost = (anchor: HTMLElement | null): HTMLElement => anchor?.closest<HTMLElement>(MODAL_SELECTOR) ?? document.body;

/**
 * Un tocco sullo sfondo di una finestra con un fumetto aperto chiude solo il fumetto: le finestre si
 * chiudono sul mousedown dello sfondo, che arriva dopo questo pointerdown (al tocco, dopo il rilascio).
 * Quel mousedown si ferma qui; una pressione senza mousedown (scorrimento) scade alla successiva.
 */
function swallowBackdropPress(backdrop: Element) {
  const onMouseDown = (event: MouseEvent) => {
    if (event.target === backdrop) event.stopPropagation();
    stop();
  };
  const stop = () => {
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("pointerdown", stop, true);
  };
  window.addEventListener("mousedown", onMouseDown, true);
  // Aggiunto durante il pointerdown attuale (già passato da window in cattura): vale dal prossimo.
  window.addEventListener("pointerdown", stop, true);
}

/**
 * Fumetti e menu ancorati a un pulsante: posizione fixed calcolata dal pulsante (sotto, sopra se manca
 * spazio, sempre dentro lo schermo), aggiornata a scorrimento e ridimensionamento. Esc e tocco fuori
 * chiudono. Esc si ferma qui (cattura su window, prima dell'ascolto dei Drawer): un Drawer aperto
 * sotto il fumetto resta aperto; lo stesso per un tocco sul suo sfondo (swallowBackdropPress).
 * `sheet`: pannello dal basso (telefono) che non segue il pulsante: niente posizione, restano Esc e
 * tocco fuori.
 */
export function useFloatingLayer(
  open: boolean,
  close: (refocus: boolean) => void,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  align: FloatingAlign,
  sheet = false
) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  // Layout effect: misura e posiziona prima che il fumetto si veda. La posizione resta dopo la
  // chiusura, così l'animazione d'uscita non salta.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (sheet || !anchor || !floating) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
      // Pulsante uscito dallo schermo scorrendo: il fumetto non resta sospeso da solo.
      if (rect.bottom < 0 || rect.top > viewport.height) {
        closeRef.current(false);
        return;
      }
      const next = placeFloating(rect, { width: floating.offsetWidth, height: floating.offsetHeight }, viewport, { align });
      setPosition((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.side === next.side ? prev : next));
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (anchorRef.current?.contains(target) || floatingRef.current?.contains(target))) return;
      if (target instanceof Element && target.matches(MODAL_SELECTOR)) swallowBackdropPress(target);
      closeRef.current(false);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (floatingRef.current) observer?.observe(floatingRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, align, anchorRef, floatingRef, sheet]);

  return position;
}

// Niente visibility: hidden prima della misura: il layout effect posiziona prima del disegno e
// l'ingresso parte da opacity 0; un elemento nascosto non riceverebbe il focus all'apertura.
const floatingStyle = (position: FloatingPosition | null, width: string) => ({
  top: position?.top ?? 0,
  left: position?.left ?? 0,
  width,
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "calc(100dvh - 32px)"
});

/**
 * Aiuto "?": si apre al tocco o al clic, mai solo al passaggio del mouse. Il fumetto è in portal su
 * body come `Drawer` (i pannelli con backdrop-filter spostano e ritagliano gli elementi fixed). Esc
 * chiude solo il fumetto, anche dentro un Drawer; un tocco fuori o un secondo tocco sul "?" lo
 * chiudono; il focus torna al pulsante. `label`: testo visibile accanto al "?" (es. "Cosa vuol dire?").
 */
export function HelpTip({ title, text, example, label }: { title: string; text: string; example?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  // Contenitore del portal, scelto all'apertura e tenuto per l'animazione d'uscita.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const position = useFloatingLayer(open, close, buttonRef, tipRef, "center");

  // Il focus entra nel fumetto: lo screen reader legge titolo e spiegazione.
  useEffect(() => {
    if (open) tipRef.current?.focus({ preventScroll: true });
  }, [open]);

  const name = UI_TEXT.helpAria(title);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label ? `${label} (${name})` : name}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) return close(true);
          setHost(floatingHost(buttonRef.current));
          setOpen(true);
        }}
        className={`motion-safe group relative inline-flex shrink-0 items-center gap-1.5 rounded-full align-middle after:absolute after:-inset-2.5 after:content-[''] ${
          label ? "min-h-6 text-xs font-extrabold text-[var(--accent-ink)] hover:underline" : "h-6 w-6"
        }`}
      >
        <span
          aria-hidden="true"
          className="motion-safe grid h-6 w-6 shrink-0 grid-cols-1 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-soft)] text-xs font-black leading-none text-[var(--muted)] group-hover:bg-[var(--surface)] group-hover:text-[var(--text)] group-aria-expanded:border-transparent group-aria-expanded:bg-[var(--accent)] group-aria-expanded:text-[#10131d]"
        >
          ?
        </span>
        {label ? <span className="min-w-0">{label}</span> : null}
      </button>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <m.div
              ref={tipRef}
              key="help-tip"
              id={id}
              role="dialog"
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-text`}
              tabIndex={-1}
              onKeyDown={(event) => {
                // Tab esce dal fumetto: si chiude e il giro riprende dal "?" (prima o dopo).
                if (event.key !== "Tab") return;
                const last = event.currentTarget.querySelector("button");
                if (event.shiftKey || document.activeElement === last) close(true);
              }}
              className="soft-panel fixed z-[60] overflow-y-auto p-3 text-left outline-none"
              style={floatingStyle(position, "20rem")}
              initial={{ opacity: 0, y: reduceMotion ? 0 : position?.side === "top" ? 4 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              <div className="flex items-start gap-2">
                <p id={`${id}-title`} className="safe-text min-w-0 flex-1 pt-1 text-sm font-black">
                  {title}
                </p>
                <button
                  type="button"
                  aria-label={UI_TEXT.close}
                  onClick={() => close(true)}
                  className="motion-safe relative grid h-7 w-7 shrink-0 grid-cols-1 place-items-center rounded-full text-[var(--muted)] after:absolute after:-inset-2 after:content-[''] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  <Icon name="X" className="h-4 w-4" />
                </button>
              </div>
              <p id={`${id}-text`} className="safe-text mt-1 text-sm font-medium">
                {text}
              </p>
              {example ? (
                <p className="safe-text mt-2 text-sm font-medium text-[var(--muted)]">
                  <span className="font-black text-[var(--accent-ink)]">{UI_TEXT.example}</span> {example}
                </p>
              ) : null}
            </m.div>
          ) : null}
        </AnimatePresence>,
        host ?? document.body
      )}
    </>
  );
}

export type PageAction = { label: string; icon?: string; onClick: () => void; danger?: boolean };

/**
 * Azioni di una pagina: una sola primaria più il menu "Altre azioni" (⋯) con il resto. Il menu è
 * in portal su body come `Drawer`; frecce e Home/End per muoversi, Esc o Tab chiudono e il focus
 * torna al pulsante, un tocco fuori chiude. `label`: nome del pulsante ⋯ (predefinito "Altre azioni").
 */
export function PageActions({ primary, more = [], label }: { primary?: ReactNode; more?: PageAction[]; label?: string }) {
  if (!primary && !more.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {primary}
      {more.length ? <MoreActionsMenu items={more} label={label || UI_TEXT.moreActions} /> : null}
    </div>
  );
}

function MoreActionsMenu({ items, label }: { items: PageAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const startAt = useRef<"first" | "last">("first");
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const position = useFloatingLayer(open, close, buttonRef, menuRef, "end");

  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    list[startAt.current === "last" ? list.length - 1 : 0]?.focus({ preventScroll: true });
  }, [open]);

  const openMenu = (at: "first" | "last") => {
    startAt.current = at;
    setHost(floatingHost(buttonRef.current));
    setOpen(true);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Tab chiude: il focus torna al pulsante e il giro della pagina riprende da lì.
    if (event.key === "Tab") {
      close(true);
      return;
    }
    const list = menuItems();
    const next = menuIndexForKey(event.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={`${id}-button`}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close(true) : openMenu("first"))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(event.key === "ArrowUp" ? "last" : "first");
        }}
        className="motion-safe grid h-11 w-11 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)] aria-expanded:bg-[var(--surface)]"
      >
        <Icon name="MoreHorizontal" className="h-[18px] w-[18px]" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <m.div
              ref={menuRef}
              key="more-actions"
              id={id}
              role="menu"
              aria-labelledby={`${id}-button`}
              aria-orientation="vertical"
              onKeyDown={onMenuKeyDown}
              className="soft-panel fixed z-[60] overflow-y-auto p-1.5"
              style={{ ...floatingStyle(position, "max-content"), minWidth: "13rem" }}
              initial={{ opacity: 0, y: reduceMotion ? 0 : position?.side === "top" ? 4 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              {items.map((item, index) => (
                <button
                  key={`${index}-${item.label}`}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    // Prima il focus al pulsante: un Drawer aperto dall'azione lo riporta lì alla chiusura.
                    close(true);
                    item.onClick();
                  }}
                  className={`motion-safe flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[14px] px-3 text-left text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                    item.danger
                      ? "text-[var(--danger-text)] hover:bg-[var(--danger-bg)] focus:bg-[var(--danger-bg)]"
                      : "text-[var(--text)] hover:bg-[var(--surface)] focus:bg-[var(--surface)]"
                  }`}
                >
                  {item.icon ? <Icon name={item.icon} className="h-4 w-4 shrink-0" /> : null}
                  <span className="safe-text min-w-0">{item.label}</span>
                </button>
              ))}
            </m.div>
          ) : null}
        </AnimatePresence>,
        host ?? document.body
      )}
    </>
  );
}

/**
 * Riquadro con un numero. Con `onClick` è un pulsante che porta a ciò che il numero conta (freccia,
 * bordo al passaggio, focus visibile); senza è un blocco di solo testo, senza aspetto da scheda.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  onClick
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-black uppercase text-[var(--faint)]">
        {icon ? <Icon name={icon} className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]" /> : null}
        <span className="one-line-safe">{label}</span>
      </span>
      <span className="mt-1 block text-2xl font-black leading-tight [overflow-wrap:anywhere]">{value}</span>
      {hint ? <span className="safe-text mt-0.5 block text-xs font-medium text-[var(--muted)]">{hint}</span> : null}
    </>
  );

  if (!onClick) return <div className="min-w-0 py-1">{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className="motion-safe group flex w-full min-w-0 items-start gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-left hover:border-[var(--accent-ink)] hover:bg-[var(--surface)] hover:ring-1 hover:ring-[var(--accent-ink)]"
    >
      <span className="block min-w-0 flex-1">{body}</span>
      <Icon name="ChevronRight" className="motion-safe mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)] group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)]" />
    </button>
  );
}
