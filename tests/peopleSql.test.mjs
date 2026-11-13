import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Le policy e le funzioni sugli inviti nominali sono copiate identiche in groups.sql, sharing.sql e
// people.sql: rieseguire uno qualsiasi dei tre non deve riaprire l'accettazione per email né togliere
// la revisione del 12/11/2026 (una sola voce «è entrato nel gruppo»). Stesso elenco di
// scripts/supabase/people-check.mjs, qui senza lo stack locale.
const read = (name) => readFileSync(new URL(`../supabase/${name}`, import.meta.url), "utf8");
const people = read("people.sql");
const sources = { "groups.sql": read("groups.sql"), "sharing.sql": read("sharing.sql") };

const blockOf = (text, start, end) => {
  const from = text.indexOf(start);
  const to = from < 0 ? -1 : text.indexOf(end, from + start.length);
  return to < 0 ? "" : text.slice(from, to + end.length);
};

const BLOCKS = [
  ["groups.sql", "alter table public.studyos_group_invites add column if not exists recipient_user_id", "\n"],
  ["groups.sql", "create policy studyos_group_invites_select ", ";\n"],
  ["groups.sql", "create policy studyos_group_invites_insert ", ";\n"],
  ["groups.sql", "create or replace function public.accept_group_invite(", "\n$$;\n"],
  ["groups.sql", "create or replace function public.decline_group_invite(", "\n$$;\n"],
  ["sharing.sql", "alter table public.studyos_share_invites\n  add column if not exists recipient_user_id", ";\n"],
  ["sharing.sql", "create policy studyos_share_invites_select ", ";\n"],
  ["sharing.sql", "create or replace function public.create_share_invite(", "\n$$;\n"],
  ["sharing.sql", "create or replace function public.preview_share_invite(", "\n$$;\n"],
  ["sharing.sql", "create or replace function public.studyos_claim_share_invite(", "\n$$;\n"]
];

test("SQL degli inviti: stesso testo in groups.sql, sharing.sql e people.sql", () => {
  for (const [file, start, end] of BLOCKS) {
    const block = blockOf(sources[file], start, end);
    assert.notEqual(block, "", `blocco non trovato in ${file}: ${start}`);
    assert.ok(people.includes(block), `testo diverso tra ${file} e people.sql: ${start}`);
  }
});

test("SQL degli inviti: solo l'account destinatario accetta, una voce per ingresso, membro senza email", () => {
  for (const [name, text] of [["groups.sql", sources["groups.sql"]], ["people.sql", people]]) {
    const accept = blockOf(text, "create or replace function public.accept_group_invite(", "\n$$;\n");
    assert.match(accept, /v_invite\.recipient_user_id is distinct from auth\.uid\(\)::text/, name);
    assert.doesNotMatch(accept, /recipient_email/, name);
    // Revisione del 12/11/2026: niente seconda voce per chi era già membro.
    assert.match(accept, /get diagnostics v_added = row_count;\s+[^]*if v_added > 0 then/, name);
    assert.doesNotMatch(accept, /'activity-' \|\| p_invite_id/, name);
    // Prima si chiude l'invito, poi entra il membro (il trigger delle push trova chi aveva invitato).
    assert.ok(accept.indexOf("set status = 'accepted'") < accept.indexOf("insert into public.studyos_group_members"), name);
    assert.match(accept, /values \(v_invite\.group_id, auth\.uid\(\)::text, null, v_name, 'member'\)/, name);
  }
  // L'inserimento diretto resta solo per gli inviti con codice.
  const insert = blockOf(sources["groups.sql"], "create policy studyos_group_invites_insert ", ";\n");
  assert.match(insert, /recipient_email is null/);
  assert.match(insert, /recipient_user_id is null/);
});

test("SQL: il nome di chi entra in un gruppo non viene mai dall'email", () => {
  const groups = sources["groups.sql"];
  const helper = blockOf(groups, "create or replace function public.studyos_member_name(", "\n$$;\n");
  assert.notEqual(helper, "");
  // Il corpo non legge p_email: nome mandato dall'app, poi profilo online, poi «Studente».
  const body = helper.slice(helper.indexOf("as $$"));
  assert.doesNotMatch(body, /p_email|split_part|'@'/);
  assert.match(body, /from public\.studyos_profiles p/);
  assert.match(body, /coalesce\(v_name, 'Studente'\)/);
  assert.match(groups, /revoke all on function public\.studyos_member_name\(text, text\) from public, anon, authenticated;/);
  // Accettare un invito (groups.sql e people.sql) ed entrare con il codice passano null, non l'email.
  const accept = blockOf(people, "create or replace function public.accept_group_invite(", "\n$$;\n");
  const join = blockOf(groups, "create or replace function public.join_group_by_code(", "\n$$;\n");
  for (const [name, block] of [["accept_group_invite", accept], ["join_group_by_code", join]]) {
    assert.match(block, /v_name text := public\.studyos_member_name\(p_display_name, null\);/, name);
  }
  for (const text of [groups, people]) assert.doesNotMatch(text, /:= public\.studyos_member_name\([^)]*email/);
});

