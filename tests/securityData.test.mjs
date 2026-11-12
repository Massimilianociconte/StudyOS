import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Protezione dei dati (revisione B4, docs/security-data.md). Controlli sul testo degli script SQL e
// del client, senza database: le prove sul database stanno nel Postgres di prova (vedi il resoconto
// della revisione) e nelle colonne di supabase/verify.sql.
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlFiles = readdirSync(new URL("supabase/", root)).filter((name) => name.endsWith(".sql"));
const sql = Object.fromEntries(sqlFiles.map((name) => [name, read(`supabase/${name}`)]));
const allSql = Object.values(sql).join("\n");

/** Ogni `create function` degli script: nome, testo fuori dal corpo (intestazione e coda) e corpo. */
const functions = () => {
  const found = [];
  const pattern = /create (?:or replace )?function\s+(public\.\w+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$([^;]*);/gi;
  for (const [file, text] of Object.entries(sql)) {
    for (const match of text.matchAll(pattern)) {
      found.push({ file, name: match[1], outside: `${match[2]}\n${match[4]}`, body: match[3] });
    }
  }
  return found;
};

/** Gli otto ingressi che anon può chiamare (stesso elenco di anon_entry in verify.sql). */
const ANON_ENTRIES = [
  "public.studyos_agent_pull",
  "public.studyos_agent_push",
  "public.studyos_agent_audit_list",
  "public.studyos_agent_restore",
  "public.studyos_agent_restore_call",
  "public.studyos_agent_group_snapshot",
  "public.push_gone",
  "public.studyos_keepalive"
];

test("ogni funzione SECURITY DEFINER fissa il search_path", () => {
  const definers = functions().filter((fn) => /security definer/i.test(fn.outside));
  assert.ok(definers.length > 40, "trovate le funzioni definer degli script");
  const loose = definers.filter((fn) => !/set search_path\s*(=|to)/i.test(fn.outside)).map((fn) => `${fn.file}: ${fn.name}`);
  assert.deepEqual(loose, []);
});

test("ogni funzione SECURITY DEFINER è tolta ad anon, tranne gli otto ingressi con segreto o senza dati", () => {
  const names = [...new Set(functions().filter((fn) => /security definer/i.test(fn.outside)).map((fn) => fn.name))];
  const open = names.filter((name) => {
    if (ANON_ENTRIES.includes(name)) return false;
    const escaped = name.replace(".", "\\.");
    return !new RegExp(`revoke (?:all|execute) on function ${escaped}\\([^;]*\\) from [^;]*\\banon\\b`, "i").test(allSql);
  });
  assert.deepEqual(open, []);
});

test("verify.sql: controlli generici su ogni tabella studyos_ e ogni funzione definer, anche future", () => {
  const verify = sql["verify.sql"];
  for (const column of [
    "tables_rls_ready",
    "anon_closed_ready",
    "definer_functions_ready",
    "security_issues",
    "emails_hidden_ready",
    "erase_all_ready"
  ]) {
    assert.match(verify, new RegExp(`\\bas ${column}\\b`), column);
  }
  // Per nome, non per elenco: una tabella nuova (es. le sessioni d'esame dei gruppi) è già coperta.
  assert.match(verify, /c\.relname like 'studyos\\_%'/);
  assert.match(verify, /where n\.nspname = 'public' and p\.prosecdef/);
  assert.match(verify, /not relrowsecurity/);
  assert.match(verify, /has_table_privilege\(client_role\.name, rel\.rel_oid, 'TRUNCATE'\)/);
  for (const entry of ANON_ENTRIES) assert.ok(verify.includes(`to_regprocedure('${entry}(`), entry);
  // Le colonne di prima restano.
  for (const column of ["erase_rpc_ready", "files_bucket_ready", "file_read_ready", "stored_file_guard_ready"]) {
    assert.match(verify, new RegExp(`\\bas ${column}\\b`), column);
  }
});

test("«Cancella anche dall'account»: definer, limitata all'account, copre ogni tabella personale", () => {
  const erase = functions().find((fn) => fn.name === "public.erase_studyos_account_items");
  assert.ok(erase, "funzione presente in schema.sql");
  assert.match(erase.outside, /security definer/);
  assert.match(erase.outside, /set search_path = public/);
  assert.match(erase.body, /if auth\.uid\(\) is null then\s+raise exception/);
  for (const statement of [
    "delete from public.studyos_push_reminders where user_id = auth.uid();",
    "delete from public.studyos_item_revisions where owner_id = auth.uid();",
    "delete from public.studyos_shares where owner_id = auth.uid();",
    "delete from public.studyos_share_invites where owner_id = auth.uid();",
    "delete from public.studyos_agent_audit where user_id = auth.uid();",
    "delete from public.studyos_agent_grants where user_id = auth.uid();",
    "update public.studyos_profiles set display_name = '', handle = null",
    "delete from public.university_sync_reports where user_id = auth.uid();",
    "delete from public.studyos_items where user_id = auth.uid() and entity_type = 'snapshot';"
  ]) {
    assert.ok(erase.body.includes(statement), statement);
  }
  // Tabelle facoltative: ogni istruzione fuori da studyos_items solo se lo script è stato eseguito.
  const optional = erase.body.match(/to_regclass\('public\.\w+'\)/g) ?? [];
  assert.equal(optional.length, 8);
  // I gruppi restano: sono anche degli altri membri.
  assert.doesNotMatch(erase.body, /studyos_group/);
  // Nessun parametro: non si può cancellare un altro account.
  assert.match(sql["schema.sql"], /function public\.erase_studyos_account_items\(\)\s*\nreturns integer/);
  assert.match(sql["schema.sql"], /revoke all on function public\.erase_studyos_account_items\(\) from anon;/);
});

test("email dei membri e di chi accetta un link: mai salvate dove altri le leggono", () => {
  const groups = sql["groups.sql"];
  assert.match(groups, /create trigger studyos_group_members_no_email\s+before insert or update on public\.studyos_group_members/);
  assert.match(groups, /new\.email := null;/);
  assert.match(groups, /update public\.studyos_group_members set email = null where email is not null;/);
  const join = functions().find((fn) => fn.file === "groups.sql" && fn.name === "public.join_group_by_code");
  assert.doesNotMatch(join.body, /jwt\(\)|'email'|v_email/);
  assert.match(join.body, /values \(v_group\.id, auth\.uid\(\)::text, null, v_name, 'member'\)/);
  const accept = functions().find((fn) => fn.file === "sharing.sql" && fn.name === "public.accept_share_invite");
  assert.doesNotMatch(accept.body, /studyos_account_email/);
  assert.match(sql["sharing.sql"], /update public\.studyos_shares set grantee_email = null where grantee_email is not null;/);
  // Il client non manda più l'email del membro.
  const groupSync = read("src/lib/groupSync.ts");
  const membership = groupSync.slice(groupSync.indexOf("export const pushSharedMembership"));
  assert.match(membership.slice(0, 600), /email: null,/);
  assert.doesNotMatch(membership.slice(0, 600), /member\.email/);
});

test("nomi presi dall'email: pulizia una tantum in people.sql, segnata e senza email in uscita", () => {
  const people = sql["people.sql"];
  const helper = functions().find((fn) => fn.name === "public.studyos_name_without_email");
  assert.ok(helper, "funzione presente");
  assert.doesNotMatch(helper.outside, /security definer/);
  assert.match(people, /revoke all on function public\.studyos_name_without_email\(uuid, text\) from public, anon, authenticated;/);
  // Restituisce il nome di prima, quello del profilo o «Studente»: mai l'email o una sua parte.
  assert.match(helper.body, /return 'Studente';/);
  assert.match(helper.body, /return left\(v_profile, 80\);/);
  assert.doesNotMatch(helper.body, /return v_local/);
  for (const column of [
    "studyos_group_members m\n  set display_name",
    "studyos_groups g\n  set owner_display_name",
    "studyos_group_invites i\n  set from_display_name",
    "studyos_group_activity a\n  set actor_display_name",
    "set added_by_display_name",
    "studyos_shares s\n  set owner_name",
    "studyos_shares s\n  set grantee_name",
    "studyos_share_invites i\n  set owner_name"
  ]) {
    assert.ok(people.includes(column), column);
  }
  assert.match(people, /insert into public\.studyos_migrations \(name\) values \('names_from_email'\) on conflict \(name\) do nothing;/);
  // Il trigger di guardia delle risorse si riaccende nella stessa istruzione.
  assert.match(people, /disable trigger studyos_group_resources_guard;[\s\S]{0,600}enable trigger studyos_group_resources_guard;/);
  assert.match(sql["people-verify.sql"], /\bas email_names_ready\b/);
});

test("TRUNCATE (ignora la RLS) tolto ai client sulle tabelle con privilegi ampi", () => {
  assert.match(sql["schema.sql"], /revoke truncate, references, trigger on table public\.studyos_items from authenticated;/);
  assert.match(sql["groups.sql"], /revoke truncate, references, trigger on table[\s\S]{0,400}public\.studyos_group_activity\s+from authenticated;/);
  assert.match(sql["university.sql"], /revoke all on table public\.university_sync_reports from authenticated;/);
});

test("nessuna policy usa dati che il client può scrivere (user_metadata)", () => {
  const policies = allSql.match(/create policy[\s\S]*?;/gi) ?? [];
  assert.ok(policies.length > 20);
  const risky = policies.filter((policy) => /user_metadata|raw_user_meta_data|auth\.jwt\(\)/i.test(policy));
  assert.deepEqual(risky, []);
});

test("testo di «Cancella anche dall'account»: dice cosa sparisce e cosa resta", async () => {
  const { SETTINGS_TEXT } = await import("../src/lib/labels/settings.ts");
  const hint = SETTINGS_TEXT.erase.alsoCloudHint;
  assert.match(hint, /profilo online/);
  assert.match(hint, /condivisioni/);
  assert.match(hint, /connettore remoto/);
  assert.match(hint, /Restano i gruppi/);
  assert.match(hint, /Non si può annullare/);
});

test("docs/security-data.md: c'è, è collegato dall'indice e copre i punti richiesti", () => {
  const doc = read("docs/security-data.md");
  assert.match(read("docs/agent/INDEX.md"), /\(\.\.\/security-data\.md\)/);
  for (const heading of [
    "## Cosa si salva e dove",
    "## Chi può leggere",
    "## Cosa protegge la cifratura a riposo",
    "## Cosa toglie «Cancella anche dall'account»",
    "## Se perdi un dispositivo",
    "## Controlli sul database"
  ]) {
    assert.ok(doc.includes(heading), heading);
  }
  assert.match(doc, /FORCE ROW LEVEL SECURITY/);
  assert.match(read("supabase/README.md"), /\.\.\/docs\/security-data\.md/);
});
