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
