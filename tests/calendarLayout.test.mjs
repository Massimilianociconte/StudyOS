import test from "node:test";
import assert from "node:assert/strict";

const { layoutDayColumns, collapseForWidth, multiDaySegments, eventDaySpan, dayOfSpan } = await import("../src/lib/calendarLayout.ts");
const { CALENDAR_LAYOUT_TEXT } = await import("../src/lib/labels/calendar.ts");

const at = (hours, minutes = 0) => Date.UTC(2026, 10, 12, hours, minutes);
const ev = (id, from, to) => ({ id, startMs: at(...from), endMs: at(...to) });
const byId = (layout) => Object.fromEntries(layout.map(({ id, column, columns, span }) => [id, { column, columns, span }]));

test("layoutDayColumns: tre eventi alla stessa ora stanno su tre colonne", () => {
  const layout = layoutDayColumns([ev("a", [15], [16]), ev("b", [15], [16]), ev("c", [15], [16])]);
  assert.deepEqual(byId(layout), {
    a: { column: 0, columns: 3, span: 1 },
    b: { column: 1, columns: 3, span: 1 },
    c: { column: 2, columns: 3, span: 1 }
  });
  assert.deepEqual(
    layout.map((item) => item.id),
    ["a", "b", "c"],
    "stesso ordine dell'elenco ricevuto"
  );
});

test("layoutDayColumns: gli eventi che non si toccano restano a tutta larghezza", () => {
  const layout = byId(layoutDayColumns([ev("morning", [9], [10]), ev("late", [11], [12])]));
  assert.deepEqual(layout.morning, { column: 0, columns: 1, span: 1 });
  assert.deepEqual(layout.late, { column: 0, columns: 1, span: 1 });
});

test("layoutDayColumns: 10–11 e 11–12 si toccano ma non si sovrappongono", () => {
  const layout = layoutDayColumns([ev("first", [10], [11]), ev("second", [11], [12])], { minDurationMs: 0 });
  assert.deepEqual(byId(layout).second, { column: 0, columns: 1, span: 1 });
  assert.notEqual(layout[0].cluster, layout[1].cluster);
});

test("layoutDayColumns: catena parziale A 9–11, B 10–12, C 11:30–13", () => {
  const layout = byId(layoutDayColumns([ev("A", [9], [11]), ev("B", [10], [12]), ev("C", [11, 30], [13])]));
  assert.deepEqual(layout.A, { column: 0, columns: 2, span: 1 });
  assert.deepEqual(layout.B, { column: 1, columns: 2, span: 1 });
  // C torna nella prima colonna (A è finito): metà larghezza solo perché B la occupa ancora.
  assert.deepEqual(layout.C, { column: 0, columns: 2, span: 1 });
});

test("layoutDayColumns: un evento si allarga verso destra sulle colonne libere", () => {
  // A 9–11, B 9:30–10:30, D 10–10:45 riempiono tre colonne; C 10:45–12 si sovrappone solo ad A.
  const layout = byId(
    layoutDayColumns([ev("A", [9], [11]), ev("B", [9, 30], [10, 30]), ev("D", [10], [10, 45]), ev("C", [10, 45], [12])], { minDurationMs: 0 })
  );
  assert.deepEqual(layout.A, { column: 0, columns: 3, span: 1 });
  assert.deepEqual(layout.B, { column: 1, columns: 3, span: 1 });
  assert.deepEqual(layout.D, { column: 2, columns: 3, span: 1 });
  assert.deepEqual(layout.C, { column: 1, columns: 3, span: 2 }, "C prende due terzi, non un terzo");
});

test("layoutDayColumns: a parità di inizio il più lungo va a sinistra", () => {
  const layout = byId(layoutDayColumns([ev("short", [9], [10]), ev("long", [9], [12])]));
  assert.equal(layout.long.column, 0);
  assert.equal(layout.short.column, 1);
});

