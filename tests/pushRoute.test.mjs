import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_CHARS, MAX_PUSH_BODY_BYTES, MAX_TITLE_CHARS, PUSH_CONCURRENCY, VAPID_SUBJECT, handlePush, parseNotification } from "../worker/push.ts";
import { VAPID_PUBLIC_KEY } from "../src/lib/pushKeys.ts";
import { pushTopic } from "../worker/webPush.ts";
import { b64u, decryptPush, makeReceiver } from "./fixtures/pushReceiver.mjs";

const SECRET = "segreto-di-prova-0123456789abcdefghijklmnop";
const SUPABASE = "http://127.0.0.1:55421";
const NOTIFICATION = {
  kind: "invite",
  title: "Giulia ti ha invitato",
  body: "Gruppo Biochimica",
  url: "?apri=notifiche",
  tag: "group-invite:inv-1"
};

const vapid = (async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: d };
})();

const envFor = async (extra = {}) => ({
  STUDYOS_PUSH_SECRET: SECRET,
  STUDYOS_VAPID_PRIVATE_KEY: (await vapid).privateKey,
  STUDYOS_SUPABASE_URL: SUPABASE,
  STUDYOS_SUPABASE_KEY: "sb_publishable_prova",
  ...extra
});

const pushRequest = (body, headers = {}) =>
  new Request("https://studyos-agent.esempio.workers.dev/push", {
    method: "POST",
    headers: { "content-type": "application/json", "x-studyos-push-secret": SECRET, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

const subscriptionOf = async (endpoint) => {
  const receiver = await makeReceiver();
  return { receiver, row: { endpoint, p256dh: receiver.p256dh, auth: receiver.auth } };
};

/** Sostituisce fetch: `respond(url, init)` decide la risposta; registra chiamate e parallelismo. */
const stubFetch = (t, respond) => {
  const calls = [];
  const state = { inFlight: 0, maxInFlight: 0 };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      return await respond(String(url), init);
    } finally {
      state.inFlight -= 1;
    }
  };
  t.after(() => {
    globalThis.fetch = previous;
  });
  return { calls, state };
};

const quietConsole = (t) => {
  const lines = [];
  const previousLog = console.log;
  const previousWarn = console.warn;
  console.log = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));
  t.after(() => {
    console.log = previousLog;
    console.warn = previousWarn;
  });
  return lines;
};

test("chiave pubblica VAPID: punto P-256 non compresso di 65 byte", () => {
  const bytes = Buffer.from(VAPID_PUBLIC_KEY, "base64url");
  assert.match(VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]{87}$/);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
});

test("/push: metodo, segreto e configurazione prima di tutto, senza chiamare la rete", async (t) => {
  const { calls } = stubFetch(t, async () => new Response(null, { status: 201 }));
  const { publicKey } = await vapid;
  const env = await envFor();
  const body = { notification: NOTIFICATION, subscriptions: [] };

  const get = await handlePush(new Request("https://studyos-agent.esempio.workers.dev/push"), env, publicKey);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");

  assert.equal((await handlePush(pushRequest(body, { "x-studyos-push-secret": "" }), env, publicKey)).status, 401);
  assert.equal((await handlePush(pushRequest(body, { "x-studyos-push-secret": `${SECRET}x` }), env, publicKey)).status, 401);
  assert.equal((await handlePush(pushRequest(body, { "x-studyos-push-secret": SECRET.slice(0, -1) }), env, publicKey)).status, 401);
  assert.equal((await handlePush(pushRequest(body), await envFor({ STUDYOS_PUSH_SECRET: "" }), publicKey)).status, 503);
  assert.equal((await handlePush(pushRequest(body), await envFor({ STUDYOS_VAPID_PRIVATE_KEY: undefined }), publicKey)).status, 503);

  const empty = await handlePush(pushRequest(body), env, publicKey);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { sent: 0, gone: 0 });
  assert.equal(calls.length, 0);
});

