import test from "node:test";
import assert from "node:assert/strict";
import { sessionFromRow, overrideFromRow } from "../src/lib/groupExams.ts";
import { groupNamesOf, useGroupExamStore } from "../src/store/useGroupExamStore.ts";

const row = (over = {}) => sessionFromRow({
  id: "gexam_a1", group_id: "gx", course_key: "nome:genetica", course_id: null, course_name: "Genetica",
  exam_date: "2027-02-01", kind: "appello", label: "", exam_time: null, room: "", notes: "",
  registration_opens: null, registration_closes: null, barb_session_id: null, source: "member", version: 1,
  created_by: "u1", created_by_name: "Bea", updated_by: "u1", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null,
  created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z", ...over
});
const override = overrideFromRow({ id: "gover_1", group_id: "gy", target_kind: "teacher", target_id: "unimi-x", target_label: "X", fields: { office: "Studio 3" }, version: 1, created_by: "u1", created_by_name: "Bea", updated_by: "u1", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null, created_at: "", updated_at: "" });
const groups = [{ id: "gx", name: "Farmaco" }, { id: "gy", name: "Bio" }];

test("snapshot: un appello per id (vince la versione più alta), solo dei miei gruppi, ordinati per data", () => {
  const store = useGroupExamStore.getState();
  store.setSnapshot({
    viewerId: "u-me",
    groups,
    sessions: [row({ version: 2, exam_date: "2027-03-01" }), row(), row({ id: "gexam_b", exam_date: "2027-01-10" }), row({ id: "gexam_z", group_id: "altro" })],
    overrides: [override]
  });
  const state = useGroupExamStore.getState();
  assert.equal(state.ready, true);
  assert.deepEqual(state.sessions.map((item) => [item.id, item.version]), [["gexam_b", 1], ["gexam_a1", 2]]);
  assert.equal(state.overrides.length, 1);
  assert.equal(groupNamesOf(state.groups).get("gx"), "Farmaco");
});

test("realtime: una versione vecchia non vince, un gruppo lasciato sparisce", () => {
  const store = useGroupExamStore.getState();
  store.applySession(row({ version: 1, room: "vecchia" }));
  assert.equal(useGroupExamStore.getState().sessions.find((item) => item.id === "gexam_a1").version, 2);
  store.applySession(row({ id: "gexam_fuori", group_id: "altro" }));
  assert.equal(useGroupExamStore.getState().sessions.some((item) => item.id === "gexam_fuori"), false);
  store.setGroups([{ id: "gx", name: "Farmaco" }]);
  assert.deepEqual(useGroupExamStore.getState().overrides, []);
  store.dropSession("gexam_b");
  assert.deepEqual(useGroupExamStore.getState().sessions.map((item) => item.id), ["gexam_a1"]);
});

test("tabelle mancanti e reset", () => {
  const store = useGroupExamStore.getState();
  store.setUnavailable();
  assert.equal(useGroupExamStore.getState().available, false);
  assert.deepEqual(useGroupExamStore.getState().sessions, []);
  store.reset();
  const state = useGroupExamStore.getState();
  assert.equal(state.ready, false);
  assert.equal(state.available, true);
  assert.equal(state.viewerId, null);
});
