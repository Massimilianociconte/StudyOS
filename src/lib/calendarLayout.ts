// Calcoli puri delle griglie del calendario (niente React): eventi contemporanei affiancati in colonne
// nella griglia oraria, "+N" sugli schermi stretti, barre degli eventi su più giorni in Settimana e Mese.
import { addDays, daysInclusive, todayYmd } from "./datePicker";

export type TimedItem = { id: string; startMs: number; endMs: number };

/**
 * Posto di un evento nella colonna del giorno: `column` (0 = a sinistra) su `columns` colonne del suo
 * gruppo di sovrapposizione (`cluster`), largo `span` colonne. Larghezza = span / columns, sinistra =
 * column / columns; altezza e posizione restano quelle dell'orario (`startMs`, `endMs`).
 */
export type DayColumn = TimedItem & { column: number; columns: number; span: number; cluster: number };

type Entry = { item: TimedItem; index: number; start: number; end: number };

const overlaps = (a: Entry, b: Entry) => a.start < b.end && b.start < a.end;

/**
 * Eventi contemporanei affiancati. Gruppi di sovrapposizione (anche a catena); colonne assegnate in
 * ordine di inizio, a parità il più lungo prima, nella prima colonna libera; poi ogni evento si allarga
 * verso destra finché la colonna accanto è libera per tutta la sua durata. Gli eventi che non si
 * sovrappongono restano a tutta larghezza; 10–11 e 11–12 si toccano ma non si sovrappongono.
 * `minDurationMs` (predefinito 30 minuti): un evento più corto, o senza durata, conta come se durasse
 * tanto, perché nella griglia ha comunque un'altezza minima e altrimenti coprirebbe il successivo;
 * la vista passa il suo valore (altezza minima in px / px al minuto).
 */
export function layoutDayColumns(items: TimedItem[], { minDurationMs = 30 * 60_000 }: { minDurationMs?: number } = {}): DayColumn[] {
  const entries: Entry[] = items.map((item, index) => {
    const end = Math.max(item.endMs, item.startMs);
    return { item, index, start: item.startMs, end: Math.max(end, item.startMs + minDurationMs) };
  });
  const sorted = [...entries].sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);
  const result: DayColumn[] = new Array(items.length);
  let cluster: Entry[] = [];
  let clusterEnd = -Infinity;
  let clusterIndex = -1;

  const flush = () => {
    if (!cluster.length) return;
    clusterIndex += 1;
    const columnEnds: number[] = [];
    const placed = cluster.map((entry) => {
      let column = columnEnds.findIndex((end) => end <= entry.start);
      if (column < 0) column = columnEnds.push(entry.end) - 1;
      else columnEnds[column] = entry.end;
      return { entry, column };
    });
    for (const { entry, column } of placed) {
      let span = 1;
      while (column + span < columnEnds.length && !placed.some((other) => other.column === column + span && overlaps(other.entry, entry))) span += 1;
      const { id, startMs, endMs } = entry.item;
      result[entry.index] = { id, startMs, endMs, column, columns: columnEnds.length, span, cluster: clusterIndex };
    }
    cluster = [];
  };

  for (const entry of sorted) {
    if (entry.start >= clusterEnd) {
      flush();
      clusterEnd = entry.end;
    } else {
      clusterEnd = Math.max(clusterEnd, entry.end);
    }
    cluster.push(entry);
  }
  flush();
  return result;
}

/** "+N" di una fascia: `ids` nascosti, `bandIds` tutti gli eventi della fascia (l'elenco che il "+N" apre). */
export type MoreGroup = { cluster: number; ids: string[]; bandIds: string[]; count: number; startMs: number; endMs: number };

/**
 * Schermi stretti: nei gruppi con più di `maxColumns` colonne restano le prime `visibleColumns`
 * (predefinito `maxColumns`, 0 = nessuna; larghezze ricalcolate su quelle) e il resto diventa un "+N"
 * per la fascia, da mettere a `startMs`–`endMs`.
 */
