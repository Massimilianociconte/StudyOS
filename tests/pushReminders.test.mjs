import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Promemoria con l'app chiusa: righe di studyos_push_reminders (supabase/push-reminders.sql) e diff.
// Gli eventi con fuso (Europe/Rome) danno gli stessi istanti in ogni fuso del dispositivo: i test
// valgono con TZ locale e con TZ=UTC.
const push = await import("../src/lib/pushReminders.ts");
const { planReminders } = await import("../src/lib/eventReminders.ts");
const { allDayTimes } = await import("../src/lib/repeat.ts");
const { EVENT_REMINDER_TEXT } = await import("../src/lib/labels/eventReminders.ts");

const ROME = "Europe/Rome";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const event = (patch) => ({
  id: "e1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "",
  priority: "medium",
  start: "2026-11-12T09:00:00.000Z",
  end: "2026-11-12T10:00:00.000Z",
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});
const at = (iso) => new Date(iso);
const ASCII_TAG = /^[\x21-\x7e]{1,200}$/;

test("chiave sicura: le chiavi normali restano uguali (stesso tag della scheda aperta di prima)", () => {
  const key = "e1@2026-11-12#0d15m@1794474900000";
  assert.equal(push.safeReminderKey(key), key);
  assert.equal(push.reminderTagOf(key), `studyos-reminder-${key}`);
  assert.equal(push.reminderRowId(key), `event:${key}`);
});

test("chiave sicura: caratteri strani o chiave lunghissima → prefisso + hash, sempre ASCII e ≤ 200", () => {
  const accented = push.safeReminderKey("è@2026-11-12#0d15m@1");
  const other = push.safeReminderKey("à@2026-11-12#0d15m@1");
  assert.notEqual(accented, other, "due chiavi diverse non finiscono sulla stessa riga");
  assert.match(push.reminderTagOf("è@2026-11-12#0d15m@1"), ASCII_TAG);
  const spaced = push.safeReminderKey("evento con spazi@2026-11-12#0d15m@1");
  assert.doesNotMatch(spaced, / /);
  const long = "x".repeat(500);
  assert.ok(push.safeReminderKey(long).length <= 160);
  assert.notEqual(push.safeReminderKey(long), push.safeReminderKey(`${"x".repeat(499)}y`));
  for (const key of [long, "è", "id con\nritorno"]) {
    assert.match(push.reminderTagOf(key), ASCII_TAG);
    assert.match(push.reminderRowId(key), ASCII_TAG);
  }
  assert.equal(push.safeReminderKey(long), push.safeReminderKey(long), "stabile");
});

