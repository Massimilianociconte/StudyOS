// Flashcard e quiz: blocchi strutturati, SVG ostili, ripasso a intervalli, punteggio dei quiz,
// statistiche e modello (gerarchia, copia, richieste agli agenti).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLLECTIONS, ENTITY_TYPES } from "../src/lib/collections.ts";
import {
  blocksPlainText,
  CARD_LIMITS,
  duplicateKey,
  KATEX_OPTIONS,
  normalizeBlocks,
  parseInline,
  safeBlocks,
  safeUrl,
  sanitizeSvg
} from "../src/lib/cardBlocks.ts";
import { applyReview, classifyCard, SRS } from "../src/lib/srs.ts";
import { questionError, scoreAttempt, scoreQuestion, shuffled } from "../src/lib/quizScoring.ts";
import {
  appendRunEvent,
  copyDeckTree,
  deckDescendantIds,
  deckPath,
  newAiRequest,
  normalizeCardFields,
  normalizeOptions,
  normalizeQuestionFields,
  parentError,
  requestStatusAt,
  sameFields
} from "../src/lib/learningModel.ts";
import { learningStats } from "../src/lib/learningStats.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };

test("le 8 collezioni nuove sono registrate per persistenza, sync e backup", () => {
  const expected = {
    decks: "studyDeck",
    flashcards: "flashcard",
    quizzes: "quiz",
    quizQuestions: "quizQuestion",
    cardStates: "flashcardState",
    studyRuns: "studyRun",
    aiAnalyses: "aiAnalysis",
    aiRequests: "aiRequest"
  };
  for (const [key, type] of Object.entries(expected)) {
    assert.ok(COLLECTIONS.includes(key), key);
    assert.equal(ENTITY_TYPES[key], type);
    assert.match(source("src/views/SettingsView.tsx"), new RegExp(`${key}: scope === "full" \\? snapshot\\.${key} : \\[\\]`));
    assert.match(source("src/data/defaults.ts"), new RegExp(`${key}: \\[\\]`));
  }
  assert.match(source("src/lib/db.ts"), /this\.version\(9\)\.stores\(\{[^}]*decks: "id, updatedAt, parentId, subjectId"/);
  // Ogni collezione nuova alza SYNC_SCHEMA (5 = raccolte e quiz, 6 = dubbi segnati).
  assert.ok(Number(/const SYNC_SCHEMA = (\d+);/.exec(source("src/lib/cloudSync.ts"))[1]) >= 5);
});

// ─── Blocchi ──────────────────────────────────────────────────────────────────────────────

test("normalizeBlocks: testo semplice diventa paragrafi, i blocchi si validano", () => {
  const plain = normalizeBlocks("Prima riga\n\nSeconda **riga**", "front");
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.blocks, [
    { type: "text", text: "Prima riga" },
    { type: "text", text: "Seconda **riga**" }
  ]);
  const rich = normalizeBlocks(
    [
      { type: "heading", text: "Cinetica", level: 3 },
      { type: "formula", latex: "v = k[A]^2" },
      { type: "list", items: ["uno", "due"], ordered: true },
      { type: "table", header: ["a", "b"], rows: [["1", 2]] },
      { type: "callout", text: "Ricorda", tone: "key" },
      { type: "code", code: "\nprint(1)\n", language: "python" },
      { type: "reference", title: "Atkins", chapter: "3", pages: "45-48", url: "https://example.org/libro" }
    ],
    "back"
  );
  assert.equal(rich.ok, true, rich.error);
  assert.equal(rich.blocks[3].rows[0][1], "2", "numeri nelle celle diventano testo");
  assert.equal(rich.blocks[5].code, "print(1)");
  assert.equal(normalizeBlocks({ v: 1, blocks: [{ type: "text", text: "ok" }] }, "front").ok, true);
  assert.match(normalizeBlocks({ v: 2, blocks: [] }, "front").error, /versione/);
});

test("normalizeBlocks: limiti e tipi sconosciuti respinti con messaggi utili", () => {
  assert.match(normalizeBlocks([], "front").error, /mancante/);
  assert.match(normalizeBlocks([{ type: "html", html: "<b>x</b>" }], "front").error, /tipo sconosciuto/);
  assert.match(normalizeBlocks("x".repeat(CARD_LIMITS.text + 1), "front").error, /troppo lungo/);
  const many = Array.from({ length: CARD_LIMITS.blocksPerSide + 1 }, () => "a");
  assert.match(normalizeBlocks(many, "front").error, /massimo 30 blocchi/);
  assert.match(normalizeBlocks([{ type: "table", rows: [Array(9).fill("x")] }], "f").error, /colonne/);
  assert.equal(normalizeBlocks(undefined, "explanation", { required: false }).ok, true);
});

