// Calcoli puri dei pezzi comuni dell'interfaccia (HelpTip, menu "Altre azioni"): senza DOM, testabili.

export type AnchorRect = { top: number; bottom: number; left: number; right: number };
export type FloatingAlign = "start" | "center" | "end";
export type FloatingPosition = { top: number; left: number; side: "top" | "bottom" };

/** Margine dai bordi dello schermo: a 375 px restano 16 px per lato. */
export const FLOATING_MARGIN = 16;
/** Distanza tra il pulsante e il fumetto o il menu. */
export const FLOATING_GAP = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Posizione (fixed) di un fumetto vicino al suo pulsante: sotto se c'è posto, altrimenti dalla parte
 * con più spazio; sempre dentro lo schermo, con `margin` px dai bordi.
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { align = "start", margin = FLOATING_MARGIN, gap = FLOATING_GAP }: { align?: FloatingAlign; margin?: number; gap?: number } = {}
): FloatingPosition {
  const below = anchor.bottom + gap;
  const spaceBelow = viewport.height - margin - below;
  const spaceAbove = anchor.top - gap - margin;
  const side = size.height <= spaceBelow || spaceBelow >= spaceAbove ? "bottom" : "top";
  const top = side === "bottom" ? below : anchor.top - gap - size.height;
  const left =
    align === "end" ? anchor.right - size.width : align === "center" ? (anchor.left + anchor.right) / 2 - size.width / 2 : anchor.left;
  return {
    side,
    top: Math.round(clamp(top, margin, viewport.height - margin - size.height)),
    left: Math.round(clamp(left, margin, viewport.width - margin - size.width))
  };
}

/**
 * Voce del menu da mettere a fuoco dopo un tasto: frecce in giro continuo, Home/End agli estremi.
 * `current` -1 = nessuna voce ancora a fuoco. null = tasto che il menu non gestisce.
 */
export function menuIndexForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Voce attiva di un elenco a scelta (tendina) dopo un tasto: come un <select>, niente giro continuo e
 * le voci non disponibili si saltano. Frecce di una voce, Pagina su/giù di `page` voci, Home/End agli
 * estremi. `current` -1 = nessuna voce attiva. null = tasto che l'elenco non gestisce (o nessuna voce).
 */
export function listboxIndexForKey(key: string, current: number, disabled: readonly boolean[], page = 8): number | null {
  const count = disabled.length;
  const scan = (from: number, step: 1 | -1): number | null => {
    for (let index = from; index >= 0 && index < count; index += step) if (!disabled[index]) return index;
    return null;
  };
  if (key === "ArrowDown") return current < 0 ? scan(0, 1) : (scan(current + 1, 1) ?? current);
  if (key === "ArrowUp") return current < 0 ? scan(count - 1, -1) : (scan(current - 1, -1) ?? current);
  if (key === "Home") return scan(0, 1);
  if (key === "End") return scan(count - 1, -1);
  if (key === "PageDown" || key === "PageUp") {
    let index = current;
    for (let step = 0; step < page; step += 1) {
      const next = listboxIndexForKey(key === "PageDown" ? "ArrowDown" : "ArrowUp", index, disabled);
      if (next === null || next === index) break;
      index = next;
    }
    return index < 0 ? null : index;
  }
  return null;
}

const typeaheadText = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("it");

/**
 * Lettere scritte con l'elenco aperto: la prima voce disponibile che comincia così, dopo quella attiva
 * (in giro). Una lettera ripetuta («aaa») passa da una voce in «a» alla successiva; più lettere diverse
 * («an») restano sulla voce attiva finché va bene. Accenti e maiuscole non contano. null = nessuna.
 */
export function typeaheadIndex(labels: readonly string[], disabled: readonly boolean[], current: number, query: string): number | null {
  const typed = typeaheadText(query);
  if (!typed.trim() || !labels.length) return null;
  const repeated = [...typed].every((char) => char === typed[0]);
  const needle = repeated ? typed[0] : typed;
  const start = repeated ? current + 1 : Math.max(current, 0);
  for (let step = 0; step < labels.length; step += 1) {
    const index = (start + step) % labels.length;
    if (!disabled[index] && typeaheadText(labels[index]).startsWith(needle)) return index;
  }
  return null;
}
