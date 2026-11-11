import test from "node:test";
import assert from "node:assert/strict";
import {
  alignedSeriesStart,
  explicitRule,
  movedRule,
  occurrenceEditCalls,
  scopeImpact,
  seriesSpan,
  seriesMovePatch,
  simulateOccurrenceEdit,
  userRuleChange
} from "../src/lib/occurrenceEdit.ts";
import { scopeOptions, shortDatesText, weekdaysText } from "../src/lib/eventEditor.ts";
import { findOccurrence, startDayOf } from "../src/lib/occurrenceLookup.ts";
import { applyEditPlan, expandEvents, isOccurrenceRow, normalizeRepeat, planDelete, planEdit } from "../src/lib/repeat.ts";
import { customFromRule, repeatPresets, ruleFromCustom } from "../src/lib/repeatPicker.ts";
import { SCOPE_TEXT } from "../src/lib/labels/calendar.ts";
import { localMidnight } from "../src/lib/tz.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Orari locali (a mezzogiorno): i giorni sono gli stessi in ogni fuso del dispositivo.
const local = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = "2026-11-11T12:00:00.000Z";
const TODAY = "2026-11-11";

const event = (patch) => ({
  id: "s",
  createdAt: NOW,
  updatedAt: NOW,
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start: local(2026, 11, 2),
  end: local(2026, 11, 2, 13),
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

// Ogni lunedì a mezzogiorno dal 2 novembre.
const WEEKLY = event({ repeat: { freq: "weekly" } });

const apply = (events, plan) => applyEditPlan(events, plan).events;
const seriesOf = (events, id = "s") => events.find((item) => item.id === id && !isOccurrenceRow(item));
/** Lunedì 23 rinominato, lunedì 30 annullato. */
const withChangedDays = () => {
  let events = [WEEKLY];
  events = apply(events, planEdit(seriesOf(events), events, "2026-11-23", "this", { title: "Esercitazione" }, { now: NOW }));
  events = apply(events, planDelete(events, "s", "2026-11-30", "this", { now: NOW }));
  return events;
};
const shown = (events, from, to) =>
  expandEvents(events, localMidnight(from), localMidnight(to)).map((item) => `${item.occurrenceDate} ${item.title}${item.cancelled ? " (annullato)" : ""}`);
const shiftMs = (item, ms) => ({ start: new Date(Date.parse(item.start) + ms).toISOString(), end: new Date(Date.parse(item.end) + ms).toISOString() });
const DAY = 24 * 3600e3;

const impactsFor = (events, item, changes, shownFields = item) => {
  const series = seriesOf(events, item.seriesId ?? item.id);
  const result = {};
  for (const scope of ["following", "all"]) {
    const { calls } = occurrenceEditCalls({ item, series, scope, changes, shown: shownFields });
    result[scope] = scopeImpact(events, item, scope, calls, NOW, changes);
  }
  return result;
};
const NO_IMPACT = {
  changedLost: 0,
  changedGone: 0,
  cancelledLost: 0,
  kept: 0,
  ownLost: false,
  absorbed: 0,
  gone: [],
  goneMore: false,
  laterParts: 0,
  laterOwnTime: 0,
  laterMoved: 0,
  laterOwnDays: 0
};

test("B1. spostare un giorno a un altro giorno con «Questo e i successivi» o «Tutti»: si dice che le modifiche e gli annullamenti si perdono", () => {
  const events = withChangedDays();
  const item = findOccurrence(events, "s", "2026-11-16");
  const moved = shiftMs(item, DAY);
  const impacts = impactsFor(events, item, moved);
  for (const scope of ["following", "all"]) {
    assert.deepEqual(impacts[scope], { ...NO_IMPACT, changedLost: 1, cancelledLost: 1 }, scope);
    // Ciò che si dice è ciò che il motore fa: nessuna riga resta, il 30 annullato torna come 1° dicembre.
    const { calls } = occurrenceEditCalls({ item, series: seriesOf(events), scope, changes: moved, shown: item });
    const after = simulateOccurrenceEdit(events, "s", "2026-11-16", calls, NOW).events;
    assert.deepEqual(after.filter(isOccurrenceRow), [], scope);
    assert.deepEqual(shown(after, "2026-11-16", "2026-12-08"), ["2026-11-17 Lezione", "2026-11-24 Lezione", "2026-12-01 Lezione"], scope);
  }
  const options = scopeOptions({ action: "move", date: "2026-11-16", impacts, span: seriesSpan(events, "s", "2026-11-16", TODAY) });
  for (const id of ["following", "all"]) {
    const details = options.find((option) => option.id === id).details;
    assert.ok(details.includes(SCOPE_TEXT.changedLost(1)), id);
    assert.ok(details.includes(SCOPE_TEXT.cancelledBack(1)), id);
    assert.ok(!details.some((line) => line.includes("restano così")), id);
  }
});

test("B1. stesso giorno, ora diversa: con «Questo e i successivi» le modifiche si perdono e gli annullamenti restano; con «Tutti» restano tutti", () => {
  const events = withChangedDays();
  const item = findOccurrence(events, "s", "2026-11-16");
  const later = shiftMs(item, 3600e3);
  const impacts = impactsFor(events, item, later);
  assert.deepEqual(impacts.following, { ...NO_IMPACT, changedLost: 1, kept: 1 });
  assert.deepEqual(impacts.all, { ...NO_IMPACT, kept: 2 });
  const options = scopeOptions({ action: "move", date: "2026-11-16", impacts });
  assert.deepEqual(options.find((option) => option.id === "following").details.slice(1, 3), [SCOPE_TEXT.changedLost(1), SCOPE_TEXT.othersKept]);
  assert.ok(options.find((option) => option.id === "all").details.includes(SCOPE_TEXT.rowsKept));
  // Solo il titolo, stessa ora: con «Questo e i successivi» restano tutti.
  const title = impactsFor(events, item, { title: "Analisi" }, { ...item, title: "Analisi" });
  assert.deepEqual(title.following, { ...NO_IMPACT, kept: 2 });
});

test("B1. una regola nuova che lascia fuori giorni cambiati o annullati: non «tornano», escono dalla serie (e si dice)", () => {
  // Ogni lunedì dal 2 novembre; il 16 rinominato, il 23 annullato, il 30 rinominato, il 9 rinominato.
  let events = [WEEKLY];
  for (const date of ["2026-11-09", "2026-11-16", "2026-11-30"]) events = apply(events, planEdit(seriesOf(events), events, date, "this", { title: `Cambiato ${date}` }, { now: NOW }));
  events = apply(events, planDelete(events, "s", "2026-11-23", "this", { now: NOW }));
  // Dal 14 dicembre (secondo lunedì): "Ogni mese il secondo lunedì".
  const item = findOccurrence(events, "s", "2026-12-14");
  const rule = repeatPresets("2026-12-14").find((preset) => preset.id === "monthlyNth").rule;
  const impacts = impactsFor(events, item, { repeat: rule });
  // Il 9 è un secondo lunedì e resta; il 16 e il 30 non sono più nella serie; il 23 annullato non torna.
  assert.deepEqual(impacts.all, { ...NO_IMPACT, changedGone: 2, kept: 1 });
  const { calls } = occurrenceEditCalls({ item, series: seriesOf(events), scope: "all", changes: { repeat: rule } });
  const after = simulateOccurrenceEdit(events, "s", "2026-12-14", calls, NOW).events;
  assert.deepEqual(shown(after, "2026-11-01", "2026-12-31"), ["2026-11-09 Cambiato 2026-11-09", "2026-12-14 Lezione"]);
  const all = scopeOptions({ action: "edit", date: "2026-12-14", ruleChanged: true, impacts }).find((option) => option.id === "all");
  assert.ok(all.details.includes(SCOPE_TEXT.changedGone(2)));
  assert.ok(all.details.includes(SCOPE_TEXT.othersKept));
  assert.ok(!all.details.some((line) => line === SCOPE_TEXT.cancelledBack(1) || line === SCOPE_TEXT.changedLost(2)));
});

test("B1. spostare con «Tutti» un giorno cambiato da solo: si dice che perde la sua modifica", () => {
  let events = [WEEKLY];
  events = apply(events, planEdit(WEEKLY, events, "2026-11-16", "this", { title: "Esercitazione" }, { now: NOW }));
  const item = findOccurrence(events, "s", "2026-11-16");
  assert.equal(item.title, "Esercitazione");
  const impacts = impactsFor(events, item, shiftMs(item, DAY));
  assert.equal(impacts.all.ownLost, true);
  assert.equal(impacts.following.ownLost, false, "con «Questo e i successivi» ciò che mostra passa ai successivi");
  const all = scopeOptions({ action: "move", date: "2026-11-16", impacts }).find((option) => option.id === "all");
  assert.ok(all.details.includes(SCOPE_TEXT.ownLost));
  // Stessa ora, giorno uguale: il giorno resta suo.
  assert.equal(impactsFor(events, item, { description: "porta il libro" }).all.ownLost, false);
});

test("S2. «Tutti» da una parte nata da «Questo e i successivi»: si dice da quale giorno; eliminare dice che va via tutta la serie", () => {
  let events = [WEEKLY];
  events = apply(events, planEdit(WEEKLY, events, "2026-11-23", "following", { ...shiftMs(findOccurrence(events, "s", "2026-11-23"), 3600e3) }, { now: NOW }));
  const child = events.find((item) => item.splitFrom === "s");
  const part = seriesSpan(events, child.id, "2026-11-30", TODAY);
  assert.deepEqual(part, { start: "2026-11-23", from: "2026-11-23", past: false, parts: 2 });
  const root = seriesSpan(events, "s", "2026-11-09", TODAY);
  assert.deepEqual(root, { start: "2026-11-02", until: "2026-11-22", past: true, parts: 2 });
  const edit = scopeOptions({ action: "edit", date: "2026-11-30", span: part }).find((option) => option.id === "all").details[0];
  assert.equal(edit, SCOPE_TEXT.allEdit({ from: "lunedì 23 novembre", past: false }));
  assert.ok(!edit.includes("anche quelle passate"));
  // Davanti al giorno della settimana: "da lunedì", "fino a domenica" (non "dal lunedì", "fino al domenica").
  assert.ok(edit.includes("da lunedì 23 novembre in poi"), edit);
  assert.ok(scopeOptions({ action: "edit", date: "2026-11-09", span: root }).find((option) => option.id === "all").details[0].includes("fino a domenica 22 novembre"));
  assert.ok(SCOPE_TEXT.allMove({ from: "lunedì 23 novembre", until: "domenica 6 dicembre", past: false }).includes("da lunedì 23 novembre a domenica 6 dicembre"));
  assert.deepEqual(scopeOptions({ action: "delete", date: "2026-11-30", span: part }).find((option) => option.id === "all").details, [SCOPE_TEXT.allDeleteFamily]);
  // Serie mai divisa, tutta nel futuro: niente "anche quelle passate".
  const future = seriesSpan([event({ start: local(2026, 12, 7), end: local(2026, 12, 7, 13), repeat: { freq: "weekly" } })], "s", "2026-12-14", TODAY);
  assert.deepEqual(future, { start: "2026-12-07", past: false, parts: 1 });
  // Dal primo giorno di una serie mai divisa "Questo e i successivi" sarebbe "Tutti": non c'è.
  assert.deepEqual(scopeOptions({ action: "edit", date: "2026-12-07", span: future }).map((option) => option.id), ["this", "all"]);
  assert.deepEqual(scopeOptions({ action: "delete", date: "2026-12-07", span: future }).map((option) => option.id), ["this", "all"]);
  // Da quello di una parte divisa sì: le due cose sono diverse.
  assert.deepEqual(scopeOptions({ action: "edit", date: "2026-11-23", span: part }).map((option) => option.id), ["this", "following", "all"]);
  assert.equal(scopeOptions({ action: "delete", date: "2026-12-14", span: future }).find((option) => option.id === "all").details[0], SCOPE_TEXT.allDelete(false));
});

test("B2. le scelte pronte e «Personalizza» scrivono i giorni della settimana", () => {
  const weekly = repeatPresets("2026-11-18").find((preset) => preset.id === "weekly");
  assert.deepEqual(weekly.rule, { freq: "weekly", byWeekday: ["WE"] });
  assert.equal(weekly.label, "Ogni settimana il mercoledì");
  assert.deepEqual(ruleFromCustom(customFromRule(null, "2026-11-18"), "2026-11-18"), { freq: "weekly", byWeekday: ["WE"] });
  assert.deepEqual(explicitRule({ freq: "weekly" }, "2026-11-18"), { freq: "weekly", byWeekday: ["WE"] });
  assert.deepEqual(explicitRule({ freq: "monthly" }, "2026-11-18"), { freq: "monthly" });
});

test("B2. alignedSeriesStart: primo giorno della regola dall'inizio della serie in poi", () => {
  assert.equal(alignedSeriesStart({ freq: "weekly", byWeekday: ["WE"] }, "2026-11-18", "2026-11-02"), "2026-11-04");
  assert.equal(alignedSeriesStart({ freq: "monthly" }, "2026-11-18", "2026-11-02"), "2026-11-18");
  assert.equal(alignedSeriesStart({ freq: "monthly" }, "2026-11-18", "2026-09-30"), "2026-10-18");
  assert.equal(alignedSeriesStart({ freq: "monthly", interval: 2 }, "2026-11-18", "2026-08-30"), "2026-09-18");
  assert.equal(alignedSeriesStart({ freq: "monthly", monthly: { by: "weekday", nth: 3, weekday: "WE" } }, "2026-11-18", "2026-11-02"), "2026-11-18");
  assert.equal(alignedSeriesStart({ freq: "yearly" }, "2026-11-18", "2026-11-02"), "2026-11-18");
  assert.equal(alignedSeriesStart({ freq: "daily" }, "2026-11-18", "2026-11-02"), "2026-11-02");
  assert.equal(alignedSeriesStart({ freq: "daily", interval: 3 }, "2026-11-18", "2026-11-02"), "2026-11-03");
  assert.equal(alignedSeriesStart({ freq: "weekly", byWeekday: ["MO", "WE"] }, "2026-11-18", "2026-11-02"), "2026-11-02");
  assert.equal(alignedSeriesStart({ freq: "weekly", interval: 2, byWeekday: ["WE"] }, "2026-11-18", "2026-11-02"), "2026-11-04");
  assert.equal(alignedSeriesStart({ freq: "weekly", byWeekday: ["WE"] }, "2026-11-02", "2026-11-02"), "2026-11-02", "dal primo giorno nulla da spostare");
});

test("B2. regola scelta da un giorno dopo il primo e salvata con «Tutti»: resta quella scelta, senza un primo giorno in più", () => {
  const DAILY = event({ repeat: { freq: "daily" } });
  const item = findOccurrence([DAILY], "s", "2026-11-18");
  const presets = repeatPresets("2026-11-18");
  const save = (id) => {
    const rule = presets.find((preset) => preset.id === id).rule;
    // Orari e regola viaggiano insieme (CALENDAR_EVENT_FIELD_GROUPS): il modulo li manda tutti.
    const changes = { repeat: rule, start: item.start, end: item.end, allDay: false };
    const { calls, newStart } = occurrenceEditCalls({ item, series: DAILY, scope: "all", changes });
    const after = simulateOccurrenceEdit([DAILY], "s", "2026-11-18", calls, NOW).events;
    return { newStart, series: seriesOf(after), dates: expandEvents(after, localMidnight("2026-10-01"), localMidnight("2027-12-01")).map((o) => o.occurrenceDate) };
  };
  const weekly = save("weekly");
  assert.equal(weekly.newStart, "2026-11-04");
  assert.deepEqual(weekly.series.repeat, { freq: "weekly", byWeekday: ["WE"] });
  assert.deepEqual(weekly.dates.slice(0, 4), ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
  assert.equal(new Date(weekly.series.start).getHours(), 12, "stessa ora");
  const monthly = save("monthlyDay");
  assert.equal(monthly.newStart, "2026-11-18");
  assert.deepEqual(monthly.dates.slice(0, 3), ["2026-11-18", "2026-12-18", "2027-01-18"]);
  const nth = save("monthlyNth");
  assert.deepEqual(nth.dates.slice(0, 3), ["2026-11-18", "2026-12-16", "2027-01-20"]);
  const yearly = save("yearly");
  assert.deepEqual(yearly.dates, ["2026-11-18", "2027-11-18"]);
  // Ogni giorno lavorativo: la serie parte ancora dal lunedì 2.
  assert.equal(save("workdays").newStart, undefined);
  // La scelta dice il nuovo primo giorno.
  const all = scopeOptions({ action: "edit", date: "2026-11-18", ruleChanged: true, newStart: "2026-11-04" }).find((option) => option.id === "all");
  assert.ok(all.details.includes(SCOPE_TEXT.newStart("mercoledì 4 novembre")));
  // «Questo e i successivi»: la parte nuova parte dal giorno aperto, con il giorno scritto.
  const rule = presets.find((preset) => preset.id === "weekly").rule;
  const { calls } = occurrenceEditCalls({ item, series: DAILY, scope: "following", changes: { repeat: rule, start: item.start, end: item.end, allDay: false } });
  const after = simulateOccurrenceEdit([DAILY], "s", "2026-11-18", calls, NOW).events;
  const dates = expandEvents(after, localMidnight("2026-11-16"), localMidnight("2026-12-03")).map((o) => o.occurrenceDate);
  assert.deepEqual(dates, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-25", "2026-12-02"]);
});

test("B2. la stessa modifica salvata dallo store dà ciò che la simulazione ha detto", async () => {
  const DAILY = event({ repeat: { freq: "daily" } });
  useStudyStore.setState({ loading: true, events: [DAILY], attachments: [], notes: [], reminders: [] });
  const item = findOccurrence([DAILY], "s", "2026-11-18");
  const changes = { repeat: { freq: "weekly", byWeekday: ["WE"] }, start: item.start, end: item.end, allDay: false };
  const { calls } = occurrenceEditCalls({ item, series: DAILY, scope: "all", changes });
  for (const call of calls) await useStudyStore.getState().editOccurrence("s", "2026-11-18", call.scope, call.patch);
  const stored = seriesOf(useStudyStore.getState().events);
  const simulated = seriesOf(simulateOccurrenceEdit([DAILY], "s", "2026-11-18", calls, NOW).events);
  assert.equal(stored.start, simulated.start);
  assert.deepEqual(stored.repeat, simulated.repeat);
  assert.equal(expandEvents(useStudyStore.getState().events, localMidnight("2026-11-01"), localMidnight("2026-11-30"))[0].occurrenceDate, "2026-11-04");
});

test("B2. spostare di un giorno una serie con il giorno scritto: «Tutti» e «Questo e i successivi» la portano sul giorno nuovo", () => {
  // Ogni martedì scritto (come lo salvano ora le scelte pronte), dal 3 novembre a mezzogiorno.
  const TUESDAYS = event({ start: local(2026, 11, 3), end: local(2026, 11, 3, 13), repeat: { freq: "weekly", byWeekday: ["TU"] } });
  const item = findOccurrence([TUESDAYS], "s", "2026-11-17");
  const moved = shiftMs(item, DAY);
  const all = occurrenceEditCalls({ item, series: TUESDAYS, scope: "all", changes: moved });
  assert.equal(all.newStart, undefined, "spostare non è scegliere una regola nuova: niente «La serie ora inizia…»");
  const afterAll = simulateOccurrenceEdit([TUESDAYS], "s", "2026-11-17", all.calls, NOW).events;
  assert.deepEqual(seriesOf(afterAll).repeat, { freq: "weekly", byWeekday: ["WE"] });
  assert.deepEqual(shown(afterAll, "2026-11-01", "2026-11-26"), ["2026-11-04 Lezione", "2026-11-11 Lezione", "2026-11-18 Lezione", "2026-11-25 Lezione"]);
  const following = occurrenceEditCalls({ item, series: TUESDAYS, scope: "following", changes: moved, shown: item });
  const afterFollowing = simulateOccurrenceEdit([TUESDAYS], "s", "2026-11-17", following.calls, NOW).events;
  assert.deepEqual(shown(afterFollowing, "2026-11-01", "2026-12-03"), [
    "2026-11-03 Lezione",
    "2026-11-10 Lezione",
    "2026-11-18 Lezione",
    "2026-11-25 Lezione",
    "2026-12-02 Lezione"
  ]);
  // «Solo questo»: il giorno si sposta, la serie no.
  const only = occurrenceEditCalls({ item, series: TUESDAYS, scope: "this", changes: moved });
  assert.equal("repeat" in only.calls[0].patch, false);
});

test("B2. il modulo che adatta la regola al giorno nuovo non è «una regola nuova»: c'è «Solo questo» e la regola non va sul giorno", () => {
  const TUESDAYS = event({ start: local(2026, 11, 3), end: local(2026, 11, 3, 13), repeat: { freq: "weekly", byWeekday: ["TU"] } });
  const item = findOccurrence([TUESDAYS], "s", "2026-11-17");
  // Come changeStart nel modulo: inizio al mercoledì e regola adattata a "il mercoledì".
  const adapted = { ...shiftMs(item, DAY), repeat: { freq: "weekly", byWeekday: ["WE"] } };
  assert.equal(userRuleChange({ item, series: TUESDAYS, changes: adapted }), false);
  const only = occurrenceEditCalls({ item, series: TUESDAYS, scope: "this", changes: adapted });
  assert.equal("repeat" in only.calls[0].patch, false);
  const all = occurrenceEditCalls({ item, series: TUESDAYS, scope: "all", changes: adapted });
  assert.equal(all.newStart, undefined);
  assert.deepEqual(seriesOf(simulateOccurrenceEdit([TUESDAYS], "s", "2026-11-17", all.calls, NOW).events).repeat, { freq: "weekly", byWeekday: ["WE"] });
  // Una regola scelta davvero resta una regola nuova.
  assert.equal(userRuleChange({ item, series: TUESDAYS, changes: { ...adapted, repeat: { freq: "daily" } } }), true);
  assert.equal(userRuleChange({ item, series: TUESDAYS, changes: { repeat: { freq: "weekly", byWeekday: ["TU", "TH"] } } }), true);
  assert.equal(userRuleChange({ item, series: TUESDAYS, changes: { repeat: null } }), true);
  assert.equal(userRuleChange({ item, series: TUESDAYS, changes: { title: "Altro" } }), false);
});

const MONDAYS = () => event({ repeat: { freq: "weekly", byWeekday: ["MO"] } });

test("R1-S1. «Tutti» verso un giorno della settimana prima: la serie tiene la sua prima data (1/11, non 8/11)", () => {
  const series = MONDAYS();
  for (const date of ["2026-11-16", "2026-11-02"]) {
    const item = findOccurrence([series], "s", date);
    const moved = shiftMs(item, -DAY);
    const { calls, newStart } = occurrenceEditCalls({ item, series, scope: "all", changes: moved });
    assert.equal(newStart, undefined, date);
    const after = simulateOccurrenceEdit([series], "s", date, calls, NOW).events;
    assert.deepEqual(seriesOf(after).repeat, { freq: "weekly", byWeekday: ["SU"] }, date);
    assert.deepEqual(shown(after, "2026-10-25", "2026-11-23"), ["2026-11-01 Lezione", "2026-11-08 Lezione", "2026-11-15 Lezione", "2026-11-22 Lezione"], date);
  }
  // Dal modulo (inizio spostato alla domenica, regola adattata da sola): lo stesso.
  const item = findOccurrence([series], "s", "2026-11-16");
  const changes = { ...shiftMs(item, -DAY), repeat: { freq: "weekly", byWeekday: ["SU"] } };
  const { calls, newStart } = occurrenceEditCalls({ item, series, scope: "all", changes });
  assert.equal(newStart, undefined);
  assert.equal(shown(simulateOccurrenceEdit([series], "s", "2026-11-16", calls, NOW).events, "2026-10-25", "2026-11-09")[0], "2026-11-01 Lezione");
  assert.equal(alignedSeriesStart({ freq: "weekly", byWeekday: ["SU"] }, "2026-11-15", "2026-11-02", "2026-11-01"), "2026-11-01");
  // Una regola scelta a mano resta dal primo giorno in poi (B2).
  assert.equal(alignedSeriesStart({ freq: "weekly", byWeekday: ["SU"] }, "2026-11-15", "2026-11-02"), "2026-11-08");
});

test("Nit 2. «La serie ora inizia…» solo se il primo giorno cambia davvero", () => {
  const series = MONDAYS();
  const item = findOccurrence([series], "s", "2026-11-16");
  // Inizio spostato a martedì e regola "ogni giorno": la serie parte ancora lunedì 2.
  const changes = { ...shiftMs(item, DAY), repeat: { freq: "daily" } };
  const { calls, newStart } = occurrenceEditCalls({ item, series, scope: "all", changes });
  assert.equal(newStart, undefined);
  assert.equal(shown(simulateOccurrenceEdit([series], "s", "2026-11-16", calls, NOW).events, "2026-11-01", "2026-11-04")[0], "2026-11-02 Lezione");
  // Ogni mercoledì scelto dal 18: la serie parte mercoledì 4, e lo si dice.
  const wednesday = findOccurrence([event({ repeat: { freq: "daily" } })], "s", "2026-11-18");
  assert.equal(
    occurrenceEditCalls({ item: wednesday, series: event({ repeat: { freq: "daily" } }), scope: "all", changes: { repeat: { freq: "weekly" } } }).newStart,
    "2026-11-04"
  );
});

/** Mezzogiorno a Roma del 2 novembre: per le serie con il fuso di Roma, stessi giorni da ogni dispositivo. */
const ROME_NOON = { start: "2026-11-02T11:00:00.000Z", end: "2026-11-02T12:00:00.000Z" };

test("R1-B1. tutta la serie spostata a un altro giorno (evento di un'altra persona, agente senza giorno): la regola segue", () => {
  const series = { ...MONDAYS(), ...ROME_NOON, recurrence: "weekly", repeatLegacy: "weekly|", timeZone: "Europe/Rome" };
  const start = new Date(Date.parse(series.start) + DAY).toISOString();
  const end = new Date(Date.parse(series.end) + DAY).toISOString();
  const patch = seriesMovePatch(series, start, end);
  assert.deepEqual(patch, { start, end, repeat: { freq: "weekly", byWeekday: ["TU"] }, recurrence: "weekly", recurrenceUntil: undefined, repeatLegacy: "weekly|" });
  const after = { ...series, ...patch };
  assert.deepEqual(shown([after], "2026-11-01", "2026-11-26"), ["2026-11-03 Lezione", "2026-11-10 Lezione", "2026-11-17 Lezione", "2026-11-24 Lezione"]);
  // Stessa settimana dell'ora: solo gli orari. Regola senza giorno scritto, o nessuna regola: solo gli orari.
  const later = new Date(Date.parse(series.start) + 3600e3).toISOString();
  assert.deepEqual(seriesMovePatch(series, later, end), { start: later, end });
  assert.deepEqual(seriesMovePatch(WEEKLY, start, end), { start, end });
  assert.deepEqual(seriesMovePatch(event({}), start, end), { start, end });
});

test("Nit 6. «Questo e i successivi» da un giorno cambiato da solo: si dice che i giorni dopo ne prendono titolo e dettagli", () => {
  const following = (rowContent) =>
    scopeOptions({ action: "move", date: "2026-11-16", rowContent }).find((option) => option.id === "following").details;
  assert.ok(following(true).includes(SCOPE_TEXT.followingTakesDay));
  assert.ok(!following(false).includes(SCOPE_TEXT.followingTakesDay));
});

// Giorni feriali (lun–ven) a mezzogiorno dal lunedì 2 novembre, come la scelta pronta.
const WORKDAYS = () => event({ repeat: { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] } });
const TUE_SAT = ["TU", "WE", "TH", "FR", "SA"];
const dates = (events, from, to) => expandEvents(events, localMidnight(from), localMidnight(to)).map((item) => item.occurrenceDate);
const days = (from, to, weekdays) => {
  const names = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const result = [];
  for (let day = new Date(`${from}T12:00:00Z`); day <= new Date(`${to}T12:00:00Z`); day = new Date(day.getTime() + DAY)) {
    if (weekdays.includes(names[day.getUTCDay()])) result.push(day.toISOString().slice(0, 10));
  }
  return result;
};

test("R2-S1. la regola con più giorni segue lo spostamento: tutti i giorni dello stesso scarto", () => {
  const workdays = { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] };
  assert.deepEqual(movedRule(workdays, "2026-11-16", "2026-11-17"), { freq: "weekly", byWeekday: TUE_SAT });
  assert.deepEqual(movedRule(workdays, "2026-11-16", "2026-11-15"), { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "SU"] });
  // Ogni 2 settimane: anche l'inizio della settimana si sposta (WKST), così le coppie restano insieme.
  assert.deepEqual(movedRule({ freq: "weekly", byWeekday: ["MO", "WE"], interval: 2 }, "2026-11-18", "2026-11-19"), {
    freq: "weekly",
    byWeekday: ["TU", "TH"],
    interval: 2,
    wkst: "TU"
  });
  assert.equal("wkst" in movedRule({ freq: "weekly", byWeekday: ["TU", "TH"], interval: 2, wkst: "TU" }, "2026-11-17", "2026-11-16"), false);
  // Stesso giorno della settimana (una settimana dopo), o un giorno che la regola non ha: la regola resta.
  assert.equal(movedRule(workdays, "2026-11-16", "2026-11-23"), workdays);
  assert.equal(movedRule({ freq: "weekly", byWeekday: ["MO", "WE"] }, "2026-11-17", "2026-11-18").byWeekday.join(), "MO,WE");
  // Un giorno solo e il mensile: come prima.
  assert.deepEqual(movedRule({ freq: "weekly", byWeekday: ["MO"] }, "2026-11-16", "2026-11-17"), { freq: "weekly", byWeekday: ["TU"] });
  assert.equal(weekdaysText(["MO", "TU", "WE", "TH", "FR"]), "lun–ven");
  assert.equal(weekdaysText(TUE_SAT), "mar–sab");
  assert.equal(weekdaysText(["MO", "TU", "WE", "TH", "SU"]), "dom–gio");
  assert.equal(weekdaysText(["MO", "WE"]), "lun, mer");
  assert.equal(weekdaysText(["MO", "TU", "FR"]), "lun, mar, ven");
});

test("R2-S1. editor «Tutti»: Giorni feriali spostati dal lunedì al martedì diventano mar–sab, senza perdere la prima data", () => {
  const series = WORKDAYS();
  for (const date of ["2026-11-16", "2026-11-02"]) {
    const item = findOccurrence([series], "s", date);
    // Trascinamento (solo gli orari) e modulo (inizio cambiato e altro, regola non toccata): lo stesso.
    for (const changes of [shiftMs(item, DAY), { ...shiftMs(item, DAY), notes: "Aula 2" }]) {
      const { calls, newStart, weekdays } = occurrenceEditCalls({ item, series, scope: "all", changes });
      assert.equal(newStart, undefined, date);
      assert.deepEqual(weekdays, { from: ["MO", "TU", "WE", "TH", "FR"], to: TUE_SAT }, date);
      const after = simulateOccurrenceEdit([series], "s", date, calls, NOW).events;
      assert.deepEqual(seriesOf(after).repeat, { freq: "weekly", byWeekday: TUE_SAT }, date);
      assert.deepEqual(dates(after, "2026-11-01", "2026-11-29"), days("2026-11-03", "2026-11-28", TUE_SAT), date);
    }
  }
  // La scelta lo dice: "Tutte le date passano da lun–ven a mar–sab".
  const options = scopeOptions({ action: "move", date: "2026-11-16", daysShift: { from: ["MO", "TU", "WE", "TH", "FR"], to: TUE_SAT } });
  assert.ok(options.find((option) => option.id === "all").details.includes(SCOPE_TEXT.allDaysShift("lun–ven", "mar–sab")));
  assert.ok(options.find((option) => option.id === "following").details.includes(SCOPE_TEXT.followingDaysShift("lun–ven", "mar–sab")));
  assert.ok(!options.find((option) => option.id === "this").details.some((line) => line.includes("mar–sab")));
  assert.equal(SCOPE_TEXT.allDaysShift("lun–ven", "mar–sab"), "Tutte le date passano da lun–ven a mar–sab.");
  // Una regola scelta a mano non si sposta e non si dice.
  const item = findOccurrence([series], "s", "2026-11-16");
  const chosen = occurrenceEditCalls({ item, series, scope: "all", changes: { ...shiftMs(item, DAY), repeat: { freq: "weekly", byWeekday: ["TU", "TH"] } } });
  assert.equal(chosen.weekdays, undefined);
});

test("R2-S1. editor «Questo e i successivi»: dal 16 le date passano a mar–sab, prima restano lun–ven", () => {
  const series = WORKDAYS();
  const item = findOccurrence([series], "s", "2026-11-16");
  const { calls, weekdays } = occurrenceEditCalls({ item, series, scope: "following", changes: shiftMs(item, DAY), shown: item });
  assert.deepEqual(weekdays, { from: ["MO", "TU", "WE", "TH", "FR"], to: TUE_SAT });
  const after = simulateOccurrenceEdit([series], "s", "2026-11-16", calls, NOW).events;
  assert.deepEqual(dates(after, "2026-11-01", "2026-11-29"), [...days("2026-11-02", "2026-11-13", ["MO", "TU", "WE", "TH", "FR"]), ...days("2026-11-17", "2026-11-28", TUE_SAT)]);
  assert.deepEqual(after.find((entry) => entry.splitFrom === "s").repeat, { freq: "weekly", byWeekday: TUE_SAT });
  // Dal mercoledì 18 al giovedì 19: lunedì 16 e martedì 17 restano, poi gio, ven, sab.
  const wednesday = findOccurrence([series], "s", "2026-11-18");
  const later = occurrenceEditCalls({ item: wednesday, series, scope: "following", changes: shiftMs(wednesday, DAY), shown: wednesday });
  const moved = simulateOccurrenceEdit([series], "s", "2026-11-18", later.calls, NOW).events;
  assert.deepEqual(dates(moved, "2026-11-16", "2026-11-23"), ["2026-11-16", "2026-11-17", "2026-11-19", "2026-11-20", "2026-11-21"]);
});

test("R2-S1. tutta la serie spostata (agente senza giorno, evento di un'altra persona): ogni giorno della regola dello stesso scarto", () => {
  const series = { ...event({ repeat: { freq: "weekly", byWeekday: ["MO", "WE"] }, ...ROME_NOON }), recurrence: "weekly", repeatLegacy: "weekly|", timeZone: "Europe/Rome" };
  const start = new Date(Date.parse(series.start) + DAY).toISOString();
  const end = new Date(Date.parse(series.end) + DAY).toISOString();
  const patch = seriesMovePatch(series, start, end);
  assert.deepEqual(patch.repeat, { freq: "weekly", byWeekday: ["TU", "TH"] });
  const after = { ...series, ...patch };
  // Prima data martedì 3 (nessun martedì in più davanti a lunedì e mercoledì).
  assert.deepEqual(dates([after], "2026-11-01", "2026-11-15"), ["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12"]);
  // Ogni 2 settimane lun e mer, spostata di 6 giorni (lunedì 2 → domenica 8): dom 8, mar 10, dom 22, mar 24.
  const biweekly = { ...series, repeat: { freq: "weekly", byWeekday: ["MO", "WE"], interval: 2 }, recurrence: "none", repeatLegacy: "none|" };
  const sixDays = seriesMovePatch(biweekly, new Date(Date.parse(series.start) + 6 * DAY).toISOString(), new Date(Date.parse(series.end) + 6 * DAY).toISOString());
  assert.deepEqual(dates([{ ...biweekly, ...sixDays }], "2026-11-01", "2026-11-29"), ["2026-11-08", "2026-11-10", "2026-11-22", "2026-11-24"]);
  // La scelta per l'evento altrui lo dice.
  const shared = scopeOptions({ action: "move", date: "2026-11-09", sharedOnly: true, daysShift: { from: ["MO", "WE"], to: ["TU", "TH"] } });
  assert.deepEqual(shared[0].details, [SCOPE_TEXT.sharedAll, SCOPE_TEXT.allDaysShift("lun, mer", "mar, gio")]);
});

// ---------------------------------------------------------------------------------------
// Revisione finale B1: il giorno della settimana si legge nel fuso della serie, non in quello del
// dispositivo. Ogni test fissa il fuso del dispositivo e lo rimette com'era.
// ---------------------------------------------------------------------------------------

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
/** Ogni lunedì a Roma, dalle `start` (istante UTC del 2 novembre) per un'ora. */
const romeMondays = (start) => ({
  ...event({ start, end: new Date(Date.parse(start) + 3600e3).toISOString() }),
  recurrence: "weekly",
  repeat: { freq: "weekly", byWeekday: ["MO"] },
  repeatLegacy: "weekly|",
  timeZone: "Europe/Rome"
});
/** Giorno della settimana e ora a Roma di ogni data di novembre. */
const romeShown = (events) =>
  expandEvents(events, new Date("2026-11-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z")).map((item) =>
    new Date(item.start).toLocaleString("en-GB", { timeZone: "Europe/Rome", weekday: "short", hour: "2-digit", minute: "2-digit" })
  );

test("B1. serie di Roma cambiata da Tokyo: solo l'ora (18:00 → 17:30 dello stesso lunedì), la regola resta il lunedì", () => {
  // Lunedì 18:00 a Roma = martedì 02:00 a Tokyo: i due fusi cadono in giorni diversi.
  const series = romeMondays("2026-11-02T17:00:00.000Z");
  for (const zone of ["Asia/Tokyo", "Europe/Rome"]) {
    withTz(zone, () => {
      const item = findOccurrence([series], "s", "2026-11-16");
      const changes = { start: "2026-11-16T16:30:00.000Z", end: "2026-11-16T17:30:00.000Z" };
      assert.equal(userRuleChange({ item, series, changes }), false, zone);
      for (const scope of ["all", "following"]) {
        const { calls, weekdays } = occurrenceEditCalls({ item, series, scope, changes, shown: item });
        assert.ok(calls.every((call) => !("repeat" in call.patch)), `${zone} ${scope}: ${JSON.stringify(calls)}`);
        assert.equal(weekdays, undefined, `${zone} ${scope}`);
        const after = simulateOccurrenceEdit([series], "s", "2026-11-16", calls, NOW).events;
        const expected = scope === "all" ? ["Mon 17:30", "Mon 17:30", "Mon 17:30", "Mon 17:30", "Mon 17:30"] : ["Mon 18:00", "Mon 18:00", "Mon 17:30", "Mon 17:30", "Mon 17:30"];
        assert.deepEqual(romeShown(after), expected, `${zone} ${scope}`);
      }
      // La scelta non dice che le date cambiano giorno.
      const impact = scopeImpact([series], item, "all", occurrenceEditCalls({ item, series, scope: "all", changes }).calls, NOW, changes);
      assert.deepEqual(impact, NO_IMPACT, zone);
    });
  }
});

test("B1. serie di Roma cambiata da Londra: lunedì 00:30 → 00:00 resta lunedì (non domenica)", () => {
  // Lunedì 00:30 a Roma = domenica 23:30 a Londra.
  const series = romeMondays("2026-11-01T23:30:00.000Z");
  withTz("Europe/London", () => {
    const item = findOccurrence([series], "s", "2026-11-16");
    const changes = { start: "2026-11-15T23:00:00.000Z", end: "2026-11-16T00:00:00.000Z" };
    for (const scope of ["all", "following"]) {
      const { calls } = occurrenceEditCalls({ item, series, scope, changes, shown: item });
      assert.ok(calls.every((call) => !("repeat" in call.patch)), `${scope}: ${JSON.stringify(calls)}`);
      const after = simulateOccurrenceEdit([series], "s", "2026-11-16", calls, NOW).events;
      assert.ok(romeShown(after).every((text) => text.startsWith("Mon")), `${scope}: ${romeShown(after)}`);
      assert.deepEqual(seriesOf(after, scope === "all" ? "s" : "s~2026-11-16").repeat, { freq: "weekly", byWeekday: ["MO"] }, scope);
    }
  });
});

test("B1. da un altro fuso uno spostamento vero di giorno (a Roma) porta la regola sul giorno nuovo", () => {
  const series = romeMondays("2026-11-02T17:00:00.000Z");
  for (const zone of ["Asia/Tokyo", "Pacific/Honolulu", "Europe/Rome"]) {
    withTz(zone, () => {
      const item = findOccurrence([series], "s", "2026-11-16");
      // Lunedì 16 18:00 → martedì 17 18:00 a Roma.
      const changes = shiftMs(item, DAY);
      const { calls } = occurrenceEditCalls({ item, series, scope: "all", changes });
      const after = simulateOccurrenceEdit([series], "s", "2026-11-16", calls, NOW).events;
      assert.deepEqual(seriesOf(after).repeat, { freq: "weekly", byWeekday: ["TU"] }, zone);
      assert.deepEqual(romeShown(after), ["Tue 18:00", "Tue 18:00", "Tue 18:00", "Tue 18:00"], zone);
    });
  }
});

test("B1. «Tutti» con una regola nuova scelta da un altro fuso: la serie parte dal giorno giusto a Roma", () => {
  // Ogni giorno alle 18 a Roma dal 2; dal mercoledì 18 diventa "ogni settimana": parte mercoledì 4.
  const series = { ...romeMondays("2026-11-02T17:00:00.000Z"), repeat: { freq: "daily" }, recurrence: "daily", repeatLegacy: "daily|" };
  for (const zone of ["Asia/Tokyo", "Pacific/Kiritimati", "Europe/Rome"]) {
    withTz(zone, () => {
      const wednesday = findOccurrence([series], "s", "2026-11-18");
      const { calls, newStart } = occurrenceEditCalls({ item: wednesday, series, scope: "all", changes: { repeat: { freq: "weekly" } } });
      assert.equal(newStart, "2026-11-04", zone);
      const after = simulateOccurrenceEdit([series], "s", "2026-11-18", calls, NOW).events;
      assert.deepEqual(seriesOf(after).repeat, { freq: "weekly", byWeekday: ["WE"] }, zone);
      assert.deepEqual(romeShown(after), ["Wed 18:00", "Wed 18:00", "Wed 18:00", "Wed 18:00"], zone);
    });
  }
});

test("R3-S1 (revisione finale). «Questo e i successivi» a un altro giorno su una serie di N volte: la serie finisce quando finiva prima", () => {
  const cases = [
    {
      name: "lun ×6",
      repeat: { freq: "weekly", byWeekday: ["MO"], end: { type: "count", count: 6 } },
      date: "2026-11-16",
      expected: ["2026-11-02", "2026-11-09", "2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08"],
      rule: { freq: "weekly", byWeekday: ["TU"], end: { type: "count", count: 4 } }
    },
    {
      name: "lun e mer ×6",
      repeat: { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "count", count: 6 } },
      date: "2026-11-16",
      expected: ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-17", "2026-11-19"],
      rule: { freq: "weekly", byWeekday: ["TU", "TH"], end: { type: "count", count: 2 } }
    },
    {
      name: "primo lunedì del mese ×4",
      repeat: { freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "MO" }, end: { type: "count", count: 4 } },
      date: "2026-12-07",
      // Dal 7 dicembre all'8 (secondo martedì): le 3 date rimaste diventano "il secondo martedì".
      expected: ["2026-11-02", "2026-12-08", "2027-01-12", "2027-02-09"],
      rule: { freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TU" }, end: { type: "count", count: 3 } }
    }
  ];
  for (const { name, repeat, date, expected, rule } of cases) {
    const series = event({ repeat });
    assert.equal(dates([series], "2026-11-01", "2027-12-31").length, expected.length, name);
    const item = findOccurrence([series], "s", date);
    const { calls } = occurrenceEditCalls({ item, series, scope: "following", changes: shiftMs(item, DAY), shown: item });
    const after = simulateOccurrenceEdit([series], "s", date, calls, NOW).events;
    assert.deepEqual(dates(after, "2026-11-01", "2027-12-31"), expected, name);
    assert.deepEqual(seriesOf(after, `s~${date}`).repeat, rule, name);
  }
  // Una regola scelta a mano con le sue volte resta com'è (la scelta è di chi la scrive).
  const series = event({ repeat: { freq: "weekly", byWeekday: ["MO"], end: { type: "count", count: 6 } } });
  const item = findOccurrence([series], "s", "2026-11-16");
  const chosen = { freq: "weekly", byWeekday: ["FR"], end: { type: "count", count: 6 } };
  const { calls } = occurrenceEditCalls({ item, series, scope: "following", changes: { repeat: chosen }, shown: item });
  assert.deepEqual(calls[0].patch.repeat, chosen);
});

