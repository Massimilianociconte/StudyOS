import test from "node:test";
import assert from "node:assert/strict";

const picker = await import("../src/lib/datePicker.ts");
const {
  addDays,
  addMonths,
  addYears,
  checkTypedTime,
  clampYmd,
  finishRange,
  focusMovesTo,
  daysInclusive,
  formatDateField,
  formatDateLong,
  formatDateShort,
  formatDateTimeField,
  formatMonthTitle,
  formatRangeField,
  isOutOfRange,
  jumpTo,
  monthDisabled,
  monthGrid,
  moveByKey,
  nearestSlot,
  parseTime,
  pickRange,
  previewRange,
  slotInView,
  splitDateTime,
  joinDateTime,
  timeSlots,
  todayYmd,
  weekdayIndex,
  yearDisabled,
  yearPage
} = picker;
const { DATE_PICKER_TEXT } = await import("../src/lib/labels.ts");

test("monthGrid: lunedì per primo, 6 righe fisse con i giorni dei mesi vicini", () => {
  // Novembre 2026: l'1 è domenica, quindi 6 giorni di ottobre in testa.
  const grid = monthGrid(2026, 10);
  assert.equal(grid.weeks.length, 6);
  assert.ok(grid.weeks.every((week) => week.length === 7));
  assert.equal(grid.weeks[0][0].ymd, "2026-10-26");
  assert.equal(grid.weeks[0][0].inMonth, false);
  assert.equal(grid.weeks[0][6].ymd, "2026-11-01");
  assert.equal(grid.weeks[0][6].inMonth, true);
  assert.equal(grid.weeks[0][6].weekday, 6, "domenica in ultima colonna");
  assert.equal(grid.weeks[5][6].ymd, "2026-12-06");
  assert.equal(grid.weeks[5][6].inMonth, false);
  // Febbraio 2027 parte di lunedì: nessun giorno in testa, sempre 6 righe (altezza fissa).
  const february = monthGrid(2027, 1);
  assert.equal(february.weeks[0][0].ymd, "2027-02-01");
  assert.equal(february.weeks.length, 6);
  assert.equal(february.weeks[4][0].ymd, "2027-03-01");
});

test("monthGrid: oggi, scelto, fuori dai limiti e intervallo", () => {
  const grid = monthGrid(2026, 10, {
    today: "2026-11-11",
    selected: "2026-11-12",
    min: "2026-11-03",
    max: "2026-11-28",
    range: { start: "2026-11-20", end: "2026-11-22" }
  });
  const day = (ymd) => grid.weeks.flat().find((item) => item.ymd === ymd);
  assert.equal(day("2026-11-11").isToday, true);
  assert.equal(day("2026-11-12").isSelected, true);
  assert.equal(day("2026-11-11").isSelected, false);
  assert.equal(day("2026-11-02").disabled, true);
  assert.equal(day("2026-11-03").disabled, false);
  assert.equal(day("2026-11-29").disabled, true);
  assert.deepEqual(
    ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"].map((ymd) => [day(ymd).inRange, day(ymd).rangeStart, day(ymd).rangeEnd]),
    [
      [false, false, false],
      [true, true, false],
      [true, false, false],
      [true, false, true],
      [false, false, false]
    ]
  );
});

test("aritmetica delle date: mesi corti, bisestili, ora legale", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2027-03-28", 1), "2027-03-29", "il cambio dell'ora non sposta il giorno");
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addYears("2028-02-29", 1), "2029-02-28");
  assert.equal(weekdayIndex("2026-11-12"), 3, "giovedì");
  assert.equal(weekdayIndex("2026-11-16"), 0, "lunedì");
  assert.equal(daysInclusive("2027-01-01", "2027-01-03"), 3);
  assert.equal(daysInclusive("2027-01-01", "2027-01-01"), 1);
  assert.equal(daysInclusive("2027-03-27", "2027-03-29"), 3, "attraverso il cambio dell'ora");
  assert.equal(todayYmd(new Date(2026, 10, 11, 23, 59)), "2026-11-11", "data locale, non UTC");
});

test("limiti: clampYmd e isOutOfRange", () => {
  assert.equal(clampYmd("2026-11-01", "2026-11-10"), "2026-11-10");
  assert.equal(clampYmd("2026-12-01", undefined, "2026-11-30"), "2026-11-30");
  assert.equal(clampYmd("2026-11-15", "2026-11-10", "2026-11-30"), "2026-11-15");
  assert.equal(isOutOfRange("2026-11-09", "2026-11-10"), true);
  assert.equal(isOutOfRange("2026-11-10", "2026-11-10", "2026-11-10"), false);
});

