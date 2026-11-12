import test from "node:test";
import assert from "node:assert/strict";
import {
  agentDeskStatus,
  hubRevokesByAccount,
  pairFirstError,
  parseRevokeOutcome,
  remoteConnectorView,
  revokeNotice
} from "../src/lib/agentDesk.ts";
import { AGENT_DESK_TEXT } from "../src/lib/labels/agents.ts";
import { agentAccountLabels } from "../src/lib/labels.ts";

const HUB = "https://studyos-agent.esempio.workers.dev";

test("revoca: l'esito dice cosa è stato tolto e che gli assistenti degli altri restano", () => {
  const mine = revokeNotice({ scope: "account", revoked: 2, legacy: 0 }, 0);
  assert.match(mine, /2 assistenti/);
  assert.match(mine, /altre persone/);
  assert.doesNotMatch(mine, /prima dell'aggiornamento/);
  assert.match(revokeNotice({ scope: "account", revoked: 1, legacy: 0 }, 0), /1 assistente /);

  const none = revokeNotice({ scope: "account", revoked: 0, legacy: 0 }, 0);
  assert.match(none, /Nessun assistente/);

  // Accessi di prima: non si sa di chi sono, restano e la frase dice come toglierli.
  const legacy = revokeNotice({ scope: "account", revoked: 0, legacy: 1 }, 0);
  assert.match(legacy, /1 collegamento/);
  assert.ok(legacy.includes(`«${AGENT_DESK_TEXT.revokeAllButton}»`), legacy);
  assert.match(revokeNotice({ scope: "account", revoked: 0, legacy: 3 }, 0), /3 collegamenti/);

  // Il permesso cloud tolto insieme.
  assert.ok(revokeNotice({ scope: "account", revoked: 1, legacy: 0 }, 1).includes("connettore remoto"));

  const all = revokeNotice({ scope: "all", revoked: 0, legacy: 0 }, 0);
  assert.match(all, /anche quelli delle altre persone/);

  assert.match(revokeNotice({ scope: "cloud", revoked: 1, legacy: 0 }, 0), /Connettore remoto scollegato/);
  assert.match(revokeNotice({ scope: "cloud", revoked: 0, legacy: 0 }, 2), /Connettore remoto scollegato/);
  assert.match(revokeNotice({ scope: "cloud", revoked: 0, legacy: 0 }, 0), /Nessun connettore remoto/);
});

test("revoca: la risposta dell'hub si legge senza fidarsi dei tipi", () => {
  assert.deepEqual(parseRevokeOutcome({ scope: "account", revoked: 2, legacy: 1 }, "account"), { scope: "account", revoked: 2, legacy: 1 });
  assert.deepEqual(parseRevokeOutcome({ revoked: "molti", legacy: -4 }, "cloud"), { scope: "cloud", revoked: 0, legacy: 0 });
  assert.deepEqual(parseRevokeOutcome(null, "all"), { scope: "all", revoked: 0, legacy: 0 });
  // Un hub di prima (1.5.0) risponde { ok: true } e ha scollegato tutti.
  assert.deepEqual(parseRevokeOutcome({ ok: true }, "account"), { scope: "all", revoked: 0, legacy: 0 });
});

test("revoca: solo un hub dalla 1.6.0 sa revocare per account (prima scollegava tutti)", () => {
  assert.equal(hubRevokesByAccount("1.6.0"), true);
  assert.equal(hubRevokesByAccount("1.10.2"), true);
  assert.equal(hubRevokesByAccount("2.0.0"), true);
  assert.equal(hubRevokesByAccount("1.5.0"), false);
  assert.equal(hubRevokesByAccount("0.9.9"), false);
  assert.equal(hubRevokesByAccount(undefined), false);
  assert.equal(hubRevokesByAccount("ultima"), false);
});

test("parole giuste: «chiave» sul sito pubblicato, «codice» con npm run agent", () => {
  assert.match(pairFirstError(false), /chiave/);
  assert.doesNotMatch(pairFirstError(false), /terminale|codice/);
  assert.match(pairFirstError(true), /codice/);
  assert.match(agentAccountLabels.help(false), /stessa chiave/);
  assert.doesNotMatch(agentAccountLabels.help(true), /chiave/);
  assert.match(agentAccountLabels.help(true), /codice/);
});

test("stato: «Non ancora collegato» finché la persona non prova a collegarsi", () => {
  assert.deepEqual(agentDeskStatus({ paired: false, hub: "down", attempted: false }), { label: AGENT_DESK_TEXT.status.notYet, tone: "neutral" });
  assert.deepEqual(agentDeskStatus({ paired: false, hub: "unknown", attempted: false }), { label: AGENT_DESK_TEXT.status.notYet, tone: "neutral" });
  assert.deepEqual(agentDeskStatus({ paired: false, hub: "up", attempted: true }), { label: AGENT_DESK_TEXT.status.notYet, tone: "neutral" });
  assert.deepEqual(agentDeskStatus({ paired: false, hub: "down", attempted: true }), { label: AGENT_DESK_TEXT.status.unreachable, tone: "warn" });
  assert.deepEqual(agentDeskStatus({ paired: true, hub: "up", attempted: false }), { label: AGENT_DESK_TEXT.status.connected, tone: "ok" });
  assert.deepEqual(agentDeskStatus({ paired: true, hub: "down", attempted: false }), { label: AGENT_DESK_TEXT.status.unreachable, tone: "warn" });
  assert.deepEqual(agentDeskStatus({ paired: true, hub: "unknown", attempted: false }), { label: AGENT_DESK_TEXT.status.checking, tone: "neutral" });
});

test("connettore remoto: indirizzo dal nome del profilo, o il motivo per cui manca", () => {
  const base = { cloud: true, hub: HUB, remote: "on", displayName: "Camilla Rossì" };
  assert.deepEqual(remoteConnectorView(base), { kind: "address", address: `${HUB}/u/camilla-rossi/mcp` });
  // Prima di /health non si sa se è attivo: l'indirizzo si mostra lo stesso.
  assert.deepEqual(remoteConnectorView({ ...base, remote: "unknown" }), { kind: "address", address: `${HUB}/u/camilla-rossi/mcp` });
  assert.deepEqual(remoteConnectorView({ ...base, displayName: "   " }), { kind: "noName" });
  assert.deepEqual(remoteConnectorView({ ...base, displayName: "!!!" }), { kind: "noName" });
  assert.deepEqual(remoteConnectorView({ ...base, remote: "off" }), { kind: "off" });
  assert.deepEqual(remoteConnectorView({ ...base, hub: null }), { kind: "noHub" });
  assert.deepEqual(remoteConnectorView({ ...base, cloud: false, hub: null }), { kind: "noCloud" });
});