test("SQL: un invito a una persona non porta il codice del gruppo", () => {
  const invite = blockOf(people, "create or replace function public.invite_person_to_group(", "\n$$;\n");
  assert.match(invite, /null, p_person_id::text, '', 'pending'/);
  assert.doesNotMatch(invite, /invite_code/);
  // Gli inviti già scritti con il codice lo perdono; idempotente.
  assert.match(people, /update public\.studyos_group_invites\nset code = ''\nwhere code <> '' and \(recipient_user_id is not null or recipient_email is not null\);/);
});

test("SQL: il limite per IP usa solo cf-connecting-ip, mai x-forwarded-for", () => {
  const ip = blockOf(people, "create or replace function public.studyos_request_ip(", "\n$$;\n");
  assert.match(ip, /request\.headers ->> 'cf-connecting-ip'/);
  const code = ip.slice(ip.indexOf("as $$"));
  assert.doesNotMatch(code, /x-forwarded-for|x-real-ip/);
});

test("SQL: la migrazione lega un vecchio invito per email solo a un indirizzo confermato prima dell'11/11", () => {
  const migration = blockOf(people, "-- ─── Migrazione una tantum: inviti pendenti per sola email → account", "end $$;\n");
  assert.notEqual(migration, "");
  assert.match(migration, /v_cutoff constant timestamptz := timestamptz '2026-11-11 00:00:00\+01';/);
  // Legame: entrambe le tabelle chiedono la conferma prima della data.
  const bind = migration.slice(0, migration.indexOf("insert into public.studyos_migrations"));
  assert.equal(bind.match(/email_confirmed_at < v_cutoff/g)?.length, 2);
  // Controllo fuori dal segno (gira sempre): scioglie i legami verso account che non passano la regola.
  const check = migration.slice(migration.indexOf("end if;"));
  assert.equal(check.match(/set recipient_user_id = null/g)?.length, 2);
  assert.equal(check.match(/u\.deleted_at is null and u\.email_confirmed_at < v_cutoff/g)?.length, 2);
  assert.match(check, /where i\.status = 'pending' and i\.recipient_email is not null and i\.recipient_user_id is not null/);
});

test("SQL delle push: pg_net e Vault sono facoltativi, le notifiche non bloccano mai la scrittura", () => {
  // Senza pg_net lo script si applica lo stesso (provato su un Postgres senza estensioni).
  assert.match(people, /pg_net non disponibile, notifiche push spente/);
  const notify = blockOf(people, "create or replace function public.studyos_push_notify(", "\n$$;\n");
  assert.match(notify, /exception when others/);
  assert.match(people, /revoke all on function public\.studyos_push_notify\(uuid\[\], text, text, text, text, text\) from public/);
});

test("SQL delle push (revisione finale M-1, L-1): password dell'app → testo generico; lotti da 15", () => {
  const notify = blockOf(people, "create or replace function public.studyos_push_notify(", "\n$$;\n");
  // Lotti separati per `private`, come il job dei promemoria (push-reminders.sql).
  assert.match(notify, /for v_batch, v_private in/);
  assert.match(notify, /row_number\(\) over \(partition by sub\.private order by sub\.user_id, sub\.created_at, sub\.id\) as rn/);
  assert.match(notify, /group by s\.private, \(s\.rn - 1\) \/ 15\n\s+order by s\.private, \(s\.rn - 1\) \/ 15/);
  assert.doesNotMatch(notify, /\/ 40/, "niente più lotti da 40 (CPU del Worker sul piano Free)");
  // Solo titolo e testo cambiano: url, tag e tipo restano quelli della notifica.
  assert.match(notify, /'notification', case when v_private\n\s+then v_notification \|\| jsonb_build_object\('title', 'StudyOS', 'body', 'Hai una nuova notifica\.'\)\n\s+else v_notification end/);
  assert.match(notify, /'account', s\.user_id/, "l'account resta in ogni iscrizione (filtro del service worker)");
  // Ogni trigger delle persone passa da qui: nessuno chiama net.http_post da sé.
  for (const trigger of ["studyos_push_group_invite", "studyos_push_share_invite", "studyos_push_share_accepted",
    "studyos_push_group_join", "studyos_push_share_permission", "studyos_push_share_removed"]) {
    const body = blockOf(people, `create or replace function public.${trigger}(`, "\n$$;\n");
    assert.match(body, /perform public\.studyos_push_notify\(/, trigger);
    assert.doesNotMatch(body, /net\.http_post/, trigger);
  }
  assert.equal(people.match(/net\.http_post\(/g)?.length, 1, "un solo invio, in studyos_push_notify");
  const verify = readFileSync(new URL("../supabase/people-verify.sql", import.meta.url), "utf8");
  assert.match(verify, /like '%when v_private%Hai una nuova notifica\.%', false\)/);
  assert.match(verify, /like '%group by s\.private, \(s\.rn - 1\) \/ 15%', false\) as push_private_ready,/);
});