test("R1-S1 (revisione finale). La scelta dice che le parti divise prima restano, o quali date spariscono con una regola nuova", () => {
  // Ogni lunedì; dal 30/11 lunedì e venerdì (un «Questo e i successivi» di prima).
  let events = [WEEKLY];
  events = apply(events, planEdit(WEEKLY, events, "2026-11-30", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "FR"] } }, { now: NOW }));
  const item = findOccurrence(events, "s", "2026-11-16");
  // Solo il titolo: la parte del 30/11 resta, nessuna data sparisce.
  const title = impactsFor(events, item, { title: "Nuovo" });
  assert.deepEqual(title.following, { ...NO_IMPACT, laterParts: 1 });
  const titleLines = scopeOptions({ action: "edit", date: "2026-11-16", impacts: title }).find((option) => option.id === "following").details;
  assert.deepEqual(titleLines.slice(1), [SCOPE_TEXT.followingKeepsSplits, SCOPE_TEXT.followingKeepsEnd]);
  // Un'ora dopo: la parte del 30/11 aveva la stessa ora e la prende (nessuna riga sul suo orario).
  assert.equal(impactsFor(events, item, shiftMs(item, 3600e3)).following.laterOwnTime, 0);
  // Lunedì e mercoledì: la parte si sostituisce e i venerdì spariscono, detti per nome.
  const rule = { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } };
  const ruled = impactsFor(events, item, rule).following;
  assert.deepEqual([ruled.absorbed, ruled.goneMore], [1, true], "la parte non aveva fine: i venerdì spariscono anche dopo un anno");
  assert.deepEqual(ruled.gone.slice(0, 6), ["2026-12-04", "2026-12-11", "2026-12-18", "2026-12-25", "2027-01-01", "2027-01-08"]);
  const ruleLines = scopeOptions({ action: "edit", date: "2026-11-16", ruleChanged: true, impacts: { following: ruled } }).find((option) => option.id === "following").details;
  assert.deepEqual(ruleLines.slice(1), [SCOPE_TEXT.followingSplits, "Spariscono: ven 4, 11, 18, 25 dic, ven 1, 8 gen e altre date dopo."]);

  // Una parte con un orario suo: con l'ora nuova lo tiene, e lo si dice.
  let timed = [WEEKLY];
  const late = findOccurrence(timed, "s", "2026-11-30");
  timed = apply(timed, planEdit(WEEKLY, timed, "2026-11-30", "following", shiftMs(late, 2 * 3600e3), { now: NOW }));
  const first = findOccurrence(timed, "s", "2026-11-16");
  const moved = impactsFor(timed, first, shiftMs(first, 3600e3)).following;
  assert.deepEqual([moved.laterParts, moved.laterOwnTime], [1, 1]);
  const movedLines = scopeOptions({ action: "move", date: "2026-11-16", impacts: { following: moved } }).find((option) => option.id === "following").details;
  assert.deepEqual(movedLines.slice(1, 3), [SCOPE_TEXT.followingKeepsSplits, SCOPE_TEXT.followingSplitsOwnTime]);
  const after = simulateOccurrenceEdit(timed, "s", "2026-11-16", [{ scope: "following", patch: shiftMs(first, 3600e3) }], NOW).events;
  assert.deepEqual(
    expandEvents(after, localMidnight("2026-11-16"), localMidnight("2026-12-08")).map((occurrence) => [occurrence.occurrenceDate, new Date(occurrence.start).getHours()]),
    [["2026-11-16", 13], ["2026-11-23", 13], ["2026-11-30", 14], ["2026-12-07", 14]]
  );
});

