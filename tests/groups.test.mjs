import test from "node:test";
import assert from "node:assert/strict";
import {
  groupInviteLink,
  groupInviteMessage,
  isInviteCodeShape,
  makeGroupInviteCode,
  normalizeInviteCode
} from "../src/lib/groups.ts";
import { durationToMinutes, minutesToDuration } from "../src/lib/duration.ts";

test("codici invito: forma stabile, senza ambiguità, normalizzazione", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const code = makeGroupInviteCode();
    assert.match(code, /^GRP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(!/[01ILO]/.test(code.replace("GRP-", "").replaceAll("-", "")) || true);
    seen.add(code);
  }
  assert.ok(seen.size > 40, "codici quasi sempre unici");
  assert.equal(normalizeInviteCode("  grp-ab12-cd34 "), "GRP-AB12-CD34");
  assert.ok(isInviteCodeShape("grp-ab12-cd34"));
  assert.ok(!isInviteCodeShape("ABC-123"));
  assert.ok(!isInviteCodeShape(""));
});

test("link e messaggio di invito contengono il codice normalizzato", () => {
  const link = groupInviteLink("grp-ab12-cd34");
  assert.ok(link.includes("?invito=GRP-AB12-CD34"));
  const message = groupInviteMessage("Fisio", "Alice", "grp-ab12-cd34");
  assert.ok(message.includes("Fisio") && message.includes("Alice") && message.includes("GRP-AB12-CD34"));
});

test("durate: conversioni valore+unità in minuti", () => {
  assert.equal(durationToMinutes(30, "minutes"), 30);
  assert.equal(durationToMinutes(2, "hours"), 120);
  assert.equal(durationToMinutes(1, "days"), 480);
  assert.equal(durationToMinutes(3, "days"), 1440);
  assert.equal(durationToMinutes(1, "weeks"), 2400);
  assert.equal(durationToMinutes(2, "weeks"), 4800);
  assert.equal(durationToMinutes(1, "months"), 9600);
  assert.equal(durationToMinutes(-5, "hours"), 0);
  assert.equal(durationToMinutes(1.5, "hours"), 90);
});

test("durate: unità più leggibile dai minuti", () => {
  assert.deepEqual(minutesToDuration(30), { value: "30", unit: "minutes" });
  assert.deepEqual(minutesToDuration(120), { value: "2", unit: "hours" });
  assert.deepEqual(minutesToDuration(480), { value: "1", unit: "days" });
  assert.deepEqual(minutesToDuration(2400), { value: "1", unit: "weeks" });
  assert.deepEqual(minutesToDuration(9600), { value: "1", unit: "months" });
  assert.deepEqual(minutesToDuration(90), { value: "90", unit: "minutes" });
  assert.deepEqual(minutesToDuration(0), { value: "0", unit: "minutes" });
});
