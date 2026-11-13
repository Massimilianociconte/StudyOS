import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Cloudflare rifiuta il Worker se un modulo, mentre si carica, chiede un valore casuale, un timer o
// una richiesta di rete. Il connettore remoto importa lo store dell'app: anche quei moduli devono
// rimandare queste operazioni al primo uso.
test("the Worker's modules load without random values, timers or network at import time", () => {
  const child = spawnSync(
    process.execPath,
    ["--import", "./scripts/lib/register-ts.mjs", "./tests/fixtures/workerGlobalScope.mjs"],
    { cwd: root, encoding: "utf8", timeout: 60_000 }
  );
  assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`.slice(0, 2000));
  assert.match(child.stdout, /^ok$/m);
});
