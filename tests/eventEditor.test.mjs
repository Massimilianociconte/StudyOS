import test from "node:test";
import assert from "node:assert/strict";
import {
  addReminder,
  allScopePatch,
  changeStart,
  customReminder,
  draftColor,
  draftFromEvent,
  draftPatch,
  draftRuleDay,
  editorChanges,
  editorFormFor,
  followingPatch,
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
  validateDraft,
  withTypeColor
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
  // Una ricorrenza segue il colore del suo tipo (compleanno, anniversario…), non quello di Personale.
  assert.equal(draftColor({ ...draft, category: "personal" }, { occasionKind: "anniversary" }), "#EC4899");
  assert.equal(draftColor({ ...draft, category: "personal" }, { occasionKind: "birthday", overrides: { birthday: "#000000" } }), "#000000");
  assert.equal(draftColor({ ...draft, category: "personal" }, { occasionKind: "recurring-day" }), draftColor({ ...draft, category: "personal" }, {}));
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

test("B1 (revisione finale). la ripetizione si legge nel fuso dell'evento: da Tokyo un lunedì di Roma resta lunedì", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  try {
    // Lunedì 16 alle 10 a Roma = lunedì 16 alle 18 a Tokyo; ogni lunedì a Roma.
    const draft = draftFromEvent(
      { id: "e", title: "Lezione", start: "2026-11-16T09:00:00.000Z", end: "2026-11-16T10:00:00.000Z", category: "lesson", color: "#7CF7C8", priority: "medium", status: "planned", links: [], repeat: { freq: "weekly", byWeekday: ["MO"] }, timeZone: "Europe/Rome" },
      {}
    );
    assert.equal(draftRuleDay(draft, "Europe/Rome"), "2026-11-16");
    // Martedì 07:00 a Tokyo = lunedì 23:00 a Roma: per la regola è sempre lunedì.
    const later = changeStart(draft, "2026-11-17T07:00", "Europe/Rome");
    assert.equal(draftRuleDay(later, "Europe/Rome"), "2026-11-16");
    assert.deepEqual(later.repeat, { freq: "weekly", byWeekday: ["MO"] });
    // Martedì 18:00 a Tokyo = martedì 10:00 a Roma: la regola segue il martedì.
    assert.deepEqual(changeStart(draft, "2026-11-17T18:00", "Europe/Rome").repeat, { freq: "weekly", byWeekday: ["TU"] });
    // Lunedì 18:00 a Roma (martedì 02:00 a Tokyo): il giorno della regola è lunedì, quello mostrato martedì.
    const evening = { ...draft, start: "2026-11-17T02:00", end: "2026-11-17T03:00" };
    assert.equal(draftRuleDay(evening, "Europe/Rome"), "2026-11-16");
    assert.equal(draftRuleDay(evening), "2026-11-17");
    // Tutto il giorno: vale la data locale.
    assert.equal(draftRuleDay({ ...evening, allDay: true }, "Europe/Rome"), "2026-11-17");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
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
  const edit = scopeOptions({ action: "edit", date: "2026-11-12", ruleChanged: false });
  assert.deepEqual(edit.map((option) => option.id), ["this", "following", "all"]);
  // Senza giorni cambiati da soli non si parla di loro; la fine resta.
  const following = edit.find((option) => option.id === "following");
  assert.deepEqual(following.details, ["Cambia l'evento di giovedì 12 novembre e tutti quelli dopo; quelli prima restano come sono.", "La serie finisce quando finiva prima."]);
  // Cambiando la regola non si può scegliere "Solo questo".
  assert.deepEqual(scopeOptions({ action: "edit", date: "2026-11-12", ruleChanged: true }).map((option) => option.id), ["following", "all"]);
  // Ciò che si dice dei giorni cambiati viene da `impacts` (vedi occurrenceEdit.test).
  const lost = scopeOptions({ action: "edit", date: "2026-11-12", impacts: { following: { changedLost: 2, cancelledLost: 0, kept: 1, ownLost: false, absorbed: 1 } } });
  assert.deepEqual(lost.find((option) => option.id === "following").details.slice(1, 4), [
    "2 giorni che avevi cambiato da soli perdono le loro modifiche e tornano come il resto della serie.",
    "Gli altri giorni che avevi cambiato o annullato da soli restano così.",
    "Dopo questa data avevi già cambiato la serie con «Questo e i successivi»: vale questa modifica."
  ]);
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

test("«Tutti» da un giorno: la modifica si riporta al giorno di riferimento della serie", () => {
  const series = { start: iso(2026, 11, 5, 10), allDay: false };
  // Occorrenza al suo posto: nessuno spostamento, si cambia solo l'ora.
  const plain = allScopePatch({ start: iso(2026, 11, 12, 14), end: iso(2026, 11, 12, 15) }, { occurrence: { start: iso(2026, 11, 12, 10), allDay: false }, series, date: "2026-11-12" });
  assert.equal(plain.start, iso(2026, 11, 12, 14));
  // Riga spostata a venerdì: cambiando l'ora la serie non si sposta di giorno.
  const moved = allScopePatch({ start: iso(2026, 11, 13, 14), end: iso(2026, 11, 13, 15) }, { occurrence: { start: iso(2026, 11, 13, 10), allDay: false }, series, date: "2026-11-12" });
  assert.equal(moved.start, iso(2026, 11, 12, 14));
  assert.equal(moved.end, iso(2026, 11, 12, 15));
  // Tutto il giorno acceso da un giorno qualsiasi: si scrive dal primo giorno della serie.
  const toggled = allScopePatch({ start: iso(2026, 11, 12), end: iso(2026, 11, 13), allDay: true }, { occurrence: { start: iso(2026, 11, 12, 10), allDay: false }, series, date: "2026-11-12" });
  assert.equal(toggled.start, iso(2026, 11, 5));
  assert.equal(toggled.end, iso(2026, 11, 6));
  // "Tutto il giorno" invariato su una serie senza il campo: passa com'è e non sposta il giorno (il
  // motore lo confronta con `?? false`, vedi repeat.test).
  const sameAllDay = allScopePatch({ start: iso(2026, 11, 12, 14), end: iso(2026, 11, 12, 16), allDay: false }, { occurrence: { start: iso(2026, 11, 12, 10) }, series: { start: iso(2026, 11, 5, 10) }, date: "2026-11-12" });
  assert.equal(sameAllDay.allDay, false);
  assert.equal(sameAllDay.start, iso(2026, 11, 12, 14));
  // Senza orari la modifica resta com'è.
  const title = { title: "Nuovo" };
  assert.equal(allScopePatch(title, { occurrence: { start: iso(2026, 11, 13, 10) }, series, date: "2026-11-12" }), title);
});

test("«Questo e i successivi» da un giorno cambiato da solo: i successivi prendono ciò che si vede", () => {
  const shown = { title: "Lezione in aula B", description: "porta il libro", color: "#EF4444", colorCustom: true, start: iso(2026, 11, 13, 10), end: iso(2026, 11, 13, 11), allDay: false, repeat: { freq: "weekly" }, subjectId: "s1" };
  const changes = { start: iso(2026, 11, 13, 14), end: iso(2026, 11, 13, 15) };
  const fromRow = followingPatch(shown, changes, true);
  assert.equal(fromRow.title, "Lezione in aula B");
  assert.equal(fromRow.color, "#EF4444");
  assert.equal(fromRow.start, changes.start);
  // Orari, regola e materia solo se cambiati: la serie non si sposta da sola.
  assert.equal("repeat" in followingPatch(shown, { title: "x" }, true), false);
  assert.equal("start" in followingPatch(shown, { title: "x" }, true), false);
  assert.equal("subjectId" in followingPatch(shown, { title: "x" }, true), false);
  // Dalla serie: solo le modifiche.
  assert.deepEqual(followingPatch(shown, changes, false), changes);
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

test("colori delle tipologie: scegliere, tornare al predefinito, ripristinare", () => {
  assert.deepEqual(withTypeColor({}, "exam", "#3B82F6"), { exam: "#3B82F6" });
  // Il colore predefinito non si salva: la tipologia torna "Predefinito".
  assert.deepEqual(withTypeColor({ exam: "#3B82F6" }, "exam", "#ef4444"), {});
  assert.deepEqual(withTypeColor({ exam: "#3B82F6", gym: "#000000" }, "exam", null), { gym: "#000000" });
  // Valori arrivati dalla sincronizzazione: si scartano tipologie e colori non validi.
  assert.deepEqual(withTypeColor({ nope: "#000000", work: "url(x)" }, "birthday", "#A855F7"), {});
  assert.deepEqual(withTypeColor({}, "vacation", "javascript:alert(1)"), {});
});
