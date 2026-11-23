// Raggruppamenti della sezione Ripasso, puri e testabili.
// - Mazzi per materia: il primo livello che si legge (la materia, con il suo segno), poi i mazzi e
//   i sotto-mazzi. Le sole rientranze non bastavano a far capire chi sta dentro chi.
// - Quiz come i mazzi: un mazzo con due o più quiz (anche nei suoi sotto-mazzi) è un quiz in parti,
//   una riga sola che si apre sulle parti; un mazzo con un quiz solo mostra direttamente quel quiz.
//   Senza mazzo valgono «1 di 2» / «Parte 2» nel titolo. Le parti hanno il titolo accorciato a ciò
//   che le distingue («Simulazione 1 di 2», «Cervelletto e circuiti cerebellari»).
import type { DeckNode } from "./learnSession";

export interface DeckGroup {
  /** Id della materia, "none" o "owner:<id>" per i mazzi condivisi da un'altra persona. */
  key: string;
  label: string;
  subjectId?: string;
  ownerId?: string;
  nodes: DeckNode[];
  cards: number;
  due: number;
  fresh: number;
}

export interface DeckGroupOptions {
  subjectName: (subjectId: string) => string | undefined;
  /** Persona che condivide il mazzo (assente = tuo). */
  ownerOf: (deckId: string) => { id: string; name: string } | undefined;
  noSubject: string;
  sharedBy: (name: string) => string;
}

/** Radici dell'albero divise per materia: prima le materie (in ordine alfabetico), poi «Senza materia», poi chi condivide. */
export const groupDeckNodes = (nodes: readonly DeckNode[], options: DeckGroupOptions): DeckGroup[] => {
  const map = new Map<string, DeckGroup>();
  for (const node of nodes) {
    const owner = options.ownerOf(node.deck.id);
    const subjectId = owner ? undefined : node.deck.subjectId;
    const subjectLabel = subjectId ? options.subjectName(subjectId) : undefined;
    const key = owner ? `owner:${owner.id}` : subjectLabel ? (subjectId as string) : "none";
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: owner ? options.sharedBy(owner.name) : (subjectLabel ?? options.noSubject),
        ...(subjectLabel ? { subjectId } : {}),
        ...(owner ? { ownerId: owner.id } : {}),
        nodes: [],
        cards: 0,
        due: 0,
        fresh: 0
      };
      map.set(key, group);
    }
    group.nodes.push(node);
    group.cards += node.counts.cards;
    group.due += node.counts.due;
    group.fresh += node.counts.fresh;
  }
  const rank = (key: string) => (key.startsWith("owner:") ? 2 : key === "none" ? 1 : 0);
  return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "it"));
};

/** Albero ridotto ai mazzi con qualcosa da fare oggi (in ritardo, da ripassare o mai studiate). */
export const pruneToTodo = (nodes: readonly DeckNode[]): DeckNode[] =>
  nodes.filter((node) => node.counts.due + node.counts.fresh > 0).map((node) => ({ ...node, children: pruneToTodo(node.children) }));

// ─── Quiz in parti ─────────────────────────────────────────────────────────────────────

/** «Simulazione 1 di 2», «Parte 2», «(1/2)», «blocco 3 su 4». */
const PART = /(?:\b(?:parte|simulazione|blocco|tranche|sezione|modulo|set)\s*\d+(?:\s*(?:di|su|\/)\s*\d+)?|\b\d+\s*(?:di|su|\/)\s*\d+)\b/i;
/** «(50 domande)», «(50 quesiti)»: il numero di domande della parte, non il nome del quiz. */
const SIZE = /\(\s*\d+\s*(?:domande|quesiti|affermazioni|v\/f)\s*\)/gi;
const SEPARATORS = [" — ", " – ", " - ", ": ", " · "];

/** Il nome comune delle parti: senza «Parte 2», «1 di 2», «(50 domande)» e le parentesi rimaste vuote. */
const commonName = (title: string) =>
  title
    .replace(SIZE, " ")
    .replace(PART, " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/[\s—–\-:·,(]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

const baseOf = (title: string) => commonName(title).toLowerCase();

const upperFirst = (text: string) => (text ? text[0].toLocaleUpperCase("it") + text.slice(1) : text);

/**
 * Titoli delle parti senza l'inizio che hanno in comune, tagliato a un separatore («Vero/Falso
 * avanzato — Simulazione 1 di 2» → «Simulazione 1 di 2»). Senza un separatore comune restano interi.
 */
export const partTitles = (titles: readonly string[]): string[] => {
  if (titles.length < 2) return [...titles];
  let prefix = titles[0];
  for (const title of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < title.length && prefix[i] === title[i]) i++;
    prefix = prefix.slice(0, i);
  }
  let cut = -1;
  let size = 0;
  for (const separator of SEPARATORS) {
    const at = prefix.lastIndexOf(separator);
    if (at > cut) {
      cut = at;
      size = separator.length;
    }
  }
  if (cut <= 0) return [...titles];
  const rest = titles.map((title) => upperFirst(title.slice(cut + size).trim()));
  return rest.every(Boolean) ? rest : [...titles];
};

