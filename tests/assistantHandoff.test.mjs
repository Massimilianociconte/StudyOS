// Richieste «Spiegami meglio» e analisi: ChatGPT e Claude non controllano StudyOS da soli (MCP è a
// richiesta, nessun server scrive in una loro chat). L'app dà il messaggio da mandare; l'assistente,
// appena la persona gli scrive per qualsiasi motivo, trova l'invito in studyos_status e studyos_overview.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatGptUrl, claudeUrl, waitingRequests } from "../src/lib/assistantHandoff.ts";
import { LEARN_TEXT } from "../src/lib/labels/learn.ts";
import { LEARNING_INSTRUCTION } from "../src/agent/catalogLearning.ts";
import { AGENT_INSTRUCTIONS, cloudInstructions } from "../src/agent/mcp.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { groupsForTool } from "../src/agent/cloudGroups.ts";
import { findAgentTool } from "../src/agent/catalog.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import * as learning from "../src/store/learning.ts";

const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const request = (id, fields) => ({ id, kind: "explain_card", style: "simple", prompt: "", targetId: "card_1", attempts: 0, expiresAt: "2099-01-01T00:00:00.000Z", ...stamp, ...fields });

const seed = () => {
  useStudyStore.setState({
    loading: false,
    locked: false,
    subjects: [{ id: "sub_chim", name: "Chimica", ...stamp }],
    exams: [],
    topics: [],
    tasks: [],
    decks: [],
    flashcards: [],
    quizzes: [],
    quizQuestions: [],
    cardStates: [],
    studyRuns: [],
    aiAnalyses: [],
    aiRequests: []
  });
  useSharedStore.setState({ items: [], received: [], labels: [] });
};

test("messaggio per l'assistente: generico, con l'account se c'è, mai il testo della scheda o del dubbio", () => {
  assert.equal(LEARN_TEXT.handoffMessage(""), "Elabora tutte le richieste in attesa in StudyOS («Spiegami meglio» e analisi).");
  assert.equal(LEARN_TEXT.handoffMessage("Alice"), "Elabora tutte le richieste in attesa in StudyOS («Spiegami meglio» e analisi), nell'account di Alice.");
  const message = LEARN_TEXT.handoffMessage("Alice");
  const gpt = new URL(chatGptUrl(message));
  assert.equal(gpt.origin, "https://chatgpt.com");
  assert.equal(gpt.searchParams.get("q"), message);
  const claude = new URL(claudeUrl(message));
  assert.equal(`${claude.origin}${claude.pathname}`, "https://claude.ai/new");
  assert.equal(claude.searchParams.get("q"), message);
  // Caratteri speciali codificati: niente parametri aggiunti da un nome con & o #.
  assert.deepEqual([...new URL(chatGptUrl(LEARN_TEXT.handoffMessage("A&b=c#d"))).searchParams.keys()], ["q"]);
});

test("messaggio per l'assistente: compare solo con richieste che nessun assistente ha preso", () => {
  const at = new Date("2026-11-23T10:00:00.000Z");
  assert.equal(waitingRequests([], at), 0);
  const items = [
    request("a", { status: "pending" }),
    request("b", { status: "claimed", leaseUntil: "2026-11-23T10:10:00.000Z" }),
    request("c", { status: "claimed", leaseUntil: "2026-11-23T09:00:00.000Z" }),
    request("d", { status: "completed" }),
    request("e", { status: "cancelled" }),
    request("f", { status: "pending", expiresAt: "2026-11-20T00:00:00.000Z" })
  ];
  // a in attesa, c presa ma con il lease scaduto (torna in attesa); b presa, f scaduta, d ed e chiuse.
  assert.equal(waitingRequests(items, at), 2);
});