test("moveByKey: frecce, Pagina su/giù, Maiusc per l'anno, Home/End per la settimana", () => {
  const from = "2026-11-12"; // giovedì
  assert.equal(moveByKey(from, "ArrowLeft"), "2026-11-11");
  assert.equal(moveByKey(from, "ArrowRight"), "2026-11-13");
  assert.equal(moveByKey(from, "ArrowUp"), "2026-11-05");
  assert.equal(moveByKey(from, "ArrowDown"), "2026-11-19");
  assert.equal(moveByKey(from, "PageUp"), "2026-10-12");
  assert.equal(moveByKey(from, "PageDown"), "2026-12-12");
  assert.equal(moveByKey(from, "PageUp", { shiftKey: true }), "2025-11-12");
  assert.equal(moveByKey(from, "PageDown", { shiftKey: true }), "2027-11-12");
  assert.equal(moveByKey(from, "Home"), "2026-11-09", "lunedì della stessa settimana");
  assert.equal(moveByKey(from, "End"), "2026-11-15", "domenica della stessa settimana");
  assert.equal(moveByKey("2027-01-31", "PageDown"), "2027-02-28");
  assert.equal(moveByKey("2028-02-29", "PageDown", { shiftKey: true }), "2029-02-28");
  assert.equal(moveByKey(from, "ArrowUp", { min: "2026-11-10" }), "2026-11-10", "si ferma al primo giorno ammesso");
  assert.equal(moveByKey(from, "PageDown", { max: "2026-11-30" }), "2026-11-30");
  assert.equal(moveByKey(from, "Enter"), null);
  assert.equal(moveByKey(from, "a"), null);
});