test("immagini: solo https pubblici, niente base64, javascript: o host privati", () => {
  const bad = [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "http://example.org/a.png",
    "https://user:pass@example.org/a.png",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://192.168.1.1/router.png",
    "https://10.0.0.5/x.png",
    "https://[::1]/x.png",
    "blob:https://example.org/uuid",
    "//example.org/a.png"
  ];
  for (const url of bad) {
    const result = normalizeBlocks([{ type: "image", url, alt: "x" }], "front");
    assert.equal(result.ok, false, url);
  }
  assert.match(normalizeBlocks([{ type: "image", url: "data:image/png;base64,AAA", alt: "x" }], "f").error, /base64/);
  assert.match(normalizeBlocks([{ type: "image", url: "https://example.org/a.png" }], "f").error, /alt/);
  const good = normalizeBlocks([{ type: "image", url: "https://upload.wikimedia.org/a.png", alt: "Schema", width: 640.4, height: -2 }], "f");
  assert.equal(good.ok, true);
  assert.deepEqual(good.blocks[0], { type: "image", url: "https://upload.wikimedia.org/a.png", alt: "Schema", width: 640 });
  assert.equal(safeUrl("http://example.org", { allowHttp: true }), "http://example.org/");
  assert.equal(safeUrl("ftp://example.org"), null);
});

test("URL delle schede: host locali travestiti respinti, host pubblici accettati", () => {
  const local = [
    "https://localhost./a.png",
    "https://localhost%2e/a.png",
    "https://intranet/a.png",
    "https://nas/a.png",
    "https://0x7f000001/a.png",
    "https://2130706433/a.png",
    "https://127.1/a.png",
    "https://0.0.0.0/a.png",
    "https://100.64.1.1/a.png",
    "https://100.127.255.1/a.png",
    "https://192.168.1.1./a.png",
    "https://172.20.0.5/a.png",
    "https://169.254.169.254/latest",
    "https://198.18.0.1/a.png",
    "https://224.0.0.1/a.png",
    "https://router.lan/a.png",
    "https://router.LAN./a.png",
    "https://a.home.arpa/a.png",
    "https://fritz.box/a.png",
    "https://printer.local/a.png",
    "https://svc.internal/a.png",
    "https://foo.test/a.png",
    "https://[::1]/a.png",
    "https://[::ffff:127.0.0.1]/a.png",
    "https://[fe80::1]/a.png",
    "https://a..b/a.png"
  ];
  for (const url of local) assert.equal(safeUrl(url), null, url);
  for (const url of ["https://upload.wikimedia.org/a.png", "https://example.org/x", "https://100.63.0.1/a.png", "https://8.8.8.8/a.png", "https://home.example.org/a", "https://lan.wikipedia.org/x"]) {
    assert.notEqual(safeUrl(url), null, url);
  }
  assert.equal(safeUrl("https://Upload.Wikimedia.org./a.png"), "https://upload.wikimedia.org./a.png");
});

test("SVG: script, eventi, foreignObject e riferimenti esterni respinti all'ingresso", () => {
  const attacks = [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"><rect/></svg>',
    '<svg><foreignObject><iframe src="https://evil"/></foreignObject></svg>',
    '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><image href="https://tracker.example/p.gif"/></svg>',
    '<svg><use xlink:href="https://evil/x.svg#a"/></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg>&x;</svg>'
  ];
  for (const svg of attacks) {
    assert.equal(normalizeBlocks([{ type: "svg", svg, alt: "x" }], "f").ok, false, svg);
  }
  assert.match(normalizeBlocks([{ type: "svg", svg: "<svg/>".padEnd(CARD_LIMITS.svgBytes + 10, " "), alt: "x" }], "f").error, /troppo grande/);
});

