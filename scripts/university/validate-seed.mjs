// Validazione offline di seed + overlay sincronizzato (nessuna rete, nessun Firecrawl).
// Usa la STESSA logica della PWA (merge + validateDataset in src/lib/university),
// non più controlli testuali sul sorgente TS (che contavano anche le righe di tipo).

import { getProvider, loadSeed, readSynced } from "./unimiProvider.mjs";
import { mergeUniversityDataset } from "../../src/lib/university/merge.ts";
import { validateDataset } from "../../src/lib/university/validate.ts";

export async function runValidation({ provider: providerKey = "barb" } = {}) {
  const provider = getProvider(providerKey);
  const seed = await loadSeed(provider);
  const synced = readSynced(provider);
  const dataset = mergeUniversityDataset(seed, synced);
  const issues = validateDataset(dataset);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  // Regole di dominio: mai dati inventati.
  const secondo = dataset.semesters.find((semester) => semester.id === "secondo");
  if (secondo && secondo.scheduleStatus !== "pubblicato" && dataset.courses.some((c) => c.semester === "secondo" && c.schedule.length)) {
    errors.push({ scope: "secondo", level: "error", field: "schedule", message: "Regole orarie per il 2° semestre ma orario dichiarato non pubblicato." });
  }
  for (const course of dataset.courses) {
    if (!course.provenance.retrievedAt || !course.provenance.lastVerifiedAt) {
      errors.push({ scope: course.id, level: "error", field: "provenance", message: "Provenienza incompleta." });
    }
  }

  return {
    provider: provider.key,
    overlay: synced ? { lastRun: synced.lastRun?.finishedAt ?? null, courses: Object.keys(synced.courses).length, teachers: synced.teachers.length } : null,
    courses: dataset.courses.length,
    teachers: dataset.teachers.length,
    semesters: dataset.semesters.map((semester) => ({ id: semester.id, startDate: semester.startDate, endDate: semester.endDate, status: semester.scheduleStatus })),
    errors,
    warnings,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runValidation();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length ? 1 : 0);
}
