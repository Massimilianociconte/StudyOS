import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PERSONAL_COLLECTIONS, accountSwitchBlock, accountSwitchStep, personalRemovals } from "../src/lib/accountSwitch.ts";
import { ACCOUNT_TEXT } from "../src/lib/labels/account.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("P6: con i dati di un altro account non si unisce mai senza una scelta esplicita", () => {
  const base = { bound: "anna", userId: "bruno", hasData: true };
  // Nessuna risposta (finestra del browser bloccata, Esc, app dentro un'altra app): si chiede, non si unisce.
  assert.equal(accountSwitchStep(base), "ask");
  assert.equal(accountSwitchStep({ ...base, choice: null }), "ask");
  assert.equal(accountSwitchStep({ ...base, choice: "separate" }), "separate");
  assert.equal(accountSwitchStep({ ...base, choice: "merge" }), "merge");
  // Nulla da decidere: stesso account, primo collegamento, dispositivo vuoto.
  assert.equal(accountSwitchStep({ ...base, userId: "anna" }), "none");
  assert.equal(accountSwitchStep({ ...base, bound: undefined }), "none");
  assert.equal(accountSwitchStep({ ...base, hasData: false, choice: "merge" }), "none");
});

test("P6: il cambio di account non usa più confirm() (che senza risposta voleva dire «unisci»)", () => {
  const sync = source("src/lib/cloudSync.ts");
  const bind = sync.slice(sync.indexOf("const bindUser"), sync.indexOf("const syncOnce"));
  assert.doesNotMatch(bind, /confirm\(/);
  assert.match(bind, /accountSwitchStep\(/);
  assert.match(bind, /AccountChoiceNeededError/);
  // La scelta vale solo per l'account per cui è stata fatta, e si dimentica cambiando sessione.
  assert.match(sync, /export const chooseAccountSwitch/);
  const apply = sync.slice(sync.indexOf("const applySession"), sync.indexOf("export const initCloudSync"));
  assert.match(apply, /switchChoice = null/);
  // Nel pannello la scelta sicura ha il fuoco; unire richiede il suo pulsante.
  const panel = source("src/components/CloudPanel.tsx");
  const choice = panel.slice(panel.indexOf("account-switch-title") - 200, panel.indexOf("ACCOUNT_TEXT.switchMerge}") + 40);
  assert.match(choice, /chooseSwitch\("separate"\)[^\n]*autoFocus/);
  assert.match(choice, /chooseSwitch\("merge"\)/);
  assert.doesNotMatch(choice.slice(choice.indexOf('chooseSwitch("merge")')), /autoFocus/);
  assert.match(panel, /await chooseAccountSwitch\(choice\)/);
  assert.match(source("src/components/CloudStatusBadge.tsx"), /accountChoice/);
});

const empty = () => ({
  subjects: [],
  tasks: [],
  events: [],
  exams: [],
  notes: [],
  goals: [],
  sessions: [],
  materials: [],
  preferences: []
});

test("cambio di account: nome, foto e preferenze di prima si tolgono, il resto si unisce", () => {
  const state = {
    ...empty(),
    preferences: [{ id: "main", displayName: "Anna Rossi", avatarDataUrl: "data:image/png;base64,AA", updatedAt: "2026-11-12T08:54:07.668Z" }],
    tasks: [{ id: "task_1", title: "Compito di Anna", updatedAt: "2026-11-12T08:54:07.668Z" }]
  };
  assert.deepEqual(personalRemovals(state), [{ collection: "preferences", id: "main", entity: null, force: true }]);
});

test("cambio di account: senza preferenze salvate non si toglie nulla", () => {
  assert.deepEqual(personalRemovals(empty()), []);
  assert.deepEqual(personalRemovals({ ...empty(), tasks: [{ id: "task_1", title: "x", updatedAt: "2026-11-12T08:00:00.000Z" }] }), []);
});

test("cambio di account: solo le preferenze sono della persona", () => {
  assert.deepEqual([...PERSONAL_COLLECTIONS], ["preferences"]);
});

test("P6 (revisione): una modifica fatta mentre la domanda è aperta non blocca entrambi i pulsanti", () => {
  // Prima: la modifica (o la sessione salvata dal Pomodoro) metteva una voce in coda per l'account di
  // prima e ogni pulsante finiva in «modifiche cloud in attesa»; l'unica uscita era tornare all'altro account.
  const asked = { pending: 1, stuck: 0, asked: true };
  assert.equal(accountSwitchBlock({ ...asked, choice: null }), null, "la domanda resta aperta");
  assert.equal(accountSwitchBlock({ ...asked, choice: "merge" }), null, "«Aggiungi» porta anche la modifica nel nuovo account");
  assert.equal(accountSwitchBlock({ ...asked, choice: "separate" }), "editedWhileAsked", "«Mostra solo» la perderebbe: si dice perché");
  // Modifiche in coda prima della domanda: la regola di prima (vanno mandate all'account di prima).
  assert.equal(accountSwitchBlock({ pending: 2, stuck: 0, asked: false, choice: "merge" }), "pending");
  assert.equal(accountSwitchBlock({ pending: 0, stuck: 1, asked: true, choice: "merge" }), "stuck");
  assert.equal(accountSwitchBlock({ pending: 0, stuck: 0, asked: false }), null);
  assert.match(ACCOUNT_TEXT.switchEditedWhileAsked(1), /Mentre sceglievi hai cambiato 1 elemento/);
  assert.match(ACCOUNT_TEXT.switchEditedWhileAsked(1), /«Aggiungi i dati di prima a questo account»/);
  assert.match(ACCOUNT_TEXT.switchEditedWhileAsked(3), /3 elementi/);

  const sync = source("src/lib/cloudSync.ts");
  const bind = sync.slice(sync.indexOf("const bindUser"), sync.indexOf("const syncOnce"));
  // La domanda aperta si ricorda (anche dopo un ricaricamento) per la coppia di account.
  assert.match(bind, /await setMeta\(metaKeys\.switchAsked, askedPair\);\s*throw new AccountChoiceNeededError\(\);/);
  assert.match(bind, /accountSwitchBlock\(\{ pending, stuck, asked: \(await getMeta<string>\(metaKeys\.switchAsked\)\) === askedPair, choice \}\)/);
  assert.match(bind, /await deleteMeta\(metaKeys\.switchAsked\);\s*await setMeta\(metaKeys\.boundUser, userId\);/);
  // Il blocco «pending» viene prima della domanda: accountChoice non resta acceso accanto all'errore.
  assert.ok(bind.indexOf('block === "pending"') < bind.indexOf("setState({ accountChoice: true })"));
});

test("uscita: le modifiche non inviate si contano al singolare e al plurale", () => {
  assert.match(ACCOUNT_TEXT.leavePending(1), /^1 modifica non è ancora/);
  assert.match(ACCOUNT_TEXT.leavePending(3), /^3 modifiche non sono ancora/);
});