test("sanitizeSvg ricostruisce solo tag e attributi consentiti", () => {
  const dirty =
    '<svg viewBox="0 0 10 10" onclick="x()"><g><rect width="5" height="5" fill="url(#g)" style="fill:red"/><SCRIPT>bad()</SCRIPT>' +
    '<style>@import url(https://evil)</style><circle r="2" fill="url(https://evil/x)"/><text x="1">a &lt;b&gt; &amp; "c"</text>' +
    '<linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><animate attributeName="href" to="javascript:1"/>' +
    '<use href="#g"/><use href="https://evil"/></g></svg>';
  const result = sanitizeSvg(dirty);
  assert.equal(result.ok, true);
  const out = result.svg;
  assert.ok(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'), out);
  assert.doesNotMatch(out, /script|onclick|@import|evil|animate|javascript/i);
  assert.match(out, /fill="url\(#g\)"/);
  assert.match(out, /<circle r="2"\/>/, "fill esterno tolto, cerchio tenuto");
  assert.match(out, /<text x="1">a &lt;b&gt; &amp; &quot;c&quot;<\/text>/, "testo ri-escapato");
  assert.match(out, /<linearGradient id="g">/);
  assert.match(out, /<use href="#g"\/><use\/>/);
  assert.ok(result.dropped >= 5);
  // Tag mal chiusi o senza radice
  assert.equal(sanitizeSvg("<g><rect/></g>").ok, false);
  assert.equal(sanitizeSvg('<svg><g><rect width="1">').svg, '<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1"></rect></g></svg>');
  // Payload annidati per far «riaprire» uno script dopo la rimozione
  const nested = sanitizeSvg("<svg><scr<script>ipt>alert(1)</script><text>ok</text></svg>");
  assert.doesNotMatch(nested.svg ?? "", /<script/i);
});

test("formule: KaTeX vero con le opzioni delle schede non produce link, immagini, id, classi o stili scelti dall'agente", async () => {
  const { default: katex } = await import("katex");
  await import("katex/contrib/mhchem");
  const hostile = [
    String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\url{javascript:alert(1)}`,
    String.raw`\htmlClass{evil}{y}`,
    String.raw`\htmlId{evil}{y}`,
    String.raw`\htmlStyle{background:url(https://evil.example/x)}{y}`,
    String.raw`\htmlData{onload=alert(1)}{y}`,
    String.raw`\includegraphics{https://evil.example/x.png}`,
    "<script>alert(1)</script> x<img src=x onerror=alert(1)>",
    String.raw`\ce{H2O <script>alert(1)</script>}`,
    String.raw`\text{<img src=x onerror=alert(1)>}`
  ];
  const forbiddenTags = new Set(["script", "a", "img", "image", "iframe", "object", "embed", "link", "style", "foreignobject", "use"]);
  for (const latex of hostile) {
    for (const displayMode of [true, false]) {
      const html = katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
      // Solo il markup vero: il testo dell'agente resta testo (escapato, es. dentro <annotation>).
      for (const [tag, name, attrs] of html.matchAll(/<([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"]*")*)\s*\/?>/g)) {
        assert.equal(forbiddenTags.has(name.toLowerCase()), false, `${latex}: tag ${tag}`);
        for (const [, attr, value] of attrs.matchAll(/\s+([a-zA-Z:-]+)="([^"]*)"/g)) {
          const key = attr.toLowerCase();
          assert.equal(/^(href|src|xlink:href|id|on[a-z]+|data-.*)$/.test(key), false, `${latex}: attributo ${attr}`);
          if (key === "class") assert.equal(/evil/.test(value), false, `${latex}: classe ${value}`);
          if (key === "style") assert.equal(/url\(|expression|javascript|evil/i.test(value), false, `${latex}: stile ${value}`);
        }
      }
      assert.equal(/<script|<img|<a\s/i.test(html), false, latex);
    }
  }
  // Espansione senza fine: errore in fretta, nessun blocco.
  const started = performance.now();
  const loop = katex.renderToString(String.raw`\def\x{\x\x}\x`, { ...KATEX_OPTIONS, displayMode: true });
  assert.match(loop, /katex-error/);
  assert.ok(performance.now() - started < 1000);
  assert.equal(KATEX_OPTIONS.trust, false);
});

test("safeBlocks scarta in silenzio i blocchi rotti (dati da sync o versioni vecchie)", () => {
  const blocks = safeBlocks([{ type: "text", text: "ok" }, { type: "image", url: "javascript:1", alt: "x" }, null, { type: "svg", svg: "<svg onload=1/>", alt: "x" }]);
  assert.deepEqual(blocks.map((block) => block.type), ["text", "svg"]);
  assert.doesNotMatch(blocks[1].svg, /onload/);
  assert.deepEqual(safeBlocks("testo"), [{ type: "text", text: "testo" }]);
  assert.deepEqual(safeBlocks(42), []);
});

test("parseInline: markdown ridotto senza HTML", () => {
  assert.deepEqual(parseInline("**F** = m*a* con $E=mc^2$, H~2~O, x^2^ e `code` costa \\$5"), [
    { kind: "bold", text: "F" },
    { kind: "text", text: " = m" },
    { kind: "italic", text: "a" },
    { kind: "text", text: " con " },
    { kind: "math", text: "E=mc^2" },
    { kind: "text", text: ", H" },
    { kind: "sub", text: "2" },
    { kind: "text", text: "O, x" },
    { kind: "sup", text: "2" },
    { kind: "text", text: " e " },
    { kind: "code", text: "code" },
    { kind: "text", text: " costa $5" }
  ]);
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>"), [{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
});

test("blocksPlainText e duplicateKey per ricerca e duplicati", () => {
  const blocks = [
    { type: "text", text: "Qual è la **legge** di Ohm?" },
    { type: "formula", latex: "V = RI" }
  ];
  assert.equal(blocksPlainText(blocks), "Qual è la legge di Ohm? V = RI");
  assert.equal(duplicateKey(blocks), "qual e la legge di ohm v ri");
  assert.equal(blocksPlainText([{ type: "text", text: "a".repeat(50) }], 10), "aaaaaaaaa…");
});

// ─── Ripasso a intervalli ─────────────────────────────────────────────────────────────────

test("SRS: corretta 1 → 3 → intervallo × facilità, massimo 365", () => {
  const card = { id: "card_1", deckId: "deck_1", revision: 2 };
  const t0 = new Date("2026-11-16T09:00:00.000Z");
  const s1 = applyReview(undefined, card, "correct", t0);
  assert.equal(s1.intervalDays, 1);
  assert.equal(s1.reps, 1);
  assert.equal(s1.ease, 2.55);
  assert.equal(s1.due, "2026-11-17T09:00:00.000Z");
  assert.equal(s1.revision, 2);
  const s2 = applyReview(s1, card, "correct", new Date(s1.due));
  assert.equal(s2.intervalDays, 3);
  const s3 = applyReview(s2, card, "correct", new Date(s2.due));
  assert.equal(s3.intervalDays, Math.round(3 * 2.6));
  let s = s3;
  for (let i = 0; i < 20; i++) s = applyReview(s, card, "correct", new Date(s.due));
  assert.equal(s.intervalDays, SRS.maxIntervalDays);
  assert.equal(s.ease, SRS.maxEase);
  assert.equal(s.correct, 23);
});

test("SRS: uno stato senza contatori (o con valori strani) non produce NaN", () => {
  const card = { id: "card_1" };
  const now = new Date("2026-11-16T09:00:00.000Z");
  const broken = { id: "card_1", cardId: "card_1", due: now.toISOString(), ease: "x", intervalDays: null, reps: "3", lapses: undefined, correct: NaN, wrong: -4, doubt: Infinity };
  for (const result of ["correct", "wrong", "doubt"]) {
    const next = applyReview(broken, card, result, now);
    for (const key of ["reps", "lapses", "correct", "wrong", "doubt", "ease", "intervalDays"]) assert.ok(Number.isFinite(next[key]), `${result} ${key}=${next[key]}`);
    assert.ok(!Number.isNaN(Date.parse(next.due)), result);
  }
  assert.equal(applyReview(broken, card, "wrong", now).lapses, 1);
  assert.equal(applyReview(broken, card, "correct", now).correct, 1);
});

test("SRS: sbagliata azzera e torna dopo 10 minuti; dubbia rallenta; salta non cambia nulla", () => {
  const card = { id: "card_1" };
  const t0 = new Date("2026-11-16T09:00:00.000Z");
  const learned = applyReview(applyReview(undefined, card, "correct", t0), card, "correct", new Date("2026-11-17T09:00:00.000Z"));
  const wrong = applyReview(learned, card, "wrong", new Date("2026-11-20T09:00:00.000Z"));
  assert.equal(wrong.reps, 0);
  assert.equal(wrong.lapses, 1);
  assert.equal(wrong.intervalDays, 0);
  assert.equal(wrong.ease, 2.4);
  assert.equal(wrong.due, "2026-11-20T09:10:00.000Z");
  const doubt = applyReview(learned, card, "doubt", new Date("2026-11-20T09:00:00.000Z"));
  assert.equal(doubt.intervalDays, 4, "3 × 1,2 = 3,6 → 4");
  assert.equal(doubt.ease, 2.45);
  assert.equal(doubt.reps, learned.reps);
  assert.equal(applyReview(undefined, card, "doubt", t0).intervalDays, 1);
  assert.equal(applyReview(learned, card, "skip", t0), learned);
  let low = learned;
  for (let i = 0; i < 10; i++) low = applyReview(low, card, "wrong", t0);
  assert.equal(low.ease, SRS.minEase);
});

test("SRS: classificazione per giorno locale", () => {
  const card = { id: "c" };
  const now = new Date(2026, 10, 16, 15, 0);
  assert.equal(classifyCard(undefined, now).status, "new");
  const dueLater = { ...applyReview(undefined, card, "correct", new Date(2026, 10, 15, 20, 0)) };
  assert.equal(classifyCard(dueLater, now).status, "due", "scade oggi alle 20: da ripassare oggi");
  const overdue = applyReview(undefined, card, "correct", new Date(2026, 10, 10, 9, 0));
  assert.equal(classifyCard(overdue, now).status, "overdue");
  let hard = applyReview(undefined, card, "wrong", new Date(2026, 10, 1));
  hard = applyReview(hard, card, "wrong", new Date(2026, 10, 1));
  hard = applyReview(hard, card, "wrong", new Date(2026, 10, 1));
  hard = { ...hard, due: new Date(2026, 11, 1).toISOString() };
  assert.equal(classifyCard(hard, now).status, "difficult");
  const consolidated = { ...overdue, intervalDays: 30, due: new Date(2026, 11, 20).toISOString(), lastResult: "correct" };
  assert.equal(classifyCard(consolidated, now).status, "consolidated");
  const doubtful = { ...consolidated, lastResult: "doubt" };
  assert.equal(classifyCard(doubtful, now).status, "doubtful");
});

// ─── Quiz ─────────────────────────────────────────────────────────────────────────────────

const single = { id: "q1", kind: "single", options: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }] };
const multiple = {
  id: "q2",
  kind: "multiple",
  options: [
    { id: "a", text: "A", correct: true },
    { id: "b", text: "B", correct: false },
    { id: "c", text: "C", correct: true }
  ]
};

test("punteggio: singola, multipla esatta, nessun parziale, non data a parte", () => {
  assert.equal(scoreQuestion(single, ["b"]), "correct");
  assert.equal(scoreQuestion(single, ["a"]), "wrong");
  assert.equal(scoreQuestion(single, ["a", "b"]), "wrong");
  assert.equal(scoreQuestion(single, []), "skip");
  assert.equal(scoreQuestion(single, ["zzz"]), "skip", "id inesistenti = non data");
  assert.equal(scoreQuestion(multiple, ["c", "a"]), "correct", "l'ordine non conta");
  assert.equal(scoreQuestion(multiple, ["a"]), "wrong", "nessun punteggio parziale");
  assert.equal(scoreQuestion(multiple, ["a", "b", "c"]), "wrong");
  const attempt = scoreAttempt([single, multiple, { ...single, id: "q3" }], new Map([["q1", ["b"]], ["q2", ["a"]]]), new Set(["q2"]));
  assert.deepEqual(attempt, { total: 3, correct: 1, wrong: 1, skipped: 1, flagged: 1, score: 1 / 3 });
  assert.equal(scoreAttempt([], {}).score, null);
});

test("coerenza delle domande e opzioni con id stabili", () => {
  assert.match(questionError({ kind: "single", options: multiple.options }), /esattamente 1/);
  assert.match(questionError({ kind: "multiple", options: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: false }] }), /almeno 1/);
  assert.match(questionError({ kind: "single", options: [{ id: "a", text: "A", correct: true }] }), /da 2 a 10/);
  assert.match(questionError({ kind: "single", options: [{ id: "a", text: "A", correct: true }, { id: "b", text: " a ", correct: false }] }), /ripetuti/);
  const fresh = normalizeOptions([{ text: "Uno", correct: true }, { text: "Due", correct: false }]);
  assert.deepEqual(fresh.value.map((option) => option.id), ["o1", "o2"]);
  const kept = normalizeOptions([{ text: "Due", correct: false }, { text: "Tre", correct: true }], fresh.value);
  assert.deepEqual(kept.value.map((option) => option.id), ["o2", "o3"], "stesso testo, stesso id; i nuovi non riusano id occupati");
  assert.match(normalizeOptions([{ id: "x y", text: "a", correct: true }, { text: "b", correct: false }]).error, /id/);
  const inserted = normalizeOptions([{ text: "Zero", correct: false }, { text: "Uno", correct: true }, { text: "Due", correct: false }], fresh.value);
  assert.deepEqual(inserted.value.map((option) => option.id), ["o3", "o1", "o2"], "un'opzione nuova in testa non sposta gli id delle altre");
  const removed = normalizeOptions([{ text: "Due", correct: false }, { text: "Nuova", correct: true }], fresh.value);
  assert.deepEqual(removed.value.map((option) => option.id), ["o2", "o3"], "l'id di un'opzione tolta non passa a una nuova");
  const explicitFirst = normalizeOptions([{ text: "Uno", correct: false }, { id: "o1", text: "Altro", correct: true }], fresh.value);
  assert.deepEqual(explicitFirst.value.map((option) => option.id), ["o3", "o1"], "un id esplicito vince sul testo uguale");
  assert.match(normalizeOptions([{ id: "a", text: "A", correct: true }, { id: "a", text: "B", correct: false }]).error, /ripetuto/);
  const question = normalizeQuestionFields({ kind: "multiple", prompt: "Quali?", options: multiple.options }, false);
  assert.equal(question.ok, true);
  assert.match(normalizeQuestionFields({ kind: "single" }, true, { ...multiple, prompt: [] }).error, /esattamente 1/, "cambio di tipo controllato sulla domanda risultante");
});

