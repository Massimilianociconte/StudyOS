import { useEffect, useRef } from "react";
import type { AppView } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { readTabUiState, useUiState, writeUiState, type UiScope } from "../lib/uiState";
import { linkedUiChange } from "../lib/uiLinks";

/**
 * `useUiState` per le chiavi che altre schermate scrivono per portare qui ("3 in ritardo" → Attività
 * filtrate, "Esame tra" → l'esame aperto). Si legge all'apertura della sezione, come `useUiState`, e
 * anche dopo: se la sezione è già aperta quando un'altra parte dell'app scrive la chiave e chiama
 * `setActiveView`, il nuovo valore (se valido) si applica senza rimontare la vista.
 */
export function useLinkedUiState<T>(
  key: string,
  initial: T | (() => T),
  { scope = "tab", validate }: { scope?: UiScope; validate: (value: unknown) => boolean }
) {
  const [value, setValue] = useUiState<T>(key, initial, { scope, validate });
  const seen = useRef<unknown>(readTabUiState(key));
  const latest = useRef({ validate, value, scope });
  latest.current = { validate, value, scope };

  // Ciò che la vista sceglie da sé (useUiState lo ha appena salvato) è già visto: altrimenti un altro
  // schermo che riscrive il valore di prima non verrebbe riconosciuto come cambiato.
  useEffect(() => {
    seen.current = value;
  }, [value]);

  useEffect(() => {
    const check = () => {
      const stored = readTabUiState(key);
      const change = linkedUiChange(stored, seen.current, latest.current.validate);
      if (change.apply) {
        seen.current = change.seen;
        setValue(change.seen as T);
      } else if (!Object.is(stored, seen.current)) {
        // Valore non valido scritto da fuori: si ignora e al suo posto torna quello in uso, così un
        // refresh non riapre la vista con un valore diverso da quello che si vedeva.
        writeUiState(key, latest.current.value, latest.current.scope);
      }
    };
    check();
    // Chi porta qui chiama sempre setActiveView: ogni cambio dello store è l'occasione per ricontrollare.
    return useStudyStore.subscribe(check);
  }, [key, setValue]);

  return [value, setValue] as const;
}

/** Porta a un'altra sezione con le chiavi già scritte (es. l'attività da aprire, il filtro da applicare). */
export function goToView(view: AppView, links: ReadonlyArray<readonly [key: string, value: unknown, scope: UiScope]> = []) {
  for (const [key, value, scope] of links) writeUiState(key, value, scope);
  useStudyStore.getState().setActiveView(view);
}
