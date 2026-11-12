import test from "node:test";
import assert from "node:assert/strict";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    size: () => data.size
  };
};

const useStorage = (storage) => Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true, writable: true });

const { requestCalendarTransfer, takeCalendarTransfer } = await import("../src/lib/calendarJump.ts");

test("Calendario dalla Home: la guida «Importa» si apre una volta sola", () => {
  const storage = memoryStorage();
  useStorage(storage);
  assert.equal(takeCalendarTransfer(), null);
  requestCalendarTransfer("import");
  assert.equal(takeCalendarTransfer(), "import");
  // Letta una volta: tornando nel Calendario non si riapre.
  assert.equal(takeCalendarTransfer(), null);
  assert.equal(storage.size(), 0);
  requestCalendarTransfer("export");
  assert.equal(takeCalendarTransfer(), "export");
});

test("Calendario dalla Home: un valore estraneo nella scheda non apre nulla e si toglie", () => {
  const storage = memoryStorage();
  useStorage(storage);
  storage.setItem("studyos-calendar-jump", "sync");
  assert.equal(takeCalendarTransfer(), null);
  assert.equal(storage.size(), 0);
});

test("Calendario dalla Home: senza storage il Calendario si apre e basta", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    }
  };
  useStorage(broken);
  assert.doesNotThrow(() => requestCalendarTransfer("import"));
  assert.equal(takeCalendarTransfer(), null);
});
