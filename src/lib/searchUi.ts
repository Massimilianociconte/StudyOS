// Logica pura della ricerca globale (niente DOM, testata con node --test): dove sta il pannello dei
// risultati sui telefoni e come si muove la scelta con le frecce (combobox con aria-activedescendant).

/** Margine laterale del pannello dei risultati sui telefoni. */
export const SEARCH_GUTTER = 16;
/** Sotto questa larghezza (barra in basso, campo stretto accanto ai pulsanti) il pannello esce dal campo. */
export const SEARCH_PHONE_MAX = 640;

/**
 * Posizione del pannello rispetto al campo di ricerca. Sui telefoni il campo è stretto (≈ 177 px a 375):
 * il pannello si allarga a tutto lo schermo meno 16 px per lato, spostandosi a sinistra di quanto il
 * campo dista dal bordo. null = come il campo (left 0, right 0).
 */
export const searchPanelBox = (field: { left: number }, viewportWidth: number): { left: number; width: number } | null =>
  viewportWidth > 0 && viewportWidth < SEARCH_PHONE_MAX
    ? { left: SEARCH_GUTTER - field.left, width: Math.max(0, viewportWidth - 2 * SEARCH_GUTTER) }
    : null;

/** Id di un risultato: il campo lo indica con aria-activedescendant mentre il focus resta nel campo. */
export const searchOptionId = (listId: string, index: number) => `${listId}-option-${index}`;

/** Risultato evidenziato dopo una freccia (in tondo); null = tasto che non sposta la scelta. */
export const nextSearchIndex = (index: number, key: string, count: number): number | null => {
  if (count <= 0) return null;
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  return null;
};
