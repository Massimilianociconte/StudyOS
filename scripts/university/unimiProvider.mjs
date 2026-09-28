// UNIMI Provider — configurazione per-corso + whitelist + I/O report.
// La whitelist NON è più duplicata: arriva da src/lib/university/officialSources.ts
// (la stessa usata dalla PWA e dalla validazione). Per un nuovo corso UNIMI basta
// aggiungere una voce in PROVIDERS con le sue pagine ufficiali e il suo seed.

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOfficialUnimiUrl } from "../../src/lib/university/officialSources.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CACHE_ROOT = join(ROOT, ".cache", "ai", "university");

export const isOfficial = (url) => isOfficialUnimiUrl(url);

export const PROVIDERS = {
  barb: {
    key: "barb",
    label: "BARB · Biologia applicata alla ricerca biomedica (LM-6 R)",
    degreeCode: "FBG",
    academicYear: "2026/2027",
    /** Coorte seguita (immatricolati 2026/2027 -> curriculum FBGof2) */
    cohortPattern: /Immatricolati nell'anno accademico 2026\/2027/i,
    idPrefix: "barb-26-27-",
    pages: {
      plan: "https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico",
      calendar: "https://barb.cdl.unimi.it/it/studiare/calendari-e-orari",
      contacts: "https://barb.cdl.unimi.it/it/il-corso/referenti-e-contatti",
    },
    easyAcademy: { academicYear: 2026, courseCode: "FBG" },
    seedModule: "../../src/data/university/barb.seed.ts",
    syncedFile: join(ROOT, "src", "data", "university", "barb.synced.json"),
  },
};

export function getProvider(key = "barb") {
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`Provider sconosciuto: ${key}. Disponibili: ${Object.keys(PROVIDERS).join(", ")}`);
  for (const url of Object.values(provider.pages)) {
    if (!isOfficial(url)) throw new Error(`URL non ufficiale nella configurazione: ${url}`);
  }
  return provider;
}

export async function loadSeed(provider) {
  const module = await import(new URL(provider.seedModule, import.meta.url).href);
  return module.BARB_SEED;
}

export function readSynced(provider) {
  if (!existsSync(provider.syncedFile)) return null;
  return JSON.parse(readFileSync(provider.syncedFile, "utf8"));
}

/** Scrittura atomica (tmp + rename): un'interruzione non lascia mai un JSON troncato. */
export function writeJsonAtomic(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}

export function runDir(id) {
  const dir = join(CACHE_ROOT, "runs", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function candidatePath(provider) {
  return join(CACHE_ROOT, `${provider.key}.candidate.json`);
}

/** Compatibilità con la vecchia API */
export function writeJsonLog(name, payload) {
  return writeJsonAtomic(join(CACHE_ROOT, name), payload);
}