test("mescolamento deterministico con seme", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(shuffled(items, 42), shuffled(items, 42));
  assert.notDeepEqual(shuffled(items, 42), items);
  assert.deepEqual([...shuffled(items, 7)].sort((a, b) => a - b), items);
});

// ─── Modello ──────────────────────────────────────────────────────────────────────────────

const deck = (id, parentId, extra = {}) => ({ id, title: id, description: "", kind: "topic", position: 1, ...(parentId ? { parentId } : {}), ...stamp, ...extra });

test("gerarchia: discendenti, percorso, niente cicli, profondità massima", () => {
  const decks = [deck("a"), deck("b", "a"), deck("c", "b"), deck("x")];
  assert.deepEqual([...deckDescendantIds(decks, "a")].sort(), ["a", "b", "c"]);
  assert.deepEqual(deckPath(decks, "c").map((item) => item.id), ["a", "b", "c"]);
  assert.match(parentError(decks, "a", "c"), /sé stessa/);
  assert.match(parentError(decks, "a", "a"), /sé stessa/);
  assert.match(parentError(decks, undefined, "zzz"), /non trovata/);
  assert.equal(parentError(decks, "x", "c"), null);
  const deep = Array.from({ length: 8 }, (_, i) => deck(`d${i}`, i ? `d${i - 1}` : undefined));
  assert.match(parentError(deep, undefined, "d7"), /8 livelli/);
  const cyclic = [deck("p", "q"), deck("q", "p")];
  assert.equal(deckPath(cyclic, "p").length, 2, "un ciclo arrivato dalla sync non blocca");
});

