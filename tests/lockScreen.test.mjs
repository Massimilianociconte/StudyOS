import test from "node:test";
import assert from "node:assert/strict";

const { LOCK_TEXT, lockAccountOf } = await import("../src/lib/labels/lock.ts");

test("lockAccountOf: senza cloud nessun account, poi collegato o no", () => {
  assert.equal(lockAccountOf(false, false), "none");
  assert.equal(lockAccountOf(false, true), "none", "senza cloud una sessione vecchia non conta");
  assert.equal(lockAccountOf(true, true), "signed-in");
  assert.equal(lockAccountOf(true, false), "signed-out");
});

test("recovery: collegato all'account, i dati tornano da soli e l'account non si tocca", () => {
  const lines = LOCK_TEXT.recovery("signed-in");
  assert.ok(lines.some((line) => /tornano da soli/.test(line)));
  assert.ok(lines.some((line) => /restano come sono/.test(line)), "l'account non viene cancellato");
  assert.ok(lines.some((line) => /non ancora arrivate nell'account/.test(line)), "dice cosa si perde");
  assert.ok(!lines.some((line) => /accedi/i.test(line)), "la sessione resta: non serve accedere di nuovo");
  assert.ok(lines.some((line) => /Copia di sicurezza/.test(line)));
});

test("recovery: account non collegato, si accede di nuovo da Impostazioni", () => {
  const lines = LOCK_TEXT.recovery("signed-out");
  assert.ok(lines.some((line) => /accedi da Impostazioni → Account/.test(line)));
  assert.ok(lines.some((line) => /Copia di sicurezza/.test(line)));
});

test("recovery: senza cloud resta solo la copia di sicurezza, nessun account promesso", () => {
  const lines = LOCK_TEXT.recovery("none");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Impostazioni → Copia di sicurezza/);
  assert.ok(!lines.some((line) => /account/i.test(line)));
});

test("testi: niente gergo (vault, passphrase, cloud, reset) e niente promesse di recupero della password", () => {
  const all = [
    LOCK_TEXT.forgot,
    LOCK_TEXT.title,
    LOCK_TEXT.erase,
    LOCK_TEXT.recoveryTitle,
    LOCK_TEXT.confirm,
    LOCK_TEXT.busy,
    LOCK_TEXT.cancel,
    LOCK_TEXT.failed,
    ...LOCK_TEXT.recovery("signed-in"),
    ...LOCK_TEXT.recovery("signed-out"),
    ...LOCK_TEXT.recovery("none")
  ];
  for (const text of all) {
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /vault|passphrase|cloud|reset|sync/i, text);
  }
  assert.match(LOCK_TEXT.erase, /questo dispositivo/);
  assert.match(LOCK_TEXT.erase, /password/);
  assert.match(LOCK_TEXT.erase, /Non si può annullare/);
});