test("layoutDayColumns: eventi senza durata occupano almeno minDurationMs", () => {
  const point = ev("point", [10], [10]);
  // Alle 10 c'è anche un'ora intera: si vedrebbero uno sopra l'altro, quindi affiancati.
  assert.equal(byId(layoutDayColumns([point, ev("hour", [10], [11])])).point.columns, 2);
  // Alle 11, quando l'ora è appena finita: si toccano soltanto.
  assert.equal(byId(layoutDayColumns([ev("hour", [10], [11]), ev("point", [11], [11])])).point.columns, 1);
  // Due eventi istantanei alla stessa ora: affiancati.
  assert.equal(byId(layoutDayColumns([point, ev("other", [10], [10])])).other.column, 1);
  // Fine prima dell'inizio (dato rovinato): trattato come istantaneo, nessun errore.
  assert.deepEqual(byId(layoutDayColumns([ev("broken", [12], [11])])).broken, { column: 0, columns: 1, span: 1 });
  // Durata minima predefinita: 30 minuti (un evento di 10 minuti alle 10 e uno alle 10:20 si affiancano).
  assert.equal(byId(layoutDayColumns([ev("ten", [10], [10, 10]), ev("next", [10, 20], [11])])).next.columns, 2);
});

test("collapseForWidth: oltre 2 colonne le prime due più un +N per la fascia", () => {
  const layout = layoutDayColumns([ev("a", [15], [16]), ev("b", [15], [16]), ev("c", [15], [16]), ev("alone", [18], [19])]);
  const collapsed = collapseForWidth(layout, 2);
  assert.deepEqual(
    collapsed.items.map(({ id, column, columns, span }) => [id, column, columns, span]),
    [
      ["a", 0, 2, 1],
      ["b", 1, 2, 1],
      ["alone", 0, 1, 1]
    ]
  );
  assert.equal(collapsed.more.length, 1);
  assert.deepEqual(collapsed.more[0].ids, ["c"]);
  assert.equal(collapsed.more[0].count, 1);
  assert.deepEqual(collapsed.more[0].bandIds, ["a", "b", "c"], "il +N apre l'elenco di tutta la fascia");
  assert.equal(collapsed.more[0].startMs, at(15));
  assert.equal(collapsed.more[0].endMs, at(16));
  assert.equal(CALENDAR_LAYOUT_TEXT.more(3), "+3");
});

test("collapseForWidth: meno colonne visibili accanto al +N, o nessuna", () => {
  const layout = layoutDayColumns([ev("a", [15], [16]), ev("b", [15], [16]), ev("c", [15], [16]), ev("alone", [18], [19])]);
  const one = collapseForWidth(layout, 2, 1);
  assert.deepEqual(one.items.map(({ id, column, columns }) => [id, column, columns]), [["a", 0, 1], ["alone", 0, 1]]);
  assert.deepEqual(one.more[0].ids, ["b", "c"]);
  assert.equal(one.more[0].count, 2);
  const none = collapseForWidth(layout, 2, 0);
  assert.deepEqual(none.items.map(({ id }) => id), ["alone"]);
  assert.equal(none.more[0].count, 3);
  assert.deepEqual(none.more[0].bandIds, ["a", "b", "c"]);
});

test("collapseForWidth: le larghezze restano dentro le colonne visibili", () => {
  const layout = layoutDayColumns([ev("A", [9], [11]), ev("B", [9, 30], [10, 30]), ev("D", [10], [10, 45]), ev("C", [10, 45], [12])], { minDurationMs: 0 });
  const collapsed = collapseForWidth(layout, 2);
  const c = collapsed.items.find((item) => item.id === "C");
  assert.deepEqual([c.column, c.columns, c.span], [1, 2, 1]);
  assert.deepEqual(collapsed.more[0].ids, ["D"]);
  // Con spazio per tutte le colonne non cambia nulla.
  assert.deepEqual(collapseForWidth(layout, 3), { items: layout, more: [] });
});

const weeks = ["2026-11-30", "2026-12-07"];
const bar = (id, startDay, endDay) => ({ id, startDay, endDay });