test("/push: corpo oltre 64 kB, JSON rotto, notifica non valida, più di 49 iscrizioni", async (t) => {
  const { calls } = stubFetch(t, async () => new Response(null, { status: 201 }));
  const { publicKey } = await vapid;
  const env = await envFor();
  const huge = JSON.stringify({ notification: NOTIFICATION, subscriptions: [], pad: "x".repeat(MAX_PUSH_BODY_BYTES) });
  assert.equal((await handlePush(pushRequest(huge), env, publicKey)).status, 413);
  assert.equal((await handlePush(pushRequest("{non json"), env, publicKey)).status, 400);
  for (const notification of [
    { ...NOTIFICATION, kind: "chat" },
    { ...NOTIFICATION, title: " " },
    { ...NOTIFICATION, body: 3 },
    { ...NOTIFICATION, url: "https://evil.example" },
    { ...NOTIFICATION, tag: "con spazi" },
    null
  ]) {
    assert.equal((await handlePush(pushRequest({ notification, subscriptions: [] }), env, publicKey)).status, 400, JSON.stringify(notification));
  }
  assert.equal((await handlePush(pushRequest({ notification: NOTIFICATION }), env, publicKey)).status, 400);
  const { row } = await subscriptionOf("https://fcm.googleapis.com/fcm/send/a");
  const tooMany = Array.from({ length: 50 }, (_, index) => ({ ...row, endpoint: `https://fcm.googleapis.com/fcm/send/${index}` }));
  assert.equal((await handlePush(pushRequest({ notification: NOTIFICATION, subscriptions: tooMany }), env, publicKey)).status, 400);
  assert.equal(calls.length, 0);
});

test("notifica: solo i cinque campi, testi lunghi accorciati senza spezzare le emoji", () => {
  const parsed = parseNotification({ ...NOTIFICATION, title: "😀".repeat(500), body: "b".repeat(5000), extra: "no" });
  assert.deepEqual(Object.keys(parsed), ["kind", "title", "body", "url", "tag"]);
  assert.equal(parsed.title, "😀".repeat(MAX_TITLE_CHARS));
  assert.equal(parsed.body.length, MAX_BODY_CHARS);
  assert.equal(parseNotification({ ...NOTIFICATION, url: "?apri=gruppi" }).url, "?apri=gruppi");
});

test("/push: cifra per ogni dispositivo, conta 201, raccoglie 404/410 e li manda a push_gone", async (t) => {
  const { publicKey } = await vapid;
  const ok = await subscriptionOf("https://fcm.googleapis.com/fcm/send/ok");
  const expired = await subscriptionOf("https://updates.push.services.mozilla.com/wpush/v2/expired");
  const missing = await subscriptionOf("https://web.push.apple.com/missing");
  const broken = await subscriptionOf("https://fcm.googleapis.com/fcm/send/broken");
  const status = {
    "https://fcm.googleapis.com/fcm/send/ok": 201,
    "https://updates.push.services.mozilla.com/wpush/v2/expired": 410,
    "https://web.push.apple.com/missing": 404,
    "https://fcm.googleapis.com/fcm/send/broken": 500
  };
  const { calls } = stubFetch(t, async (url) => {
    if (url === `${SUPABASE}/rest/v1/rpc/push_gone`) return Response.json(2);
    return new Response(null, { status: status[url] });
  });
  const lines = quietConsole(t);

  const response = await handlePush(
    pushRequest({ notification: NOTIFICATION, subscriptions: [ok.row, expired.row, missing.row, broken.row, ok.row] }),
    await envFor(),
    publicKey
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1, gone: 2 });

  const pushes = calls.filter((call) => call.url !== `${SUPABASE}/rest/v1/rpc/push_gone`);
  assert.equal(pushes.length, 4, "l'endpoint ripetuto parte una volta sola");
  const first = pushes.find((call) => call.url === ok.row.endpoint);
  assert.equal(first.init.headers.ttl, "86400");
  assert.equal(first.init.headers.urgency, "normal");
  assert.equal(first.init.headers["content-encoding"], "aes128gcm");
  assert.equal(first.init.headers.topic, await pushTopic(NOTIFICATION.tag));
  assert.match(first.init.headers.authorization, new RegExp(`^vapid t=[^,]+, k=${publicKey}$`));
  const claims = JSON.parse(Buffer.from(first.init.headers.authorization.split(" t=")[1].split(".")[1], "base64url").toString());
  assert.equal(claims.sub, VAPID_SUBJECT);
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal((await decryptPush(first.init.body, ok.receiver)).text, JSON.stringify(NOTIFICATION));

  const gone = calls.filter((call) => call.url === `${SUPABASE}/rest/v1/rpc/push_gone`);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].init.method, "POST");
  assert.equal(gone[0].init.headers.apikey, "sb_publishable_prova");
  assert.equal("authorization" in gone[0].init.headers, false);
  const goneBody = JSON.parse(gone[0].init.body);
  assert.equal(goneBody.p_secret, SECRET);
  assert.deepEqual([...goneBody.p_endpoints].sort(), [expired.row.endpoint, missing.row.endpoint].sort());

  const log = lines.join("\n");
  assert.match(log, /"sent":1/);
  for (const secretish of [NOTIFICATION.title, NOTIFICATION.body, "fcm.googleapis.com", "mozilla", SECRET]) {
    assert.equal(log.includes(secretish), false, `il log non contiene ${secretish}`);
  }
});

