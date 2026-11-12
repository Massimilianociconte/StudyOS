// Etichette sugli elementi (attività, materiali, note, eventi): aggiungere e togliere senza doppioni e il
// riepilogo di studyos_list_tags. Le etichette sono testi (BaseEntity.tags), maiuscole ignorate nel confronto.
export type TaggableType = "task" | "material" | "note" | "event";

const MAX_TAGS_PER_ITEM = 30;
const key = (tag: string) => tag.toLocaleLowerCase("it");

/** Spazi ridotti, al massimo 40 caratteri. */
export const cleanTag = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 40);

/** Tolte quelle di `remove`, aggiunte in coda quelle nuove di `add`. */
export const retag = (tags: readonly string[], add: readonly string[], remove: readonly string[]) => {
  const drop = new Set(remove.map((tag) => key(cleanTag(tag))));
  const next = tags.filter((tag) => !drop.has(key(tag)));
  for (const raw of add) {
    const tag = cleanTag(raw);
    if (tag && !next.some((item) => key(item) === key(tag))) next.push(tag);
  }
  return next.slice(0, MAX_TAGS_PER_ITEM);
};

export interface TagCount {
  label: string;
  count: number;
  byType: Record<string, number>;
}

/** Ogni etichetta usata dagli elementi non archiviati, con quanti per tipo: dalla più usata. */
export const tagSummary = (collections: Record<string, ReadonlyArray<{ tags?: readonly string[]; archived?: boolean }>>): TagCount[] => {
  const counts = new Map<string, TagCount>();
  for (const [type, items] of Object.entries(collections)) {
    for (const item of items) {
      if (item.archived) continue;
      for (const raw of item.tags ?? []) {
        const label = cleanTag(raw);
        if (!label) continue;
        const entry = counts.get(key(label)) ?? { label, count: 0, byType: {} };
        entry.count += 1;
        entry.byType[type] = (entry.byType[type] ?? 0) + 1;
        counts.set(key(label), entry);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "it"));
};
