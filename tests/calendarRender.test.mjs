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

test("isBarEvent: tutto il giorno o almeno 24 ore su più giorni va nella fascia in alto", () => {
  assert.equal(render.isBarEvent(timed("a", [2026, 12, 4], [2026, 12, 5], { allDay: true })), true);
  assert.equal(render.isBarEvent(timed("b", [2026, 12, 4], [2026, 12, 7], { allDay: true })), true);
  assert.equal(render.isBarEvent(timed("conf", [2026, 12, 4, 9], [2026, 12, 6, 18])), true, "congresso di tre giorni");
  assert.equal(render.isBarEvent(timed("day", [2026, 12, 4, 10], [2026, 12, 5, 10])), true, "24 ore esatte");
  assert.equal(render.isBarEvent(timed("night", [2026, 12, 4, 22], [2026, 12, 5, 2])), false, "4 ore a cavallo della mezzanotte");
  assert.equal(render.isBarEvent(timed("lesson", [2026, 12, 4, 10], [2026, 12, 4, 12])), false);
  // Mezzanotte → mezzanotte senza "tutto il giorno" (import vecchi): resta nella griglia come prima.
  assert.equal(render.isBarEvent(timed("legacy", [2026, 12, 4], [2026, 12, 5])), false);
  assert.equal(render.isBarEvent({ start: "x", end: "y" }), false);
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

/* ------------------------------------------------------------------ */
/* Barre su più giorni                                                  */
/* ------------------------------------------------------------------ */

test("weekStartsOf: i lunedì delle righe del mese", () => {
  const days = Array.from({ length: 14 }, (_, index) => local(2026, 11, 30 + index));
  assert.deepEqual(render.weekStartsOf(days), ["2026-11-30", "2026-12-07"]);
});

test("barSource: giorni di una barra; null se non è una barra", () => {
  assert.deepEqual(render.barSource(timed("trip", [2026, 12, 4], [2026, 12, 7], { allDay: true })), {
    id: "trip",
    startDay: "2026-12-04",
    endDay: "2026-12-06"
  });
  assert.equal(render.barSource(timed("lesson", [2026, 12, 4, 10], [2026, 12, 4, 12])), null);
});

test("laneRows: vacanza di 3 giorni a cavallo di due settimane nel Mese", () => {
  // Sab 5, dom 6, lun 7 dicembre 2026: una barra per riga, senza angoli dove continua.
  const vacation = { id: "vacation", startDay: "2026-12-05", endDay: "2026-12-07" };
  const rows = render.laneRows([vacation], ["2026-11-30", "2026-12-07"], 3);
  assert.deepEqual(rows[0].segments, [{ id: "vacation", startCol: 5, endCol: 6, lane: 0, continuesBefore: false, continuesAfter: true }]);
  assert.deepEqual(rows[1].segments, [{ id: "vacation", startCol: 0, endCol: 0, lane: 0, continuesBefore: true, continuesAfter: false }]);
  assert.equal(rows[0].lanes, 1);
  assert.deepEqual(rows[0].hidden, [0, 0, 0, 0, 0, 0, 0]);
});

test("laneRows: oltre il tetto di corsie le barre diventano un +N per giorno", () => {
  const items = [
    { id: "a", startDay: "2026-12-01", endDay: "2026-12-03" },
    { id: "b", startDay: "2026-12-01", endDay: "2026-12-02" },
    { id: "c", startDay: "2026-12-02", endDay: "2026-12-04" },
    { id: "d", startDay: "2026-12-02", endDay: "2026-12-02" }
  ];
  const [row] = render.laneRows(items, ["2026-11-30"], 2);
  assert.equal(row.lanes, 2, "solo le corsie mostrate");
  assert.ok(row.segments.every((segment) => segment.lane < 2));
  const hiddenIds = items.map((item) => item.id).filter((id) => !row.segments.some((segment) => segment.id === id));
  assert.equal(hiddenIds.length, 2);
  // Ogni giorno conta le barre nascoste che lo coprono.
  assert.equal(row.hidden.reduce((sum, count) => sum + count, 0) > 0, true);
  assert.equal(row.hidden[0], 0, "lunedì non ha barre");
  const [uncapped] = render.laneRows(items, ["2026-11-30"], Infinity);
  assert.deepEqual(uncapped.hidden, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(uncapped.segments.length, 4);
});

test("monthItemBudget: le barre lasciano meno posto alle voci del giorno, mai meno di una", () => {
  assert.equal(render.monthItemBudget(0), 3);
  assert.equal(render.monthItemBudget(1), 2);
  assert.equal(render.monthItemBudget(3), 1);
  assert.equal(render.monthItemBudget(5), 1);
});

/* ------------------------------------------------------------------ */
/* Elenchi per giorno (Agenda, Settimana sul telefono)                  */
/* ------------------------------------------------------------------ */

test("listDayOf: una voce sola, nel primo giorno mostrato in cui c'è", () => {
  const trip = timed("trip", [2026, 12, 4], [2026, 12, 7], { allDay: true });
  assert.equal(render.listDayOf(trip, "2026-12-01", "2026-12-14"), "2026-12-04");
  assert.equal(render.listDayOf(trip, "2026-12-05", "2026-12-18"), "2026-12-05", "iniziata prima: in cima al primo giorno");
  assert.equal(render.listDayOf(trip, "2026-12-07", "2026-12-20"), null, "finita il 6");
  assert.equal(render.listDayOf(trip, "2026-11-20", "2026-12-03"), null, "comincia dopo");
  const night = timed("night", [2026, 12, 4, 22], [2026, 12, 5, 2]);
  assert.equal(render.listDayOf(night, "2026-12-01", "2026-12-14"), "2026-12-04");
  assert.equal(render.listDayOf(night, "2026-12-05", "2026-12-14"), "2026-12-05");
});

test("spanText: 'ven 4 – dom 6 dic' per le voci su più giorni, niente per le altre", () => {
  const today = "2026-11-11";
  assert.equal(render.spanText(timed("trip", [2026, 12, 4], [2026, 12, 7], { allDay: true }), today), "ven 4 – dom 6 dic");
  assert.equal(render.spanText(timed("cross", [2026, 11, 30], [2026, 12, 2], { allDay: true }), today), "lun 30 nov – mar 1 dic");
  assert.equal(render.spanText(timed("one", [2026, 12, 4], [2026, 12, 5], { allDay: true }), today), null);
  assert.equal(render.spanText(timed("lesson", [2026, 12, 4, 10], [2026, 12, 4, 12]), today), null);
  assert.equal(render.spanText(timed("conf", [2026, 12, 4, 9], [2026, 12, 6, 18]), today), "ven 4 – dom 6 dic");
});

test("overdueForAgenda: le attività in ritardo solo se l'Agenda parte da oggi", () => {
  const now = local(2026, 12, 10, 9);
  const tasks = [
    { id: "late", status: "todo", dueDate: iso(2026, 12, 8, 18) },
    { id: "done", status: "done", dueDate: iso(2026, 12, 8, 18) },
    { id: "today", status: "todo", dueDate: iso(2026, 12, 10, 18) },
    { id: "nodate", status: "todo" }
  ];
  assert.deepEqual(
    render.overdueForAgenda(tasks, local(2026, 12, 10), now).map((task) => task.id),
    ["late"]
  );
  // A1: con solo attività in ritardo e l'Agenda spostata in avanti, niente elenco (e quindi lo stato vuoto).
  assert.deepEqual(render.overdueForAgenda(tasks, local(2026, 12, 24), now), []);
});

/* ------------------------------------------------------------------ */
/* Attività senza data                                                  */
/* ------------------------------------------------------------------ */

test("undatedTasks: da fare e senza data; undatedDueDate alle 18 del giorno scelto", () => {
  const tasks = [
    { id: "a", status: "todo", title: "Leggere" },
    { id: "b", status: "done", title: "Fatta" },
    { id: "c", status: "archived", title: "Archiviata" },
    { id: "d", status: "todo", title: "Con data", dueDate: iso(2026, 12, 4, 18) },
    { id: "e", status: "doing", title: "In corso", archived: false }
  ];
  assert.deepEqual(
    render.undatedTasks(tasks).map((task) => task.id),
    ["a", "e"]
  );
  const due = new Date(render.undatedDueDate("2026-12-04"));
  assert.deepEqual([due.getFullYear(), due.getMonth(), due.getDate(), due.getHours(), due.getMinutes()], [2026, 11, 4, 18, 0]);
  assert.equal(render.undatedDueDate("non è una data"), null);
});

/* ------------------------------------------------------------------ */
/* Festività, ricorrenze, colori                                        */
/* ------------------------------------------------------------------ */

test("holidaysByDay: festività di aprile 2027 raggruppate per giorno (Pasqua il 28 marzo)", async () => {
  const { holidaysInRange } = await import("../src/lib/holidays.ts");
  const list = holidaysInRange("2027-03-22", "2027-05-03");
  const byDay = render.holidaysByDay(list);
  assert.deepEqual(
    byDay.get("2027-03-28").map((holiday) => holiday.name),
    ["Pasqua", "Inizia l'ora legale (lancette avanti di un'ora)"]
  );
  assert.equal(byDay.get("2027-03-29")[0].kind, "national");
  assert.equal(byDay.get("2027-04-25")[0].name, "Festa della Liberazione");
  assert.equal(byDay.get("2027-04-26"), undefined);
  // Festività come barre di un giorno: id stabili e diversi per due voci nello stesso giorno.
  const sources = render.holidayBars(byDay.get("2027-03-28"));
  assert.equal(new Set(sources.map((item) => item.id)).size, 2);
  assert.ok(sources.every((item) => item.startDay === "2027-03-28" && item.endDay === "2027-03-28"));
});


test("holidayPaint: le feste nazionali un po' più marcate delle ricorrenze", () => {
  const national = render.holidayPaint("national", "dark");
  const celebration = render.holidayPaint("celebration", "dark");
  assert.notEqual(national.background, celebration.background);
  assert.ok(national.strong && !celebration.strong);
  assert.equal(render.holidayPaint("clock", "light").strong, false);
});
