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
import { scopeOptions, weekdaysText } from "../src/lib/eventEditor.ts";
import { findOccurrence } from "../src/lib/occurrenceLookup.ts";
import { applyEditPlan, expandEvents, isOccurrenceRow, planDelete, planEdit } from "../src/lib/repeat.ts";
import { customFromRule, repeatPresets, ruleFromCustom } from "../src/lib/repeatPicker.ts";
import { SCOPE_TEXT } from "../src/lib/labels.ts";
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
const NO_IMPACT = { changedLost: 0, changedGone: 0, cancelledLost: 0, kept: 0, ownLost: false, absorbed: 0 };

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
