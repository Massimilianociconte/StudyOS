import { useId, type ReactNode } from "react";
import { HelpTip } from "./ui";

type Help = { title: string; text: string; example?: string };

/**
 * Come `Field`, con l'aiuto "?" accanto all'etichetta. Il "?" sta fuori dal <label>: un pulsante dentro
 * un'etichetta ne diventerebbe il campo collegato e il vero campo perderebbe il nome.
 */
export function HelpField({
  label,
  help,
  children,
  className = ""
}: {
  label: string;
  help: Help;
  /** Riceve l'id da dare al campo. */
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`block min-w-0 ${className}`}>
      <div className="mb-1.5 flex min-h-4 items-center gap-1.5">
        <label htmlFor={id} className="safe-text min-w-0 text-xs font-black uppercase text-[var(--faint)]">
          {label}
        </label>
        {/* -my-1: il "?" da 24 px non allunga la riga dell'etichetta, i campi accanto restano allineati. */}
        <span className="-my-1 inline-flex shrink-0">
          <HelpTip {...help} />
        </span>
      </div>
      {children(id)}
    </div>
  );
}
