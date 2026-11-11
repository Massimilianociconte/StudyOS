import test from "node:test";
import assert from "node:assert/strict";
import {
  alignedSeriesStart,
  explicitRule,
  occurrenceEditCalls,
  scopeImpact,
  seriesSpan,
  simulateOccurrenceEdit,
  userRuleChange
} from "../src/lib/occurrenceEdit.ts";
import { scopeOptions } from "../src/lib/eventEditor.ts";
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
  assert.ok(scopeOptions({ action: "edit", date: "2026-11-09", span: root }).find((option) => option.id === "all").details[0].includes("fino al domenica 22 novembre"));
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
