import test from "node:test";
import assert from "node:assert/strict";

const render = await import("../src/lib/calendarRender.ts");
const { CALENDAR_LAYOUT_TEXT, CALENDAR_VIEW_TEXT } = await import("../src/lib/labels/calendar.ts");
const { EVENT_TYPE_COLORS } = await import("../src/lib/eventColors.ts");

// Date locali del dispositivo: i test valgono in ogni fuso (Roma, New York, UTC).
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts) => local(...parts).toISOString();
/**
 * Dispositivi da cui si leggono gli eventi vecchi salvati a Roma senza fuso. Un istante senza fuso si
 * capisce solo entro 12 ore da Roma: a Kiritimati (+14) la mezzanotte di Roma è alle 13, più vicina al
 * giorno dopo. Il test fissa questi fusi, così non dipende da quello di chi lo esegue.
 */
const ROME_READERS = ["Europe/Rome", "Europe/London", "America/New_York", "Pacific/Honolulu", "Asia/Tokyo", "UTC"];
const eachReader = (run) => {
  const previous = process.env.TZ;
  try {
    for (const zone of ROME_READERS) {
      process.env.TZ = zone;
      run(zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};
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

  // Settimana su computer (124 px): il "+N" prende 44 px (bersaglio da dito), gli eventi accanto restano
  // larghi almeno MIN_EVENT_COLUMN_PX: ne entra uno.
  const narrow = render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 124 });
  assert.equal(narrow.merged, false);
  assert.deepEqual(
    narrow.placed.map(({ item, column, columns, narrowed }) => [item.id, column, columns, narrowed]),
    [["a", 0, 1, true]]
  );
  assert.ok(124 - render.MORE_GUTTER_PX >= render.MIN_EVENT_COLUMN_PX);
  assert.ok(render.MORE_GUTTER_PX >= render.TOUCH_TARGET_PX);
  assert.equal(narrow.more.length, 1);
  assert.equal(narrow.more[0].count, 2);
  assert.deepEqual(
    narrow.more[0].items.map((item) => item.id),
    ["a", "b", "c"],
    "il +N apre l'elenco di tutta la fascia"
  );
  assert.equal(narrow.more[0].startMs, local(2026, 12, 5, 15).getTime());
  assert.equal(CALENDAR_LAYOUT_TEXT.more(narrow.more[0].count), "+2");
  // Tre colonne ci stanno a 200 px, ma con il "+N" accanto due (2 × 78 px).
  const four = [...items, timed("d", [2026, 12, 5, 15], [2026, 12, 5, 16])];
  const fourPieces = render.dayPieces(four, local(2026, 12, 5).getTime(), local(2026, 12, 6).getTime());
  const mid = render.layoutTimedDay(fourPieces, { hourHeight: 46, columnWidth: 200 });
  assert.deepEqual(mid.placed.map(({ item, columns }) => [item.id, columns]), [["a", 2], ["b", 2]]);
  assert.equal(mid.more[0].count, 2);
});

test("layoutTimedDay: in una colonna stretta (Settimana sul tablet) la fascia diventa un solo pulsante largo quanto la colonna", () => {
  const items = [timed("a", [2026, 12, 5, 15], [2026, 12, 5, 16]), timed("b", [2026, 12, 5, 15, 30], [2026, 12, 5, 17]), timed("alone", [2026, 12, 5, 18], [2026, 12, 5, 19])];
  const pieces = render.dayPieces(items, local(2026, 12, 5).getTime(), local(2026, 12, 6).getTime());
  const tablet = render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 72 });
  assert.equal(tablet.merged, true);
  // L'evento da solo resta a tutta larghezza; quelli che si sovrappongono sono tutti nel pulsante.
  assert.deepEqual(tablet.placed.map(({ item, narrowed }) => [item.id, narrowed]), [["alone", false]]);
  assert.equal(tablet.more.length, 1);
  assert.equal(tablet.more[0].count, 2);
  assert.deepEqual(tablet.more[0].items.map((item) => item.id), ["a", "b"]);
  // Anche con il mouse: accanto al "+N" non resterebbero 56 px.
  assert.equal(render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 74, pointer: "mouse" }).merged, true);
  assert.equal(CALENDAR_LAYOUT_TEXT.mergedAria(3), "3 eventi che si sovrappongono: apri l'elenco");
  assert.equal(CALENDAR_LAYOUT_TEXT.moreAria(1), "Un altro evento in questa fascia: apri l'elenco");
  assert.equal(CALENDAR_LAYOUT_TEXT.moreAria(2), "Altri 2 eventi in questa fascia: apri l'elenco");
});

