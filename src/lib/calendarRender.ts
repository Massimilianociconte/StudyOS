// Calcoli puri per disegnare il calendario (niente React né DOM): cosa va nella griglia oraria e cosa
// nella fascia "tutto il giorno", pezzi di un giorno affiancati, barre su più giorni con un tetto di
// corsie, voci degli elenchi per giorno, festività, Attività senza data, colori e icone per tipologia.
import { collapseForWidth, eventDaySpan, layoutDayColumns, multiDaySegments, type DayRangeItem, type WeekSegment } from "./calendarLayout";
import { formatRangeField, todayYmd } from "./datePicker";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Altezza minima (px) di un evento nella griglia oraria: anche un evento di 5 minuti si deve leggere. */
export const MIN_EVENT_HEIGHT_PX = 20;
/** Larghezza minima (px) di una colonna di eventi affiancati: sotto, i successivi vanno nel "+N". */
export const MIN_EVENT_COLUMN_PX = 56;
/** Spazio (px) a destra di una fascia con il "+N". */
export const MORE_GUTTER_PX = 28;

/** Durata (ms) che occupa davvero un evento corto: l'altezza minima in px divisa per i px all'ora. */
export const minDurationMsFor = (hourHeight: number, minHeightPx = MIN_EVENT_HEIGHT_PX) => Math.round((minHeightPx / hourHeight) * HOUR_MS);

/** Quante colonne affiancate entrano in una colonna-giorno larga `width` px (almeno una). */
export const maxColumnsFor = (width: number, minColumnPx = MIN_EVENT_COLUMN_PX) =>
  Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width / minColumnPx)) : 1;

type Timed = { start: string; end: string; allDay?: boolean };

const msOf = (iso: string) => Date.parse(iso);

/**
 * L'evento va nella fascia "tutto il giorno" come barra: è di tutto il giorno, oppure ha un orario e
 * dura almeno 24 ore su più giorni (un congresso da venerdì a domenica). Un evento di qualche ora a
 * cavallo della mezzanotte resta nella griglia oraria, un pezzo per giorno.
 */
export function isBarEvent(item: Timed): boolean {
  if (item.allDay === true) return true;
  const start = msOf(item.start);
  const end = msOf(item.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end - start < DAY_MS) return false;
  const span = eventDaySpan(item);
  return Boolean(span && span.startDay !== span.endDay);
}

/** Giorni di una barra (ultimo compreso); null se l'evento non è una barra. `id` = chiave dell'occorrenza. */
export function barSource(item: Timed & { id: string; occurrenceKey?: string }): DayRangeItem | null {
  if (!isBarEvent(item)) return null;
  const span = eventDaySpan(item);
  return span ? { id: item.occurrenceKey ?? item.id, ...span } : null;
}

/** Pezzo di un evento con orario dentro un giorno; `offsetMs` = quanto dell'evento sta prima del pezzo. */
export type DayPiece<T> = { item: T; startMs: number; endMs: number; offsetMs: number };

/** Pezzi degli eventi con orario (non barre) che toccano il giorno [dayStartMs, dayEndMs), tagliati sul giorno. */
export function dayPieces<T extends Timed>(items: readonly T[], dayStartMs: number, dayEndMs: number): DayPiece<T>[] {
  const pieces: DayPiece<T>[] = [];
  for (const item of items) {
    if (isBarEvent(item)) continue;
    const start = msOf(item.start);
    const end = Math.max(msOf(item.end), start);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    // Un evento senza durata conta se comincia nel giorno; gli altri se lo toccano.
    const touches = start < dayEndMs && (end > dayStartMs || start >= dayStartMs);
    if (!touches) continue;
    const pieceStart = Math.max(start, dayStartMs);
    pieces.push({ item, startMs: pieceStart, endMs: Math.min(end, dayEndMs), offsetMs: pieceStart - start });
  }
  return pieces;
}

export type PlacedPiece<T> = DayPiece<T> & { key: string; column: number; columns: number; span: number; narrowed: boolean };
export type MoreBand<T> = { cluster: number; count: number; startMs: number; endMs: number; items: T[] };

