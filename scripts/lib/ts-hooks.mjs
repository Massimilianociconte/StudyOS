// Module hooks che permettono a Node (>= 22.18, type stripping nativo) di importare
// direttamente i moduli TypeScript di `src/` usati anche dal frontend, con import
// senza estensione ("./normalize" -> "./normalize.ts"). Nessuna dipendenza extra:
// script CLI e test riusano ESATTAMENTE la stessa logica (whitelist, normalize,
// validate, seed) della PWA, senza copie divergenti.
//
// Uso: node --import ./scripts/lib/register-ts.mjs <script>

import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CANDIDATES = [".ts", ".tsx", "/index.ts"];

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const fromTs = context.parentURL?.endsWith(".ts") || context.parentURL?.endsWith(".tsx");
  if (relative && fromTs && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    for (const ext of CANDIDATES) {
      const url = new URL(specifier + ext, context.parentURL);
      const path = fileURLToPath(url);
      if (existsSync(path) && isFile(path)) {
        return nextResolve(url.href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
