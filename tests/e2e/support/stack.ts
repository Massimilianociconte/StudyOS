// Stack Supabase LOCALE per le prove end-to-end (porte 5542x, vedi scripts/supabase/local-stack.md).
// Tutto qui gira in Node (global setup, pulizia tra un test e l'altro): mai nel browser.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNTS } from "./accounts";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Solo lo stack locale di StudyOS: http://127.0.0.1:5542x. Mai il progetto reale, mai le porte 5432x. */
export const LOCAL_API = /^http:\/\/127\.0\.0\.1:5542\d$/;
/** Database dello stesso stack (porta 55422 di default): serve solo per azzerare i due account di prova. */
export const LOCAL_DB = /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:5542\d\/postgres$/;

export const DEFAULT_API = "http://127.0.0.1:55421";
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 5190);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

export const assertLocalApi = (url: string | undefined): string => {
  if (!url || !LOCAL_API.test(url)) {
    throw new Error(
      `Le prove end-to-end girano solo sullo stack Supabase locale (http://127.0.0.1:5542x). URL ricevuto: ${url ? JSON.stringify(url) : "nessuno"}.`
    );
  }
  return url;
};

export const stackDir = () => path.resolve(REPO_ROOT, process.env.E2E_SUPABASE_DIR ?? ".cache/ai/supabase-sharing");

export interface StackEnv {
  apiUrl: string;
  publishableKey: string;
  dbUrl: string;
}

/** `supabase status -o env` nella cartella dello stack. I valori non si stampano mai. */
export const readStackEnv = (): StackEnv => {
  const dir = stackDir();
  if (!existsSync(path.join(dir, "supabase", "config.toml"))) {
    throw new Error(`Cartella dello stack locale non trovata: ${dir}. Segui tests/e2e/README.md (Avviare lo stack).`);
  }
  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error(`«supabase status» non risponde in ${dir}: lo stack locale è avviato? (supabase start, vedi tests/e2e/README.md)`);
  }
  const values = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  const apiUrl = assertLocalApi(values.get("API_URL"));
  const publishableKey = values.get("PUBLISHABLE_KEY") ?? "";
  if (!publishableKey.startsWith("sb_publishable_")) throw new Error("Chiave publishable assente nell'output di «supabase status -o env».");
  const dbUrl = values.get("DB_URL") ?? "";
  if (!LOCAL_DB.test(dbUrl)) throw new Error("DB_URL dello stack non è locale (127.0.0.1:5542x): mi fermo.");
  return { apiUrl, publishableKey, dbUrl };
};

/** Esegue SQL sul database locale con psql (stesso strumento di scripts/supabase/local-stack.md). */
export const psql = (dbUrl: string, sql: string): string => {
  if (!LOCAL_DB.test(dbUrl)) throw new Error("Rifiuto di eseguire SQL fuori dallo stack locale.");
  return execFileSync("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
};

const emails = () => Object.values(ACCOUNTS).map((account) => `'${account.email.replace(/'/g, "''")}'`).join(", ");

/**
 * Azzera tutto ciò che i due account di prova hanno sul server (dati personali, gruppi, condivisioni,
 * inviti, cronologie). Gli account restano. Trigger spenti solo per questa sessione: le righe si
 * tolgono figlie prima dei genitori, senza voci di cronologia scritte dalla pulizia.
 */
export const resetAccounts = (dbUrl: string) => {
  psql(
    dbUrl,
    `
begin;
set local session_replication_role = replica;
create temp table e2e_users on commit drop as select id::text as id from auth.users where email in (${emails()});
create temp table e2e_groups on commit drop as
  select g.id::text as id from public.studyos_groups g where g.owner_id::text in (select id from e2e_users)
  union select m.group_id::text from public.studyos_group_members m where m.user_id::text in (select id from e2e_users);
delete from public.studyos_group_activity where group_id::text in (select id from e2e_groups) or actor_user_id::text in (select id from e2e_users);
delete from public.studyos_group_resources where group_id::text in (select id from e2e_groups) or added_by_user_id::text in (select id from e2e_users);
delete from public.studyos_group_invites where group_id::text in (select id from e2e_groups) or from_user_id::text in (select id from e2e_users)
  or lower(recipient_email) in (${emails()});
delete from public.studyos_group_members where group_id::text in (select id from e2e_groups) or user_id::text in (select id from e2e_users);
delete from public.studyos_groups where id::text in (select id from e2e_groups);
delete from public.studyos_shares where owner_id::text in (select id from e2e_users) or grantee_user_id::text in (select id from e2e_users)
  or grantee_group_id::text in (select id from e2e_groups);
delete from public.studyos_share_invites where owner_id::text in (select id from e2e_users) or accepted_by::text in (select id from e2e_users)
  or lower(recipient_email) in (${emails()});
delete from public.studyos_item_revisions where owner_id::text in (select id from e2e_users) or changed_by::text in (select id from e2e_users);
delete from public.studyos_items where user_id::text in (select id from e2e_users);
commit;
`
  );
};

/** Le migrazioni dei gruppi e della condivisione ci sono? (Altrimenti le prove fallirebbero per un motivo sbagliato.) */
export const assertSchemaReady = (dbUrl: string) => {
  const ready = psql(
    dbUrl,
    `select (to_regclass('public.studyos_items') is not null)
       and (to_regclass('public.studyos_groups') is not null)
       and (to_regclass('public.studyos_shares') is not null)
       and exists (select 1 from pg_proc where proname = 'erase_studyos_account_items')
       and exists (select 1 from pg_trigger where tgname = 'studyos_group_member_left')`
  );
  if (ready !== "t") {
    throw new Error(
      "Lo stack locale non ha lo schema completo: applica supabase/schema.sql, groups.sql e sharing.sql (vedi tests/e2e/README.md)."
    );
  }
};

/** Crea i due account di prova se mancano (stack locale: nessuna conferma email). */
export const ensureAccounts = async ({ apiUrl, publishableKey }: StackEnv) => {
  for (const account of Object.values(ACCOUNTS)) {
    const headers = { apikey: publishableKey, "Content-Type": "application/json" };
    const body = JSON.stringify({ email: account.email, password: account.password });
    const signIn = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers, body });
    if (signIn.ok) continue;
    const signUp = await fetch(`${apiUrl}/auth/v1/signup`, { method: "POST", headers, body });
    if (!signUp.ok) throw new Error(`Account di prova non creato (${account.label}): HTTP ${signUp.status}.`);
    const retry = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers, body });
    if (!retry.ok) throw new Error(`Accesso non riuscito con l'account di prova ${account.label} appena creato: HTTP ${retry.status}.`);
  }
};

/** Quante righe vive (non eliminate) ha un account per tipo di entità: per i controlli lato server. */
export const liveItemCount = (dbUrl: string, email: string, entityType: string) =>
  Number(
    psql(
      dbUrl,
      `select count(*) from public.studyos_items i join auth.users u on u.id::text = i.user_id::text
        where u.email = '${email.replace(/'/g, "''")}' and i.entity_type = '${entityType.replace(/'/g, "''")}' and not i.deleted`
    )
  );
