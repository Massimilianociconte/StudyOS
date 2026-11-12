import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_MINUTES_MAX, plannedDonePatch, plannedSessions, sessionUndoPatch } from "../src/lib/studySessions.ts";

const MIN = 60_000;
const at = (hours, minutes = 0) => Date.UTC(2026, 10, 10, hours, minutes);
const iso = (time) => new Date(time).toISOString();

test("in programma: solo le sessioni pianificate, dalla più vicina", () => {
  const sessions = [
    { id: "fatta", status: "completed", start: iso(at(8)) },
    { id: "dopodomani", status: "planned", start: iso(at(8) + 2 * 24 * 60 * MIN) },
    { id: "domani", status: "planned", start: iso(at(8) + 24 * 60 * MIN) },
    { id: "saltata", status: "skipped", start: iso(at(9)) }
  ];
  assert.deepEqual(plannedSessions(sessions).map((session) => session.id), ["domani", "dopodomani"]);
});

test("«Fatta»: una sessione prevista già passata resta alla sua ora, con i minuti previsti", () => {
  const patch = plannedDonePatch({ start: iso(at(9)), plannedMinutes: 50, actualMinutes: 0 }, at(12));
  assert.deepEqual(patch, { status: "completed", actualMinutes: 50, start: iso(at(9)), end: iso(at(9, 50)) });
});

test("«Fatta»: prevista più tardi o ancora in corso, finisce adesso (mai nel futuro)", () => {
  const later = plannedDonePatch({ start: iso(at(15)), plannedMinutes: 60, actualMinutes: 0 }, at(12));
  assert.deepEqual(later, { status: "completed", actualMinutes: 60, start: iso(at(11)), end: iso(at(12)) });
  const running = plannedDonePatch({ start: iso(at(11, 30)), plannedMinutes: 60, actualMinutes: 0 }, at(12));
  assert.equal(running.end, iso(at(12)));
  // Un minuto di margine, come nei moduli: finisce alle 12:00:30 → resta all'ora prevista.
  const edge = plannedDonePatch({ start: iso(at(11) + 30_000), plannedMinutes: 60, actualMinutes: 0 }, at(12));
  assert.equal(edge.start, iso(at(11) + 30_000));
});

test("«Fatta»: minuti mancanti, zero o troppi diventano un numero valido", () => {
  assert.equal(plannedDonePatch({ start: iso(at(8)), plannedMinutes: 0, actualMinutes: 25 }, at(12)).actualMinutes, 25);
  assert.equal(plannedDonePatch({ start: iso(at(8)), plannedMinutes: Number.NaN, actualMinutes: 0 }, at(12)).actualMinutes, 60);
  assert.equal(plannedDonePatch({ start: iso(at(0)), plannedMinutes: 5000, actualMinutes: 0 }, at(23)).actualMinutes, SESSION_MINUTES_MAX);
  // Inizio non valido: finisce adesso.
  assert.equal(plannedDonePatch({ start: "domani", plannedMinutes: 30, actualMinutes: 0 }, at(12)).end, iso(at(12)));
});

test("«Fatta» e poi «Annulla»: torna in programma com'era", () => {
  const session = { id: "s", status: "planned", start: iso(at(15)), end: undefined, plannedMinutes: 45, actualMinutes: 0, title: "Anatomia" };
  const patch = plannedDonePatch(session, at(12));
  const undo = sessionUndoPatch(session, patch);
  assert.deepEqual({ ...session, ...patch, ...undo }, session);
});
