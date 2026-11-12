import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sync = source("src/lib/groupExamSync.ts");
const groupSync = source("src/lib/groupSync.ts");

test("groupSync carica la sync degli appelli solo con import() e la ferma con la cassetta", () => {
  assert.match(groupSync, /import\("\.\/groupExamSync"\)/);
  assert.doesNotMatch(groupSync, /from "\.\/groupExamSync"/);
  assert.match(groupSync, /export const stopSharedMailbox = \(\) => \{[\s\S]*?stopGroupExams\(\);/);
  assert.match(groupSync, /export const resetSharedCache = async \(\) => \{[\s\S]*?stopGroupExams\(\);/);
});

test("nessun import statico di groupExamSync (tira dentro Supabase)", () => {
  const files = readdirSync(new URL("../src", import.meta.url), { recursive: true }).filter((name) => /\.(ts|tsx)$/.test(name));
  const offenders = files.filter((name) => /from ["'][./]*(lib\/)?groupExamSync["']/.test(source(`src/${name}`)));
  assert.deepEqual(offenders, []);
});

test("scritture solo con le funzioni del server; cronologia letta dalla tabella", () => {
  for (const fn of ["save_group_exam_session", "delete_group_exam_session", "restore_group_record", "save_group_catalog_override", "delete_group_catalog_override"]) {
    assert.match(sync, new RegExp(`"${fn}"`));
  }
  assert.doesNotMatch(sync, /\.from\("studyos_group_exam_sessions"\)\s*\.(insert|update|upsert|delete)/);
  assert.match(sync, /\.from\("studyos_group_history"\)/);
});

test("realtime: canale per account, filtro sui miei gruppi, pull a ogni iscrizione", () => {
  assert.match(sync, /`studyos-group-exams:\$\{me\}`/);
  assert.match(sync, /realtimeGroupIds\(/);
  assert.match(sync, /group_id=in\.\(/);
  assert.match(sync, /status !== "SUBSCRIBED"/);
  assert.match(sync, /gexam-seen:/);
});
