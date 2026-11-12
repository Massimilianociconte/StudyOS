import test from "node:test";
import assert from "node:assert/strict";
import { materialMatches } from "../src/lib/materialFilters.ts";

const material = (patch = {}) => ({
  name: "Dispense.pdf",
  description: "",
  tags: [],
  mimeType: "application/pdf",
  externalUrl: undefined,
  linkedEntityType: undefined,
  linkedEntityId: undefined,
  ...patch
});
const all = { kind: "all", subjectId: "", query: "" };

test("materiali: senza filtri si vede tutto", () => {
  assert.equal(materialMatches(material(), all), true);
});

test("materiali: il tipo scelto nasconde gli altri (un link a YouTube è un video)", () => {
  assert.equal(materialMatches(material(), { ...all, kind: "pdf" }), true);
  assert.equal(materialMatches(material({ name: "Appunti.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), { ...all, kind: "pdf" }), false);
  const youtube = material({ name: "Lezione", mimeType: "text/uri-list", externalUrl: "https://youtube.com/watch?v=1" });
  assert.equal(materialMatches(youtube, { ...all, kind: "link" }), false);
  assert.equal(materialMatches(youtube, { ...all, kind: "video" }), true);
});

test("materiali: il filtro per materia vale solo per i materiali collegati a quella materia", () => {
  const linked = material({ linkedEntityType: "subject", linkedEntityId: "s1" });
  assert.equal(materialMatches(linked, { ...all, subjectId: "s1" }), true);
  assert.equal(materialMatches(linked, { ...all, subjectId: "s2" }), false);
  assert.equal(materialMatches(material(), { ...all, subjectId: "s1" }), false);
  // Collegato a un'attività della materia: non è «della materia» per il filtro.
  assert.equal(materialMatches(material({ linkedEntityType: "task", linkedEntityId: "s1" }), { ...all, subjectId: "s1" }), false);
});

test("materiali: il testo si cerca in nome, descrizione, etichette e link, senza maiuscole", () => {
  const item = material({ description: "Capitolo 3", tags: ["orale"], externalUrl: "https://unimi.it/slide" });
  for (const query of ["dispense", "CAPITOLO", "orale", "unimi", "  slide  "]) assert.equal(materialMatches(item, { ...all, query }), true, query);
  assert.equal(materialMatches(item, { ...all, query: "scritto" }), false);
});