export function collapseForWidth(layout: DayColumn[], maxColumns: number, visibleColumns: number = maxColumns): { items: DayColumn[]; more: MoreGroup[] } {
  const max = Math.max(1, Math.floor(maxColumns));
  const visible = Math.max(0, Math.min(max, Math.floor(visibleColumns)));
  const items: DayColumn[] = [];
  const groups = new Map<number, MoreGroup>();
  for (const item of layout) {
    if (item.columns <= max) {
      items.push(item);
      continue;
    }
    const group = groups.get(item.cluster) ?? { cluster: item.cluster, ids: [], bandIds: [], count: 0, startMs: Infinity, endMs: -Infinity };
    groups.set(item.cluster, group);
    group.bandIds.push(item.id);
    group.startMs = Math.min(group.startMs, item.startMs);
    group.endMs = Math.max(group.endMs, item.endMs);
    if (item.column < visible) items.push({ ...item, columns: visible, span: Math.min(item.span, visible - item.column) });
    else group.ids.push(item.id);
  }
  return { items, more: [...groups.values()].map((group) => ({ ...group, count: group.ids.length })) };
}

/** Evento su uno o più giorni: primo e ultimo giorno "YYYY-MM-DD", ultimo compreso. */
export type DayRangeItem = { id: string; startDay: string; endDay: string };

/**
 * Pezzo di barra in una riga-settimana: colonne 0 (lunedì) … 6 (domenica) comprese, corsia (`lane`, 0 in
 * alto) e se la barra continua dalla settimana prima o nella successiva (bordo senza angolo arrotondato).
 */
export type WeekSegment = { id: string; startCol: number; endCol: number; lane: number; continuesBefore: boolean; continuesAfter: boolean };

/**
 * Barre continue degli eventi su più giorni per ogni settimana mostrata (`weekStarts`: lunedì
 * "YYYY-MM-DD"). Nel Mese una barra si spezza solo al cambio di riga, come Google. Corsie riempite
 * dall'alto: prima chi comincia prima, a parità il più lungo; due barre nella stessa corsia non si
 * toccano mai. Fine prima dell'inizio = un giorno solo.
 */
export function multiDaySegments(items: DayRangeItem[], weekStarts: string[]): { weekStart: string; segments: WeekSegment[]; lanes: number }[] {
  return weekStarts.map((weekStart) => {
    const weekEnd = addDays(weekStart, 6);
    const pieces = items.flatMap((item, index) => {
      const start = item.startDay;
      const end = item.endDay >= item.startDay ? item.endDay : item.startDay;
      if (end < weekStart || start > weekEnd) return [];
      return [
        {
          index,
          id: item.id,
          startCol: daysInclusive(weekStart, start < weekStart ? weekStart : start) - 1,
          endCol: daysInclusive(weekStart, end > weekEnd ? weekEnd : end) - 1,
          continuesBefore: start < weekStart,
          continuesAfter: end > weekEnd,
          total: daysInclusive(start, end)
        }
      ];
    });
    pieces.sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol) || b.total - a.total || a.index - b.index);
    const laneEnds: number[] = [];
    const segments = pieces.map(({ id, startCol, endCol, continuesBefore, continuesAfter }) => {
      let lane = laneEnds.findIndex((end) => end < startCol);
      if (lane < 0) lane = laneEnds.push(endCol) - 1;
      else laneEnds[lane] = endCol;
      return { id, startCol, endCol, lane, continuesBefore, continuesAfter };
    });
    return { weekStart, segments, lanes: laneEnds.length };
  });
}

/**
 * Giorni (ora locale) toccati da un evento salvato con `start`/`end` ISO. La fine è esclusiva: un evento
 * di tutto il giorno salvato come [inizio, mezzanotte dopo) è un giorno solo, e un evento che finisce
 * a mezzanotte non tocca il giorno dopo. null se l'inizio non è una data.
 */
export function eventDaySpan({ start, end }: { start: string; end?: string; allDay?: boolean }): { startDay: string; endDay: string } | null {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return null;
  const startDay = todayYmd(from);
  const to = end ? new Date(end) : from;
  if (Number.isNaN(to.getTime()) || to.getTime() <= from.getTime()) return { startDay, endDay: startDay };
  const endDay = todayYmd(new Date(to.getTime() - 1));
  return { startDay, endDay: endDay < startDay ? startDay : endDay };
}

/** Posizione di `day` dentro un evento su più giorni ("giorno 2 di 3"); null se il giorno è fuori. */
export function dayOfSpan(day: string, startDay: string, endDay: string): { index: number; total: number } | null {
  if (day < startDay || day > endDay) return null;
  return { index: daysInclusive(startDay, day), total: daysInclusive(startDay, endDay) };
}
