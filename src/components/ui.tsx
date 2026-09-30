import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren, type ReactNode } from "react";
import { Icon } from "./Icon";

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
    <motion.section
      layout
      className={`soft-panel min-w-0 p-[var(--pad)] ${className}`}
      style={accent ? ({ "--panel-accent": accent } as React.CSSProperties) : undefined}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
    >
      {children}
    </motion.section>
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
        <h2 className="safe-text text-2xl font-black leading-tight [hyphens:manual] md:text-3xl xl:text-4xl">{title}</h2>
        {subtitle ? <p className="safe-text mt-1 max-w-2xl text-sm font-medium text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{action}</div> : null}
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
      <motion.div
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
        <motion.circle
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
      className={`no-scrollbar relative inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface-soft)] p-1 ${className}`}
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
            className={`motion-safe inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-extrabold ${
              size === "sm" ? "min-h-8 px-3 text-xs" : "min-h-9 px-3.5 text-sm"
            } ${active ? "bg-[var(--accent)] text-[#10131d]" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"}`}
          >
            {option.icon ? <Icon name={option.icon} className="h-3.5 w-3.5" /> : null}
            {option.label}
            {option.count !== undefined ? (
              <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-black/10" : "bg-[var(--surface-strong)]"}`}>{option.count}</span>
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
  width = "max-w-[640px]"
}: PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  width?: string;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Su mobile è un foglio che sale dal basso, su desktop un pannello che entra da destra.
  const offset = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches ? { x: 40 } : { y: 60 };

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      // Tab resta dentro il pannello (aria-modal): niente focus sugli elementi della pagina sotto.
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
        (element) => element.offsetParent !== null
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
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
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="drawer"
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/45 backdrop-blur-sm sm:items-stretch sm:p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
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
            <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
            {footer ? <footer className="safe-bottom border-t border-[var(--border)] p-3 sm:p-4">{footer}</footer> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
