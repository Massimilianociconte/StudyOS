import test from "node:test";
import assert from "node:assert/strict";
import {
  addReminder,
  changeStart,
  customReminder,
  draftColor,
  draftFromEvent,
  draftPatch,
  editorChanges,
  editorFormFor,
  initialColorCustom,
  newEventDraft,
  reminderChoices,
  removeReminder,
  scopeOptions,
  setDraftAllDay,
  setDraftDuration,
  draftDuration,
  shiftPatchDays,
  toLocalInput,
  validateDraft
} from "../src/lib/eventEditor.ts";
import { localMidnight } from "../src/lib/tz.ts";

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (y, m, d, h = 0, min = 0) => at(y, m, d, h, min).toISOString();

const baseEvent = (patch = {}) => ({
  id: "e1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start: iso(2026, 11, 12, 10),
  end: iso(2026, 11, 12, 11),
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

test("nuovo evento: un'ora dall'inizio scelto, colore della tipologia", () => {
  const draft = newEventDraft({ start: at(2026, 11, 12, 10) });
  assert.equal(draft.start, "2026-11-12T10:00");
  assert.equal(draft.end, "2026-11-12T11:00");
  assert.equal(draft.allDay, false);
  assert.equal(draft.category, "study");
  assert.equal(draft.colorCustom, false);
  assert.equal(draft.color, "#14B8A6");
  assert.equal(draft.repeat, null);
  // Con una materia, Studio prende il colore della materia.
  assert.equal(newEventDraft({ start: at(2026, 11, 12, 10), subjectId: "s1", subjectColor: "#123456" }).color, "#123456");
});

test("colore scelto a mano: esplicito, oppure dedotto per gli eventi di prima", () => {
  assert.equal(initialColorCustom(baseEvent({ colorCustom: true }), undefined), true);
  assert.equal(initialColorCustom(baseEvent({ colorCustom: false, color: "#FF0000" }), undefined), false);
  assert.equal(initialColorCustom(baseEvent({ color: "#7CF7C8" }), undefined), false);
  assert.equal(initialColorCustom(baseEvent({ color: "#123456" }), "#123456"), false);
  assert.equal(initialColorCustom(baseEvent({ color: "#FF0000" }), "#123456"), true);
  assert.equal(initialColorCustom(baseEvent({ color: "" }), undefined), false);
});

test("cambiando tipologia il colore segue, se non è scelto a mano", () => {
  const draft = newEventDraft({ start: at(2026, 11, 12, 10) });
  assert.equal(draftColor({ ...draft, category: "exam" }, {}), "#EF4444");
  assert.equal(draftColor({ ...draft, category: "exam" }, { overrides: { exam: "#000000" } }), "#000000");
  assert.equal(draftColor({ ...draft, category: "exam", colorCustom: true, color: "#ABCDEF" }, {}), "#ABCDEF");
  assert.equal(draftColor({ ...draft, category: "vacation" }, {}), "#FACC15");
});

test("da evento a modulo e ritorno: nessuna modifica se non si cambia nulla", () => {
  const event = baseEvent({ location: "Aula 3", reminders: [{ minutesBefore: 15 }] });
  const draft = draftFromEvent(event, {});
  assert.equal(draft.start, "2026-11-12T10:00");
  assert.equal(draft.end, "2026-11-12T11:00");
  assert.equal(draft.location, "Aula 3");
  assert.deepEqual(draft.reminders, [{ minutesBefore: 15 }]);
  const patch = draftPatch(draft);
  assert.equal(patch.start, event.start);
  assert.equal(patch.end, event.end);
  assert.deepEqual(editorChanges(draftPatch(draft), patch), {});
});

test("modifiche: solo i campi cambiati, orari e ripetizione insieme, mai campi vuoti in più", () => {
  const draft = draftFromEvent(baseEvent(), {});
  const before = draftPatch(draft);
  const title = editorChanges(before, draftPatch({ ...draft, title: "Lezione 2" }));
  assert.deepEqual(title, { title: "Lezione 2" });
  const moved = editorChanges(before, draftPatch({ ...draft, start: "2026-11-12T14:00", end: "2026-11-12T15:00" }));
  assert.deepEqual(Object.keys(moved).sort(), ["allDay", "end", "start"]);
  const repeat = editorChanges(before, draftPatch({ ...draft, repeat: { freq: "weekly" } }));
  assert.deepEqual(repeat, { repeat: { freq: "weekly" } });
  assert.equal("timeZone" in repeat, false);
  // Togliere la ripetizione manda `repeat` vuoto (= non si ripete più).
  const series = draftFromEvent(baseEvent({ repeat: { freq: "weekly" }, repeatLegacy: "weekly|", recurrence: "weekly" }), {});
  const cleared = editorChanges(draftPatch(series), draftPatch({ ...series, repeat: null }));
  assert.equal("repeat" in cleared, true);
  assert.equal(cleared.repeat, undefined);
  // Colore e scelta a mano viaggiano insieme.
  assert.deepEqual(editorChanges(before, draftPatch({ ...draft, color: "#ABCDEF", colorCustom: true })), { color: "#ABCDEF", colorCustom: true });
});

test("ripetizione vecchia: si mostra quella e, se non cambia, non si riscrive", () => {
  const legacy = baseEvent({ recurrence: "weekly" });
  const draft = draftFromEvent(legacy, {});
  assert.deepEqual(draft.repeat, { freq: "weekly" });
  assert.deepEqual(editorChanges(draftPatch(draft), draftPatch({ ...draft, title: "Altro" })), { title: "Altro" });
});

test("tutto il giorno: date comprese nel modulo, mezzanotti nel salvataggio", () => {
  const event = baseEvent({ allDay: true, start: localMidnight("2026-11-12").toISOString(), end: localMidnight("2026-11-15").toISOString() });
  const draft = draftFromEvent(event, {});
  assert.equal(draft.allDay, true);
  assert.equal(draft.start.slice(0, 10), "2026-11-12");
  assert.equal(draft.end.slice(0, 10), "2026-11-14");
  const patch = draftPatch(draft);
  assert.equal(patch.start, event.start);
  assert.equal(patch.end, event.end);
  assert.equal(patch.allDay, true);
});

test("tutto il giorno acceso e spento: si ritrovano gli orari, altrimenti 9–10", () => {
  const draft = newEventDraft({ start: at(2026, 11, 12, 14) });
  const on = setDraftAllDay(draft, true);
  assert.equal(on.allDay, true);
  assert.equal(on.end.slice(0, 10), "2026-11-12");
  const off = setDraftAllDay(on, false);
  assert.equal(off.start, "2026-11-12T14:00");
  assert.equal(off.end, "2026-11-12T15:00");
  const midnight = setDraftAllDay({ ...draft, allDay: true, start: "2026-11-12T00:00", end: "2026-11-12T00:00" }, false);
  assert.equal(midnight.start, "2026-11-12T09:00");
  assert.equal(midnight.end, "2026-11-12T10:00");
});

test("spostando l'inizio la fine segue con la stessa durata; la ripetizione segue il giorno", () => {
  const draft = { ...newEventDraft({ start: at(2026, 11, 12, 10) }), end: "2026-11-12T11:30", repeat: { freq: "weekly", byWeekday: ["TH"] } };
  const moved = changeStart(draft, "2026-11-13T09:00");
  assert.equal(moved.start, "2026-11-13T09:00");
  assert.equal(moved.end, "2026-11-13T10:30");
  assert.deepEqual(moved.repeat, { freq: "weekly", byWeekday: ["FR"] });
  // Più giorni tutto il giorno: lo stesso numero di giorni.
  const days = { ...draft, allDay: true, start: "2026-11-12T00:00", end: "2026-11-14T00:00", repeat: null };
  const shifted = changeStart(days, "2026-11-20T00:00");
  assert.equal(shifted.end.slice(0, 10), "2026-11-22");
});

test("durata: scelta e calcolata", () => {
  const draft = newEventDraft({ start: at(2026, 11, 12, 10) });
  assert.equal(draftDuration(draft), 60);
  const longer = setDraftDuration(draft, 90);
  assert.equal(longer.end, "2026-11-12T11:30");
  assert.equal(draftDuration(longer), 90);
});

test("errori del modulo in italiano semplice", () => {
  const draft = { ...newEventDraft({ start: at(2026, 11, 12, 10) }), title: "Studio" };
  assert.equal(validateDraft(draft), "");
  assert.match(validateDraft({ ...draft, title: "  " }), /titolo/);
  assert.match(validateDraft({ ...draft, end: "2026-11-12T09:00" }), /fine viene prima/i);
  assert.match(validateDraft({ ...draft, end: "2026-11-12T10:00" }), /fine viene prima/i);
  assert.match(validateDraft({ ...draft, allDay: true, start: "2026-11-12T00:00", end: "2026-11-10T00:00" }), /ultimo giorno/i);
  assert.equal(validateDraft({ ...draft, allDay: true, start: "2026-11-12T00:00", end: "2026-11-12T00:00" }), "");
  assert.match(validateDraft({ ...draft, start: "" }), /data valida/);
  assert.match(validateDraft({ ...draft, repeat: { freq: "daily", end: { type: "until", date: "2026-11-01" } } }), /ripetizione finisce prima/);
  assert.match(validateDraft(draft, { subjectRequired: true }), /materia/);
});

test("promemoria: scelte pronte, niente doppioni, personalizzati entro i limiti", () => {
  assert.deepEqual(
    reminderChoices(false).map((choice) => choice.label),
    ["All'ora dell'evento", "15 minuti prima", "1 ora prima", "1 giorno prima alle 9:00"]
  );
  assert.deepEqual(
    reminderChoices(true).map((choice) => choice.label),
    ["Il giorno stesso alle 9:00", "1 giorno prima alle 9:00", "7 giorni prima alle 9:00"]
  );
  let list = addReminder([], { minutesBefore: 15 });
  list = addReminder(list, { minutesBefore: 15 });
  assert.deepEqual(list, [{ minutesBefore: 15 }]);
  list = addReminder(list, { minutesBefore: 60 });
  assert.deepEqual(removeReminder(list, 0), [{ minutesBefore: 60 }]);
  assert.deepEqual(customReminder(2, "hours"), { minutesBefore: 120 });
  assert.deepEqual(customReminder(3, "days", "08:30"), { daysBefore: 3, at: "08:30" });
  assert.deepEqual(customReminder(3, "days"), { minutesBefore: 4320 });
  assert.equal(customReminder(29, "days"), null);
  assert.equal(customReminder(-1, "minutes"), null);
  assert.equal(customReminder(1.5, "minutes"), null);
});

test("scelta della portata: opzioni e conseguenze dette chiaramente", () => {
  const edit = scopeOptions({ action: "edit", date: "2026-11-12", ruleChanged: false, timeChanged: true });
  assert.deepEqual(edit.map((option) => option.id), ["this", "following", "all"]);
  const following = edit.find((option) => option.id === "following");
  assert.ok(following.details.some((line) => line.includes("verranno sostituite")));
  assert.ok(following.details.some((line) => line.includes("i giorni annullati restano annullati")));
  // Cambiando la regola non si può scegliere "Solo questo".
  assert.deepEqual(scopeOptions({ action: "edit", date: "2026-11-12", ruleChanged: true }).map((option) => option.id), ["following", "all"]);
  // Stesso orario: le modifiche dei singoli giorni restano.
  const same = scopeOptions({ action: "edit", date: "2026-11-12", timeChanged: false }).find((option) => option.id === "following");
  assert.ok(same.details.some((line) => line.includes("restano")));
  const remove = scopeOptions({ action: "delete", date: "2026-11-12" });
  assert.ok(remove.find((option) => option.id === "all").details[0].includes("tutta la serie"));
  // Eventi di altri: solo "Tutti".
  assert.deepEqual(scopeOptions({ action: "move", date: "2026-11-12", sharedOnly: true }).map((option) => option.id), ["all"]);
  // Fuso fissato alla prima modifica di un giorno: lo si dice.
  const pinned = scopeOptions({ action: "edit", date: "2026-11-12", pinsZone: "Europe/Rome" });
  assert.ok(pinned.find((option) => option.id === "this").details.some((line) => line.includes("Europe/Rome")));
});

test("spostare inizio e fine di qualche giorno (per «Tutti» con tutto il giorno)", () => {
  const patch = { start: iso(2026, 11, 19), end: iso(2026, 11, 20), allDay: true, title: "x" };
  const shifted = shiftPatchDays(patch, -7);
  assert.equal(shifted.start, iso(2026, 11, 12));
  assert.equal(shifted.end, iso(2026, 11, 13));
  assert.equal(shifted.title, "x");
  assert.equal(shiftPatchDays({ title: "y" }, 3).start, undefined);
});

test("quale modulo apre un evento: ricorrenza, vacanza o completo", () => {
  assert.equal(editorFormFor(baseEvent({ occasion: { kind: "birthday", person: "Giulia" } })), "occasion");
  assert.equal(editorFormFor(baseEvent({ category: "vacation" })), "vacation");
  assert.equal(editorFormFor(baseEvent()), "event");
});

test("ora locale per i campi", () => {
  assert.equal(toLocalInput(at(2026, 1, 5, 7, 5)), "2026-01-05T07:05");
  assert.equal(toLocalInput("nope"), "");
});