test("normalizeCardFields e sameFields per l'idempotenza", () => {
  const fields = normalizeCardFields({ front: "Domanda", back: [{ type: "text", text: "Risposta" }], difficulty: 3, externalRef: "cap1-01", tags: ["a", "a", "b"] }, false);
  assert.equal(fields.ok, true);
  assert.deepEqual(fields.value.tags, ["a", "b"]);
  assert.match(normalizeCardFields({ front: "x", back: "y", difficulty: 9 }, false).error, /difficulty/);
  assert.match(normalizeCardFields({ front: "x" }, false).error, /back/);
  const card = { ...fields.value, id: "card_1" };
  assert.equal(sameFields(card, { front: [{ type: "text", text: "Domanda" }], difficulty: 3 }), true);
  assert.equal(sameFields(card, { difficulty: 4 }), false);
});

test("copyDeckTree: copia indipendente con id nuovi e relazioni rimappate", () => {
  const source = {
    decks: [deck("a", undefined, { subjectId: "sub_1" }), deck("b", "a"), deck("z")],
    flashcards: [{ id: "c1", deckId: "b", subjectId: "sub_1", front: [], back: [], position: 1, revision: 7, ...stamp }],
    quizzes: [{ id: "q1", deckId: "a", title: "Q", description: "", position: 1, revision: 3, ...stamp }],
    quizQuestions: [{ id: "qq1", quizId: "q1", kind: "single", prompt: [], options: [{ id: "a", text: "A", correct: true }], position: 1, revision: 2, ...stamp }]
  };
  let n = 0;
  const copy = copyDeckTree(source, "a", { newId: (prefix) => `${prefix}_new${++n}`, now: "2026-11-16T10:00:00.000Z", title: "Copia", subjectId: null });
  assert.equal(copy.decks.length, 2);
  const root = copy.decks.find((item) => !item.parentId);
  assert.equal(root.title, "Copia");
  assert.equal(root.subjectId, undefined, "subjectId null toglie la materia (copia di altri)");
  const child = copy.decks.find((item) => item.parentId);
  assert.equal(child.parentId, root.id);
  assert.equal(copy.flashcards[0].deckId, child.id);
  assert.equal(copy.flashcards[0].revision, 1);
  assert.equal(copy.quizQuestions[0].quizId, copy.quizzes[0].id);
  assert.ok([...copy.decks, ...copy.flashcards, ...copy.quizzes, ...copy.quizQuestions].every((item) => item.id.includes("_new")));
  copy.quizQuestions[0].options[0].text = "cambiato";
  assert.equal(source.quizQuestions[0].options[0].text, "A", "la copia non condivide oggetti");
});