test("layoutTimedDay: con il mouse il \"+N\" è largo 28 px e due eventi stanno affiancati in 118 px", () => {
  assert.equal(render.OVERLAP_SIZES.touch.gutter, render.TOUCH_TARGET_PX);
  assert.ok(render.OVERLAP_SIZES.mouse.gutter >= 24, "sopra il minimo di 24 px");
  const items = [timed("gym", [2026, 11, 13, 10], [2026, 11, 13, 12]), timed("exam", [2026, 11, 13, 10, 30], [2026, 11, 13, 12]), timed("c", [2026, 11, 13, 10, 45], [2026, 11, 13, 11, 30])];
  const pieces = render.dayPieces(items, local(2026, 11, 13).getTime(), local(2026, 11, 14).getTime());
  // Venerdì in Settimana a 1280 (circa 118 px).
  const mouse = render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 118, pointer: "mouse" });
  assert.equal(mouse.merged, false);
  assert.deepEqual(mouse.placed.map(({ item, column, columns, narrowed }) => [item.id, column, columns, narrowed]), [["gym", 0, 2, true], ["exam", 1, 2, true]]);
  assert.equal(mouse.more[0].count, 1);
  // Con il dito: "+N" da 44 px e un evento solo accanto.
  const touch = render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 118, pointer: "touch" });
  assert.deepEqual(touch.placed.map(({ item }) => item.id), ["gym"]);
  assert.equal(touch.more[0].count, 2);
  // Senza indicazione: dito (il caso più largo).
  assert.deepEqual(render.layoutTimedDay(pieces, { hourHeight: 46, columnWidth: 118 }).placed.length, 1);
});

