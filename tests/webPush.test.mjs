import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PLAINTEXT_BYTES,
  encryptPayload,
  encryptPayloadWith,
  fromBase64Url,
  importEcPrivateKey,
  pushTopic,
  sendWebPush,
  toBase64Url,
  vapidAuthorization
} from "../worker/webPush.ts";
import { b64u, decryptPush, makeReceiver, unb64u } from "./fixtures/pushReceiver.mjs";

// RFC 8291, sezione 5 e appendice A (https://www.rfc-editor.org/rfc/rfc8291.txt), spazi e a capo tolti.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
};

const SUBJECT = "https://massimilianociconte.github.io/StudyOS/";

const vapidKeys = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: d };
};

test("base64url: andata e ritorno, niente padding, rifiuta caratteri estranei", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.equal(toBase64Url(bytes), b64u(bytes));
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  assert.deepEqual(fromBase64Url("_-8="), unb64u("_-8"));
  assert.equal(toBase64Url(new Uint8Array(70_000)).length, Math.ceil((70_000 * 4) / 3));
  assert.throws(() => fromBase64Url("ab+/"), /base64url non valido/);
  assert.throws(() => fromBase64Url("abcde"), /base64url non valido/);
});

test("RFC 8291 sezione 5: con sale e chiavi dell'esempio il corpo è identico byte per byte", async () => {
  const sender = {
    publicKey: fromBase64Url(RFC.asPublic),
    privateKey: await importEcPrivateKey(RFC.asPublic, RFC.asPrivate, "ECDH")
  };
  const body = await encryptPayloadWith(new TextEncoder().encode(RFC.plaintext), RFC.uaPublic, RFC.authSecret, fromBase64Url(RFC.salt), sender);
  // 86 di intestazione + 41 di testo + 1 delimitatore + 16 di tag. Il "Content-Length: 145"
  // dell'esempio è un refuso dell'RFC: il corpo base64url che riporta decodifica in 144 byte.
  assert.equal(body.length, 144);
  assert.equal(toBase64Url(body.subarray(0, 86)), RFC.header);
  assert.equal(toBase64Url(body.subarray(86)), RFC.ciphertext);
  assert.equal(toBase64Url(body), RFC.body);
});

test("encryptPayload: sale e chiave nuovi a ogni messaggio, il destinatario decifra", async () => {
  const receiver = {
    privateKey: await importEcPrivateKey(RFC.uaPublic, RFC.uaPrivate, "ECDH"),
    publicKey: fromBase64Url(RFC.uaPublic),
    p256dh: RFC.uaPublic,
    auth: RFC.authSecret
  };
  const plaintext = new TextEncoder().encode(JSON.stringify({ kind: "invite", title: "Giulia ti invita", body: "Biochimica", url: "?apri=notifiche", tag: "group-invite:g1" }));
  const first = await encryptPayload(plaintext, RFC.uaPublic, RFC.authSecret);
  const second = await encryptPayload(plaintext, RFC.uaPublic, RFC.authSecret);
  assert.equal(first.length, 86 + plaintext.length + 1 + 16);
  assert.notDeepEqual(first.subarray(0, 16), second.subarray(0, 16));
  assert.notDeepEqual(first.subarray(21, 86), second.subarray(21, 86));
  const opened = await decryptPush(first, receiver);
  assert.equal(opened.recordSize, 4096);
  assert.equal(opened.idLength, 65);
  assert.equal(opened.delimiter, 2);
  assert.equal(opened.text, new TextDecoder().decode(plaintext));
});

test("encryptPayload: rifiuta testi oltre 3993 byte e chiavi malformate", async () => {
  const receiver = await makeReceiver();
  await encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES), receiver.p256dh, receiver.auth);
  await assert.rejects(encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), receiver.p256dh, receiver.auth), /3993/);
  await assert.rejects(encryptPayload(new Uint8Array(1), receiver.p256dh.slice(0, 40), receiver.auth), /p256dh/);
  await assert.rejects(encryptPayload(new Uint8Array(1), receiver.p256dh, "AAAA"), /auth/);
  const offCurve = new Uint8Array(65);
  offCurve[0] = 4;
  offCurve[64] = 1;
  await assert.rejects(encryptPayload(new Uint8Array(1), b64u(offCurve), receiver.auth));
});

test("VAPID: JWT ES256 verificabile con la chiave pubblica, aud = origine, exp entro 24 ore", async () => {
  const keys = await vapidKeys();
  const now = 1_800_000_000;
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc:def?x=1", keys.publicKey, keys.privateKey, SUBJECT, now);
  const match = /^vapid t=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  assert.ok(match, header);
  const [, rawHeader, rawClaims, rawSignature, k] = match;
  assert.equal(k, keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(rawHeader, "base64url").toString()), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(rawClaims, "base64url").toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now + 43_200, sub: SUBJECT });
  assert.ok(claims.exp - now <= 86_400);

  const signature = unb64u(rawSignature);
  assert.equal(signature.length, 64);
  const verifyKey = await crypto.subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${rawHeader}.${rawClaims}`);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, signature, signed), true);
  const other = await vapidKeys();
  const otherKey = await crypto.subtle.importKey("raw", unb64u(other.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, otherKey, signature, signed), false);
});

test("Topic: al massimo 32 caratteri base64url, stabile per tag, diverso tra tag", async () => {
  const a = await pushTopic("group-join:g-1:7c9e6679-7425-40de-944b-e07fc1f90ae7");
  const b = await pushTopic("group-join:g-1:9b2f7a10-1c3d-4e5f-8a9b-0c1d2e3f4a5b");
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(a, await pushTopic("group-join:g-1:7c9e6679-7425-40de-944b-e07fc1f90ae7"));
  assert.notEqual(a, b);
});

test("sendWebPush: intestazioni RFC 8030, VAPID, corpo cifrato e stato del servizio", async (t) => {
  const keys = await vapidKeys();
  const receiver = await makeReceiver();
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 201 });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const payload = JSON.stringify({ kind: "accepted", title: "Luca ha accettato", body: "Calendario", url: "?apri=condivisione", tag: "share-accepted:i1" });
  const result = await sendWebPush(
    { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc", p256dh: receiver.p256dh, auth: receiver.auth },
    payload,
    { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: SUBJECT, topic: "share-accepted:i1" }
  );
  assert.deepEqual(result, { status: 201 });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://updates.push.services.mozilla.com/wpush/v2/abc");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.ttl, "86400");
  assert.equal(init.headers.urgency, "normal");
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.equal(init.headers.topic, await pushTopic("share-accepted:i1"));
  assert.match(init.headers.authorization, new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`));
  assert.equal((await decryptPush(init.body, receiver)).text, payload);
});

test("sendWebPush: senza tag niente Topic", async (t) => {
  const keys = await vapidKeys();
  const receiver = await makeReceiver();
  let headers = null;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    headers = init.headers;
    return new Response(null, { status: 410 });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  const result = await sendWebPush({ endpoint: "https://web.push.apple.com/QGx", p256dh: receiver.p256dh, auth: receiver.auth }, "{}", {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: SUBJECT
  });
  assert.deepEqual(result, { status: 410 });
  assert.equal("topic" in headers, false);
});
