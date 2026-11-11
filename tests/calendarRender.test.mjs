import test from "node:test";
import assert from "node:assert/strict";

const render = await import("../src/lib/calendarRender.ts");
const { CALENDAR_LAYOUT_TEXT } = await import("../src/lib/labels.ts");

// Date locali del dispositivo: i test valgono in ogni fuso (Roma, New York, UTC).
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts) => local(...parts).toISOString();
const timed = (id, from, to, extra = {}) => ({ id, occurrenceKey: id, start: iso(...from), end: iso(...to), ...extra });

/* ------------------------------------------------------------------ */
/* Griglia oraria: durata minima, colonne, pezzi del giorno             */
/* ------------------------------------------------------------------ */

test("minDurationMsFor: l'altezza minima del blocco diventa una durata", () => {
  // 20 px su un'ora di 60 px = 20 minuti; su 46 px circa 26 minuti.
  assert.equal(render.minDurationMsFor(60), 20 * 60_000);
  assert.equal(render.minDurationMsFor(46), Math.round((20 / 46) * 3_600_000));
  assert.equal(render.minDurationMsFor(60, 30), 30 * 60_000);
  assert.equal(render.MIN_EVENT_HEIGHT_PX, 20);
});

test("maxColumnsFor: quante colonne affiancate entrano in un giorno", () => {
  assert.equal(render.maxColumnsFor(280), 5, "telefono, vista Giorno");
  assert.equal(render.maxColumnsFor(124), 2, "computer, Settimana");
  assert.equal(render.maxColumnsFor(87), 1, "tablet, Settimana");
  assert.equal(render.maxColumnsFor(0), 1, "mai meno di una");
  assert.equal(render.maxColumnsFor(Number.NaN), 1);
});

test("dayPieces: solo eventi con orario, tagliati sul giorno", () => {
  const dayStart = local(2026, 12, 5).getTime();
  const dayEnd = local(2026, 12, 6).getTime();
  const items = [
    timed("lesson", [2026, 12, 5, 10], [2026, 12, 5, 12]),
    timed("night", [2026, 12, 4, 22], [2026, 12, 5, 2]),
    timed("trip", [2026, 12, 4], [2026, 12, 7], { allDay: true }),
    timed("point", [2026, 12, 5, 15], [2026, 12, 5, 15]),
    timed("midnight", [2026, 12, 5], [2026, 12, 5]),
    timed("other", [2026, 12, 6, 9], [2026, 12, 6, 10])
  ];
  const pieces = render.dayPieces(items, dayStart, dayEnd);
  assert.deepEqual(
    pieces.map((piece) => piece.item.id),
    ["lesson", "night", "point", "midnight"]
  );
  const night = pieces.find((piece) => piece.item.id === "night");
  assert.equal(night.startMs, dayStart, "il pezzo del secondo giorno parte da mezzanotte");
  assert.equal(night.endMs, local(2026, 12, 5, 2).getTime());
  assert.equal(night.offsetMs, 2 * 3_600_000, "quanto dell'evento sta prima di questo pezzo (per trascinarlo)");
  assert.equal(pieces.find((piece) => piece.item.id === "lesson").offsetMs, 0);
});

test("layoutTimedDay: tre eventi 15–16 affiancati dove c'è spazio, +N dove non c'è", () => {
  const items = [timed("a", [2026, 12, 5, 15], [2026, 12, 5, 16]), timed("b", [2026, 12, 5, 15], [2026, 12, 5, 16]), timed("c", [2026, 12, 5, 15], [2026, 12, 5, 16])];
  const pieces = render.dayPieces(items, local(2026, 12, 5).getTime(), local(2026, 12, 6).getTime());
  const wide = render.layoutTimedDay(pieces, { hourHeight: 52, columnWidth: 280 });
  assert.deepEqual(
    wide.placed.map(({ item, column, columns, narrowed }) => [item.id, column, columns, narrowed]),
    [
      ["a", 0, 3, false],
      ["b", 1, 3, false],
      ["c", 2, 3, false]
    ]
  );
  assert.deepEqual(wide.more, []);

  const narrow = render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 124 });
  assert.deepEqual(
    narrow.placed.map(({ item, column, columns, narrowed }) => [item.id, column, columns, narrowed]),
    [
      ["a", 0, 2, true],
      ["b", 1, 2, true]
    ]
  );
  assert.equal(narrow.more.length, 1);
  assert.equal(narrow.more[0].count, 1);
  assert.deepEqual(
    narrow.more[0].items.map((item) => item.id),
    ["a", "b", "c"],
    "il +N apre l'elenco di tutta la fascia"
  );
  assert.equal(narrow.more[0].startMs, local(2026, 12, 5, 15).getTime());
  assert.equal(CALENDAR_LAYOUT_TEXT.more(narrow.more[0].count), "+1");
});

test("layoutTimedDay: sovrapposizioni parziali e eventi isolati a tutta larghezza", () => {
  const items = [
    timed("A", [2026, 12, 5, 9], [2026, 12, 5, 11]),
    timed("B", [2026, 12, 5, 10], [2026, 12, 5, 12]),
    timed("C", [2026, 12, 5, 11, 30], [2026, 12, 5, 13]),
    timed("alone", [2026, 12, 5, 18], [2026, 12, 5, 19])
  ];
  const pieces = render.dayPieces(items, local(2026, 12, 5).getTime(), local(2026, 12, 6).getTime());
  const { placed, more } = render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 600 });
  const byId = Object.fromEntries(placed.map((entry) => [entry.item.id, [entry.column, entry.columns, entry.span]]));
  assert.deepEqual(byId, { A: [0, 2, 1], B: [1, 2, 1], C: [0, 2, 1], alone: [0, 1, 1] });
  assert.deepEqual(more, []);
});

test("layoutTimedDay: un evento cortissimo occupa l'altezza minima e si affianca al successivo", () => {
  // 10:00–10:05 è alto 20 px (26 minuti con ore da 46 px): l'evento delle 10:15 lo coprirebbe.
  const items = [timed("short", [2026, 12, 5, 10], [2026, 12, 5, 10, 5]), timed("next", [2026, 12, 5, 10, 15], [2026, 12, 5, 11])];
  const pieces = render.dayPieces(items, local(2026, 12, 5).getTime(), local(2026, 12, 6).getTime());
  assert.equal(render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 600 }).placed[1].columns, 2);
  // Con ore da 120 px l'altezza minima vale 10 minuti: non si toccano più.
  assert.equal(render.layoutTimedDay(pieces, { hourHeight: 120, columnWidth: 600 }).placed[1].columns, 1);
});