test("sessioni: oltre 400 risposte si continua in una riga nuova", () => {
  const run = { id: "run_1", kind: "flashcards", mode: "review", title: "R", deckIds: [], subjectIds: [], startedAt: "2026-11-16T09:00:00.000Z", itemIds: [], events: [], ...stamp };
  let current = run;
  for (let i = 0; i < 400; i++) current = appendRunEvent(current, { i: `c${i}`, r: "correct", at: "2026-11-16T09:00:00.000Z" }, () => "x", "t").run;
  const result = appendRunEvent(current, { i: "c400", r: "wrong", at: "2026-11-16T10:00:00.000Z" }, () => "run_2", "t");
  assert.equal(result.run.events.length, 400);
  assert.equal(result.run.endedAt, "2026-11-16T10:00:00.000Z");
  assert.equal(result.next.id, "run_2");
  assert.equal(result.next.continuesId, "run_1");
  assert.deepEqual(result.next.events.map((event) => event.i), ["c400"]);
});

test("richieste agli agenti: scadenza e lease", () => {
  const now = new Date("2026-11-16T10:00:00.000Z");
  const request = newAiRequest({ kind: "explain_card", style: "simple", prompt: "  perché?  ", targetId: "card_1" }, "aireq_1", now);
  assert.equal(request.status, "pending");
  assert.equal(request.prompt, "perché?");
  assert.equal(request.expiresAt, "2026-11-30T10:00:00.000Z");
  const claimed = { ...request, status: "claimed", leaseUntil: "2026-11-16T10:15:00.000Z" };
  assert.equal(requestStatusAt(claimed, new Date("2026-11-16T10:10:00.000Z")), "claimed");
  assert.equal(requestStatusAt(claimed, new Date("2026-11-16T10:16:00.000Z")), "pending", "lease scaduto: torna prendibile");
  assert.equal(requestStatusAt(request, new Date("2026-12-01T00:00:00.000Z")), "expired");
  assert.equal(requestStatusAt({ ...request, status: "completed" }, new Date("2027-01-01T00:00:00.000Z")), "completed");
});