test("date in breve per mese: il giorno della settimana solo quando cambia", () => {
  assert.equal(shortDatesText(["2026-12-04", "2026-12-11", "2026-12-18", "2027-01-01", "2027-01-04"]), "ven 4, 11, 18 dic, ven 1, lun 4 gen");
  assert.equal(shortDatesText([]), "");
});

// ---------------------------------------------------------------------------------------
// R1-S1, seconda revisione: una regola nuova assorbe tutto ciò che viene dopo (anche le parti
// divise da un antenato) fino alla fine della famiglia; uno spostamento di giorno sposta le parti
// successive con gli stessi giorni e lo stesso orario e non fa sparire nulla.
// ---------------------------------------------------------------------------------------

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayView = (events, from, to) =>
  expandEvents(events, localMidnight(from), localMidnight(to)).map(
    (item) => `${item.occurrenceDate} ${WEEKDAY_NAMES[new Date(`${item.occurrenceDate}T12:00:00Z`).getUTCDay()]} ${item.title}`
  );
/** Come il calendario: chiamate, impatto e testo della scelta, poi le chiamate applicate con il motore. */
const following = (events, seriesId, date, changes, action = "edit", ruleChanged = false) => {
  const item = findOccurrence(events, seriesId, date);
  assert.ok(item, `${seriesId} ${date}`);
  const series = seriesOf(events, seriesId);
  const { calls } = occurrenceEditCalls({ item, series, scope: "following", changes, shown: item });
  const impact = scopeImpact(events, item, "following", calls, NOW, changes);
  const lines = scopeOptions({ action, date, ruleChanged, impacts: { following: impact } }).find((option) => option.id === "following").details;
  return { after: simulateOccurrenceEdit(events, seriesId, date, calls, NOW).events, impact, lines: lines.slice(1) };
};
const laterOf = (impact) => [impact.absorbed, impact.gone, impact.laterParts, impact.laterMoved, impact.laterOwnDays];