test("salto a mese e anno: stesso giorno se esiste, mesi e anni fuori dai limiti", () => {
  assert.equal(jumpTo("2027-01-31", 2027, 1), "2027-02-28");
  assert.equal(jumpTo("2026-11-12", 2030, 5), "2030-06-12");
  assert.equal(jumpTo("2026-11-12", 2026, 9, { min: "2026-10-20" }), "2026-10-20");
  assert.equal(monthDisabled(2026, 9, "2026-11-10"), true);
  assert.equal(monthDisabled(2026, 10, "2026-11-10"), false);
  assert.equal(monthDisabled(2026, 11, undefined, "2026-11-30"), true);
  assert.equal(yearDisabled(2025, "2026-11-10"), true);
  assert.equal(yearDisabled(2026, "2026-11-10"), false);
  assert.deepEqual(yearPage(2026), [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
  assert.deepEqual(yearPage(2028).slice(0, 2), [2028, 2029]);
});

test("orari ogni 15 minuti e orario più vicino", () => {
  const slots = timeSlots();
  assert.equal(slots.length, 96);
  assert.equal(slots[0], "00:00");
  assert.equal(slots[37], "09:15");
  assert.equal(slots.at(-1), "23:45");
  assert.equal(timeSlots(30).length, 48);
  assert.equal(nearestSlot("09:40"), "09:45");
  assert.equal(nearestSlot("09:37"), "09:30");
  assert.equal(nearestSlot("23:55"), "23:45", "non torna a mezzanotte del giorno dopo");
  assert.equal(nearestSlot("nonsense"), "09:00");
});

test("focusMovesTo: un giorno grigio si sceglie col clic; solo la tastiera sposta il mese al focus", () => {
  // Griglia di novembre: il 30 ottobre è grigio. Il dito giù non cambia mese (il clic poi sceglie).
  assert.equal(focusMovesTo("2026-10-30", "2026-11-12", true), null);
  assert.equal(focusMovesTo("2026-10-30", "2026-11-12", false), "2026-10-30");
  assert.equal(focusMovesTo("2026-11-12", "2026-11-12", false), null, "già a fuoco: nulla da fare");
});

test("slotInView: la lista va all'ora scritta, se no a quella scelta o alle 9", () => {
  assert.equal(slotInView("14.20", "09:00"), "14:15");
  assert.equal(slotInView("1830", ""), "18:30");
  assert.equal(slotInView("", "16:40"), "16:45");
  assert.equal(slotInView("boh", ""), "09:00");
});

test("parseTime: 9.30, 930, 09:30 e altre scritture comuni", () => {
  assert.equal(parseTime("9.30"), "09:30");
  assert.equal(parseTime("930"), "09:30");
  assert.equal(parseTime("09:30"), "09:30");
  assert.equal(parseTime(" 7:05 "), "07:05");
  assert.equal(parseTime("14,15"), "14:15");
  assert.equal(parseTime("1415"), "14:15");
  assert.equal(parseTime("9h30"), "09:30");
  assert.equal(parseTime("9"), "09:00");
  assert.equal(parseTime("0"), "00:00");
  assert.equal(parseTime("23:59"), "23:59");
  for (const bad of ["", "24:00", "9:75", "9:5", "12345", "abc", "9:30pm", "-1"]) assert.equal(parseTime(bad), null, bad);
});

test("splitDateTime e joinDateTime: valore locale YYYY-MM-DDTHH:mm", () => {
  assert.deepEqual(splitDateTime("2026-11-12T10:00"), { date: "2026-11-12", time: "10:00" });
  assert.deepEqual(splitDateTime("2026-11-12T10:00:30"), { date: "2026-11-12", time: "10:00" });
  assert.equal(splitDateTime(""), null);
  assert.equal(splitDateTime("2026-11-12"), null);
  assert.equal(joinDateTime("2026-11-12", "09:30"), "2026-11-12T09:30");
});

test("formati italiani: campo, nome completo, titolo del mese", () => {
  assert.equal(formatDateShort("2026-11-12"), "gio 12 nov 2026");
  assert.equal(formatDateShort("2026-11-12", { year: false }), "gio 12 nov");
  assert.equal(formatDateLong("2026-11-12"), "giovedì 12 novembre 2026");
  assert.equal(formatMonthTitle(2026, 10), "novembre 2026");
  // Nel campo l'anno compare solo se non è quello in corso.
  assert.equal(formatDateField("2026-11-12", "2026-11-11"), "gio 12 nov");
  assert.equal(formatDateField("2027-01-15", "2026-11-11"), "ven 15 gen 2027");
  assert.equal(formatDateTimeField("2026-11-12T10:00", "2026-11-11"), "gio 12 nov, 10:00");
  assert.equal(formatDateTimeField("2026-11-12T10:00", "2026-11-11", { allDay: true }), "gio 12 nov");
  assert.equal(formatDateTimeField("", "2026-11-11"), "");
  assert.equal(DATE_PICKER_TEXT.weekdaysShort[0], "lun");
});

test("formatRangeField: un solo mese, mesi diversi, anni diversi", () => {
  const today = "2026-11-11";
  assert.equal(formatRangeField("2026-12-04", "2026-12-06", today), "ven 4 – dom 6 dic");
  assert.equal(formatRangeField("2026-11-30", "2026-12-02", today), "lun 30 nov – mer 2 dic");
  assert.equal(formatRangeField("2027-01-01", "2027-01-03", today), "ven 1 – dom 3 gen 2027");
  assert.equal(formatRangeField("2026-12-30", "2027-01-02", today), "mer 30 dic 2026 – sab 2 gen 2027");
  assert.equal(formatRangeField("2026-11-12", "2026-11-12", today), "gio 12 nov");
  assert.equal(DATE_PICKER_TEXT.days(1), "1 giorno");
  assert.equal(DATE_PICKER_TEXT.days(3), "3 giorni");
});

test("checkTypedTime: ora scritta da confermare con Fatto (vuota, non valida, troppo presto, buona)", () => {
  assert.deepEqual(checkTypedTime(""), { status: "empty" });
  assert.deepEqual(checkTypedTime("   "), { status: "empty" }, "campo svuotato: si chiude senza cambiare");
  assert.deepEqual(checkTypedTime("9.7"), { status: "invalid" });
  assert.deepEqual(checkTypedTime("25"), { status: "invalid" });
  assert.deepEqual(checkTypedTime("8:30", "09:00"), { status: "early" });
  assert.deepEqual(checkTypedTime("9", "09:00"), { status: "ok", time: "09:00" });
  assert.deepEqual(checkTypedTime("930"), { status: "ok", time: "09:30" });
  assert.equal(DATE_PICKER_TEXT.timeInvalid, "Scrivi un orario come 9:30");
});

test("finishRange: Fatto dopo un solo tocco salva un giorno; senza tocchi non cambia nulla", () => {
  assert.deepEqual(finishRange({ start: "2026-12-04", end: "2026-12-06", anchor: "2027-01-05" }), { start: "2027-01-05", end: "2027-01-05" });
  assert.equal(finishRange({ start: "2026-12-04", end: "2026-12-06", anchor: null }), null);
});

test("pickRange: primo tocco = inizio, secondo = fine (in qualunque ordine)", () => {
  let state = { start: "2026-12-01", end: "2026-12-03", anchor: null };
  state = pickRange(state, "2027-01-05");
  assert.deepEqual(state, { start: "2027-01-05", end: "2027-01-05", anchor: "2027-01-05", done: false });
  assert.deepEqual(pickRange(state, "2027-01-08"), { start: "2027-01-05", end: "2027-01-08", anchor: null, done: true });
  assert.deepEqual(pickRange(state, "2027-01-02"), { start: "2027-01-02", end: "2027-01-05", anchor: null, done: true });
  assert.deepEqual(previewRange("2027-01-05", "2027-01-02"), { start: "2027-01-02", end: "2027-01-05" });
  assert.deepEqual(previewRange("2027-01-05", "2027-01-09"), { start: "2027-01-05", end: "2027-01-09" });
});
