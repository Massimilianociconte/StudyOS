import test from "node:test";
import assert from "node:assert/strict";

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data)
  };
};

// Scheda già aperta (refresh) su "career"; il dispositivo ricorda "calendar" da un'altra scheda.
const session = memoryStorage({ "studyos-ui": JSON.stringify({ view: "career", "calendar.cursor": "2026-09-01T10:00:00.000Z" }) });
const local = memoryStorage({ "studyos-ui": JSON.stringify({ view: "calendar", "tasks.mode": "kanban" }) });
globalThis.window = { sessionStorage: session, localStorage: local };

const { readUiState, readDeviceUiState, readTabUiState, writeUiState, clearUiState, oneOf, isNullableString } = await import("../src/lib/uiState.ts");

test("uiState: la scheda vince sul dispositivo, il dispositivo fa da ripiego solo per l'ambito device", () => {
  assert.equal(readUiState("view", "device"), "career");
  assert.equal(readTabUiState("view"), "career");
  assert.equal(readDeviceUiState("view"), "calendar");
  assert.equal(readUiState("tasks.mode", "device"), "kanban");
  assert.equal(readUiState("tasks.mode", "tab"), undefined);
});

test("uiState: scrittura per ambito", () => {
  writeUiState("barb.courseQuery", "genetica", "tab");
  writeUiState("tasks.sort", "priority", "device");
  assert.equal(JSON.parse(session.dump()["studyos-ui"])["barb.courseQuery"], "genetica");
  assert.equal(JSON.parse(local.dump()["studyos-ui"])["barb.courseQuery"], undefined);
  assert.equal(JSON.parse(local.dump()["studyos-ui"])["tasks.sort"], "priority");
  assert.equal(JSON.parse(session.dump()["studyos-ui"])["tasks.sort"], "priority");
});

test("uiState: validatori", () => {
  const isMode = oneOf("list", "kanban");
  assert.equal(isMode("kanban"), true);
  assert.equal(isMode("gantt"), false);
  assert.equal(isMode(3), false);
  assert.equal(isNullableString(null), true);
  assert.equal(isNullableString("id"), true);
  assert.equal(isNullableString(4), false);
});

test("uiState: reset svuota entrambi gli ambiti", () => {
  clearUiState();
  assert.equal(readUiState("view", "device"), undefined);
  assert.equal(session.dump()["studyos-ui"], undefined);
  assert.equal(local.dump()["studyos-ui"], undefined);
});