test("R1-S1 bis (A). Regola nuova da una parte di una parte: assorbe anche la parte divisa dall'antenato e arriva alla fine della famiglia", () => {
  // P ogni lunedì; R dal 30/11, Q dal 9/11 (si ferma a R), E dal 16/11 della parte Q: R è divisa dall'antenato.
  let events = [MONDAYS()];
  events = following(events, "s", "2026-11-30", { title: "R" }).after;
  events = following(events, "s", "2026-11-09", { title: "Q" }).after;
  events = following(events, "s~2026-11-09", "2026-11-16", { title: "E" }).after;
  const e = "s~2026-11-09~2026-11-16";
  // La regola com'è nel modulo (con la fine che E ha per la divisione, 29/11) e com'è dall'agente (senza fine).
  for (const [label, end] of [["modulo", normalizeRepeat(seriesOf(events, e)).end], ["agente", undefined]]) {
    const repeat = { freq: "weekly", byWeekday: ["MO", "WE"], ...(end ? { end } : {}) };
    const { after, impact, lines } = following(events, e, "2026-11-23", { title: "Z", repeat }, "edit", true);
    assert.equal(after.some((item) => item.id === "s~2026-11-30"), false, `${label}: R si assorbe`);
    assert.deepEqual(normalizeRepeat(seriesOf(after, `${e}~2026-11-23`)), { freq: "weekly", byWeekday: ["MO", "WE"] }, `${label}: fino alla fine della famiglia (mai)`);
    assert.deepEqual(
      weekdayView(after, "2026-11-01", "2026-12-15"),
      [
        "2026-11-02 Mon Lezione",
        "2026-11-09 Mon Q",
        "2026-11-16 Mon E",
        ...["2026-11-23 Mon", "2026-11-25 Wed", "2026-11-30 Mon", "2026-12-02 Wed", "2026-12-07 Mon", "2026-12-09 Wed", "2026-12-14 Mon"].map((day) => `${day} Z`)
      ],
      label
    );
    // I lunedì di R restano (con la regola nuova): non sparisce nulla, ma R perde il suo titolo e lo si dice.
    assert.deepEqual(laterOf(impact), [1, [], 0, 0, 0], label);
    assert.deepEqual(lines, [SCOPE_TEXT.followingSplits], label);
  }
  // Una fine scelta nel modulo vince: dopo il 13/12 i lunedì di R spariscono, e si dicono.
  const chosen = following(events, e, "2026-11-23", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "until", date: "2026-12-13" } } }, "edit", true);
  assert.equal(weekdayView(chosen.after, "2026-11-01", "2027-02-01").at(-1), "2026-12-09 Wed E");
  assert.deepEqual([chosen.impact.absorbed, chosen.impact.gone.slice(0, 3), chosen.impact.goneMore], [1, ["2026-12-14", "2026-12-21", "2026-12-28"], true]);
});

