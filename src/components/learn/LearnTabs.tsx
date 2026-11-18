// Schede del ripasso. Sul telefono stanno tutte in vista, in cinque colonne con l'icona sopra il nome
// (prima la barra scorreva e Quiz, Andamento e Analisi restavano fuori schermo: chi arrivava non
// sapeva che esistessero). Da 640px tornano in riga come le altre schede dell'app. Il numero dice
// dove c'è qualcosa da fare. Frecce ← → per spostarsi, come in Segmented.
import { useRef, type KeyboardEvent } from "react";
import { Icon } from "../Icon";

export interface LearnTabOption<T extends string> {
  id: T;
  label: string;
  icon: string;
  count?: number;
}

export function LearnTabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly LearnTabOption<T>[]; onChange: (value: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      className="grid w-full grid-cols-5 gap-1 rounded-[22px] border border-[var(--border)] bg-[var(--surface-soft)] p-1 sm:inline-flex sm:w-auto sm:max-w-full sm:rounded-full sm:py-0"
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={`motion-safe relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 text-[11px] font-extrabold max-[359px]:text-[10px] sm:min-h-11 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3.5 sm:text-sm sm:before:absolute sm:before:inset-x-0 sm:before:inset-y-1 sm:before:rounded-full sm:before:content-[''] ${
              active
                ? "bg-[var(--accent)] text-[#10131d] sm:bg-transparent sm:before:bg-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] sm:hover:bg-transparent sm:hover:before:bg-[var(--surface)]"
            }`}
          >
            <span className="relative">
              <Icon name={option.icon} className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
              {/* Telefono: il numero sta sull'icona; da 640px accanto al nome. */}
              {option.count ? (
                <span
                  aria-hidden="true"
                  className={`absolute -right-2.5 -top-1.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] leading-4 tabular-nums sm:hidden ${
                    active ? "bg-[#10131d] text-[var(--accent)]" : "bg-[var(--accent)] text-[#10131d]"
                  }`}
                >
                  {option.count > 99 ? "99+" : option.count}
                </span>
              ) : null}
            </span>
            <span className="relative max-w-full truncate">{option.label}</span>
            {option.count ? (
              <span className={`relative rounded-full px-1.5 text-[11px] max-sm:sr-only ${active ? "bg-black/10" : "bg-[var(--surface-strong)]"}`}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
