import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOnce } from "../src/lib/loadOnce.ts";

test("loadOnce: una sola richiesta anche con chiamate in contemporanea, poi la stessa risposta", async () => {
  let calls = 0;
  const load = loadOnce(async () => {
    calls += 1;
    return { value: calls };
  });
  const [first, second] = await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(await load(), first);
  assert.equal(calls, 1);
});

test("loadOnce: un caricamento fallito arriva a chi aspetta e la volta dopo si riprova", async () => {
  let calls = 0;
  const load = loadOnce(async () => {
    calls += 1;
    if (calls === 1) throw new Error("chunk non raggiungibile");
    return "ok";
  });
  await assert.rejects(load(), /chunk non raggiungibile/);
  // La promessa fallita non resta in memoria.
  assert.equal(await load(), "ok");
  assert.equal(await load(), "ok");
  assert.equal(calls, 2);
});
