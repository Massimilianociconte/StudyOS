// Raggruppamenti del Ripasso: mazzi per materia, albero di oggi, quiz divisi in parti.
import test from "node:test";
import assert from "node:assert/strict";
import { groupDeckNodes, partTitles, pruneToTodo, quizBlocks } from "../src/lib/learnGroups.ts";

const node = (id, subjectId, counts = {}, children = []) => ({
  deck: { id, title: id, ...(subjectId ? { subjectId } : {}) },
  depth: 0,
  counts: { cards: 10, direct: 10, due: 0, fresh: 0, quizzes: 0, subdecks: 0, ...counts },
  children
});
const names = new Map([["anat", "Anatomia Umana"], ["fisio", "Principi di Fisiologia"]]);
const options = {
  subjectName: (id) => names.get(id),
  ownerOf: (deckId) => (deckId.startsWith("bob") ? { id: "u_bob", name: "Bob" } : undefined),
  noSubject: "Senza materia",
  sharedBy: (name) => `Condivisi da ${name}`
};

test("mazzi per materia: materie in ordine alfabetico, poi senza materia, poi chi condivide; totali per gruppo", () => {
  const groups = groupDeckNodes(
    [
      node("bob-1", "anat", { due: 2 }),
      node("f1", "fisio", { fresh: 50, cards: 50 }),
      node("loose", undefined),
      node("a1", "anat", { due: 1, fresh: 19, cards: 20 }),
      node("a2", "anat", { fresh: 50, cards: 50 }),
      node("ghost", "materia_cancellata")
    ],
    options
  );
  assert.deepEqual(
    groups.map((group) => [group.key, group.label, group.nodes.map((item) => item.deck.id)]),
    [
      ["anat", "Anatomia Umana", ["a1", "a2"]],
      ["fisio", "Principi di Fisiologia", ["f1"]],
      ["none", "Senza materia", ["loose", "ghost"]],
      ["owner:u_bob", "Condivisi da Bob", ["bob-1"]]
    ]
  );
  const anat = groups[0];
  assert.deepEqual([anat.cards, anat.due, anat.fresh, anat.subjectId], [70, 1, 69, "anat"]);
  assert.equal(groups[3].subjectId, undefined, "la materia di un'altra persona non è tua: niente segno");
  assert.equal(groups[3].ownerId, "u_bob");
});

test("albero di oggi: restano solo i mazzi con qualcosa da fare, anche dentro", () => {
  const tree = [
    node("a1", "anat", { due: 1, fresh: 19 }, [node("a1-x", undefined, { fresh: 10 }), node("a1-y", undefined, {})]),
    node("a2", "anat", {})
  ];
  const pruned = pruneToTodo(tree);
  assert.deepEqual(pruned.map((item) => [item.deck.id, item.children.map((child) => child.deck.id)]), [["a1", ["a1-x"]]]);
  assert.equal(tree[0].children.length, 2, "l'albero di partenza non cambia");
});

test("titoli delle parti: via l'inizio comune fino a un separatore", () => {
  assert.deepEqual(partTitles(["Vero/Falso avanzato — Simulazione 1 di 2 (50 domande)", "Vero/Falso avanzato — Simulazione 2 di 2 (50 domande)"]), [
    "Simulazione 1 di 2 (50 domande)",
    "Simulazione 2 di 2 (50 domande)"
  ]);
  assert.deepEqual(partTitles(["Chimica: parte 1", "Chimica: parte 2"]), ["Parte 1", "Parte 2"]);
  assert.deepEqual(partTitles(["Parte 1", "Parte 2"]), ["Parte 1", "Parte 2"], "senza separatore restano interi");
  assert.deepEqual(partTitles(["Solo"]), ["Solo"]);
});

const quiz = (id, title, deckId) => ({ id, title, ...(deckId ? { deckId } : {}) });

test("quiz in parti: stesso mazzo → un gruppo con il titolo del mazzo, al posto della prima parte", () => {
  const items = [
    quiz("q0", "50 vero/falso — Simulazione completa di Fisiologia", "deck_completo"),
    quiz("q1", "Vero/Falso avanzato — Simulazione 1 di 2 (50 domande)", "deck_vf"),
    quiz("q2", "Vero/Falso avanzato — Simulazione 2 di 2 (50 domande)", "deck_vf")
  ];
  const blocks = quizBlocks(items, (item) => item, (deckId) => ({ deck_vf: "100 nuovi vero/falso — Due simulazioni da 50" })[deckId]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { kind: "single", item: items[0] }, "un quiz da solo nel suo mazzo resta da solo");
  assert.equal(blocks[1].kind, "parts");
  assert.equal(blocks[1].title, "100 nuovi vero/falso — Due simulazioni da 50");
  assert.deepEqual(blocks[1].items.map((item) => item.id), ["q1", "q2"]);
  assert.deepEqual(blocks[1].titles, ["Simulazione 1 di 2 (50 domande)", "Simulazione 2 di 2 (50 domande)"]);
});

test("quiz in parti senza mazzo: «1 di 2», «Parte 2», «(1/2)» con lo stesso nome per il resto", () => {
  const items = [
    quiz("a", "Biochimica — Parte 1"),
    quiz("x", "Genetica"),
    quiz("b", "Biochimica — Parte 2"),
    quiz("c", "Istologia (1/2)"),
    quiz("d", "Istologia (2/2)"),
    quiz("e", "Fisica 1 di 3"),
    quiz("f", "Chimica 2 di 3")
  ];
  const blocks = quizBlocks(items, (item) => item, () => undefined);
  assert.deepEqual(
    blocks.map((block) => (block.kind === "single" ? block.item.id : `${block.title}: ${block.items.map((item) => item.id).join("+")}`)),
    ["Biochimica: a+b", "x", "Istologia: c+d", "e", "f"]
  );
  assert.deepEqual(blocks[0].titles, ["Parte 1", "Parte 2"]);
});

test("quiz in parti: un titolo con un numero qualunque non fa gruppo", () => {
  const items = [quiz("a", "Cap. 5 · Midollo"), quiz("b", "Cap. 6 · Tronco"), quiz("c", "Set medio-alto (150 quesiti)")];
  assert.ok(quizBlocks(items, (item) => item, () => undefined).every((block) => block.kind === "single"));
});
