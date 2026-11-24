// Identità delle materie: doppioni certi, probabili e semplici somiglianze, sui nomi veri di un account.
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareSubjects,
  duplicateSubjectPairs,
  exactDuplicate,
  normalizeSubjectName,
  sameTeacher,
  subjectMatches,
  subjectPairKey,
  subjectWords
} from "../src/lib/subjectIdentity.ts";

// Le 14 materie di un account reale (nomi e docenti come sono salvati), con i due doppioni creati da un agente.
const REAL = [
  ["approcci", "Approcci per l'identificazione di bersagli farmacologici nelle malattie genetiche", "Valenza Marta"],
  ["patologia", "Patologia", "Gandellini Paolo"],
  ["anat-barb", "Anatomia dell'uomo", "Cappelletti Graziella"],
  ["fisio-barb", "Principi di fisiologia", "Baruscotti Mirko"],
  ["genetica", "Genetica e genomica umana con elementi di bioinformatica", "Caretti Giuseppina"],
  ["farmaco", "Farmacologia speciale", "Sacerdote Paola Giuseppina"],
  ["biostat", "Biostatistica", "Colicino Elena"],
  ["meccanismi", "Meccanismi molecolari di trasduzione del segnale in biologia cellulare e patologia", "Ricciardi Sara"],
  ["endocrino", "Fisiologia e farmacologia del sistema endocrino", "Bucchi Annalisa"],
  ["neuro", "Neurofisiologia", "Baruscotti Mirko"],
  ["diagnostica", "Diagnostica avanzata di laboratorio biosanitario", "Bianchi Silvia"],
  ["methods", "Methods in bioinformatics", "Zambelli Federico"],
  ["anat-agent", "Anatomia Umana", "Graziella Cappelletti"],
  ["fisio-agent", "Principi di Fisiologia", "Mirko Baruscotti"]
].map(([id, name, teacher]) => ({ id, name, teacher, archived: false, status: "active" }));

test("normalizzazione: maiuscole, accenti, apostrofi e spazi non contano", () => {
  assert.equal(normalizeSubjectName("  Anatomia dell'Uomo "), "anatomia dell uomo");
  assert.equal(normalizeSubjectName("Biologia  Cellulare–Molecolare"), "biologia cellulare molecolare");
  assert.equal(normalizeSubjectName("Città"), "citta");
  assert.deepEqual(subjectWords("Anatomia dell'uomo"), ["anatomia", "uomo"]);
  assert.deepEqual(subjectWords("Anatomia Umana"), ["anatomia", "uomo"]);
  assert.deepEqual(subjectWords("Principi di fisiologia"), ["fisiologia"], "«principi» è una parola da corso");
});

test("docente: stesso nome in qualsiasi ordine, titoli a parte; vuoto non è mai lo stesso", () => {
  assert.ok(sameTeacher("Graziella Cappelletti", "Cappelletti Graziella"));
  assert.ok(sameTeacher("Prof.ssa Graziella Cappelletti", "CAPPELLETTI"));
  assert.ok(!sameTeacher("Baruscotti Mirko", "Bucchi Annalisa"));
  assert.ok(!sameTeacher("", ""));
  assert.ok(!sameTeacher("Rossi", ""));
});

test("account reale: esattamente le due coppie create dall'agente, nient'altro", () => {
  const pairs = duplicateSubjectPairs(REAL);
  assert.deepEqual(
    pairs.map((pair) => [pair.a.id, pair.b.id, pair.level]).sort(),
    [
      ["anat-barb", "anat-agent", "likely"],
      ["fisio-barb", "fisio-agent", "same"]
    ]
  );
});

test("trappole dei nomi veri: stesso docente su materie diverse, parole contenute in altri nomi", () => {
  const byId = Object.fromEntries(REAL.map((subject) => [subject.id, subject]));
  // Stesso docente, materie diverse, nessuna parola intera in comune.
  assert.equal(compareSubjects(byId.neuro, byId["fisio-barb"]), null);
  // «umana» in comune ma docenti diversi: solo un'indicazione.
  assert.equal(compareSubjects(byId.genetica, byId["anat-agent"])?.level, "related");
  // «bioinformatics» = «bioinformatica», docenti diversi: solo un'indicazione.
  assert.equal(compareSubjects(byId.methods, byId.genetica)?.level, "related");
  // Parole contenute in nomi più lunghi, docenti diversi.
  assert.equal(compareSubjects(byId.patologia, byId.meccanismi)?.level, "related");
  assert.equal(compareSubjects(byId.endocrino, byId["fisio-barb"])?.level, "related");
  assert.equal(compareSubjects(byId.endocrino, byId.farmaco)?.level, "related");
});

test("un agente che crea «Anatomia Umana» trova la materia del catalogo anche senza docente", () => {
  const matches = subjectMatches({ name: "Anatomia umana" }, REAL.filter((subject) => !subject.id.endsWith("agent")));
  // Prima il probabile doppione, poi le semplici somiglianze («umana» di Genetica).
  assert.deepEqual(matches.map((match) => [match.subject.id, match.level]), [["anat-barb", "likely"], ["genetica", "related"]]);
  assert.equal(exactDuplicate({ name: "principi di FISIOLOGIA " }, REAL)?.subject.id, "fisio-barb");
  assert.equal(exactDuplicate({ name: "Fisiologia vegetale" }, REAL), undefined);
});

test("numeri diversi e insegnamenti diversi del catalogo non sono mai la stessa materia", () => {
  assert.equal(compareSubjects({ name: "Fisica I", teacher: "Mario Rossi" }, { name: "Fisica II", teacher: "Mario Rossi" })?.level, "related");
  assert.equal(compareSubjects({ name: "Chimica 1" }, { name: "Chimica 2" })?.level, "related");
  assert.equal(compareSubjects({ name: "Fisica 1" }, { name: "Fisica I" })?.level, "likely", "1 e I sono lo stesso numero");
  assert.equal(compareSubjects({ name: "Genetica", universityCourseId: "c1" }, { name: "Genetica", universityCourseId: "c2" })?.level, "related");
  assert.equal(compareSubjects({ name: "Genetica umana", universityCourseId: "c1" }, { name: "Altro nome", universityCourseId: "c1" })?.level, "same");
  assert.equal(compareSubjects({ name: "Laboratorio di chimica", teacher: "Rossi" }, { name: "Laboratorio di fisica", teacher: "Rossi" }), null);
});

test("abbreviazioni: solo un'indicazione", () => {
  assert.equal(compareSubjects({ name: "Anat. umana" }, { name: "Anatomia comparata" })?.level, "related");
});

test("«Sono diverse»: la coppia non torna; archiviate escluse; chiave uguale nei due ordini", () => {
  assert.equal(subjectPairKey("b", "a"), subjectPairKey("a", "b"));
  assert.equal(duplicateSubjectPairs(REAL, [subjectPairKey("anat-agent", "anat-barb")]).length, 1);
  const archived = REAL.map((subject) => (subject.id === "fisio-agent" ? { ...subject, status: "archived" } : subject));
  assert.deepEqual(duplicateSubjectPairs(archived).map((pair) => pair.key), [subjectPairKey("anat-barb", "anat-agent")]);
});
