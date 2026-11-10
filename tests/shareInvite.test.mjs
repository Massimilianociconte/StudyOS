import test from "node:test";
import assert from "node:assert/strict";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
};
const events = [];
globalThis.window = {
  localStorage: memoryStorage(),
  dispatchEvent: (event) => events.push(event.type),
  location: { origin: "https://x.github.io", pathname: "/StudyOS/" }
};
globalThis.Event = class {
  constructor(type) {
    this.type = type;
  }
};

const { PENDING_SHARE_EVENT, clearPendingShare, readPendingShare, savePendingShare } = await import("../src/lib/shareInvite.ts");
const { shareInviteLink } = await import("../src/lib/sharing.ts");

const token = "b".repeat(64);
const now = Date.parse("2026-11-10T10:00:00Z");

test("invito di condivisione in sospeso: salvato, letto, scaduto, cancellato", () => {
  savePendingShare(token, now);
  assert.deepEqual(readPendingShare(now), { token, savedAt: now });
  assert.equal(readPendingShare(now + 15 * 24 * 60 * 60 * 1000), null);
  clearPendingShare();
  assert.equal(readPendingShare(now), null);
  assert.ok(events.includes(PENDING_SHARE_EVENT));
});

test("valori non validi in memoria vengono ignorati", () => {
  window.localStorage.setItem("studyos-pending-share", JSON.stringify({ token: "x", savedAt: now }));
  assert.equal(readPendingShare(now), null);
  window.localStorage.setItem("studyos-pending-share", "{rotto");
  assert.equal(readPendingShare(now), null);
  savePendingShare("non-un-token", now);
  assert.equal(window.localStorage.getItem("studyos-pending-share"), "{rotto");
});

test("il link porta il token nel frammento, che il browser non invia ai server", () => {
  assert.equal(shareInviteLink(token), `https://x.github.io/StudyOS/#condividi=${token}`);
});
