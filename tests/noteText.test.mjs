import test from "node:test";
import assert from "node:assert/strict";
import { noteTextParts } from "../src/lib/noteText.ts";

test("testo della nota: senza link resta un solo pezzo di testo", () => {
  assert.deepEqual(noteTextParts("Ripassa il capitolo 4"), [{ text: "Ripassa il capitolo 4" }]);
  assert.deepEqual(noteTextParts(""), []);
});

test("testo della nota: i link http, https e www diventano link sicuri; la punteggiatura dopo resta testo", () => {
  assert.deepEqual(noteTextParts("Vedi https://example.com/a?b=1. Poi www.uni.it, grazie"), [
    { text: "Vedi " },
    { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
    { text: ". Poi " },
    { text: "www.uni.it", href: "https://www.uni.it/" },
    { text: ", grazie" }
  ]);
});

test("testo della nota: link tra parentesi o virgolette non si portano dietro la chiusura", () => {
  assert.deepEqual(noteTextParts("(https://example.com/x) «https://example.com/y»"), [
    { text: "(" },
    { text: "https://example.com/x", href: "https://example.com/x" },
    { text: ") «" },
    { text: "https://example.com/y", href: "https://example.com/y" },
    { text: "»" }
  ]);
});

test("testo della nota: javascript:, data: e indirizzi non validi restano testo semplice", () => {
  const unsafe = "javascript:alert(1) data:text/html,<b>x</b> http://localhost-nope";
  for (const part of noteTextParts(unsafe)) assert.equal(part.href, undefined, part.text);
  assert.equal(noteTextParts(unsafe).map((part) => part.text).join(""), unsafe);
});

test("testo della nota: mailto diventa un link, il testo intero resta uguale", () => {
  const body = "Scrivi a mailto:prof@uni.it\nper il ricevimento";
  const parts = noteTextParts(body);
  assert.deepEqual(parts[1], { text: "mailto:prof@uni.it", href: "mailto:prof@uni.it" });
  assert.equal(parts.map((part) => part.text).join(""), body);
});