test("R1-S1 bis (A). Giorni cambiati nel modulo (lun → lun e mer) dopo una divisione: la parte arriva alla fine della famiglia", () => {
  // Divisione dal 30/11 con solo il titolo: i suoi lunedì restano con la regola nuova (ma senza il titolo A).
  let events = [MONDAYS()];
  events = following(events, "s", "2026-11-30", { title: "A" }).after;
  const shownRule = normalizeRepeat(seriesOf(events));
  assert.deepEqual(shownRule.end, { type: "until", date: "2026-11-29" }, "il modulo mostra «fino al 29/11»");
  const { after, impact, lines } = following(events, "s", "2026-11-16", { repeat: { ...shownRule, byWeekday: ["MO", "WE"] } }, "edit", true);
  assert.deepEqual(normalizeRepeat(seriesOf(after, "s~2026-11-16")), { freq: "weekly", byWeekday: ["MO", "WE"] });
  assert.deepEqual(
    weekdayView(after, "2026-11-14", "2026-12-08"),
    ["2026-11-16 Mon", "2026-11-18 Wed", "2026-11-23 Mon", "2026-11-25 Wed", "2026-11-30 Mon", "2026-12-02 Wed", "2026-12-07 Mon"].map((day) => `${day} Lezione`)
  );
  assert.deepEqual(laterOf(impact), [1, [], 0, 0, 0]);
  assert.deepEqual(lines, [SCOPE_TEXT.followingSplits]);

  // Divisione con lunedì e venerdì: i venerdì spariscono e si dicono per nome.
  let fridays = [MONDAYS()];
  fridays = following(fridays, "s", "2026-11-30", { repeat: { freq: "weekly", byWeekday: ["MO", "FR"] } }, "edit", true).after;
  const ruled = following(fridays, "s", "2026-11-16", { repeat: { ...normalizeRepeat(seriesOf(fridays)), byWeekday: ["MO", "WE"] } }, "edit", true);
  assert.deepEqual([ruled.impact.absorbed, ruled.impact.gone.slice(0, 3), ruled.impact.goneMore], [1, ["2026-12-04", "2026-12-11", "2026-12-18"], true]);
  assert.deepEqual(ruled.lines, [SCOPE_TEXT.followingSplits, "Spariscono: ven 4, 11, 18, 25 dic, ven 1, 8 gen e altre date dopo."]);

  // La famiglia finisce: la parte nuova finisce alla sua ultima data (con «fino al» domenica 10/1,
  // lunedì 4/1: niente mercoledì 6/1 in più); con le volte, lo stesso.
  let ended = [MONDAYS()];
  ended = following(ended, "s", "2026-11-30", { title: "A" }).after;
  ended = apply(ended, planDelete(ended, "s~2026-11-30", "2027-01-11", "following", { now: NOW }));
  const endedAfter = following(ended, "s", "2026-11-16", { repeat: { ...normalizeRepeat(seriesOf(ended)), byWeekday: ["MO", "WE"] } }, "edit", true);
  assert.deepEqual(normalizeRepeat(seriesOf(endedAfter.after, "s~2026-11-16")).end, { type: "until", date: "2027-01-04" });
  assert.equal(weekdayView(endedAfter.after, "2026-11-01", "2027-06-01").at(-1), "2027-01-04 Mon Lezione");
  assert.deepEqual(endedAfter.impact.gone, []);
  let counted = [event({ repeat: { freq: "weekly", byWeekday: ["MO"], end: { type: "count", count: 10 } } })];
  counted = following(counted, "s", "2026-11-30", { title: "A" }).after;
  const countedAfter = following(counted, "s", "2026-11-16", { repeat: { ...normalizeRepeat(seriesOf(counted)), byWeekday: ["MO", "WE"] } }, "edit", true);
  assert.deepEqual(normalizeRepeat(seriesOf(countedAfter.after, "s~2026-11-16")).end, { type: "until", date: "2027-01-04" });
  assert.equal(weekdayView(countedAfter.after, "2026-11-01", "2027-06-01").at(-1), "2027-01-04 Mon Lezione");
});

