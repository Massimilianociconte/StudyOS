// Carica i moduli del Worker (connettore remoto e /push) come li carica il runtime di Cloudflare:
// mentre si importano niente valori casuali, timer o richieste di rete, altrimenti il deploy fallisce
// con «Disallowed operation called within global scope» (codice 10021). Usato da
// tests/workerGlobalScope.test.mjs in un processo a parte.
const forbidden = (name) => () => {
  throw new Error(`${name} chiamato mentre si caricano i moduli del Worker`);
};

const saved = {
  randomUUID: crypto.randomUUID,
  getRandomValues: crypto.getRandomValues,
  random: Math.random,
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
  fetch: globalThis.fetch
};

crypto.randomUUID = forbidden("crypto.randomUUID");
crypto.getRandomValues = forbidden("crypto.getRandomValues");
Math.random = forbidden("Math.random");
globalThis.setTimeout = forbidden("setTimeout");
globalThis.setInterval = forbidden("setInterval");
globalThis.fetch = forbidden("fetch");

try {
  await import("../../src/agent/hubEndpoint.ts");
  await import("../../src/agent/httpHub.ts");
  await import("../../src/agent/cloudRunner.ts");
  await import("../../worker/push.ts");
} finally {
  crypto.randomUUID = saved.randomUUID;
  crypto.getRandomValues = saved.getRandomValues;
  Math.random = saved.random;
  globalThis.setTimeout = saved.setTimeout;
  globalThis.setInterval = saved.setInterval;
  globalThis.fetch = saved.fetch;
}

console.log("ok");
