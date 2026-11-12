// Genera scripts/supabase/email-vectors-tests.sql da tests/fixtures/emailVectors.json (la stessa tabella
// di esempi usata dai test TypeScript): `node scripts/supabase/gen-email-vectors.mjs`.
// tests/institutionalEmail.test.mjs controlla che il file generato sia aggiornato.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../tests/fixtures/emailVectors.json", import.meta.url)), "utf8")).vectors;

/** Stringa SQL E'…' con ogni carattere non ASCII scritto come \uXXXX (nessun problema di codifica). */
export const sqlText = (value) => {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (code < 0x20 || code > 0x7e) out += code > 0xffff ? `\\U${code.toString(16).padStart(8, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `E'${out}'`;
};

export const buildSql = () => {
  const lines = [
    "-- GENERATO da scripts/supabase/gen-email-vectors.mjs da tests/fixtures/emailVectors.json: non modificarlo a mano.",
    "-- Stessi esempi dei test TypeScript (tests/institutionalEmail.test.mjs): la regola sulle email non può divergere.",
    "\\set ON_ERROR_STOP 1",
    "\\pset tuples_only on",
    "\\pset format unaligned",
    "begin;",
    "create function pg_temp.vec(p_name text, p_ok boolean) returns text language plpgsql as $$",
    "begin",
    "  if p_ok is distinct from true then raise exception 'FALLITO: vettore %', p_name; end if;",
    "  return 'ok vettore ' || p_name;",
    "end $$;"
  ];
  vectors.forEach((v, i) => {
    const id = sqlText(`${i + 1} ${v.name}`);
    const input = sqlText(v.input);
    lines.push(`select pg_temp.vec(${id} || ' (nascondi)', public.studyos_hide_emails(${input}, false) = ${sqlText(v.hide)});`);
    lines.push(`select pg_temp.vec(${id} || ' (tieni unimi)', public.studyos_hide_emails(${input}, true) = ${sqlText(v.keep)});`);
    lines.push(`select pg_temp.vec(${id} || ' (solo unimi)', public.studyos_only_unimi_emails(${input}) is ${v.only ? "true" : "false"});`);
  });
  lines.push("rollback;", "\\echo 'email-vectors-tests: tutto ok'", "");
  return lines.join("\n");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(`${here}email-vectors-tests.sql`, buildSql());
}
