import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).

const base = { createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", archived: false, tags: [] };
const note = (id, extra) => ({ ...base, id, title: id, body: "", ...extra });
const invite = (id, groupId) => ({
  ...base,
  id,
  groupId,
  groupName: "Fisiologia",
  fromUserId: "u-giulia",
  fromDisplayName: "Giulia",
  code: "ABCD",
  status: "pending"
});

const seed = () =>
  useStudyStore.setState({
    loading: true,
    locked: false,
    studyGroups: [],
    groupInvites: [invite("inv-1", "g-1"), invite("inv-2", "g-2")],
    notifications: [
      note("n-invite-1", { kind: "invite", linkGroupId: "g-1", linkView: "groups" }),
      note("n-invite-2", { kind: "invite", linkGroupId: "g-2", linkView: "groups" }),
      note("n-group-1", { kind: "group", linkGroupId: "g-1", linkView: "groups" })
    ]
  });

const readIds = () =>
  useStudyStore
    .getState()
    .notifications.filter((item) => item.readAt)
    .map((item) => item.id)
    .sort();

test("accettare un invito segna letta solo la sua notifica di invito", async () => {
  seed();
  await useStudyStore.getState().acceptGroupInvite("inv-1", { userId: "u-me", displayName: "Io" });
  assert.deepEqual(readIds(), ["n-invite-1"]);
});

test("rifiutare un invito segna letta la sua notifica di invito", async () => {
  seed();
  await useStudyStore.getState().declineGroupInvite("inv-2");
  assert.deepEqual(readIds(), ["n-invite-2"]);
});

test("markNotificationsReadWhere: solo le non lette che rispettano la condizione", async () => {
  seed();
  await useStudyStore.getState().markNotificationsReadWhere((item) => item.id === "n-group-1");
  assert.deepEqual(readIds(), ["n-group-1"]);
  const before = useStudyStore.getState().notifications;
  await useStudyStore.getState().markNotificationsReadWhere(() => false);
  assert.equal(useStudyStore.getState().notifications.length, before.length);
  assert.deepEqual(readIds(), ["n-group-1"]);
});
