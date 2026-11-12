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

// ─── Collegamenti (sorgente) ───────────────────────────────────────────────

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("scheda aperta: stesso tag e stesso indirizzo della push; segna la riga solo se la notifica di sistema è comparsa", () => {
  const watcher = read("src/components/calendar/EventReminderWatcher.tsx");
  assert.match(watcher, /tag: reminderTagOf\(key\)/);
  assert.match(watcher, /data: \{ url: PUSH_REMINDER_URL \}/);
  assert.match(watcher, /if \(shown\) markShownOnServer\(item\.key\)/);
  assert.match(watcher, /import\("\.\.\/\.\.\/lib\/pushReminderSync"\)/, "supabase-js resta fuori dal pezzo del watcher");
  assert.match(watcher, /module\.startPushReminderSync\(\)/);
  assert.doesNotMatch(watcher, /from "\.\.\/\.\.\/lib\/pushReminderSync"/);
});

test("sincronizzazione: solo con un account, dopo un giro della sync di questa pagina, per l'account, a pezzi", () => {
  const sync = read("src/lib/pushReminderSync.ts");
  assert.match(sync, /if \(!userId\) return "signed-out"/, "ospite: niente");
  assert.match(sync, /cloud\.status !== "idle" \|\| !syncedSincePageStart\(cloud\.lastSync, PAGE_START_MS\)/);
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
  assert.match(sql, /v_pending >= 300/);
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
  for (const column of ["table_ready", "rls_ready", "policies_ready", "grants_ready", "guard_ready", "due_function_ready", "erase_ready", "pg_net_ready", "vault_ready", "cron_ready"]) {
    assert.match(verify, new RegExp(`as ${column}`));
  }
});