test("multiDaySegments: una barra per settimana, spezzata solo al cambio di riga", () => {
  const rows = multiDaySegments([bar("trip", "2026-12-04", "2026-12-06"), bar("long", "2026-12-05", "2026-12-08")], weeks);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].weekStart, "2026-11-30");
  assert.deepEqual(rows[0].segments.find((segment) => segment.id === "trip"), {
    id: "trip",
    startCol: 4,
    endCol: 6,
    lane: 0,
    continuesBefore: false,
    continuesAfter: false
  });
  assert.deepEqual(rows[0].segments.find((segment) => segment.id === "long"), {
    id: "long",
    startCol: 5,
    endCol: 6,
    lane: 1,
    continuesBefore: false,
    continuesAfter: true
  });
  assert.deepEqual(rows[1].segments, [{ id: "long", startCol: 0, endCol: 1, lane: 0, continuesBefore: true, continuesAfter: false }]);
  assert.equal(rows[0].lanes, 2);
  assert.equal(rows[1].lanes, 1);
});

test("multiDaySegments: corsie riempite senza sovrapporre due barre", () => {
  const rows = multiDaySegments(
    [bar("A", "2026-11-30", "2026-12-02"), bar("B", "2026-12-01", "2026-12-03"), bar("C", "2026-12-03", "2026-12-04"), bar("D", "2026-11-30", "2026-11-30")],
    ["2026-11-30"]
  );
  const lane = Object.fromEntries(rows[0].segments.map((segment) => [segment.id, segment.lane]));
  assert.equal(lane.A, 0, "a parità di inizio il più lungo sta in alto");
  assert.equal(lane.D, 1);
  assert.equal(lane.B, 1, "B si sovrappone ad A ma non a D (solo lunedì): seconda corsia");
  assert.equal(lane.C, 0, "C comincia quando A è finito: torna in cima");
  for (const a of rows[0].segments)
    for (const b of rows[0].segments)
      if (a !== b && a.lane === b.lane) assert.ok(a.endCol < b.startCol || b.endCol < a.startCol, `${a.id} e ${b.id} si sovrappongono`);
  assert.equal(rows[0].lanes, 2);
});

test("multiDaySegments: fuori dalle settimane, fine prima dell'inizio, settimana vuota", () => {
  const rows = multiDaySegments([bar("past", "2026-10-01", "2026-10-03"), bar("broken", "2026-12-09", "2026-12-07")], weeks);
  assert.deepEqual(rows[0].segments, []);
  assert.equal(rows[0].lanes, 0);
  assert.deepEqual(rows[1].segments, [{ id: "broken", startCol: 2, endCol: 2, lane: 0, continuesBefore: false, continuesAfter: false }]);
});

test("eventDaySpan: un evento di tutto il giorno salvato fino alla mezzanotte dopo è un giorno solo", () => {
  const iso = (...parts) => new Date(...parts).toISOString();
  assert.deepEqual(eventDaySpan({ start: iso(2026, 10, 12), end: iso(2026, 10, 13), allDay: true }), {
    startDay: "2026-11-12",
    endDay: "2026-11-12"
  });
  assert.deepEqual(eventDaySpan({ start: iso(2026, 11, 4), end: iso(2026, 11, 7), allDay: true }), {
    startDay: "2026-12-04",
    endDay: "2026-12-06"
  });
  // Con orario: dalle 22 alle 2 tocca due giorni; fino a mezzanotte esatta resta nel primo.
  assert.deepEqual(eventDaySpan({ start: iso(2026, 10, 12, 22), end: iso(2026, 10, 13, 2) }), { startDay: "2026-11-12", endDay: "2026-11-13" });
  assert.deepEqual(eventDaySpan({ start: iso(2026, 10, 12, 10), end: iso(2026, 10, 13, 0) }), { startDay: "2026-11-12", endDay: "2026-11-12" });
  // Fine mancante o prima dell'inizio: un giorno.
  assert.deepEqual(eventDaySpan({ start: iso(2026, 10, 12, 10), end: iso(2026, 10, 12, 9) }), { startDay: "2026-11-12", endDay: "2026-11-12" });
  assert.equal(eventDaySpan({ start: "not a date", end: "" }), null);
});

test("dayOfSpan: 'giorno 2 di 3' nella vista Giorno", () => {
  assert.deepEqual(dayOfSpan("2026-12-05", "2026-12-04", "2026-12-06"), { index: 2, total: 3 });
  assert.equal(dayOfSpan("2026-12-08", "2026-12-04", "2026-12-06"), null);
  assert.equal(CALENDAR_LAYOUT_TEXT.dayOfSpan(2, 3), "giorno 2 di 3");
});
