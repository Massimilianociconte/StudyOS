import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { whenPersisted } from "./persistence";

const CHUNK_RELOAD_KEY = "studyos-chunk-reload";

/**
 * Dopo un nuovo deploy una scheda aperta con la build precedente non trova più i vecchi chunk
 * delle viste: si salva e si ricarica una sola volta invece di mostrare una pagina rotta.
 * Vale per ogni pezzo caricato in differita (viste, pannelli, modali).
 */
export const lazyView = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K
): LazyExoticComponent<T[K] extends ComponentType<any> ? T[K] : never> =>
  lazy(async () => {
    try {
      const module = await loader();
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // storage non disponibile
      }
      return { default: module[name] as never };
    } catch (error) {
      if (await reloadOnceForMissingChunk()) return new Promise<{ default: never }>(() => undefined);
      throw error;
    }
  });

/**
 * Un pezzo dell'app non si è caricato: salva e ricarica la pagina, una sola volta per sessione.
 * Restituisce true se la ricarica è partita (chi chiama aspetta e basta), false se c'è già stata.
 */
export async function reloadOnceForMissingChunk(): Promise<boolean> {
  let alreadyReloaded = true;
  try {
    alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
    if (!alreadyReloaded) sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    // senza storage non si rischia un loop di ricariche
  }
  if (alreadyReloaded) return false;
  await whenPersisted().catch(() => undefined);
  window.location.reload();
  return true;
}
