// Ordine delle materie nella sezione Materie: il proprio (trascinando in «Riordina») o un criterio
// (esame più vicino, nome, CFU, avanzamento). Logica pura (node --test); la scelta e l'ordine stanno
// nelle preferenze dell'account (`subjectSort`, `subjectOrder`), quindi seguono la persona su ogni
// dispositivo.

export type SubjectSort = "custom" | "exam" | "name" | "cfu-desc" | "cfu-asc" | "progress";

export const SUBJECT_SORTS: readonly SubjectSort[] = ["custom", "exam", "name", "cfu-desc", "cfu-asc", "progress"];

/** Senza una scelta salvata: l'ordine proprio, che per chi non ha mai riordinato è quello di creazione. */
export const DEFAULT_SUBJECT_SORT: SubjectSort = "custom";

/** Valore arrivato dalla sincronizzazione: un criterio sconosciuto torna a quello predefinito. */
export const validSubjectSort = (value: unknown): SubjectSort =>
  typeof value === "string" && (SUBJECT_SORTS as readonly string[]).includes(value) ? (value as SubjectSort) : DEFAULT_SUBJECT_SORT;

/** Ordine salvato: solo id testuali, senza ripetizioni (al massimo 500). */
export const validSubjectOrder = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 120))].slice(0, 500) : [];

interface SortableSubject {
  id: string;
  name: string;
  cfu: number;
}

/** Chiave d'esame per un esame con la data da decidere: dopo gli esami con una data, prima delle materie senza esame. */
export const EXAM_DATE_LATER = "9999-12-31";

export interface SubjectSortKeys {
  /** Ordine proprio (id); le materie che non ci sono vanno in fondo, nell'ordine in cui arrivano. */
  order?: readonly string[];
  /** Data del prossimo esame da preparare (YYYY-MM-DD o ISO), se c'è. */
  examDate?: (subjectId: string) => string | undefined;
  /** Avanzamento 0–100 (preparazione dell'esame o attività); null = niente da misurare. */
  progress?: (subjectId: string) => number | null;
}

const byName = (a: SortableSubject, b: SortableSubject) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true });

/** Le materie ordinate secondo `mode`; a parità decide il nome. Non cambia l'array ricevuto. */
export const sortSubjects = <S extends SortableSubject>(subjects: readonly S[], mode: SubjectSort, keys: SubjectSortKeys = {}): S[] => {
  const list = [...subjects];
  switch (mode) {
    case "name":
      return list.sort(byName);
    case "cfu-desc":
      return list.sort((a, b) => (b.cfu || 0) - (a.cfu || 0) || byName(a, b));
    case "cfu-asc":
      return list.sort((a, b) => (a.cfu || 0) - (b.cfu || 0) || byName(a, b));
    case "exam": {
      // Prima l'esame più vicino; senza esame in fondo, per nome.
      const date = (subject: S) => keys.examDate?.(subject.id) ?? "";
      return list.sort((a, b) => {
        const da = date(a);
        const db = date(b);
        if (da && db) return da.localeCompare(db) || byName(a, b);
        if (da || db) return da ? -1 : 1;
        return byName(a, b);
      });
    }
    case "progress": {
      // Prima le meno avanzate (quelle su cui lavorare); senza misura in fondo.
      const value = (subject: S) => keys.progress?.(subject.id) ?? null;
      return list.sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (va !== null && vb !== null) return va - vb || byName(a, b);
        if (va !== null || vb !== null) return va !== null ? -1 : 1;
        return byName(a, b);
      });
    }
    case "custom": {
      const position = new Map((keys.order ?? []).map((id, index) => [id, index]));
      // sort è stabile: chi non è nell'ordine resta in fondo nell'ordine di arrivo.
      return list.sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    }
  }
};

/** Sposta `id` alla posizione `to` (limitata all'elenco). Stesso array se non cambia niente. */
export const moveInList = (ids: readonly string[], id: string, to: number): readonly string[] => {
  const from = ids.indexOf(id);
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (from < 0 || from === target) return ids;
  const next = ids.filter((item) => item !== id);
  next.splice(target, 0, id);
  return next;
};

/**
 * Ordine completo da salvare dopo aver riordinato solo una parte delle materie (quelle in corso): le
 * altre (superate, archiviate) tengono il loro posto, le riordinate prendono i posti che occupavano.
 * `current` è l'ordine di tutte le materie com'è adesso.
 */
export const mergeSubsetOrder = (current: readonly string[], subset: readonly string[]): string[] => {
  const inSubset = new Set(subset);
  const queue = [...subset];
  const merged = current.map((id) => (inSubset.has(id) ? (queue.shift() as string) : id));
  // Materie riordinate che non erano ancora nell'ordine (appena create): in fondo.
  return [...merged, ...queue];
};