test("/push: senza URL o chiave Supabase niente pulizia; iscrizioni malformate e reti in errore saltate", async (t) => {
  const { publicKey } = await vapid;
  const ok = await subscriptionOf("https://fcm.googleapis.com/fcm/send/ok");
  const offline = await subscriptionOf("https://fcm.googleapis.com/fcm/send/offline");
  const { calls } = stubFetch(t, async (url) => {
    if (url.endsWith("/offline")) throw new TypeError("fetch failed");
    return new Response(null, { status: url.endsWith("/ok") ? 201 : 410 });
  });
  quietConsole(t);
  const gone = await subscriptionOf("https://fcm.googleapis.com/fcm/send/gone");
  const subscriptions = [
    ok.row,
    offline.row,
    gone.row,
    { ...ok.row, endpoint: "http://fcm.googleapis.com/fcm/send/plain" },
    { ...ok.row, endpoint: "https://user:pw@fcm.googleapis.com/x" },
    { ...ok.row, p256dh: "corta" },
    { ...ok.row, auth: "non/base64url+====" },
    "stringa",
    null
  ];
  const response = await handlePush(
    pushRequest({ notification: { ...NOTIFICATION, kind: "permission", url: "?apri=condivisione" }, subscriptions }),
    await envFor({ STUDYOS_SUPABASE_KEY: "" }),
    publicKey
  );
  assert.deepEqual(await response.json(), { sent: 1, gone: 1 });
  assert.deepEqual(calls.map((call) => call.url).sort(), [ok.row.endpoint, offline.row.endpoint, gone.row.endpoint].sort());
});

test(`/push: al massimo ${PUSH_CONCURRENCY} invii in parallelo`, async (t) => {
  const { publicKey } = await vapid;
  const rows = [];
  for (let index = 0; index < 20; index += 1) rows.push((await subscriptionOf(`https://fcm.googleapis.com/fcm/send/${index}`)).row);
  const { calls, state } = stubFetch(t, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(null, { status: 201 });
  });
  quietConsole(t);
  const response = await handlePush(pushRequest({ notification: NOTIFICATION, subscriptions: rows }), await envFor(), publicKey);
  assert.deepEqual(await response.json(), { sent: 20, gone: 0 });
  assert.equal(calls.length, 20);
  assert.ok(state.maxInFlight > 1, "invia in parallelo");
  assert.ok(state.maxInFlight <= PUSH_CONCURRENCY, `in volo al massimo ${PUSH_CONCURRENCY}, visti ${state.maxInFlight}`);
});
