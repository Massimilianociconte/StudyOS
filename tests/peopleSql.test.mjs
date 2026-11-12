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

test("SQL delle push: pg_net e Vault sono facoltativi, le notifiche non bloccano mai la scrittura", () => {
  // Senza pg_net lo script si applica lo stesso (provato su un Postgres senza estensioni).
  assert.match(people, /pg_net non disponibile, notifiche push spente/);
  const notify = blockOf(people, "create or replace function public.studyos_push_notify(", "\n$$;\n");
  assert.match(notify, /exception when others/);
  assert.match(people, /revoke all on function public\.studyos_push_notify\(uuid\[\], text, text, text, text, text\) from public/);
});