/**
 * Eventi contemporanei affiancati (layoutDayColumns con l'altezza minima della griglia). Se una fascia
 * ha più colonne di quante ne entrano (`columnWidth`), restano le prime e il resto diventa un "+N" che
 * apre l'elenco di tutta la fascia; `narrowed` = la fascia lascia spazio a destra per il "+N".
 */
export function layoutTimedDay<T extends { occurrenceKey: string }>(
  pieces: readonly DayPiece<T>[],
  { hourHeight, columnWidth }: { hourHeight: number; columnWidth: number }
): { placed: PlacedPiece<T>[]; more: MoreBand<T>[] } {
  const byKey = new Map(pieces.map((piece) => [piece.item.occurrenceKey, piece]));
  const layout = layoutDayColumns(
    pieces.map((piece) => ({ id: piece.item.occurrenceKey, startMs: piece.startMs, endMs: piece.endMs })),
    { minDurationMs: minDurationMsFor(hourHeight) }
  );
  const { items, more } = collapseForWidth(layout, maxColumnsFor(columnWidth));
  const collapsed = new Set(more.map((group) => group.cluster));
  const placed = items.flatMap((entry) => {
    const piece = byKey.get(entry.id);
    return piece ? [{ ...piece, key: entry.id, column: entry.column, columns: entry.columns, span: entry.span, narrowed: collapsed.has(entry.cluster) }] : [];
  });
  return {
    placed,
    more: more.map((group) => ({
      cluster: group.cluster,
      count: group.count,
      startMs: group.startMs,
      endMs: group.endMs,
      items: group.bandIds.flatMap((id) => {
        const piece = byKey.get(id);
        return piece ? [piece.item] : [];
      })
    }))
  };
}

/* ------------------------------------------------------------------ */
/* Barre su più giorni (Settimana, Mese)                                */
/* ------------------------------------------------------------------ */

/** Lunedì (YYYY-MM-DD) di ogni riga-settimana di un elenco di giorni consecutivi che parte di lunedì. */
export const weekStartsOf = (days: readonly Date[]) => days.filter((_, index) => index % 7 === 0).map((day) => todayYmd(day));

export type LaneRow = { weekStart: string; segments: WeekSegment[]; lanes: number; hidden: number[] };

/**
 * Barre per riga-settimana con al più `cap` corsie: le barre oltre il tetto non si disegnano e ogni
 * giorno conta quante ne nasconde (`hidden`, lunedì … domenica) per il suo "+N".
 */
export function laneRows(items: readonly DayRangeItem[], weekStarts: readonly string[], cap: number): LaneRow[] {
  return multiDaySegments([...items], [...weekStarts]).map(({ weekStart, segments, lanes }) => {
    const hidden = [0, 0, 0, 0, 0, 0, 0];
    const visible: WeekSegment[] = [];
    for (const segment of segments) {
      if (segment.lane < cap) {
        visible.push(segment);
        continue;
      }
      for (let column = segment.startCol; column <= segment.endCol; column += 1) hidden[column] += 1;
    }
    return { weekStart, segments: visible, lanes: Math.min(lanes, cap), hidden };
  });
}

/** Voci del giorno (eventi con orario, esami, Attività) che una cella del Mese mostra sotto le barre. */
export const monthItemBudget = (visibleLanes: number, limit = 3) => Math.max(1, limit - visibleLanes);

/* ------------------------------------------------------------------ */
/* Elenchi per giorno (Agenda, Settimana sul telefono)                  */
/* ------------------------------------------------------------------ */

/**
 * Giorno (YYYY-MM-DD) in cui un elenco da `firstDay` a `lastDay` (compresi) mostra la voce: il suo primo
 * giorno, oppure `firstDay` se è cominciata prima. Una voce su più giorni compare una volta sola.
 */
export function listDayOf(item: Timed, firstDay: string, lastDay: string): string | null {
  const span = eventDaySpan(item);
  if (!span || span.endDay < firstDay || span.startDay > lastDay) return null;
  return span.startDay < firstDay ? firstDay : span.startDay;
}

/** "ven 4 – dom 6 dic" per una barra su più giorni; null per tutto il resto. */
export function spanText(item: Timed, today: string = todayYmd()): string | null {
  if (!isBarEvent(item)) return null;
  const span = eventDaySpan(item);
  if (!span || span.startDay === span.endDay) return null;
  return formatRangeField(span.startDay, span.endDay, today);
}