test("R1-S1 bis (B). Spostare dal lunedì al martedì «Questo e i successivi»: la parte dopo con gli stessi giorni e orario si sposta, niente sparisce", () => {
  for (const [label, make] of [["lunedì scritto", MONDAYS], ["ogni settimana", () => WEEKLY]]) {
    let events = [make()];
    events = following(events, "s", "2026-11-30", { title: "A" }).after;
    const before = weekdayView(events, "2026-11-01", "2027-05-27").length;
    for (const [shift, until, days] of [
      [1, "2027-05-28", ["2026-11-17 Tue Lezione", "2026-11-24 Tue Lezione", "2026-12-01 Tue A", "2026-12-08 Tue A", "2026-12-15 Tue A"]],
      [-1, "2027-05-26", ["2026-11-15 Sun Lezione", "2026-11-22 Sun Lezione", "2026-11-29 Sun A", "2026-12-06 Sun A", "2026-12-13 Sun A"]]
    ]) {
      const item = findOccurrence(events, "s", "2026-11-16");
      const { after, impact, lines } = following(events, "s", "2026-11-16", shiftMs(item, shift * DAY), "move");
      assert.deepEqual(weekdayView(after, "2026-11-01", "2026-12-16"), ["2026-11-02 Mon Lezione", "2026-11-09 Mon Lezione", ...days], `${label} ${shift}`);
      assert.equal(weekdayView(after, "2026-11-01", until).length, before, `${label} ${shift}: nessuna data sparisce`);
      assert.deepEqual(laterOf(impact), [0, [], 1, 1, 0], `${label} ${shift}`);
      assert.deepEqual(lines, [SCOPE_TEXT.followingMovesSplits, SCOPE_TEXT.followingKeepsEnd], `${label} ${shift}`);
    }
    // Dal primo giorno (la serie è divisa, quindi c'è «Questo e i successivi»): lo stesso.
    const first = following(events, "s", "2026-11-02", shiftMs(findOccurrence(events, "s", "2026-11-02"), DAY), "move");
    assert.deepEqual(
      weekdayView(first.after, "2026-11-01", "2026-12-09"),
      [...["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"].map((day) => `${day} Tue Lezione`), "2026-12-01 Tue A", "2026-12-08 Tue A"],
      label
    );
    assert.deepEqual(laterOf(first.impact), [0, [], 1, 1, 0], label);
  }
});

