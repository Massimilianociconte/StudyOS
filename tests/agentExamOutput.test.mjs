import test from "node:test";
import assert from "node:assert/strict";
import { executeAgentTool } from "../src/agent/execute.ts";
import { publicSharedItem } from "../src/agent/shared.ts";
import { examDateOut } from "../src/lib/examOutcome.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Esame non superato senza la nuova data: l'etichetta interna «data-da-decidere:…» non arriva agli
// agenti; al suo posto `dateToDecide: true` e nessun conto alla rovescia sulla data passata.
const PAST = "2026-10-10T07:00:00.000Z";
const TBD_TAG = `data-da-decidere:${PAST}`;

const exam = (over) => ({
  id: "exam_x",
  subjectId: "sub_bio",
  date: "2099-01-10T08:00:00.000Z",
  program: [],
  preparation: 40,
  targetGrade: 28,
  status: "studying",
  simulations: 0,
  frequentQuestions: [],
  tags: [],
  archived: false,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-10-10T08:00:00.000Z",
  ...over
});

const seed = (exams) =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [{ id: "sub_bio", name: "Biochimica", teacher: "", cfu: 12, semester: "", status: "active", color: "#4f8", archived: false, notes: "", tags: [], createdAt: "", updatedAt: "" }],
    tasks: [],
    events: [],
    exams,
    sessions: [],
    topics: [],
    notes: [],
    goals: [],
    attachments: [],
    notifications: [],
    preferences: [],
    studyGroups: [],
    groupResources: []
  });

test("esito agli agenti: etichetta interna via, dateToDecide al suo posto (proiezione pura)", () => {
  assert.deepEqual(examDateOut({ status: "ready", date: PAST, tags: ["orale", TBD_TAG] }), { tags: ["orale"], dateToDecide: true });
  // Data cambiata o esame registrato: l'etichetta non vale più, e comunque non esce.
  assert.deepEqual(examDateOut({ status: "ready", date: "2027-01-10T08:00:00.000Z", tags: [TBD_TAG] }), { tags: [], dateToDecide: false });
  assert.deepEqual(examDateOut({ status: "done", date: PAST, tags: [TBD_TAG] }), { tags: [], dateToDecide: false });
  // Dati di un'altra persona: tipi qualsiasi, nessun errore.
  assert.deepEqual(examDateOut({ status: 3, date: null, tags: "x" }), { tags: [], dateToDecide: false });
});

test("esito agli agenti: list_exams e get_exam senza l'etichetta, senza daysLeft negativo", async () => {
  seed([exam({ id: "exam_tbd", status: "ready", date: PAST, tags: ["orale", TBD_TAG] }), exam({ id: "exam_next", tags: ["orale"] })]);
  const listed = await executeAgentTool("studyos_list_exams", {});
  assert.equal(listed.ok, true);
  const packed = JSON.stringify(listed.data);
  assert.equal(packed.includes("data-da-decidere"), false);
  const tbd = listed.data.items.find((item) => item.id === "exam_tbd");
  assert.equal(tbd.dateToDecide, true);
  assert.equal(tbd.daysLeft, null);
  assert.deepEqual(tbd.tags, ["orale"]);
  const next = listed.data.items.find((item) => item.id === "exam_next");
  assert.equal(next.dateToDecide, undefined);
  assert.equal(typeof next.daysLeft, "number");
  assert.ok(next.daysLeft > 0);
  assert.deepEqual(next.tags, ["orale"]);

  const detail = await executeAgentTool("studyos_get_exam", { id: "exam_tbd" });
  assert.equal(detail.ok, true);
  assert.equal(JSON.stringify(detail.data).includes("data-da-decidere"), false);
  assert.equal(detail.data.item.dateToDecide, true);
  assert.equal(detail.data.item.daysLeft, null);
  assert.equal(detail.data.item.date, PAST);
});

test("esito agli agenti: la ricerca non mostra la data passata come data dell'esame", async () => {
  seed([exam({ id: "exam_tbd", status: "ready", date: PAST, tags: [TBD_TAG] })]);
  const found = await executeAgentTool("studyos_search", { query: "Biochimica" });
  const hit = found.data.items.find((item) => item.type === "exam");
  assert.equal(hit.title, "Biochimica · data da decidere");
});

test("esito agli agenti: anche gli esami condivisi da altri escono senza l'etichetta", () => {
  const entry = {
    key: "owner-uuid-1:exam:exam_s",
    ownerId: "owner-uuid-1",
    entityType: "exam",
    entityId: "exam_s",
    entity: { id: "exam_s", updatedAt: "2026-11-10T08:00:00.000Z", date: PAST, status: "studying", program: [], tags: ["orale", TBD_TAG] },
    serverUpdatedAt: "2026-11-10T08:00:00.000Z"
  };
  const grant = {
    id: "s1",
    ownerId: "owner-uuid-1",
    ownerName: "Alice",
    scope: "progress",
    subjectIds: [],
    permission: "view",
    granteeUserId: "me-uuid",
    granteeGroupId: null,
    granteeName: "Bob",
    granteeEmail: "bob@example.com",
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z"
  };
  for (const brief of [true, false]) {
    const item = publicSharedItem(entry, [grant], [], brief);
    assert.equal(JSON.stringify(item).includes("data-da-decidere"), false);
    assert.deepEqual(item.tags, ["orale"]);
    assert.equal(item.dateToDecide, true);
  }
  const done = publicSharedItem({ ...entry, entity: { ...entry.entity, status: "done" } }, [grant], [], true);
  assert.deepEqual(done.tags, ["orale"]);
  assert.equal(done.dateToDecide, undefined);
});
