#!/usr/bin/env node
// Genera le chiavi delle notifiche push di StudyOS:
// - coppia VAPID P-256: la pubblica va in src/lib/pushKeys.ts (nel commit), la privata solo nel
//   secret STUDYOS_VAPID_PRIVATE_KEY del Worker;
// - segreto condiviso di 32 byte tra database (Vault `studyos_push_secret`) e Worker
//   (secret STUDYOS_PUSH_SECRET).
// Chiave privata e segreto si stampano SOLO qui nel terminale, insieme ai comandi pronti.
//
// Uso: node scripts/push-keys.mjs [--worker https://studyos-agent.<account>.workers.dev] [--rigenera] [--file <percorso>]
//   --rigenera  sostituisce una chiave già presente (le iscrizioni esistenti smettono di funzionare
//               finché ogni dispositivo non si iscrive di nuovo)
//   --file      scrive altrove (prove con chiavi usa e getta)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_WORKER = "https://studyos-agent.nexify-api.workers.dev";
const SUPABASE_URL = "https://kobmoygkwzlprhgfkzwh.supabase.co";
const EXISTING_KEY = /VAPID_PUBLIC_KEY\s*=\s*"([A-Za-z0-9_-]{87})"/;

const { values } = parseArgs({
  options: {
    worker: { type: "string", default: DEFAULT_WORKER },
    file: { type: "string" },
    rigenera: { type: "boolean", default: false }
  }
});

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let workerOrigin;
try {
  const url = new URL(values.worker);
  if (url.protocol !== "https:" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username) throw new Error();
  workerOrigin = url.origin;
} catch {
  fail(`--worker deve essere un'origine https senza percorso, per esempio ${DEFAULT_WORKER}`);
}

const target = values.file ?? fileURLToPath(new URL("../src/lib/pushKeys.ts", import.meta.url));
if (existsSync(target) && EXISTING_KEY.test(readFileSync(target, "utf8")) && !values.rigenera) {
  fail(
    `${relative(process.cwd(), target)} contiene già una chiave VAPID. Non la cambio: le iscrizioni esistenti smetterebbero di funzionare.\n` +
      "Per sostituirla davvero (e reimpostare tutti i segreti) rilancia con --rigenera."
  );
}

const b64u = (bytes) => Buffer.from(bytes).toString("base64url");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const { d: privateKey } = await crypto.subtle.exportKey("jwk", pair.privateKey);
const pushSecret = b64u(crypto.getRandomValues(new Uint8Array(32)));
const pushUrl = `${workerOrigin}/push`;

if (publicKey.length !== 87 || privateKey.length !== 43 || pushSecret.length !== 43) fail("Generazione delle chiavi non riuscita.");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  `// Chiave pubblica VAPID di StudyOS (RFC 8292): base64url del punto P-256 non compresso (65 byte).
// È pubblica: il browser la usa per iscriversi alle push, il Worker per firmarle.
// La chiave privata sta solo nel secret STUDYOS_VAPID_PRIVATE_KEY del Worker.
// Generata da \`node scripts/push-keys.mjs\` il ${new Date().toISOString().slice(0, 10)}: cambiarla invalida le iscrizioni esistenti.
export const VAPID_PUBLIC_KEY = "${publicKey}";
`
);

const vaultSql = `do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'studyos_push_secret';
  if v_id is null then
    perform vault.create_secret('${pushSecret}', 'studyos_push_secret', 'StudyOS: segreto condiviso con il Worker /push');
  else
    perform vault.update_secret(v_id, '${pushSecret}');
  end if;

  select id into v_id from vault.secrets where name = 'studyos_push_url';
  if v_id is null then
    perform vault.create_secret('${pushUrl}', 'studyos_push_url', 'StudyOS: indirizzo del Worker /push');
  else
    perform vault.update_secret(v_id, '${pushUrl}');
  end if;
end
$$;`;

const wrangler = (name) => `   npx wrangler secret put ${name} -c worker/wrangler.jsonc`;

console.log(`StudyOS: chiavi per le notifiche push

Chiave pubblica VAPID scritta in ${relative(process.cwd(), target)} (va nel commit):
  ${publicKey}

Da qui in giù ci sono segreti: non salvarli in file del repository e non incollarli nella chat con l'agente.

  STUDYOS_VAPID_PRIVATE_KEY  ${privateKey}
  STUDYOS_PUSH_SECRET        ${pushSecret}

1) Worker studyos-agent: chiedi il via prima di eseguirli (ognuno pubblica una nuova versione del Worker).
   Ogni comando chiede il valore: incollalo quando lo chiede, così non resta nella cronologia della shell.

   valore: STUDYOS_PUSH_SECRET qui sopra
${wrangler("STUDYOS_PUSH_SECRET")}
   valore: STUDYOS_VAPID_PRIVATE_KEY qui sopra
${wrangler("STUDYOS_VAPID_PRIVATE_KEY")}
   valore: ${SUPABASE_URL}
${wrangler("STUDYOS_SUPABASE_URL")}
   valore: la chiave sb_publishable_ (VITE_SUPABASE_PUBLISHABLE_KEY nel tuo .env), mai la service_role
${wrangler("STUDYOS_SUPABASE_KEY")}

2) Vault del progetto: SQL Editor di Supabase, chiedi il via. Rieseguibile: se il nome esiste aggiorna il valore.

${vaultSql}

Controlla che il Worker risponda su ${pushUrl}: se l'indirizzo è un altro, correggilo nel blocco SQL prima di eseguirlo.`);