test("R1-S1 bis (B). Lunedì e venerdì spostati al martedì: la parte dopo uguale si sposta (anche di tre giorni), quella con giorni o orario suoi resta", () => {
  const monFri = () => event({ repeat: { freq: "weekly", byWeekday: ["MO", "FR"] } });
  const count = (events, until) => weekdayView(events, "2026-11-01", until).length;
  // Uguale (solo il titolo dal 30/11): mar e sab, poi la parte A anche lei mar e sab.
  let same = [monFri()];
  same = following(same, "s", "2026-11-30", { title: "A" }).after;
  const before = count(same, "2027-05-27");
  const item = findOccurrence(same, "s", "2026-11-16");
  const moved = following(same, "s", "2026-11-16", shiftMs(item, DAY), "move");
  assert.deepEqual(weekdayView(moved.after, "2026-11-14", "2026-12-09"), [
    "2026-11-17 Tue Lezione",
    "2026-11-21 Sat Lezione",
    "2026-11-24 Tue Lezione",
    "2026-11-28 Sat Lezione",
    "2026-12-01 Tue A",
    "2026-12-05 Sat A",
    "2026-12-08 Tue A"
  ]);
  assert.equal(count(moved.after, "2027-05-28"), before);
  assert.deepEqual(normalizeRepeat(seriesOf(moved.after, "s~2026-11-30")), { freq: "weekly", byWeekday: ["TU", "SA"] });
  assert.deepEqual(laterOf(moved.impact), [0, [], 1, 1, 0]);
  // Di tre giorni (lun e ven → gio e lun): il venerdì 27/11 diventa lunedì 30/11, e c'è.
  const thursday = following(same, "s", "2026-11-16", shiftMs(item, 3 * DAY), "move");
  assert.deepEqual(weekdayView(thursday.after, "2026-11-14", "2026-12-08"), [
    "2026-11-19 Thu Lezione",
    "2026-11-23 Mon Lezione",
    "2026-11-26 Thu Lezione",
    "2026-11-30 Mon Lezione",
    "2026-12-03 Thu A",
    "2026-12-07 Mon A"
  ]);
  assert.equal(count(thursday.after, "2027-05-30"), before);

  // Con un orario suo (dal 30/11 un'ora dopo) o giorni suoi (dal 30/11 solo il lunedì): resta dov'è.
  for (const [label, splitPatch, rule, expected] of [
    ["orario suo", (split) => shiftMs(split, 3600e3), false, ["2026-11-30 Mon A", "2026-12-04 Fri A", "2026-12-07 Mon A"]],
    ["giorni suoi", () => ({ repeat: { freq: "weekly", byWeekday: ["MO"] } }), true, ["2026-11-30 Mon A", "2026-12-07 Mon A"]]
  ]) {
    let own = [monFri()];
    own = following(own, "s", "2026-11-30", { title: "A", ...splitPatch(findOccurrence(own, "s", "2026-11-30")) }, "edit", rule).after;
    const dragged = following(own, "s", "2026-11-16", shiftMs(findOccurrence(own, "s", "2026-11-16"), DAY), "move");
    assert.deepEqual(
      weekdayView(dragged.after, "2026-11-14", "2026-12-09"),
      ["2026-11-17 Tue Lezione", "2026-11-21 Sat Lezione", "2026-11-24 Tue Lezione", "2026-11-28 Sat Lezione", ...expected],
      label
    );
    assert.deepEqual(laterOf(dragged.impact), [0, [], 1, 0, 1], label);
    assert.deepEqual(dragged.lines, [SCOPE_TEXT.followingKeepsSplits, SCOPE_TEXT.followingKeepsEnd], label);
  }
  // Due parti dopo, una uguale e una con un orario suo: la prima si sposta, l'altra no (e lo si dice).
  let mixed = [monFri()];
  mixed = following(mixed, "s", "2026-11-30", { title: "A" }).after;
  mixed = following(mixed, "s~2026-11-30", "2026-12-14", { title: "B", ...shiftMs(findOccurrence(mixed, "s~2026-11-30", "2026-12-14"), 3600e3) }).after;
  const both = following(mixed, "s", "2026-11-16", shiftMs(findOccurrence(mixed, "s", "2026-11-16"), DAY), "move");
  assert.deepEqual(weekdayView(both.after, "2026-11-30", "2026-12-19"), [
    "2026-12-01 Tue A",
    "2026-12-05 Sat A",
    "2026-12-08 Tue A",
    "2026-12-12 Sat A",
    "2026-12-14 Mon B",
    "2026-12-18 Fri B"
  ]);
  assert.deepEqual(laterOf(both.impact), [0, [], 2, 1, 1]);
  assert.deepEqual(both.lines, [SCOPE_TEXT.followingMovesSplits, SCOPE_TEXT.followingSplitsOwnDays, SCOPE_TEXT.followingKeepsEnd]);
});

test("R1-S1 bis (A). Spostare il giorno e scegliere giorni nuovi insieme è una regola nuova: la parte dopo si assorbe", () => {
  let events = [MONDAYS()];
  events = following(events, "s", "2026-11-30", { title: "A" }).after;
  const item = findOccurrence(events, "s", "2026-11-16");
  const { after, impact } = following(events, "s", "2026-11-16", { ...shiftMs(item, DAY), repeat: { freq: "weekly", byWeekday: ["TU", "TH"] } }, "edit", true);
  assert.equal(after.some((entry) => entry.id === "s~2026-11-30"), false);
  assert.deepEqual(
    weekdayView(after, "2026-11-14", "2026-12-04"),
    ["2026-11-17 Tue", "2026-11-19 Thu", "2026-11-24 Tue", "2026-11-26 Thu", "2026-12-01 Tue", "2026-12-03 Thu"].map((day) => `${day} Lezione`)
  );
  assert.equal(impact.absorbed, 1);
  assert.deepEqual(impact.gone, [], "i lunedì di A diventano i martedì della parte nuova");
});

