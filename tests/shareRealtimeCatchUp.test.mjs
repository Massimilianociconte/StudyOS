import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catchUpWhenSubscribed } from "../src/lib/sharing.ts";

// Il canale realtime delle condivisioni si iscriveva senza guardare lo stato: le righe scritte da
// un'altra persona tra l'avvio (o l'accettazione) e il momento in cui il canale è davvero iscritto
// non arrivavano fino all'evento dopo o al ricontrollo dei 5 minuti. Ora a ogni SUBSCRIBED (anche
// dopo una riconnessione o un canale ricreato) parte un pull di recupero, con la stessa attesa.

test("realtime condivisioni: a ogni SUBSCRIBED del canale attuale parte un pull di recupero", () => {
  let current = true;
  const runs = [];
  const onStatus = catchUpWhenSubscribed(() => current, () => runs.push("pull"));
  onStatus("SUBSCRIBED");
  assert.deepEqual(runs, ["pull"]);
  // Errori e chiusure non fanno partire nulla (ci pensa il ricontrollo, e la riconnessione dopo).
  onStatus("CHANNEL_ERROR");
  onStatus("TIMED_OUT");
  onStatus("CLOSED");
  assert.deepEqual(runs, ["pull"]);
  // Riconnesso: le righe scritte mentre era giù si recuperano.
  onStatus("SUBSCRIBED");
  assert.deepEqual(runs, ["pull", "pull"]);
  // Un canale già sostituito (altre persone da seguire, uscita) non chiede più passate.
  current = false;
  onStatus("SUBSCRIBED");
  assert.deepEqual(runs, ["pull", "pull"]);
});

test("realtime condivisioni: shareSync si iscrive con il recupero e lo lega al canale attuale", () => {
  const source = readFileSync(new URL("../src/lib/shareSync.ts", import.meta.url), "utf8");
  const setup = source.slice(source.indexOf("const ensureRealtime"), source.indexOf("// ——— Ciclo ———"));
  assert.match(setup, /\.subscribe\(\s*catchUpWhenSubscribed\(\s*\(\) => channel === \w+,\s*\(\) => schedule\(\)\s*\)\s*\)/);
  assert.doesNotMatch(setup, /next\.subscribe\(\);/);
});
