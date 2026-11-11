import test from "node:test";
import assert from "node:assert/strict";
import {
  newOccasionDraft,
  nextOccasion,
  occasionDraftFromEvent,
  occasionError,
  occasionFields,
  occasionStartDate,
  newVacationDraft,
  vacationDays,
  vacationDraftFromEvent,
  vacationError,
  vacationFields
} from "../src/lib/occasionForms.ts";
import { localMidnight } from "../src/lib/tz.ts";

const midnight = (date) => localMidnight(date).toISOString();

const baseEvent = (patch = {}) => ({
  id: "e1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Compleanno di Giulia",
  description: "",
  category: "personal",
  color: "#A855F7",
  priority: "medium",
  start: midnight("2026-03-14"),
  end: midnight("2026-03-15"),
  allDay: true,
  recurrence: "yearly",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

test("nuova ricorrenza: oggi, compleanno, promemoria il giorno stesso alle 9", () => {
  const draft = newOccasionDraft({ today: "2026-11-11" });
  assert.equal(draft.kind, "birthday");
  assert.equal(draft.day, 11);
  assert.equal(draft.month, 11);
  assert.equal(draft.year, "");
  assert.deepEqual(draft.reminders, [{ at: "09:00" }]);
});

test("ricorrenza salvata: tutto il giorno, ogni anno, titolo del compleanno, colore della tipologia", () => {
  const draft = { ...newOccasionDraft({ today: "2026-11-11" }), name: " Giulia ", day: 14, month: 3, year: "2001", notes: " libro " };
  const fields = occasionFields(draft, { today: "2026-11-11" });
  assert.equal(fields.title, "Compleanno di Giulia");
  assert.equal(fields.category, "personal");
  assert.equal(fields.allDay, true);
  assert.equal(fields.start, midnight("2026-03-14"));
  assert.equal(fields.end, midnight("2026-03-15"));
  assert.deepEqual(fields.repeat, { freq: "yearly" });
  assert.deepEqual(fields.occasion, { kind: "birthday", birthYear: 2001, person: "Giulia" });
  assert.equal(fields.description, "libro");
  assert.equal(fields.color, "#A855F7");
  assert.equal(fields.colorCustom, false);
  // Anniversario: il titolo è il nome; colore scelto dall'utente per la tipologia.
  const anniversary = occasionFields({ ...draft, kind: "anniversary", name: "Matrimonio" }, { today: "2026-11-11", overrides: { anniversary: "#3B82F6" } });
  assert.equal(anniversary.title, "Matrimonio");
  assert.equal(anniversary.color, "#3B82F6");
  // Modificando una ricorrenza esistente il colore non si tocca.
  assert.equal("color" in occasionFields(draft, { today: "2026-11-11", baseYear: 2024, keepColor: true }), false);
  assert.equal(occasionFields(draft, { today: "2026-11-11", baseYear: 2024, keepColor: true }).start, midnight("2024-03-14"));
});

test("nato il 29 febbraio: la serie parte da un anno bisestile, negli altri anni il 28", () => {
  const draft = { ...newOccasionDraft({ today: "2026-11-11" }), name: "Luca", day: 29, month: 2 };
  assert.equal(occasionStartDate(draft, { today: "2026-11-11" }), "2024-02-29");
  assert.deepEqual(nextOccasion(draft, "2026-11-11"), { date: "2027-02-28", age: null });
  assert.deepEqual(nextOccasion({ ...draft, year: "2004" }, "2027-03-01"), { date: "2028-02-29", age: 24 });
  // Anno di nascita non bisestile: il 29 febbraio non esiste.
  assert.notEqual(occasionError({ ...draft, year: "2003" }, "2026-11-11"), "");
  assert.equal(occasionError({ ...draft, year: "2004" }, "2026-11-11"), "");
});

test("prossima volta ed età: oggi conta, poi l'anno dopo", () => {
  const draft = { ...newOccasionDraft({ today: "2026-11-11" }), name: "Giulia", day: 11, month: 11, year: "2001" };
  assert.deepEqual(nextOccasion(draft, "2026-11-11"), { date: "2026-11-11", age: 25 });
  assert.deepEqual(nextOccasion(draft, "2026-11-12"), { date: "2027-11-11", age: 26 });
});

test("errori della ricorrenza in italiano semplice", () => {
  const draft = { ...newOccasionDraft({ today: "2026-11-11" }), name: "Giulia" };
  assert.equal(occasionError({ ...draft, name: "  " }, "2026-11-11"), "Scrivi un nome.");
  assert.equal(occasionError({ ...draft, day: 31, month: 4 }, "2026-11-11"), "Questo giorno non esiste in quel mese.");
  assert.match(occasionError({ ...draft, year: "20" }, "2026-11-11"), /quattro cifre/);
  assert.match(occasionError({ ...draft, year: "2030" }, "2026-11-11"), /quattro cifre/);
  assert.equal(occasionError(draft, "2026-11-11"), "");
});

test("da una ricorrenza salvata al modulo", () => {
  const event = baseEvent({ occasion: { kind: "birthday", person: "Giulia", birthYear: 2001 }, description: "libro", reminders: [{ daysBefore: 1, at: "09:00" }] });
  const draft = occasionDraftFromEvent(event);
  assert.equal(draft.kind, "birthday");
  assert.equal(draft.name, "Giulia");
  assert.equal(draft.day, 14);
  assert.equal(draft.month, 3);
  assert.equal(draft.year, "2001");
  assert.equal(draft.notes, "libro");
  assert.deepEqual(draft.reminders, [{ daysBefore: 1, at: "09:00" }]);
  // Senza nome nella ricorrenza: il titolo.
  assert.equal(occasionDraftFromEvent(baseEvent({ title: "Festa del paese", occasion: { kind: "holiday" } })).name, "Festa del paese");
});

test("vacanza: giorni compresi, tutto il giorno, giallo, destinazione", () => {
  const draft = { ...newVacationDraft("2026-11-11"), title: " Lisbona ", first: "2026-12-20", last: "2026-12-27", destination: " Lisbona ", notes: "volo" };
  assert.equal(vacationDays(draft), 8);
  assert.equal(vacationError(draft), "");
  const fields = vacationFields(draft);
  assert.equal(fields.title, "Lisbona");
  assert.equal(fields.category, "vacation");
  assert.equal(fields.allDay, true);
  assert.equal(fields.start, midnight("2026-12-20"));
  assert.equal(fields.end, midnight("2026-12-28"));
  assert.equal(fields.location, "Lisbona");
  assert.equal(fields.description, "volo");
  assert.equal(fields.color, "#FACC15");
  assert.equal(fields.colorCustom, false);
  assert.equal("color" in vacationFields(draft, { keepColor: true }), false);
});

test("vacanza: errori e ritorno al modulo", () => {
  const draft = newVacationDraft("2026-11-11");
  assert.equal(vacationError(draft), "Scrivi un nome per la vacanza.");
  assert.equal(vacationError({ ...draft, title: "Mare", first: "" }), "Scegli il primo e l'ultimo giorno.");
  assert.notEqual(vacationError({ ...draft, title: "Mare", first: "2026-12-20", last: "2026-12-19" }), "");
  const event = baseEvent({ title: "Mare", category: "vacation", start: midnight("2026-08-01"), end: midnight("2026-08-15"), location: "Sardegna" });
  const back = vacationDraftFromEvent(event);
  assert.equal(back.first, "2026-08-01");
  assert.equal(back.last, "2026-08-14");
  assert.equal(back.destination, "Sardegna");
  assert.equal(vacationDays(back), 14);
});