test("R1-S1 bis (C). Tutto il giorno da uno a due giorni: lo prende la parte dopo che durava un giorno, non quella che ne durava tre", () => {
  // Come li scrive il modulo: da mezzanotte locale del primo giorno a mezzanotte dopo l'ultimo.
  const days = (first, after) => ({ start: localMidnight(first).toISOString(), end: localMidnight(after).toISOString(), allDay: true });
  const allDay = event({ ...days("2026-11-02", "2026-11-03"), repeat: { freq: "weekly", byWeekday: ["MO"] } });
  const spans = (events, from, to) =>
    expandEvents(events, localMidnight(from), localMidnight(to)).map((item) => `${item.occurrenceDate} ${Math.round((Date.parse(item.end) - Date.parse(item.start)) / DAY)}`);
  let events = [allDay];
  events = following(events, "s", "2026-11-30", { title: "A" }).after;
  events = following(events, "s~2026-11-30", "2026-12-14", { title: "B", ...days("2026-12-14", "2026-12-17") }).after;
  const { after, impact, lines } = following(events, "s", "2026-11-16", days("2026-11-16", "2026-11-18"));
  assert.deepEqual(spans(after, "2026-11-14", "2026-12-22"), ["2026-11-16 2", "2026-11-23 2", "2026-11-30 2", "2026-12-07 2", "2026-12-14 3", "2026-12-21 3"]);
  assert.deepEqual([impact.laterParts, impact.laterOwnTime], [2, 1]);
  assert.deepEqual(lines, [SCOPE_TEXT.followingKeepsSplits, SCOPE_TEXT.followingSplitsOwnTime, SCOPE_TEXT.followingKeepsEnd]);
});

// ---------------------------------------------------------------------------------------
// R1-S1, terza revisione: spostando non sparisce nulla (la parte spostata tiene la sua ultima data
// spostata, anche sul primo giorno di una parte con un programma suo); «il 2° lunedì» spostato al
// martedì: la parte dopo parte dal 2° martedì del suo mese; eliminare «Questo e i successivi» toglie
// tutte le parti dopo.
// ---------------------------------------------------------------------------------------

const hoursView = (events, from, to) =>
  expandEvents(events, localMidnight(from), localMidnight(to)).map((item) => `${item.occurrenceDate} ${new Date(item.start).getHours()} ${item.title}`);

test("R1-S1 ter (1). Ogni giorno alle 12 con una parte alle 13 dal 30/11: il 16/11 al 17/11 non nasconde il 30/11 spostato", () => {
  let events = [event({ repeat: { freq: "daily" } })];
  events = following(events, "s", "2026-11-30", shiftMs(findOccurrence(events, "s", "2026-11-30"), 3600e3)).after;
  const before = hoursView(events, "2026-11-14", "2026-12-03");
  const { after, impact, lines } = following(events, "s", "2026-11-16", shiftMs(findOccurrence(events, "s", "2026-11-16"), DAY), "move");
  const now = hoursView(after, "2026-11-14", "2026-12-03");
  assert.equal(now.length, before.length, "nessuna data sparisce");
  assert.equal(now.includes("2026-11-16 12 Lezione"), false);
  assert.deepEqual(now.slice(-5), ["2026-11-29 12 Lezione", "2026-11-30 12 Lezione", "2026-11-30 13 Lezione", "2026-12-01 13 Lezione", "2026-12-02 13 Lezione"]);
  assert.deepEqual(normalizeRepeat(seriesOf(after, "s~2026-11-16")).end, { type: "until", date: "2026-11-30" });
  assert.deepEqual(laterOf(impact), [0, [], 1, 0, 1]);
  // «La serie finisce quando finiva prima» resta vero.
  assert.deepEqual(lines, [SCOPE_TEXT.followingKeepsSplits, SCOPE_TEXT.followingKeepsEnd]);
});

test("R1-S1 ter (1). Ogni lunedì con lunedì e venerdì dal 30/11: il 16/11 una settimana dopo tiene il 30/11 spostato", () => {
  let events = [MONDAYS()];
  events = following(events, "s", "2026-11-30", { repeat: { freq: "weekly", byWeekday: ["MO", "FR"] } }, "edit", true).after;
  const { after, impact } = following(events, "s", "2026-11-16", shiftMs(findOccurrence(events, "s", "2026-11-16"), 7 * DAY), "move");
  assert.deepEqual(weekdayView(after, "2026-11-01", "2026-12-08"), [
    "2026-11-02 Mon Lezione",
    "2026-11-09 Mon Lezione",
    "2026-11-23 Mon Lezione",
    "2026-11-30 Mon Lezione",
    "2026-11-30 Mon Lezione",
    "2026-12-04 Fri Lezione",
    "2026-12-07 Mon Lezione"
  ]);
  assert.equal(weekdayView(after, "2026-11-01", "2027-03-01").length, weekdayView(events, "2026-11-01", "2027-03-01").length);
  assert.deepEqual(laterOf(impact), [0, [], 1, 0, 1]);
});

test("R1-S1 ter (1). Spostando indietro, la parte uguale dopo una parte con un orario suo si sposta senza nascondere quella", () => {
  // Ogni giorno alle 12; dal 30/11 alle 13 (D); dal 7/12 di nuovo alle 12 (X, come la serie).
  let events = [event({ repeat: { freq: "daily" } })];
  events = following(events, "s", "2026-11-30", shiftMs(findOccurrence(events, "s", "2026-11-30"), 3600e3)).after;
  events = following(events, "s~2026-11-30", "2026-12-07", { title: "X", ...shiftMs(findOccurrence(events, "s~2026-11-30", "2026-12-07"), -3600e3) }).after;
  const { after, impact, lines } = following(events, "s", "2026-11-16", shiftMs(findOccurrence(events, "s", "2026-11-16"), -DAY), "move");
  assert.deepEqual(hoursView(after, "2026-11-27", "2026-12-09"), [
    "2026-11-27 12 Lezione",
    "2026-11-28 12 Lezione",
    ...["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"].map((day) => `${day} 13 Lezione`),
    "2026-12-06 12 X",
    "2026-12-06 13 Lezione",
    "2026-12-07 12 X",
    "2026-12-08 12 X"
  ]);
  const x = seriesOf(after, "s~2026-11-30~2026-12-07");
  assert.equal(x.originalDate, "2026-12-07", "X ferma D solo dopo la sua ultima data (6/12)");
  assert.deepEqual(laterOf(impact), [0, [], 2, 1, 1]);
  assert.deepEqual(lines, [SCOPE_TEXT.followingMovesSplits, SCOPE_TEXT.followingSplitsOwnDays, SCOPE_TEXT.followingKeepsEnd]);
});

test("R1-S1 ter (3). «Il 2° lunedì» spostato al martedì: la parte dopo parte dal 2° martedì del suo mese e quella prima finisce prima", () => {
  const secondMonday = (month, day) => event({ start: local(2026, month, day), end: local(2026, month, day, 13), repeat: { freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "MO" } } });
  const tuesdays = ["2026-12-08 Tue A", "2027-01-12 Tue A", "2027-02-09 Tue A", "2027-03-09 Tue A"];
  // Dal primo giorno (9/11) e da un giorno dopo (la serie parte il 12/10): stesso risultato dal 9/11.
  for (const [label, series, head] of [
    ["dal primo giorno", secondMonday(11, 9), []],
    ["da un giorno dopo", secondMonday(10, 12), ["2026-10-12 Mon Lezione"]]
  ]) {
    let events = [series];
    events = following(events, "s", "2026-12-14", { title: "A" }).after;
    const before = weekdayView(events, "2026-10-01", "2027-03-31").length;
    const { after, impact } = following(events, "s", "2026-11-09", shiftMs(findOccurrence(events, "s", "2026-11-09"), DAY), "move");
    assert.deepEqual(weekdayView(after, "2026-10-01", "2027-03-31"), [...head, "2026-11-10 Tue Lezione", ...tuesdays], label);
    assert.equal(weekdayView(after, "2026-10-01", "2027-03-31").length, before, label);
    const a = seriesOf(after, "s~2026-12-14");
    assert.equal(startDayOf(a.start, false), "2026-12-08", label);
    assert.equal(a.originalDate, "2026-12-08", label);
    assert.deepEqual(normalizeRepeat(a), { freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TU" } }, label);
    assert.deepEqual(laterOf(impact), [0, [], 1, 1, 0], label);
  }
});

test("R1-S1 ter (4). Eliminare «Questo e i successivi» toglie tutte le parti dopo, anche quella divisa dall'antenato", async () => {
  // P ogni lunedì; R dal 30/11, Q dal 9/11 (si ferma a R), E dal 16/11 della parte Q.
  let events = [MONDAYS()];
  events = following(events, "s", "2026-11-30", { title: "R" }).after;
  events = following(events, "s", "2026-11-09", { title: "Q" }).after;
  events = following(events, "s~2026-11-09", "2026-11-16", { title: "E" }).after;
  const e = "s~2026-11-09~2026-11-16";
  const after = apply(events, planDelete(events, e, "2026-11-23", "following", { now: NOW }));
  assert.equal(after.some((item) => item.id === "s~2026-11-30"), false);
  assert.deepEqual(weekdayView(after, "2026-11-01", "2027-06-01"), ["2026-11-02 Mon Lezione", "2026-11-09 Mon Q", "2026-11-16 Mon E"]);
  // Dal primo giorno di E: anche E.
  const fromFirst = apply(events, planDelete(events, e, "2026-11-16", "following", { now: NOW }));
  assert.deepEqual(weekdayView(fromFirst, "2026-11-01", "2027-06-01"), ["2026-11-02 Mon Lezione", "2026-11-09 Mon Q"]);
  // Nel calendario (lo store) lo stesso, e la scelta lo dice.
  useStudyStore.setState({ loading: true, events, attachments: [], notes: [], reminders: [] });
  await useStudyStore.getState().deleteOccurrence(e, "2026-11-23", "following");
  assert.deepEqual(weekdayView(useStudyStore.getState().events, "2026-11-01", "2027-06-01"), ["2026-11-02 Mon Lezione", "2026-11-09 Mon Q", "2026-11-16 Mon E"]);
  const details = scopeOptions({ action: "delete", date: "2026-11-23" }).find((option) => option.id === "following").details;
  assert.match(details[0], /e tutti quelli dopo/);
});
