import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATIONS_TEXT } from "../src/lib/labels/notifications.ts";

test("notifiche: singolare e plurale nella campanella e nel pannello", () => {
  assert.equal(NOTIFICATIONS_TEXT.unreadTitle(1), "1 notifica non letta");
  assert.equal(NOTIFICATIONS_TEXT.unreadTitle(3), "3 notifiche non lette");
  assert.equal(NOTIFICATIONS_TEXT.bellAria(0), "Notifiche");
  assert.equal(NOTIFICATIONS_TEXT.bellAria(1), "Notifiche, 1 non letta");
  assert.equal(NOTIFICATIONS_TEXT.bellAria(12), "Notifiche, 12 non lette");
  assert.equal(NOTIFICATIONS_TEXT.unreadCount(1), "1 non letta");
  assert.equal(NOTIFICATIONS_TEXT.unreadCount(2), "2 non lette");
});

test("notifiche: il pannello vuoto parla anche dei promemoria", () => {
  assert.match(NOTIFICATIONS_TEXT.emptyBody, /promemoria/i);
});
