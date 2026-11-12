import test from "node:test";
import assert from "node:assert/strict";

const { classifyPushSupport, base64UrlToBytes, sameServerKey, rowFromSubscription, parsePushState, shouldRefresh, storedAuthUserId, pushOwnerSignedOut } = await import("../src/lib/push.ts");
const { parseOpenTarget, urlWithoutOpen } = await import("../src/lib/openLink.ts");

const env = (patch = {}) => ({
  isIos: false,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  ...patch
});

test("supporto push: browser completo e permesso da chiedere", () => {
  assert.equal(classifyPushSupport(env()), "ok");
  assert.equal(classifyPushSupport(env({ permission: "granted" })), "ok");
});

test("supporto push: permesso negato e API mancanti", () => {
  assert.equal(classifyPushSupport(env({ permission: "denied" })), "denied");
  assert.equal(classifyPushSupport(env({ hasPushManager: false })), "unsupported");
  assert.equal(classifyPushSupport(env({ hasServiceWorker: false })), "unsupported");
  assert.equal(classifyPushSupport(env({ hasNotification: false, permission: null })), "unsupported");
});

test("supporto push: iPhone e iPad vogliono StudyOS nella schermata Home", () => {
  // Safari in una scheda non espone PushManager: la risposta giusta resta "ios-install".
  assert.equal(classifyPushSupport(env({ isIos: true, hasPushManager: false })), "ios-install");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: false })), "ios-install");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: true })), "ok");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: true, hasPushManager: false })), "unsupported");
  assert.equal(classifyPushSupport(env({ isIos: true, standalone: true, permission: "denied" })), "denied");
});

test("chiave VAPID: base64url con e senza riempimento", () => {
  assert.deepEqual([...base64UrlToBytes("AQID")], [1, 2, 3]);
  assert.deepEqual([...base64UrlToBytes("-_8")], [251, 255]);
  const point = Uint8Array.from({ length: 65 }, (_, index) => (index * 7 + 4) % 256);
  const encoded = Buffer.from(point).toString("base64url");
  assert.equal(encoded.includes("="), false);
  assert.deepEqual([...base64UrlToBytes(encoded)], [...point]);
});

test("chiave del server: iscrizione fatta con un'altra chiave va rifatta", () => {
  const expected = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(sameServerKey(Uint8Array.from([1, 2, 3, 4]).buffer, expected), true);
  assert.equal(sameServerKey(Uint8Array.from([1, 2, 3, 5]).buffer, expected), false);
  assert.equal(sameServerKey(Uint8Array.from([1, 2, 3]).buffer, expected), false);
  // Alcuni browser non riportano la chiave: non si rifà l'iscrizione a ogni avvio.
  assert.equal(sameServerKey(null, expected), true);
  assert.equal(sameServerKey(undefined, expected), true);
});

test("riga dell'iscrizione: serve https, p256dh e auth", () => {
  const json = { endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } };
  assert.deepEqual(rowFromSubscription(json), { endpoint: "https://push.example/abc", p256dh: "P", auth: "A" });
  assert.equal(rowFromSubscription({ endpoint: "https://push.example/abc" }), null);
  assert.equal(rowFromSubscription({ endpoint: "https://push.example/abc", keys: { p256dh: "P" } }), null);
  assert.equal(rowFromSubscription({ endpoint: "http://push.example/abc", keys: { p256dh: "P", auth: "A" } }), null);
  assert.equal(rowFromSubscription({ keys: { p256dh: "P", auth: "A" } }), null);
});

test("stato salvato: solo valori ben formati", () => {
  assert.deepEqual(parsePushState(JSON.stringify({ endpoint: "https://e", userId: "u", at: 5 })), { endpoint: "https://e", userId: "u", at: 5 });
  assert.equal(parsePushState(null), null);
  assert.equal(parsePushState("non json"), null);
  assert.equal(parsePushState(JSON.stringify([1])), null);
  assert.equal(parsePushState(JSON.stringify({ endpoint: "", userId: "u", at: 5 })), null);
  assert.equal(parsePushState(JSON.stringify({ endpoint: "https://e", userId: "u", at: "ieri" })), null);
});

test("riallineamento all'avvio: cadenza di 12 ore, endpoint o account cambiati", () => {
  const hour = 60 * 60 * 1000;
  const prev = { endpoint: "https://e", userId: "u", at: 1_000_000 };
  assert.equal(shouldRefresh(null, "https://e", "u", prev.at), true);
  assert.equal(shouldRefresh(prev, "https://e", "u", prev.at + hour), false);
  assert.equal(shouldRefresh(prev, "https://e", "u", prev.at + 13 * hour), true);
  assert.equal(shouldRefresh(prev, "https://nuovo", "u", prev.at + hour), true);
  assert.equal(shouldRefresh(prev, "https://e", "altro", prev.at + hour), true);
  assert.equal(shouldRefresh(prev, "https://e", "u", prev.at - hour), true);
});

test("?apri=: solo le quattro destinazioni note", () => {
  assert.equal(parseOpenTarget("?apri=notifiche"), "notifiche");
  assert.equal(parseOpenTarget("?x=1&apri=condivisione"), "condivisione");
  assert.equal(parseOpenTarget("?apri=gruppi"), "gruppi");
  assert.equal(parseOpenTarget("?apri=calendario"), "calendario");
  assert.equal(parseOpenTarget("?apri=impostazioni"), null);
  assert.equal(parseOpenTarget("?apri=NOTIFICHE"), null);
  assert.equal(parseOpenTarget("?apri="), null);
  assert.equal(parseOpenTarget(""), null);
});

test("?apri=: l'URL ripulito tiene gli altri parametri e il frammento", () => {
  assert.equal(urlWithoutOpen("https://massimilianociconte.github.io/StudyOS/?apri=notifiche"), "/StudyOS/");
  assert.equal(urlWithoutOpen("https://x.github.io/StudyOS/?invito=ABC&apri=gruppi#a"), "/StudyOS/?invito=ABC#a");
  assert.equal(urlWithoutOpen("https://x.github.io/StudyOS/#invito=ABC"), "/StudyOS/#invito=ABC");
});

test("sessione finita da sola: si legge l'account della sessione salvata da supabase-js", () => {
  assert.equal(storedAuthUserId(null), null);
  assert.equal(storedAuthUserId(""), null);
  assert.equal(storedAuthUserId(JSON.stringify({ access_token: "t", user: { id: "u1" } })), "u1");
  assert.equal(storedAuthUserId(JSON.stringify({ currentSession: { user: { id: "u2" } } })), "u2");
  assert.equal(storedAuthUserId("{rotto"), undefined, "valore illeggibile: non si tocca niente");
  assert.equal(storedAuthUserId(JSON.stringify({ user: {} })), undefined);
  assert.equal(storedAuthUserId("null"), undefined);
});

test("sessione finita da sola: le notifiche si spengono solo se l'account che le ha accese non c'è più", () => {
  const saved = (id) => JSON.stringify({ access_token: "t", user: { id } });
  assert.equal(pushOwnerSignedOut("u1", null), true, "sessione tolta (scaduta, revocata, uscita altrove)");
  assert.equal(pushOwnerSignedOut("u1", saved("u2")), true, "entrato un altro account");
  assert.equal(pushOwnerSignedOut("u1", saved("u1")), false, "stesso account, anche offline con la sessione non rinnovata");
  assert.equal(pushOwnerSignedOut("u1", "?"), false, "storage illeggibile");
});
