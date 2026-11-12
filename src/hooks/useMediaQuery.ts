import { useCallback, useSyncExternalStore } from "react";

/**
 * La media query `query` vale adesso? Si aggiorna quando cambia (rotazione, finestra ridimensionata).
 * Senza `window` vale false.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
    () => false
  );
}