// ─── Statistiche ──────────────────────────────────────────────────────────────────────────

test("statistiche: correttezza, tendenza, serie, previsioni e quiz", () => {
  const now = new Date(2026, 10, 16, 18, 0);
  const at = (daysAgo, hour = 10) => new Date(2026, 10, 16 - daysAgo, hour, 0).toISOString();
  const decks = [deck("a", undefined, { subjectId: "sub_1" }), deck("b", "a"), deck("z", undefined, { subjectId: "sub_2" })];
  const cards = [
    { id: "c1", deckId: "b" },
    { id: "c2", deckId: "b" },
    { id: "c3", deckId: "a" },
    { id: "c4", deckId: "z", subjectId: "sub_2" }
  ];
  const events = [];
  // 14–27 giorni fa: 6 risposte, 3 giuste (50%)
  for (let i = 0; i < 6; i++) events.push({ i: "c1", r: i < 3 ? "correct" : "wrong", at: at(20), ms: 5000 });
  // ultimi 14 giorni: 10 risposte, 8 giuste, 1 dubbia, 1 sbagliata + 2 saltate
  for (let i = 0; i < 8; i++) events.push({ i: "c2", r: "correct", at: at(i % 3), ms: 10_000 });
  events.push({ i: "c1", r: "doubt", at: at(1), ms: 500_000 }, { i: "c1", r: "wrong", at: at(0) }, { i: "c3", r: "skip", at: at(0) }, { i: "c3", r: "skip", at: at(0) });
  const runs = [
    { id: "r1", kind: "flashcards", mode: "review", title: "", deckIds: [], subjectIds: [], itemIds: [], startedAt: at(20), events, ...stamp },
    { id: "r2", kind: "quiz", mode: "training", title: "", quizId: "qz", deckIds: [], subjectIds: [], itemIds: [], startedAt: at(2), endedAt: at(2, 11), score: 0.5, events: [{ i: "qa", r: "wrong", at: at(2) }, { i: "qb", r: "correct", at: at(2) }], ...stamp },
    { id: "r3", kind: "quiz", mode: "exam", title: "", quizId: "qz", deckIds: [], subjectIds: [], itemIds: [], startedAt: at(0), endedAt: at(0, 11), score: 1, events: [{ i: "qa", r: "correct", at: at(0) }, { i: "qb", r: "correct", at: at(0) }], ...stamp },
    { id: "r4", kind: "quiz", mode: "exam", title: "", quizId: "qz", deckIds: [], subjectIds: [], itemIds: [], startedAt: at(0), score: 0, events: [], ...stamp }
  ];
  const states = [
    { id: "c1", reps: 0, lapses: 3, ease: 1.5, intervalDays: 0, due: at(0, 9), correct: 3, wrong: 5, doubt: 1, lastResult: "wrong", ...stamp },
    { id: "c2", reps: 5, lapses: 0, ease: 2.7, intervalDays: 25, due: new Date(2026, 10, 19, 10).toISOString(), correct: 8, wrong: 0, doubt: 0, lastResult: "correct", ...stamp }
  ];
  const stats = learningStats({
    cards,
    decks,
    states,
    runs,
    quizzes: [{ id: "qz", title: "Quiz", deckId: "a" }],
    questions: [{ id: "qa", quizId: "qz" }, { id: "qb", quizId: "qz" }],
    now,
    chartDays: 30
  });
  assert.deepEqual(stats.cards, { total: 4, new: 2, studied: 2, due: 1, overdue: 0, difficult: 1, doubtful: 0, consolidated: 1, learning: 0 });
  assert.equal(stats.answers.correct, 11);
  assert.equal(stats.answers.wrong, 4);
  assert.equal(stats.answers.doubt, 1);
  assert.equal(stats.answers.skip, 2);
  assert.equal(stats.answers.accuracy, 11 / 16);
  assert.equal(stats.trend.previous, 0.5);
  assert.equal(stats.trend.current, 0.8);
  assert.equal(stats.streakDays, 3);
  assert.equal(stats.timeMs, 6 * 5000 + 8 * 10_000 + 120_000, "ogni risposta conta al massimo 2 minuti");
  assert.equal(stats.forecast.find((day) => day.date === "2026-11-19").due, 1);
  assert.equal(stats.daily.length, 30);
  assert.equal(stats.hardest[0].cardId, "c1");
  assert.equal(stats.quiz.attempts, 2, "il tentativo non concluso non conta");
  assert.equal(stats.quiz.avgScore, 0.75);
  assert.equal(stats.quiz.lastScore, 1);
  assert.equal(stats.quiz.missed[0].questionId, "qa");

  const sub2 = learningStats({ cards, decks, states, runs, quizzes: [], questions: [], now, filter: { subjectIds: ["sub_2"] } });
  assert.equal(sub2.cards.total, 1);
  assert.equal(sub2.answers.accuracy, null, "senza risposte nessun valore (non 0%)");
  const onlyB = learningStats({ cards, decks, states, runs, quizzes: [], questions: [], now, filter: { deckIds: ["b"], days: 7 } });
  assert.equal(onlyB.cards.total, 2);
  assert.equal(onlyB.answers.correct, 8);
  const subjectViaDeck = learningStats({ cards, decks, states, runs, quizzes: [], questions: [], now, filter: { subjectIds: ["sub_1"] } });
  assert.equal(subjectViaDeck.cards.total, 3, "materia ereditata dalla raccolta madre");
});

test("testo dei blocchi: liste e blocchi malformati non fanno mai errore", () => {
  assert.equal(blocksPlainText("testo"), "");
  assert.equal(blocksPlainText({ type: "text", text: "x" }), "");
  assert.equal(blocksPlainText([null, { type: "list", items: "no" }, { type: "text", text: "Ciao" }, { type: "table", rows: 3 }, 7]), "Ciao");
  assert.equal(duplicateKey({}), "");
});
