// Registra gli hook di risoluzione TS (vedi ts-hooks.mjs) e verifica la versione di Node.
import { register } from "node:module";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `StudyOS scripts richiedono Node >= 22.18 (type stripping nativo). Versione attuale: ${process.versions.node}.`,
  );
  process.exit(1);
}

// Il type stripping è stabile ma Node emette ancora un ExperimentalWarning per ogni file .ts.
const originalEmit = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === "string" ? warning : warning?.message ?? "";
  if (/type stripping|Type Stripping/i.test(text)) return;
  return originalEmit.call(process, warning, ...args);
};

register("./ts-hooks.mjs", import.meta.url);