test("dotColor: ogni colore di tipologia ha almeno 3:1 sulla cella e sul pulsante, nei due temi", async () => {
  const { contrastRatio } = await import("../src/lib/eventColors.ts");
  for (const theme of ["dark", "light"]) {
    for (const surface of ["cell", "pill"]) {
      const against = render.DOT_SURFACES[theme][surface];
      for (const color of [...Object.values(EVENT_TYPE_COLORS), "#000000", "#FFFFFF", "#123456", "rotto"]) {
        const dot = render.dotColor(color, theme, surface);
        assert.match(dot, /^#[0-9A-F]{6}$/i);
        assert.ok(contrastRatio(dot, against) >= 3, `${theme} ${surface} ${color} → ${dot}`);
      }
    }
  }
  // Un colore già leggibile resta quello.
  assert.equal(render.dotColor("#7CF7C8", "dark", "cell").toUpperCase(), "#7CF7C8");
  assert.equal(render.dotColor("#3B82F6", "light", "cell").toUpperCase(), "#3B82F6");
});

test("monthDots: un pallino per voce nel suo colore, al più 3, poi «+N»", () => {
  assert.deepEqual(render.monthDots([]), { dots: [], more: 0 });
  assert.deepEqual(render.monthDots(["#111111", "#222222"]), { dots: ["#111111", "#222222"], more: 0 });
  assert.deepEqual(render.monthDots(["#1", "#2", "#3", "#4", "#5"]), { dots: ["#1", "#2", "#3"], more: 2 });
  assert.deepEqual(render.monthDots(["#1", "#2", "#3"], 2), { dots: ["#1", "#2"], more: 1 });
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

test("continuedFrom: l'evento di ieri sera che passa la mezzanotte è «continua» sotto oggi, non un evento di oggi", () => {
  const night = timed("night", [2026, 11, 11, 23, 17], [2026, 11, 12, 0, 17]);
  assert.equal(render.continuedFrom(night, "2026-11-12"), "2026-11-11");
  assert.equal(render.continuedFrom(night, "2026-11-11"), null, "nel suo giorno è un evento normale");
  const lesson = timed("lesson", [2026, 11, 12, 9], [2026, 11, 12, 11]);
  assert.equal(render.continuedFrom(lesson, "2026-11-12"), null);
  // Le barre (tutto il giorno, più giorni) dicono già il loro periodo ("ven 4 – dom 6").
  const trip = timed("trip", [2026, 12, 4], [2026, 12, 7], { allDay: true });
  assert.equal(render.continuedFrom(trip, "2026-12-05"), null);
  assert.equal(CALENDAR_VIEW_TEXT.continuedFrom("mer 11 nov", "23:17", "00:17"), "Dal mer 11 nov, 23:17–00:17");
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

test("occasionText: anni compiuti nel giorno dell'occorrenza", () => {
  const birthday = { occurrenceDate: "2026-12-04", occasion: { kind: "birthday", birthYear: 2001 } };
  assert.equal(render.occasionText(birthday), "compie 25 anni");
  assert.equal(render.occasionText({ occurrenceDate: "2027-06-01", occasion: { kind: "anniversary", birthYear: 2026 } }), "1 anno");
  assert.equal(render.occasionText({ occurrenceDate: "2026-12-04", occasion: { kind: "birthday" } }), "");
  assert.equal(render.occasionText({ occurrenceDate: "2026-12-04" }), "");
});

test("eventPaint: colore per tipologia, icona, stile leggibile in chiaro e scuro", () => {
  const exam = render.eventPaint({ category: "exam", color: "#7CF7C8" }, { theme: "dark" });
  assert.equal(exam.color, EVENT_TYPE_COLORS.exam, "il colore automatico di prima segue la tipologia");
  assert.equal(exam.icon, "GraduationCap");
  assert.equal(exam.type, "exam");
  for (const key of ["background", "border", "text"]) assert.match(exam.style[key], /^#[0-9A-F]{6}$/);

  const lesson = render.eventPaint({ category: "lesson", color: "#123456", subjectId: "s" }, { subjectColor: "#123456", theme: "light" });
  assert.equal(lesson.color, "#123456", "lezione con materia: colore della materia");

  const custom = render.eventPaint({ category: "exam", color: "#00AA00", colorCustom: true }, { theme: "dark" });
  assert.equal(custom.color, "#00AA00");

  const birthday = render.eventPaint({ category: "personal", color: "#7CF7C8", occasion: { kind: "birthday" } }, { theme: "dark" });
  assert.equal(birthday.icon, "Cake");
  assert.equal(birthday.color, EVENT_TYPE_COLORS.birthday);

  const overridden = render.eventPaint({ category: "gym", color: "#7CF7C8" }, { overrides: { gym: "#000000" }, theme: "dark" });
  assert.equal(overridden.color, "#000000", "colore della tipologia scelto dall'utente");

  // Stessa entrata, stesso oggetto: si calcola una volta sola.
  assert.equal(render.eventPaint({ category: "exam", color: "#7CF7C8" }, { theme: "dark" }).style, exam.style);
});

/* ------------------------------------------------------------------ */
/* Revisione 1: tutto il giorno vecchi, ora del giorno, Prossimi giorni  */
/* ------------------------------------------------------------------ */

const { expandEvents } = await import("../src/lib/repeat.ts");

const legacyAllDay = (patch) => ({
  id: "s1",
  title: "Domenica libera",
  description: "",
  category: "personal",
  color: "",
  priority: "medium",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  tags: [],
  archived: false,
  allDay: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch
});

test("barSource: serie vecchie di tutto il giorno restano di un giorno, anche il 29/03/2026 (ora legale)", () => eachReader((zone) => {
  // Salvate come istanti, senza fuso: mezzanotte del dispositivo e mezzanotte di Roma (vista da qui).
  const series = [
    legacyAllDay({ id: "device-weekly", start: iso(2026, 1, 4), end: iso(2026, 1, 5), recurrence: "weekly" }),
    legacyAllDay({ id: "rome-weekly", start: "2026-01-03T23:00:00.000Z", end: "2026-01-04T23:00:00.000Z", recurrence: "weekly" }),
    legacyAllDay({ id: "device-daily", start: iso(2026, 3, 20), end: iso(2026, 3, 21), recurrence: "daily" }),
    legacyAllDay({ id: "rome-daily", start: "2026-03-19T23:00:00.000Z", end: "2026-03-20T23:00:00.000Z", recurrence: "daily" })
  ];
  for (const event of series) {
    const occurrences = expandEvents([event], local(2026, 3, 1), local(2026, 4, 13));
    assert.ok(occurrences.length > 3, event.id);
    const days = new Set();
    for (const item of occurrences) {
      const bar = render.barSource(item);
      assert.deepEqual(bar && { startDay: bar.startDay, endDay: bar.endDay }, { startDay: item.occurrenceDate, endDay: item.occurrenceDate }, `${event.id} ${item.occurrenceDate}`);
      assert.equal(render.spanText(item, "2026-03-01"), null, `${event.id} ${item.occurrenceDate}: un giorno, niente periodo`);
      assert.ok(!days.has(bar.startDay), `${event.id}: due barre lo stesso giorno (${bar.startDay})`);
      days.add(bar.startDay);
    }
    assert.ok(
      occurrences.some((item) => item.occurrenceDate === "2026-03-29"),
      `${zone} ${event.id}: c'è l'occorrenza di domenica 29 marzo`
    );
  }
}));

test("barSource, listDayOf: un tutto il giorno salvato a Roma è un giorno solo anche in un altro fuso", () => eachReader(() => {
  const trip = legacyAllDay({ id: "trip", start: "2026-11-13T23:00:00.000Z", end: "2026-11-14T23:00:00.000Z" });
  const [item] = expandEvents([trip], new Date("2026-11-09T00:00:00Z"), new Date("2026-11-20T00:00:00Z"));
  assert.deepEqual(render.barSource(item), { id: item.occurrenceKey, startDay: "2026-11-14", endDay: "2026-11-14" });
  assert.equal(render.listDayOf(item, "2026-11-09", "2026-11-15"), "2026-11-14");
  assert.equal(render.listDayOf(item, "2026-11-16", "2026-11-22"), null, "non sconfina nella settimana dopo");
  assert.equal(render.spanText(item, "2026-11-01"), null);

  // Tre giorni a cavallo dell'ora legale (71 ore a Roma): restano tre giorni, da qualsiasi fuso.
  const weekend = legacyAllDay({ id: "w", start: "2026-03-26T23:00:00.000Z", end: "2026-03-29T22:00:00.000Z" });
  assert.deepEqual(render.barSource({ ...weekend, occurrenceKey: "w" }), { id: "w", startDay: "2026-03-27", endDay: "2026-03-29" });
  const local3 = legacyAllDay({ id: "l", start: iso(2026, 3, 27), end: iso(2026, 3, 30) });
  assert.deepEqual(render.barSource({ ...local3, occurrenceKey: "l" }), { id: "l", startDay: "2026-03-27", endDay: "2026-03-29" });
  assert.ok(render.spanText(local3, "2026-03-01"));
  // Fine prima dell'inizio: un giorno.
  assert.deepEqual(render.barSource({ ...legacyAllDay({ start: iso(2026, 5, 2), end: iso(2026, 5, 1) }), occurrenceKey: "x" }), { id: "x", startDay: "2026-05-02", endDay: "2026-05-02" });
}));

test("wallMinutes e atWallMinutes: l'ora segnata dall'orologio, anche nei giorni del cambio dell'ora", () => {
  for (const [y, m, d] of [
    [2026, 3, 29],
    [2026, 3, 8],
    [2026, 10, 25],
    [2026, 11, 12]
  ]) {
    const dayEnd = local(y, m, d + 1).getTime();
    assert.equal(render.wallMinutes(local(y, m, d, 10).getTime(), dayEnd), 600, `${d}/${m} alle 10`);
    assert.equal(render.wallMinutes(local(y, m, d, 23, 30).getTime(), dayEnd), 1410);
    assert.equal(render.wallMinutes(dayEnd, dayEnd), 1440, "la mezzanotte dopo chiude il giorno");
    const created = render.atWallMinutes(local(y, m, d), 600);
    assert.equal(created.getHours(), 10, `${d}/${m}: si crea alle 10, non alle 11 o alle 9`);
    assert.equal(created.getDate(), d);
  }
});

test("upcomingAfterToday: i prossimi giorni anche con tanti eventi oggi", () => {
  const now = local(2026, 11, 11, 18);
  const today = Array.from({ length: 7 }, (_, index) =>
    legacyAllDay({ id: `t${index}`, allDay: false, start: iso(2026, 11, 11, 8 + index), end: iso(2026, 11, 11, 9 + index) })
  );
  const later = [
    legacyAllDay({ id: "late", allDay: false, start: iso(2026, 11, 11, 23), end: iso(2026, 11, 12, 1) }),
    legacyAllDay({ id: "day3", allDay: false, start: iso(2026, 11, 14, 10), end: iso(2026, 11, 14, 11) }),
    legacyAllDay({ id: "tomorrow", allDay: false, start: iso(2026, 11, 12, 9), end: iso(2026, 11, 12, 10) }),
    legacyAllDay({ id: "tomorrow2", allDay: false, start: iso(2026, 11, 12, 14), end: iso(2026, 11, 12, 15) })
  ];
  assert.deepEqual(
    render.upcomingAfterToday([...today, ...later], now, 5).map((item) => item.id),
    ["tomorrow", "tomorrow2", "day3"]
  );
  assert.equal(render.upcomingAfterToday([...today, ...later], now, 2).length, 2);
  assert.deepEqual(render.upcomingAfterToday(today, now, 5), []);
});

/* ------------------------------------------------------------------ */
/* Revisione 2                                                          */
/* ------------------------------------------------------------------ */

const { applyRepeatFields } = await import("../src/lib/repeat.ts");

const withTz = (zone, run) => {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};

test("daySpanOf: per gli eventi di tutto il giorno con fuso il primo giorno è occurrenceDate di R1, da ogni fuso", () => {
  const zoned = (patch, zone) => withTz(zone, () => applyRepeatFields(legacyAllDay({ recurrence: "none", ...patch }), { repeatChanged: true, timeZone: zone }));
  const events = [
    // Serie con regola (fuso salvato), a cavallo di entrambi i cambi dell'ora.
    zoned({ id: "rome-weekly", start: "2026-03-01T00:00:00", end: "2026-03-02T00:00:00", repeat: { freq: "weekly" } }, "Europe/Rome"),
    zoned({ id: "rome-3-weekly", start: "2026-03-27T00:00:00", end: "2026-03-30T00:00:00", repeat: { freq: "weekly" } }, "Europe/Rome"),
    zoned({ id: "ny-daily", start: "2026-10-28T00:00:00", end: "2026-10-29T00:00:00", repeat: { freq: "daily" } }, "America/New_York"),
    // Singoli con fuso: data senza ora e istante della mezzanotte del fuso.
    legacyAllDay({ id: "rome-single", start: "2026-03-29T00:00:00", end: "2026-03-30T00:00:00", timeZone: "Europe/Rome" }),
    legacyAllDay({ id: "rome-single-z", start: "2026-03-28T23:00:00.000Z", end: "2026-03-29T22:00:00.000Z", timeZone: "Europe/Rome" }),
    legacyAllDay({ id: "rome-3-z", start: "2026-10-23T22:00:00.000Z", end: "2026-10-26T23:00:00.000Z", timeZone: "Europe/Rome" }),
    legacyAllDay({ id: "ny-single-z", start: "2026-11-14T05:00:00.000Z", end: "2026-11-15T05:00:00.000Z", timeZone: "America/New_York" })
  ];
  const days = { "rome-3-weekly": 3, "rome-3-z": 3 };
  for (const zone of ["Europe/Rome", "Europe/London", "America/New_York", "UTC", "Asia/Tokyo"]) {
    withTz(zone, () => {
      for (const event of events) {
        const occurrences = expandEvents([event], new Date("2026-02-25T00:00:00Z"), new Date("2026-11-20T00:00:00Z"));
        assert.ok(occurrences.length, `${zone} ${event.id}`);
        for (const item of occurrences) {
          const span = render.daySpanOf(item);
          assert.equal(span?.startDay, item.occurrenceDate, `${zone} ${event.id} ${item.occurrenceDate}`);
          const last = new Date(`${item.occurrenceDate}T12:00:00Z`);
          last.setUTCDate(last.getUTCDate() + (days[event.id] ?? 1) - 1);
          assert.equal(span?.endDay, last.toISOString().slice(0, 10), `${zone} ${event.id} ${item.occurrenceDate}: giorni`);
        }
      }
    });
  }
});

test("laneRows: le festività nascoste non contano nel +N (non sono impegni)", () => {
  const items = [
    { id: "a", startDay: "2026-12-08", endDay: "2026-12-08" },
    { id: "b", startDay: "2026-12-08", endDay: "2026-12-08" },
    ...render.holidayBars([{ date: "2026-12-08", name: "Immacolata Concezione" }])
  ];
  const [row] = render.laneRows(items, ["2026-12-07"], 1);
  assert.deepEqual(row.hidden, [0, 1, 0, 0, 0, 0, 0], "solo l'evento nascosto, non la festa");
  const [holidaysFirst] = render.laneRows([...items].reverse(), ["2026-12-07"], 1);
  assert.equal(holidaysFirst.hidden[1], 2, "con la festa in corsia i due eventi nascosti contano");
});

test("upcomingAfterToday: un tutto il giorno di domani che qui comincia la sera prima resta nei prossimi giorni", () => {
  const now = local(2026, 11, 12, 18);
  // Salvato in un fuso un'ora avanti: in ora locale va dalle 23 di oggi alle 23 di domani. È di domani.
  const ahead = legacyAllDay({ id: "ahead", start: iso(2026, 11, 12, 23), end: iso(2026, 11, 13, 23) });
  const [item] = render.upcomingAfterToday([ahead], now, 5);
  assert.equal(item?.id, "ahead");
  assert.equal(render.daySpanOf(item).startDay, "2026-11-13");
  // E uno di oggi che finisce domani mattina no.
  const tonight = legacyAllDay({ id: "tonight", allDay: false, start: iso(2026, 11, 12, 22), end: iso(2026, 11, 13, 2) });
  assert.deepEqual(render.upcomingAfterToday([tonight], now, 5), []);
});
