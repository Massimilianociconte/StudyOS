// Errore di un campo: il messaggio sta sotto il campo giusto (aria-invalid, aria-describedby, role="alert")
// e il primo campo sbagliato prende il focus. Lo usano il modulo dell'appello e il riquadro «Correggi».
import { useCallback, useId, useState } from "react";

export interface FieldIssue {
  field: string;
  message: string;
}

const ERROR_CLASS = "safe-text text-sm font-bold text-[var(--danger-text)]";

/** Id dell'elemento di un campo dentro un riquadro (`scope` viene da useId). */
export const fieldDomId = (scope: string, field: string) => `${scope}-${field}`;

/** Messaggio sotto il campo; niente se l'errore riguarda un altro campo. */
export function FieldMessage({ scope, issue, field }: { scope: string; issue: FieldIssue | null; field: string }) {
  if (!issue || issue.field !== field) return null;
  return (
    <p id={`${fieldDomId(scope, field)}-error`} role="alert" className={ERROR_CLASS}>
      {issue.message}
    </p>
  );
}

/** Attributi per l'input di un campo: id, aria-invalid, aria-describedby. */
export const fieldAttrs = (scope: string, issue: FieldIssue | null, field: string) => {
  const invalid = issue?.field === field;
  return {
    id: fieldDomId(scope, field),
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? `${fieldDomId(scope, field)}-error` : undefined
  };
};

/** Porta il focus sul campo (o sul primo controllo dentro il suo contenitore). */
export const focusField = (scope: string, field: string) => {
  if (typeof document === "undefined") return;
  const run = () => {
    const element = document.getElementById(fieldDomId(scope, field));
    if (!element) return;
    const target = element.matches("input, select, textarea, button") ? element : element.querySelector<HTMLElement>("input, select, textarea, button");
    target?.focus();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
};

/**
 * Stato dell'errore di un modulo. `fail(field, message, known)` mostra il messaggio sotto il campo se
 * `known` lo elenca, altrimenti resta un messaggio generale (`general`).
 */
export function useFieldIssue(known: readonly string[]) {
  const scope = useId();
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [general, setGeneral] = useState("");
  const clear = useCallback(() => {
    setIssue(null);
    setGeneral("");
  }, []);
  const fail = useCallback(
    (message: string, field?: string) => {
      if (field && known.includes(field)) {
        setIssue({ field, message });
        setGeneral("");
        focusField(scope, field);
      } else {
        setIssue(null);
        setGeneral(message);
      }
    },
    [known, scope]
  );
  return { scope, issue, general, fail, clear };
}
