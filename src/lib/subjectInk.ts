// Colore dell'icona sopra il colore di una materia (scheda, dettaglio): il colore lo sceglie chi studia,
// anche scuro, quindi l'inchiostro fisso scuro può sparire. Puro, testato in tests/subjectInk.test.mjs.
import { contrastRatio } from "./eventColors";
import { safeCssColor } from "./sharing";

export const DARK_INK = "#10131d";
export const LIGHT_INK = "#ffffff";

/**
 * Inchiostro con più contrasto sul colore della materia: scuro (`dark`) sui colori chiari, bianco su
 * quelli scuri. Un colore che non è un esadecimale (vuoto, `var(--accent)`) resta con l'inchiostro scuro:
 * il ripiego dell'app è la tinta chiara dell'accento.
 */
export const inkOn = (color: string | undefined, dark: string = DARK_INK) => {
  const background = safeCssColor(color ?? "");
  if (!background) return dark;
  return contrastRatio(background, dark) >= contrastRatio(background, LIGHT_INK) ? dark : LIGHT_INK;
};
