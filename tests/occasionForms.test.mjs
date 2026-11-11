import test from "node:test";
import assert from "node:assert/strict";
import {
  newOccasionDraft,
  nextOccasion,
  occasionChanges,
  occasionDraftFromEvent,
  occasionError,
  occasionFields,
  occasionStartDate,
  newVacationDraft,
  vacationChanges,
  vacationDays,
  vacationDraftFromEvent,
  vacationError,
  vacationFields
} from "../src/lib/occasionForms.ts";
import { localMidnight } from "../src/lib/tz.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

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

test("S3. ricorrenza creata dall'agente, aperta e salvata senza toccare nulla: nessuna modifica", async () => {
  // Come nei test dell'agente: dati caricati (con `loading` l'agente aspetta).
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], tasks: [], events: [], attachments: [], notes: [], reminders: [], preferences: [] });
  const created = await executeAgentTool("studyos_create_event", { title: "Compleanno di Anna", start: "2026-04-20", allDay: true, category: "other", occasion: { kind: "birthday" } });
  assert.equal(created.ok, true);
  const event = useStudyStore.getState().events[0];
  assert.equal(event.category, "other");
  assert.equal(event.occasion.person, undefined);
  const before = occasionDraftFromEvent(event);
  assert.equal(before.name, "Anna", "il nome senza «Compleanno di »");
  assert.deepEqual(occasionChanges(event, before, before, { today: "2026-11-11" }), {});
  // Solo i promemoria toccati: solo i promemoria; mai categoria, colore o titolo.
  assert.deepEqual(occasionChanges(event, before, { ...before, reminders: [{ at: "08:00" }] }, { today: "2026-11-11" }), { reminders: [{ at: "08:00" }] });
  // Nome cambiato: titolo e persona, la categoria resta.
  assert.deepEqual(occasionChanges(event, before, { ...before, name: "Anna Maria" }, { today: "2026-11-11" }), {
    title: "Compleanno di Anna Maria",
    occasion: { kind: "birthday", person: "Anna Maria" }
  });
});

test("S3. ricorrenza con un titolo scelto a mano, senza promemoria: salvare senza cambiare non scrive nulla", () => {
  const event = baseEvent({ title: "Festa di Giulia", occasion: { kind: "birthday", person: "Giulia" } });
  assert.equal("reminders" in event, false);
  const before = occasionDraftFromEvent(event);
  assert.deepEqual(occasionChanges(event, before, before, { today: "2026-11-11" }), {});
  // Il nome cambia: il titolo scelto a mano segue il nome, non torna «Compleanno di …».
  assert.equal(occasionChanges(event, before, { ...before, name: "Giulia R." }, { today: "2026-11-11" }).title, "Festa di Giulia R.");
  // Giorno cambiato: inizio e fine, nell'anno della serie.
  assert.deepEqual(occasionChanges(event, before, { ...before, day: 15 }, { today: "2026-11-11", baseYear: 2026 }), {
    start: midnight("2026-03-15"),
    end: midnight("2026-03-16")
  });
});

test("S3. vacanza aperta e salvata senza cambiare: nessuna modifica; poi solo ciò che cambia", () => {
  const event = baseEvent({ title: "Mare", category: "vacation", start: midnight("2026-08-01"), end: midnight("2026-08-15"), location: "Sardegna" });
  const before = vacationDraftFromEvent(event);
  assert.deepEqual(vacationChanges(event, before, before), {});
  assert.deepEqual(vacationChanges(event, before, { ...before, last: "2026-08-20" }), { end: midnight("2026-08-21") });
  assert.deepEqual(vacationChanges(event, before, { ...before, destination: " " }), { location: undefined });
  assert.deepEqual(vacationChanges(event, before, { ...before, reminders: [{ daysBefore: 1, at: "09:00" }] }), { reminders: [{ daysBefore: 1, at: "09:00" }] });
});

test("Nit 3. cambiare il nome sostituisce solo la parola intera nel titolo scelto a mano", async () => {
  const { occasionChanges, occasionDraftFromEvent } = await import("../src/lib/occasionForms.ts");
  const dinner = {
    id: "c",
    title: "Cena con Al e Alberto",
    start: "2026-03-14T00:00:00.000Z",
    end: "2026-03-15T00:00:00.000Z",
    allDay: true,
    category: "personal",
    repeat: { freq: "yearly" },
    occasion: { kind: "recurring-day", person: "Al" },
    description: "",
    reminders: []
  };
  const before = occasionDraftFromEvent(dinner);
  const changes = occasionChanges(dinner, before, { ...before, name: "Bo" }, { today: "2026-11-11", baseYear: 2026 });
  assert.equal(changes.title, "Cena con Bo e Alberto");
  const accented = { ...dinner, title: "Festa di Al, Alì e Àl", occasion: { kind: "recurring-day", person: "Al" } };
  const renamed = occasionChanges(accented, occasionDraftFromEvent(accented), { ...occasionDraftFromEvent(accented), name: "$1 Bo" }, { today: "2026-11-11", baseYear: 2026 });
  assert.equal(renamed.title, "Festa di $1 Bo, Alì e Àl");
});
