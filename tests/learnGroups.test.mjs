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

// ─── Quiz come i mazzi ───────────────────────────────────────────────────────────────
import { quizNodeItems, quizTree, shortPartTitle } from "../src/lib/learnGroups.ts";

const D = (id, title, parentId, position = 0) => ({ id, title, position, createdAt: "2026-11-01T08:00:00.000Z", ...(parentId ? { parentId } : {}) });
const shape = (nodes) =>
  nodes.map((node) => (node.kind === "quiz" ? `${node.item.id}:${node.title}` : { set: node.key, title: node.title, items: node.items.map((item) => item.id), children: shape(node.children) }));

test("titolo corto di una parte: via il numero di domande in fondo, il resto intero", () => {
  assert.equal(shortPartTitle("Anatomia generale, membrane e imaging · 30 domande"), "Anatomia generale, membrane e imaging");
  assert.equal(shortPartTitle("Simulazione 1 di 2 (50 domande)"), "Simulazione 1 di 2");
  assert.equal(shortPartTitle("Midollo - 12 quesiti"), "Midollo");
  assert.equal(shortPartTitle("30 domande"), "30 domande", "se non avanza nulla resta com'era");
  assert.equal(shortPartTitle("Cap. 5 · Midollo"), "Cap. 5 · Midollo");
});

test("quiz come i mazzi: un mazzo con un quiz per sotto-mazzo è un quiz in parti; un mazzo con un quiz solo resta quel quiz", () => {
  // Forma tipica di una verifica: «Ripasso semplice» con un quiz e «per argomento» con un sotto-mazzo e un quiz per argomento.
  const decks = [
    D("semplice", "Anatomia — Primo parziale · Ripasso semplice", undefined, 0),
    D("argomenti", "Anatomia — Primo parziale · Quiz e flashcard per argomento", undefined, 1),
    D("a-diencefalo", "Diencefalo, talamo e ipotalamo", "argomenti", 2),
    D("a-generale", "Anatomia generale, membrane e imaging", "argomenti", 0),
    D("a-cervelletto", "Cervelletto e circuiti cerebellari", "argomenti", 1)
  ];
  // Quiz in ordine di posizione (tutti 0 nei sotto-mazzi): l'ordine giusto è quello dei mazzi.
  const items = [
    quiz("q-cerv", "Quiz — Cervelletto e circuiti cerebellari · 30 domande", "a-cervelletto"),
    quiz("q-dien", "Quiz — Diencefalo, talamo e ipotalamo · 30 domande", "a-diencefalo"),
    quiz("q-gen", "Quiz — Anatomia generale, membrane e imaging · 30 domande", "a-generale"),
    quiz("q-semplici", "Anatomia — Primo parziale · Quiz semplici (50)", "semplice")
  ];
  const tree = quizTree(items, (item) => item, decks);
  assert.deepEqual(shape(tree), [
    "q-semplici:Anatomia — Primo parziale · Quiz semplici (50)",
    {
      set: "deck:argomenti",
      title: "Anatomia — Primo parziale · Quiz e flashcard per argomento",
      items: ["q-gen", "q-cerv", "q-dien"],
      children: ["q-gen:Anatomia generale, membrane e imaging", "q-cerv:Cervelletto e circuiti cerebellari", "q-dien:Diencefalo, talamo e ipotalamo"]
    }
  ]);
  assert.deepEqual(quizNodeItems(tree).map((item) => item.id), ["q-semplici", "q-gen", "q-cerv", "q-dien"], "nessun quiz si perde");
});

test("quiz come i mazzi: quiz del mazzo prima dei sotto-mazzi, sotto-mazzi con più quiz annidati, mazzi senza quiz assenti", () => {
  const decks = [
    D("verifica", "Verifica finale"),
    D("cap1", "Capitolo 1", "verifica", 0),
    D("cap2", "Capitolo 2", "verifica", 1),
    D("vuoto", "Senza quiz", "verifica", 2),
    D("altro", "Altro mazzo senza quiz", undefined, 5)
  ];
  const items = [
    quiz("c1a", "Capitolo 1 — Parte A", "cap1"),
    quiz("c1b", "Capitolo 1 — Parte B", "cap1"),
    quiz("c2", "Capitolo 2", "cap2"),
    quiz("tutto", "Simulazione completa", "verifica")
  ];
  assert.deepEqual(shape(quizTree(items, (item) => item, decks)), [
    {
      set: "deck:verifica",
      title: "Verifica finale",
      items: ["tutto", "c1a", "c1b", "c2"],
      children: [
        "tutto:Simulazione completa",
        { set: "deck:cap1", title: "Capitolo 1", items: ["c1a", "c1b"], children: ["c1a:Parte A", "c1b:Parte B"] },
        "c2:Capitolo 2"
      ]
    }
  ]);
});

test("quiz come i mazzi: senza mazzo (o con un mazzo sparito) dopo i mazzi, con «Parte 1/2»; i cicli non bloccano", () => {
  const decks = [D("x", "Ciclo X", "y"), D("y", "Ciclo Y", "x"), D("m", "Mazzo")];
  const items = [
    quiz("loose1", "Biochimica — Parte 1"),
    quiz("ghost", "Quiz di un mazzo cancellato", "cancellato"),
    quiz("inM", "Unico del mazzo", "m"),
    quiz("loose2", "Biochimica — Parte 2"),
    quiz("cx", "Nel ciclo", "x")
  ];
  assert.deepEqual(shape(quizTree(items, (item) => item, decks)), [
    "inM:Unico del mazzo",
    "cx:Nel ciclo",
    { set: "title:biochimica", title: "Biochimica", items: ["loose1", "loose2"], children: ["loose1:Parte 1", "loose2:Parte 2"] },
    "ghost:Quiz di un mazzo cancellato"
  ]);
});