test("l'app non promette che l'assistente veda la richiesta da solo", () => {
  for (const text of [LEARN_TEXT.explainSent, LEARN_TEXT.analysisSent, LEARN_TEXT.aiEmptyBody, LEARN_TEXT.requestWaitHelp, LEARN_TEXT.handoffHelp]) {
    assert.doesNotMatch(text, /prossimo assistente collegato/, text);
  }
  assert.match(LEARN_TEXT.requestWaitHelp, /neanche con la chat aperta/);
  assert.match(LEARN_TEXT.handoffHelp, /neanche con la chat aperta/);
  const sheet = readFileSync(new URL("../src/components/learn/ExplainSheet.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/learn/AiPanel.tsx", import.meta.url), "utf8");
  assert.match(sheet, /waitingRequests\(previous\) \? <AssistantHandoff \/>/);
  assert.match(panel, /waitingRequests\(data\.aiRequests\) \?/);
  assert.match(panel, /<AssistantHandoff \/>/);
  // Il link si apre dentro il clic: nessuna attesa prima della navigazione (Safari bloccherebbe la finestra).
  const handoff = readFileSync(new URL("../src/components/learn/AssistantHandoff.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(handoff, /await [\w.?]+\(/);
  assert.match(handoff, /rel="noopener noreferrer"/);
});

test("stato e panoramica: con richieste in attesa l'assistente riceve l'invito a elaborarle", async () => {
  seed();
  let status = await executeAgentTool("studyos_status", {});
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.data.counts.aiRequestsWaiting, 0);
  assert.equal("aiRequestsHint" in status.data, false);
  let overview = await executeAgentTool("studyos_overview", {});
  assert.equal("aiRequestsHint" in overview.data.learning, false);

  const deck = await learning.createDeck({ title: "D", subjectId: "sub_chim" });
  const card = await learning.createCard(deck.id, { front: "Mole?", back: "Quantità di sostanza" });
  await learning.createAiRequest({ kind: "explain_card", style: "simple", prompt: "", targetId: card.id });
  status = await executeAgentTool("studyos_status", {});
  assert.equal(status.data.counts.aiRequestsWaiting, 1);
  assert.equal("aiRequestsHint" in status.data.counts, false, "l'invito sta fuori dai contatori");
  assert.match(status.data.aiRequestsHint, /^C'è 1 richiesta .*studyos_list_ai_requests/);
  overview = await executeAgentTool("studyos_overview", {});
  assert.equal(overview.data.learning.aiRequestsWaiting, 1);
  assert.match(overview.data.learning.aiRequestsHint, /studyos_list_ai_requests/);

  await learning.createAiRequest({ kind: "analysis", style: "deep", prompt: "", scope: { subjectIds: [], deckIds: [], days: 30 } });
  status = await executeAgentTool("studyos_status", {});
  assert.match(status.data.aiRequestsHint, /^Ci sono 2 richieste/);
});

test("istruzioni: l'assistente sa che non riceve avvisi, su entrambi i connettori; il remoto legge le richieste per stato e panoramica", () => {
  assert.match(LEARNING_INSTRUCTION, /Non ricevi avvisi/);
  assert.match(LEARNING_INSTRUCTION, /aiRequestsWaiting/);
  assert.ok(AGENT_INSTRUCTIONS.includes(LEARNING_INSTRUCTION));
  assert.ok(cloudInstructions("Alice").includes(LEARNING_INSTRUCTION));
  for (const name of ["studyos_status", "studyos_overview"]) assert.ok(groupsForTool(name, {}).includes("ai"), name);
});

test("le descrizioni degli strumenti portano l'invito: alcuni client tagliano le istruzioni del server a 2048 caratteri", () => {
  // Claude Code mostra solo i primi 2048 caratteri delle istruzioni: la frase di LEARNING_INSTRUCTION
  // cade dopo. Le descrizioni degli strumenti arrivano intere.
  assert.ok(AGENT_INSTRUCTIONS.indexOf("Inizia con studyos_overview o studyos_status") < 2048);
  assert.ok(cloudInstructions("Alice Rossi").indexOf("Inizia con studyos_overview o studyos_status") < 2048);
  assert.match(findAgentTool("studyos_status").description, /aiRequestsHint.*non ricevi avvisi.*studyos_list_ai_requests/);
  assert.match(findAgentTool("studyos_overview").description, /learning\.aiRequestsHint.*non ricevi avvisi.*studyos_list_ai_requests/);
  assert.match(findAgentTool("studyos_list_ai_requests").description, /Non ricevi avvisi/);
  assert.match(findAgentTool("studyos_list_ai_requests").description, /elaborale tutte|chiudile tutte/);
});