test("righe: solo i promemoria futuri entro 7 giorni, in ordine, con titolo, testo, url e tag", () => {
  const now = at("2026-11-12T08:00:00.000Z");
  const events = [
    event({ id: "soon", start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T10:00:00.000Z", reminders: [{ minutesBefore: 15 }] }),
    event({ id: "past", start: "2026-11-12T08:10:00.000Z", end: "2026-11-12T09:00:00.000Z", reminders: [{ minutesBefore: 30 }] }),
    event({ id: "far", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.000Z", reminders: [{ minutesBefore: 15 }] }),
    event({ id: "next", title: "  ", start: "2026-11-15T09:00:00.000Z", end: "2026-11-15T10:00:00.000Z", reminders: [{ minutesBefore: 60 }] })
  ];
  const rows = push.pushReminderRows(events, now);
  assert.deepEqual(rows.map((row) => row.fire_at), ["2026-11-12T08:45:00.000Z", "2026-11-15T08:00:00.000Z"]);
  const [first, second] = rows;
  const plan = planReminders(events, now, { horizonMs: 7 * DAY, graceMs: 0 }).find((item) => item.eventId === "soon");
  assert.equal(first.id, `event:${plan.key}`);
  assert.equal(first.tag, `studyos-reminder-${plan.key}`);
  assert.equal(first.title, "Lezione");
  assert.match(first.body, /^Tra 15 minuti · \d{2}:\d{2}$/, "il testo della scheda aperta all'istante del promemoria");
  assert.equal(first.url, "?apri=calendario");
  assert.equal(second.title, EVENT_REMINDER_TEXT.untitled, "titolo vuoto → testo di riserva (il server non accetta titoli vuoti)");
  assert.match(second.body, /^(Oggi|Domani) alle \d{2}:\d{2}$/, "un'ora prima: «Oggi alle …», come la scheda aperta");
});

test("righe: titolo lunghissimo tagliato a 120 caratteri senza spezzare le emoji; al più `max` righe", () => {
  const now = at("2026-11-12T08:00:00.000Z");
  const long = event({ title: "😀".repeat(300), reminders: [{ minutesBefore: 15 }] });
  const [row] = push.pushReminderRows([long], now);
  assert.equal(Array.from(row.title).length, 120);
  assert.equal(row.title, "😀".repeat(120));
  const daily = event({ id: "d", recurrence: "daily", reminders: [{ minutesBefore: 15 }, { minutesBefore: 5 }] });
  assert.equal(push.pushReminderRows([daily], now, { max: 3 }).length, 3);
  assert.equal(push.PUSH_REMINDER_MAX_ROWS < 300, true, "sotto il tetto del server");
});

test("righe: saltati, fatti, archiviati e condivisi non diventano push", () => {
  const now = at("2026-11-12T08:00:00.000Z");
  const reminders = [{ minutesBefore: 15 }];
  const rows = push.pushReminderRows(
    [
      event({ id: "s", status: "skipped", reminders }),
      event({ id: "d", status: "done", reminders }),
      event({ id: "a", archived: true, reminders }),
      event({ id: "sh", sharedFrom: { ownerId: "x" }, reminders })
    ],
    now
  );
  assert.deepEqual(rows, []);
});

test("Europe/Rome, fine dell'ora legale: serie settimanale alle 09:00 resta alle 09:00 di Roma", () => {
  const now = at("2026-10-21T12:00:00.000Z");
  // Giovedì 22/10 alle 09:00 CEST (07:00Z); il 29/10 è già CET (08:00Z).
  const weekly = event({ id: "w", timeZone: ROME, recurrence: "weekly", start: "2026-10-22T07:00:00.000Z", end: "2026-10-22T08:00:00.000Z", reminders: [{ minutesBefore: 15 }] });
  const rows = push.pushReminderRows([weekly], now, { horizonMs: 9 * DAY });
  assert.deepEqual(rows.map((row) => row.fire_at), ["2026-10-22T06:45:00.000Z", "2026-10-29T07:45:00.000Z"]);
  assert.notEqual(rows[0].id, rows[1].id, "una riga per occorrenza");
});

test("Europe/Rome: serie giornaliera attraverso il cambio d'ora, 7 giorni = 7 righe", () => {
  const now = at("2026-10-22T12:00:00.000Z");
  const daily = event({ id: "g", timeZone: ROME, recurrence: "daily", start: "2026-10-23T06:00:00.000Z", end: "2026-10-23T07:00:00.000Z", reminders: [{ minutesBefore: 30 }] });
  const rows = push.pushReminderRows([daily], now);
  assert.deepEqual(rows.map((row) => row.fire_at), [
    "2026-10-23T05:30:00.000Z",
    "2026-10-24T05:30:00.000Z",
    "2026-10-25T06:30:00.000Z",
    "2026-10-26T06:30:00.000Z",
    "2026-10-27T06:30:00.000Z",
    "2026-10-28T06:30:00.000Z",
    "2026-10-29T06:30:00.000Z"
  ]);
});

test("Europe/Rome, tutto il giorno: «il giorno prima alle 20:00» e l'inizio dell'ora legale", () => {
  const autumn = event({ id: "ad", allDay: true, timeZone: ROME, ...allDayTimes("2026-10-26", "2026-10-26", ROME), reminders: [{ daysBefore: 1, at: "20:00" }] });
  const [row] = push.pushReminderRows([autumn], at("2026-10-24T12:00:00.000Z"));
  assert.equal(row.fire_at, "2026-10-25T19:00:00.000Z", "domenica 25/10 alle 20:00 CET");
  assert.match(row.body, /^(Oggi|Domani)$/, "giorno visto dal fuso del dispositivo che scrive");
  const spring = event({ id: "sp", allDay: true, timeZone: ROME, ...allDayTimes("2027-03-29", "2027-03-29", ROME), reminders: [{ daysBefore: 1, at: "09:00" }] });
  const [springRow] = push.pushReminderRows([spring], at("2027-03-27T12:00:00.000Z"));
  assert.equal(springRow.fire_at, "2027-03-28T07:00:00.000Z", "domenica 28/03 alle 09:00 CEST");
});

test("diff: mancanti o cambiati da scrivere, futuri non più voluti da togliere, passati lasciati al server", () => {
  const nowMs = Date.parse("2026-11-12T08:00:00.000Z");
  const row = (id, fire, title = "T") => ({ id, fire_at: fire, title, body: "b", url: "?apri=calendario", tag: `studyos-reminder-${id}` });
  const desired = [row("a", "2026-11-12T09:00:00.000Z"), row("b", "2026-11-12T10:00:00.000Z", "Nuovo"), row("c", "2026-11-12T11:00:00.000Z")];
  const server = [
    { ...row("a", "2026-11-12T09:00:00+00:00") },
    row("b", "2026-11-12T10:00:00.000Z", "Vecchio"),
    row("gone", "2026-11-13T09:00:00.000Z"),
    row("fired", "2026-11-12T07:59:00.000Z")
  ];
  const { upserts, deletes } = push.diffPushReminders(desired, server, nowMs);
  assert.deepEqual(upserts.map((item) => item.id), ["b", "c"], "a è uguale anche con l'istante scritto da Postgres");
  assert.deepEqual(deletes, ["gone"], "le righe già scattate le gestisce il server");
  assert.deepEqual(push.diffPushReminders(desired, desired, nowMs), { upserts: [], deletes: [] });
  assert.deepEqual(push.diffPushReminders([], server, nowMs).deletes, ["a", "b", "gone"]);
});

test("impronta, interruttore dell'account, pezzi, sync aggiornata, tabella mancante", () => {
  const rows = push.pushReminderRows([event({ reminders: [{ minutesBefore: 15 }] })], at("2026-11-12T08:00:00.000Z"));
  assert.equal(push.pushReminderFingerprint(rows), push.pushReminderFingerprint(rows.map((item) => ({ ...item }))));
  assert.notEqual(push.pushReminderFingerprint(rows), push.pushReminderFingerprint([{ ...rows[0], title: "Altro" }]));
  assert.equal(push.pushRemindersWanted(undefined), true);
  assert.equal(push.pushRemindersWanted({}), true);
  assert.equal(push.pushRemindersWanted({ pushReminders: true }), true);
  assert.equal(push.pushRemindersWanted({ pushReminders: false }), false);
  assert.deepEqual(push.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(push.chunk([], 50), []);
  const start = Date.parse("2026-11-12T08:00:00.000Z");
  assert.equal(push.syncedSincePageStart(null, start), false);
  assert.equal(push.syncedSincePageStart("2026-11-11T08:00:00.000Z", start), false, "giro di un'apertura precedente");
  assert.equal(push.syncedSincePageStart("2026-11-12T08:00:01.000Z", start), true);
  assert.equal(push.syncedSincePageStart("rotto", start), false);
  assert.equal(push.isMissingReminderTable({ code: "PGRST205", message: "Could not find the table" }), true);
  assert.equal(push.isMissingReminderTable({ code: "42P01", message: "relation does not exist" }), true);
  assert.equal(push.isMissingReminderTable({ code: "42501", message: "permission denied" }), false);
  assert.equal(push.isMissingReminderTable(null), false);
});

test("cambio di account (L1): i dati valgono solo dopo un giro di sync dell'account entrato", () => {
  const pageStart = Date.parse("2026-11-12T08:00:00.000Z");
  let track = push.trackReminderAccount(null, "b", pageStart + 1000, pageStart);
  assert.deepEqual(track, { userId: "b", sinceMs: pageStart }, "primo account visto: vale dall'apertura della pagina");
  const ready = (cloud) => push.reminderSyncReady({ status: "idle", accountChoice: false, ...cloud }, track);
  assert.equal(ready({ userId: "b", lastSync: "2026-11-12T08:00:05.000Z" }), true);
  // b esce, entra a, poi di nuovo b nella stessa pagina: il lastSync di b salvato prima non basta.
  track = push.trackReminderAccount(track, null, pageStart + 60_000, pageStart);
  track = push.trackReminderAccount(track, "a", pageStart + 120_000, pageStart);
  track = push.trackReminderAccount(track, "b", pageStart + 180_000, pageStart);
  assert.equal(track.sinceMs, pageStart + 180_000);
  assert.equal(ready({ userId: "b", lastSync: "2026-11-12T08:00:05.000Z" }), false, "giro vecchio di b: i dati nello store sono ancora di a");
  assert.equal(ready({ userId: "b", lastSync: "2026-11-12T08:03:30.000Z", accountChoice: true }), false, "scelta «ask» aperta");
  assert.equal(ready({ userId: "b", lastSync: "2026-11-12T08:03:30.000Z", status: "syncing" }), false);
  assert.equal(ready({ userId: "a", lastSync: "2026-11-12T08:03:30.000Z" }), false, "sessione e account seguito diversi");
  assert.equal(ready({ userId: "b", lastSync: "2026-11-12T08:03:30.000Z" }), true);
  assert.equal(push.trackReminderAccount(track, "b", pageStart + 999_999, pageStart), track, "stesso account: niente di nuovo");
  assert.equal(push.reminderSyncReady({ userId: null, status: "idle", lastSync: "2026-11-12T09:00:00.000Z" }, track), false);
});

test("fuso nella riga e testo nell'ora di un altro fuso", () => {
  const rows = push.pushReminderRows([event({ timeZone: ROME, reminders: [{ minutesBefore: 15 }] })], at("2026-11-12T08:00:00.000Z"));
  assert.equal(rows[0].zone, push.rowZoneOf(Intl.DateTimeFormat().resolvedOptions().timeZone));
  assert.deepEqual(Object.keys(push.serverRowOf(rows[0])).sort(), ["body", "fire_at", "id", "tag", "title", "url", "zone"], "niente campi in più nell'upsert");
  assert.equal(push.rowZoneOf("Europe/Rome"), "Europe/Rome");
  assert.equal(push.rowZoneOf("Fuso/Inventato"), null);
  assert.equal(push.rowZoneOf("Europe/Rome; drop"), null);
  // 09:00Z = 10:00 a Roma, 09:00 a Londra.
  const start = Date.parse("2026-11-12T09:00:00.000Z");
  assert.equal(push.reminderTextIn(start, false, start - 15 * MIN, ROME), "Tra 15 minuti · 10:00");
  assert.equal(push.reminderTextIn(start, false, start - 15 * MIN, "Europe/London"), "Tra 15 minuti · 09:00");
  assert.equal(push.reminderTextIn(start, false, start - 3 * HOUR, "America/New_York"), "Oggi alle 04:00");
});

test("dispositivi in fusi diversi (L5): non si cancellano né riscrivono le righe a vicenda", () => {
  const LONDON = "Europe/London";
  const now = at("2026-11-12T08:00:00.000Z");
  const nowMs = now.getTime();
  // Un esame tutto il giorno senza fuso suo: «il giorno prima alle 20:00» è un altro istante a Roma e a Londra.
  const floating = event({ id: "f", allDay: true, ...allDayTimes("2026-11-15", "2026-11-15"), reminders: [{ daysBefore: 1, at: "20:00" }] });
  // Una lezione con il suo fuso: stesso istante ovunque, cambia solo l'ora scritta nel testo.
  const zoned = event({ id: "z", timeZone: ROME, start: "2026-11-13T09:00:00.000Z", end: "2026-11-13T10:00:00.000Z", reminders: [{ minutesBefore: 15 }] });
  const events = [floating, zoned];
  const rowsIn = (zone) => push.pushReminderRows(events, now, { zone });
  const rome = rowsIn(ROME);
  const london = rowsIn(LONDON);
  assert.equal(rome.length, 2);
  const [romeFloating, londonFloating] = [rome, london].map((rows) => rows.find((row) => row.id.startsWith("event:f@")));
  assert.notEqual(romeFloating.id, londonFloating.id, "evento senza fuso: istante diverso");
  assert.equal(push.reminderSlotOf(romeFloating.id), push.reminderSlotOf(londonFloating.id), "stesso promemoria");
  assert.equal(Date.parse(romeFloating.fire_at) - Date.parse(londonFloating.fire_at), -HOUR);
  const romeZoned = rome.find((row) => row.id.startsWith("event:z@"));
  const londonZoned = london.find((row) => row.id.startsWith("event:z@"));
  assert.equal(romeZoned.id, londonZoned.id, "evento con fuso: stesso istante");
  assert.notEqual(romeZoned.body, londonZoned.body, "ma l'ora nel testo è quella di chi scrive");

  const server = london.map(push.serverRowOf);
  const options = (zone) => ({ zone, rowsInZone: rowsIn });
  // Roma trova le righe scritte da Londra: giuste per Londra, restano.
  assert.deepEqual(push.diffPushReminders(rome, server, nowMs, options(ROME)), { upserts: [], deletes: [] });
  // Prima della correzione: Roma toglieva quella di Londra e scriveva la sua (e Londra il contrario).
  const before = push.diffPushReminders(rome, server, nowMs);
  assert.deepEqual(before.deletes, [londonFloating.id], "senza rowsInZone: comportamento di prima (interruttore spento, nessun dispositivo)");
  // Londra rilegge: niente da fare.
  assert.deepEqual(push.diffPushReminders(london, server, nowMs, options(LONDON)), { upserts: [], deletes: [] });

  // Evento cambiato da Roma: la riga di Londra non è più giusta per Londra → Roma la sostituisce, una volta.
  const moved = [{ ...floating, ...allDayTimes("2026-11-16", "2026-11-16") }, { ...zoned, title: "Lezione spostata" }];
  const romeAfter = push.pushReminderRows(moved, now, { zone: ROME });
  const afterOptions = { zone: ROME, rowsInZone: (zone) => push.pushReminderRows(moved, now, { zone }) };
  const change = push.diffPushReminders(romeAfter, server, nowMs, afterOptions);
  assert.deepEqual(change.upserts.map((row) => row.id).sort(), romeAfter.map((row) => row.id).sort());
  assert.deepEqual(change.deletes, [londonFloating.id], "quella con l'id dell'evento con fuso si sovrascrive, l'altra si toglie");
  // Poi Londra trova le righe di Roma, giuste per Roma: le lascia.
  const serverAfter = romeAfter.map(push.serverRowOf);
  const londonAfter = push.pushReminderRows(moved, now, { zone: LONDON });
  assert.deepEqual(
    push.diffPushReminders(londonAfter, serverAfter, nowMs, { zone: LONDON, rowsInZone: (zone) => push.pushReminderRows(moved, now, { zone }) }),
    { upserts: [], deletes: [] }
  );

  // Due righe per lo stesso promemoria (versioni vecchie): ne resta una.
  const both = [...server, push.serverRowOf(romeFloating)];
  const cleanup = push.diffPushReminders(rome, both, nowMs, options(ROME));
  assert.deepEqual(cleanup.upserts, []);
  assert.deepEqual(cleanup.deletes, [londonFloating.id], "resta la propria");
  // Righe senza fuso (versione precedente): come prima.
  const legacy = rome.map((row) => ({ ...push.serverRowOf(row), zone: null }));
  assert.deepEqual(push.diffPushReminders(rome, legacy, nowMs, options(ROME)), { upserts: [], deletes: [] });
  // Fuso illeggibile: la riga si tratta come propria (e si riscrive se diversa).
  const odd = server.map((row) => ({ ...row, zone: "Fuso/Inventato" }));
  const fix = push.diffPushReminders(rome, odd, nowMs, options(ROME));
  assert.ok(fix.deletes.includes(londonFloating.id));
});

// ─── Collegamenti (sorgente) ───────────────────────────────────────────────

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("scheda aperta: stesso tag della push, una notifica per dispositivo, segna la riga solo se la scheda è in uso", () => {
  const watcher = read("src/components/calendar/EventReminderWatcher.tsx");
  assert.match(watcher, /tag: reminderTagOf\(key\)/);
  assert.match(watcher, /data: \{ url: PUSH_REMINDER_URL \}/);
  const once = watcher.slice(watcher.indexOf("async function showReminderOnce"));
  const check = once.indexOf("if (alreadyShown(await readReminderShown(tag), item.at)) return;");
  const show = once.indexOf("await showSystemReminder(");
  assert.ok(check > 0 && check < show, "mostrato dalla push: solo la campanella, niente seconda notifica di sistema");
  assert.match(once, /if \(!shown\) return;\s*await recordReminderShown\(tag, "page"\);\s*if \(inUse\(\)\) markShownOnServer\(item\.key\);/);
  assert.match(watcher, /document\.visibilityState === "visible" && document\.hasFocus\(\)/, "una scheda dimenticata non toglie la push al telefono");
  assert.match(watcher, /hidden \? PRIVATE_REMINDER_TITLE : title/, "password dell'app: niente titolo anche qui");
  assert.match(watcher, /if \(system\) void showReminderOnce\(item, title, body\)/);
  assert.match(watcher, /import\("\.\.\/\.\.\/lib\/pushReminderSync"\)/, "supabase-js resta fuori dal pezzo del watcher");
  assert.match(watcher, /module\.startPushReminderSync\(\)/);
  assert.doesNotMatch(watcher, /from "\.\.\/\.\.\/lib\/pushReminderSync"/);
});

test("sincronizzazione: solo con un account, dopo un giro della sync di questa pagina, per l'account, a pezzi", () => {
  const sync = read("src/lib/pushReminderSync.ts");
  assert.match(sync, /if \(!userId\) return "signed-out"/, "ospite: niente");
  assert.match(sync, /if \(!readyFor\(cloud\)\) return "waiting"/);
  assert.match(sync, /accountChoice: cloud\.accountChoice/);
  assert.match(sync, /track = trackReminderAccount\(track, state\.session\?\.user\.id \?\? null, Date\.now\(\), PAGE_START_MS\)/);
  assert.match(sync, /if \(!stillSignedIn\(userId\)\) return "waiting";/, "account cambiato durante la rete: niente scritture");
  assert.match(sync, /\.select\("id, fire_at, title, body, url, tag, zone"\)/);
  assert.match(sync, /\.\.\.serverRowOf\(row\)/, "solo le colonne della tabella");
  assert.match(sync, /rowsInZone: \(other\) => pushReminderRows\(events, now, \{ zone: other \}\)/);
  assert.match(sync, /store\.loading \|\| store\.locked/);
  assert.match(sync, /pushRemindersWanted\(selectPreferences\(store\)\)/);
  assert.match(sync, /from\(SUBSCRIPTIONS\)\.select\("id", \{ count: "exact", head: true \}\)/, "senza dispositivi le righe si tolgono");
  assert.match(sync, /\.is\("sent_at", null\)\s*\.gt\("fire_at", now\.toISOString\(\)\)/);
  assert.match(sync, /onConflict: "user_id,id"/);
  assert.match(sync, /\.eq\("user_id", userId\)\.in\("id", ids\)/);
  assert.match(sync, /await import\("\.\/supabase"\)/);
  assert.doesNotMatch(sync, /from "\.\/supabase"/);
});

test("Impostazioni: riga e interruttore dei promemoria con l'app chiusa nella sezione notifiche, per l'account", () => {
  const toggle = read("src/components/PushToggle.tsx");
  assert.match(toggle, /pushLabels\.remindersToggle/);
  assert.match(toggle, /pushLabels\.remindersHint/);
  assert.match(toggle, /updatePreferences\(\{ pushReminders: !remindersOn \}\)/);
  assert.match(toggle, /selectPreferences\(state\)\.pushReminders !== false/);
  const store = read("src/store/useStudyStore.ts");
  assert.match(store, /"eventTypeColors" \| "pushReminders"/);
});

test("?apri=calendario: la notifica di un promemoria apre il calendario", async () => {
  const { parseOpenTarget } = await import("../src/lib/openLink.ts");
  assert.equal(parseOpenTarget("?apri=calendario"), "calendario");
  assert.equal(push.PUSH_REMINDER_URL, "?apri=calendario");
  assert.match(read("src/hooks/useOpenLink.ts"), /target === "calendario"\) useStudyStore\.getState\(\)\.setActiveView\("calendar"\)/);
});

test("SQL: tabella per account, controlli, job DEFINER chiuso ai client, pg_cron facoltativo, erase", () => {
  const sql = read("supabase/push-reminders.sql");
  assert.match(sql, /primary key \(user_id, id\)/);
  assert.match(sql, /url ~ '\^\[\?\]apri=\[a-z\]\{1,30\}\$'/);
  assert.match(sql, /char_length\(title\) between 1 and 120/);
  assert.match(sql, /char_length\(body\) <= 400/);
  assert.match(sql, /interval '14 days'/);
  assert.match(sql, /v_total >= 400/);
  assert.match(sql, /new\.fire_at := old\.fire_at;/, "un client non sposta un promemoria");
  assert.match(sql, /if old\.sent_at is not null then\s*new\.sent_at := old\.sent_at;\s*new\.skipped := old\.skipped;/, "un client non rimette in coda");
  assert.match(sql, /order by d\.rn, d\.fire_at, d\.user_id, d\.id/, "a turno tra gli account");
  assert.match(sql, /d\.rn <= least\(10, 60 - coalesce\(u\.n, 0\)\)/, "al più 10 a giro e 60 all'ora per account");
  assert.match(sql, /zone is null or zone ~ '\^\[A-Za-z0-9_\+\/-\]\{1,64\}\$'/);
  assert.match(sql, /fire_at < now\(\) - interval '30 minutes'/);
  assert.match(sql, /'kind', 'reminder'/);
  assert.match(sql, /function public\.studyos_push_due_reminders\(\)\s*returns integer\s*language plpgsql\s*security definer\s*set search_path = public/);
  assert.match(sql, /revoke all on function public\.studyos_push_due_reminders\(\) from public, anon, authenticated;/);
  assert.match(sql, /exception when others then/);
  assert.match(sql, /to_regprocedure\('cron\.schedule\(text,text,text\)'\) is null/, "senza pg_cron lo script va a buon fine");
  for (const action of ["select", "insert", "update", "delete"]) {
    assert.match(sql, new RegExp(`create policy studyos_push_reminders_${action} on public\\.studyos_push_reminders for ${action} to authenticated`));
  }
  const schema = read("supabase/schema.sql");
  const erase = schema.slice(schema.indexOf("create or replace function public.erase_studyos_account_items()"));
  assert.match(erase, /if to_regclass\('public\.studyos_push_reminders'\) is not null then\s*delete from public\.studyos_push_reminders where user_id = auth\.uid\(\);/);
  assert.ok(erase.indexOf("studyos_push_reminders") < erase.indexOf("get diagnostics"), "row_count resta quello di studyos_items");
  const settings = read("src/views/SettingsView.tsx");
  assert.match(settings, /if \(alsoCloud\) await import\("\.\.\/lib\/pushReminderSync"\)\.then\(\(module\) => module\.clearPushReminders\(\)\)/);
  const verify = read("supabase/push-reminders-verify.sql");
  for (const column of ["table_ready", "send_log_ready", "rls_ready", "policies_ready", "grants_ready", "guard_ready", "due_function_ready", "erase_ready", "pg_net_ready", "vault_ready", "cron_ready"]) {
    assert.match(verify, new RegExp(`as ${column}`));
  }
});
