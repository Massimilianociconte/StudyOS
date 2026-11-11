// Blocco dello scorrimento della pagina sotto finestre e pannelli: contatore annidabile, pila delle
// finestre aperte e calcoli puri. Il DOM vero sta in `useScrollLock` (src/components/ui.tsx).

/**
 * Contatore dei blocchi: il primo che entra blocca, l'ultimo che esce sblocca, così un selettore
 * aperto dentro il modulo evento non sblocca la pagina quando si chiude. Ogni rilascio vale una sola
 * volta (chiamarlo due volte non sblocca una finestra ancora aperta).
 */
export function createScrollLock(env: { lock: () => () => void }) {
  let count = 0;
  let restore: (() => void) | null = null;
  return {
    acquire(): () => void {
      if (count === 0) restore = env.lock();
      count += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count -= 1;
        if (count > 0) return;
        const done = restore;
        restore = null;
        done?.();
      };
    },
    get count() {
      return count;
    }
  };
}

/** Pila delle finestre aperte (dalla più vecchia alla più recente): Esc, Tab e tocco valgono per quella in cima. */
export function createLayerStack<T>() {
  const items: { token: symbol; value: T }[] = [];
  return {
    push(value: T): symbol {
      const token = Symbol("layer");
      items.push({ token, value });
      return token;
    },
    remove(token: symbol) {
      const index = items.findIndex((item) => item.token === token);
      if (index >= 0) items.splice(index, 1);
    },
    isTop(token: symbol) {
      return items.length > 0 && items[items.length - 1].token === token;
    },
    top(): T | undefined {
      return items[items.length - 1]?.value;
    },
    get size() {
      return items.length;
    }
  };
}

/** Larghezza della barra di scorrimento della pagina (0 sui telefoni, dove la barra è sovrapposta). */
export const scrollbarWidthOf = (innerWidth: number, clientWidth: number) => Math.max(0, Math.round(innerWidth - clientWidth));

/** Stili in linea (proprietà CSS in kebab-case); undefined = non toccare. */
export type InlineStyles = Record<string, string | undefined>;

/**
 * Stili del blocco. `html` non scorre (la posizione resta, i pezzi sticky restano dove sono) e niente
 * rimbalzo o "tira per aggiornare". `body` torna `visible`: con il suo `overflow-x: hidden` diventerebbe
 * lui il contenitore di scorrimento e intestazione e barra laterale sticky salterebbero. Sul computer
 * la barra di scorrimento sparisce: il margine destro la compensa, così la pagina non si allarga.
 */
export function lockStyles({ scrollbarWidth, bodyPaddingRight }: { scrollbarWidth: number; bodyPaddingRight: number }) {
  return {
    html: { overflow: "hidden", "overscroll-behavior": "none" } as InlineStyles,
    body: {
      overflow: "visible",
      "padding-right": scrollbarWidth > 0 ? `${Math.round(bodyPaddingRight + scrollbarWidth)}px` : undefined
    } as InlineStyles
  };
}

type StyleTarget = {
  style: {
    getPropertyValue: (name: string) => string;
    getPropertyPriority: (name: string) => string;
    setProperty: (name: string, value: string, priority?: string) => void;
    removeProperty: (name: string) => unknown;
  };
};

/** Applica gli stili in linea e restituisce la funzione che rimette esattamente quelli di prima. */
export function applyStyles(target: StyleTarget, styles: InlineStyles): () => void {
  const saved: { name: string; value: string; priority: string }[] = [];
  for (const [name, value] of Object.entries(styles)) {
    if (value === undefined) continue;
    saved.push({ name, value: target.style.getPropertyValue(name), priority: target.style.getPropertyPriority(name) });
    target.style.setProperty(name, value);
  }
  return () => {
    for (const { name, value, priority } of saved.reverse()) {
      if (value) target.style.setProperty(name, value, priority);
      else target.style.removeProperty(name);
    }
  };
}

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/**
 * Un elemento può scorrere nella direzione del gesto? `dx`/`dy`: spostamento del dito (dito verso
 * l'alto = dy negativo = il contenuto scende). Conta l'asse prevalente. Arrivati al bordo il gesto si
 * blocca, così al tocco (iOS compreso) non rimbalza né scorre la pagina sotto.
 */
export function canScrollToward(metrics: ScrollMetrics, dx: number, dy: number): boolean {
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy === 0) return false;
    return dy < 0 ? metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 1 : metrics.scrollTop > 0;
  }
  return dx < 0 ? metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - 1 : metrics.scrollLeft > 0;
}
