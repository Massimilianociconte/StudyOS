import test from "node:test";
import assert from "node:assert/strict";
import { executeAgentTool } from "../src/agent/execute.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { defaultTimer } from "../src/lib/studyTimer.ts";

const OLD = "2026-01-01T00:00:00.000Z";
const due = "2020-01-01T00:00:00.000Z";

const seed = () =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [
      { id: "sub_an", name: "Analisi 1", status: "active", archived: false, updatedAt: OLD },
      { id: "sub_ch", name: "Chimica", status: "completed", archived: false, updatedAt: OLD },
      { id: "sub_bio", name: "Biologia", status: "archived", archived: false, updatedAt: OLD }
    ],
    topics: [
      { id: "top_lim", subjectId: "sub_an", title: "Limiti", archived: false, nextReviewDate: due, notes: "" },
      { id: "top_mol", subjectId: "sub_ch", title: "Moli", archived: false, nextReviewDate: due, notes: "" },
      { id: "top_cel", subjectId: "sub_bio", title: "Cellula", archived: false, nextReviewDate: due, notes: "" }
    ],
    sessions: [],
    tasks: [],
    events: [],
    exams: [],
    notes: [],
    goals: [],
    attachments: [],
    notifications: [],
    preferences: [],
    studyGroups: [],
    groupResources: [],
    timer: defaultTimer("pomodoro"),
    timerReview: false
  });

test("agenti: gli argomenti di materie superate o archiviate non sono da ripassare, come in Studio", async () => {
  seed();
  const dueOnly = await executeAgentTool("studyos_list_topics", { dueOnly: true });
  assert.equal(dueOnly.ok, true);
  assert.deepEqual(dueOnly.data.items.map((item) => item.id), ["top_lim"]);
  // Senza dueOnly l'elenco resta completo (come l'elenco degli argomenti nell'app).
  const all = await executeAgentTool("studyos_list_topics", {});
  assert.deepEqual(all.data.items.map((item) => item.id).sort(), ["top_cel", "top_lim", "top_mol"]);
});