export interface QuizLike {
  id: string;
  title: string;
  deckId?: string;
}

export type QuizBlock<T> = { kind: "single"; item: T } | { kind: "parts"; key: string; title: string; items: T[]; titles: string[] };

/**
 * Quiz in blocchi: un quiz da solo, o le parti di uno più grande. Sono parti i quiz dello stesso
 * mazzo (almeno due) e, tra gli altri, quelli con «1 di 2», «Parte 2»… e lo stesso titolo per il
 * resto. Il gruppo prende il posto della sua prima parte; il titolo è quello del mazzo, altrimenti
 * il titolo comune.
 */
export const quizBlocks = <T>(items: readonly T[], quizOf: (item: T) => QuizLike, deckTitle: (deckId: string) => string | undefined): QuizBlock<T>[] => {
  const byDeck = new Map<string, T[]>();
  for (const item of items) {
    const deckId = quizOf(item).deckId;
    if (deckId) byDeck.set(deckId, [...(byDeck.get(deckId) ?? []), item]);
  }
  const keyOf = new Map<T, string>();
  const members = new Map<string, T[]>();
  const titleOf = new Map<string, string>();
  for (const [deckId, group] of byDeck) {
    if (group.length < 2) continue;
    const key = `deck:${deckId}`;
    for (const item of group) keyOf.set(item, key);
    members.set(key, group);
    titleOf.set(key, deckTitle(deckId) ?? "");
  }
  const byBase = new Map<string, T[]>();
  for (const item of items) {
    if (keyOf.has(item)) continue;
    const title = quizOf(item).title;
    if (!PART.test(title)) continue;
    const base = baseOf(title);
    if (base) byBase.set(base, [...(byBase.get(base) ?? []), item]);
  }
  for (const [base, group] of byBase) {
    if (group.length < 2) continue;
    const key = `title:${base}`;
    for (const item of group) keyOf.set(item, key);
    members.set(key, group);
    titleOf.set(key, commonName(quizOf(group[0]).title));
  }
  const out: QuizBlock<T>[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = keyOf.get(item);
    if (!key) {
      out.push({ kind: "single", item });
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    const group = members.get(key) as T[];
    const titles = partTitles(group.map((member) => quizOf(member).title));
    out.push({ kind: "parts", key, title: titleOf.get(key) || quizOf(group[0]).title, items: group, titles });
  }
  return out;
};

// ─── Quiz come i mazzi ─────────────────────────────────────────────────────────────────

/** «· 30 domande», «- 30 quesiti», «(30 domande)» in fondo al titolo: il numero si legge già accanto. */
const TRAILING_SIZE = /\s*(?:[·•—–\-:,|]\s*)?\(?\s*\d+\s*(?:domande|quesiti|affermazioni|v\/f)\s*\)?\s*$/i;

/** Titolo di una parte senza il numero di domande in fondo (resta intero se non avanza nulla). */
export const shortPartTitle = (title: string) => {
  const out = title.replace(TRAILING_SIZE, "").trim();
  return out || title;
};

export interface DeckLike {
  id: string;
  title: string;
  parentId?: string;
  position: number;
  createdAt: string;
}

export type QuizNode<T> =
  /** Un quiz: `title` è accorciato quando sta tra le parti di un quiz più grande. */
  | { kind: "quiz"; item: T; title: string }
  /** Quiz in parti: un mazzo (o un nome comune) con almeno due quiz; `items` sono tutte le parti, in ordine. */
  | { kind: "set"; key: string; title: string; deckId?: string; children: QuizNode<T>[]; items: T[] };

/** Tutti i quiz di un ramo, nell'ordine in cui si leggono. */
export const quizNodeItems = <T>(nodes: readonly QuizNode<T>[]): T[] => nodes.flatMap((node) => (node.kind === "quiz" ? [node.item] : node.items));

const byDeckOrder = (a: DeckLike, b: DeckLike) => a.position - b.position || a.title.localeCompare(b.title, "it") || a.createdAt.localeCompare(b.createdAt);

/** Titoli delle parti sorelle: via l'inizio comune e il numero di domande in fondo. */
const shortenSiblings = <T>(nodes: QuizNode<T>[]): QuizNode<T>[] => {
  const quizzes = nodes.filter((node): node is Extract<QuizNode<T>, { kind: "quiz" }> => node.kind === "quiz");
  const short = partTitles(quizzes.map((node) => node.title)).map(shortPartTitle);
  return nodes.map((node) => (node.kind === "quiz" ? { ...node, title: short[quizzes.indexOf(node)] } : node));
};

/**
 * I quiz con la forma dei mazzi di flashcard: per ogni mazzo principale (in ordine di mazzo) una riga.
 * Un mazzo con un solo quiz, contando i sotto-mazzi, è quel quiz; con due o più è un quiz in parti
 * (`set`), le cui parti sono i quiz del mazzo e, per ogni sotto-mazzo, il suo quiz o un altro quiz in
 * parti. I quiz senza mazzo (o con un mazzo sparito) vengono dopo, raggruppati con «1 di 2», «Parte 2».
 * `items` arrivano già nell'ordine dei quiz (posizione): dentro un mazzo restano in quell'ordine.
 */
export const quizTree = <T>(items: readonly T[], quizOf: (item: T) => QuizLike, decks: readonly DeckLike[]): QuizNode<T>[] => {
  const deckById = new Map(decks.map((deck) => [deck.id, deck]));
  const direct = new Map<string, T[]>();
  const loose: T[] = [];
  for (const item of items) {
    const deckId = quizOf(item).deckId;
    if (deckId && deckById.has(deckId)) direct.set(deckId, [...(direct.get(deckId) ?? []), item]);
    else loose.push(item);
  }
  // Figli di ogni mazzo; un mazzo con la madre sparita è un mazzo principale.
  const children = new Map<string, DeckLike[]>();
  const roots: DeckLike[] = [];
  for (const deck of decks) {
    if (deck.parentId && deckById.has(deck.parentId) && deck.parentId !== deck.id) children.set(deck.parentId, [...(children.get(deck.parentId) ?? []), deck]);
    else roots.push(deck);
  }
  for (const list of children.values()) list.sort(byDeckOrder);
  roots.sort(byDeckOrder);

  const seen = new Set<string>();
  // Contenuto di un mazzo: prima i suoi quiz, poi un nodo per ogni sotto-mazzo che ne ha (i cicli si fermano).
  const content = (deck: DeckLike): QuizNode<T>[] => {
    seen.add(deck.id);
    const nodes: QuizNode<T>[] = (direct.get(deck.id) ?? []).map((item) => ({ kind: "quiz", item, title: quizOf(item).title }));
    for (const child of children.get(deck.id) ?? []) {
      if (seen.has(child.id)) continue;
      const node = nodeOf(child);
      if (node) nodes.push(node);
    }
    return shortenSiblings(nodes);
  };
  // Un mazzo come riga: niente se non ha quiz, il quiz se ne ha uno, altrimenti un quiz in parti.
  const nodeOf = (deck: DeckLike): QuizNode<T> | null => {
    const inside = content(deck);
    const all = quizNodeItems(inside);
    if (!all.length) return null;
    if (all.length === 1) return { kind: "quiz", item: all[0], title: quizOf(all[0]).title };
    return { kind: "set", key: `deck:${deck.id}`, title: deck.title, deckId: deck.id, children: inside, items: all };
  };

  const out: QuizNode<T>[] = [];
  for (const root of roots) {
    if (seen.has(root.id)) continue;
    const node = nodeOf(root);
    if (node) out.push(node);
  }
  // Mazzi in un ciclo (nessuno è principale): ognuno come riga a sé, così nessun quiz sparisce.
  for (const deck of [...decks].sort(byDeckOrder)) {
    if (seen.has(deck.id) || !direct.has(deck.id)) continue;
    const node = nodeOf(deck);
    if (node) out.push(node);
  }
  const blocks = quizBlocks(loose, (item) => ({ ...quizOf(item), deckId: undefined }), () => undefined);
  for (const block of blocks) {
    if (block.kind === "single") out.push({ kind: "quiz", item: block.item, title: quizOf(block.item).title });
    else
      out.push({
        kind: "set",
        key: block.key,
        title: block.title,
        children: block.items.map((item, index) => ({ kind: "quiz", item, title: shortPartTitle(block.titles[index]) })),
        items: block.items
      });
  }
  return out;
};
