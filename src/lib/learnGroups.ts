// Raggruppamenti della sezione Ripasso, puri e testabili.
// - Mazzi per materia: il primo livello che si legge (la materia, con il suo segno), poi i mazzi e
//   i sotto-mazzi. Le sole rientranze non bastavano a far capire chi sta dentro chi.
// - Quiz divisi in parti: due quiz dello stesso mazzo, o con «1 di 2» / «Parte 2» nel titolo, sono
//   le parti di un quiz più grande e si mostrano insieme, con il titolo accorciato a ciò che li
//   distingue («Simulazione 1 di 2»).
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
