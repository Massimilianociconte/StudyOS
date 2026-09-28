// CLI sincronizzazione dati universitari (Firecrawl OSS locale, nessun cloud).
//
//   npm run barb:sync                      pipeline completa -> report + candidato (nessuna scrittura)
//   npm run barb:sync -- --apply           ...e applica l'overlay se la validazione passa
//   npm run barb:sync:schedule             solo date semestri + portale orari EasyAcademy
//   npm run barb:sync:courses              solo piano didattico (CFU, SSD, semestri, gruppi)
//   npm run barb:sync:teachers             schede insegnamento + docenti (email, ricevimento)
//   npm run barb:sync:contacts             referenti, tutor e contatti del corso
//   npm run barb:sync -- --scope teachers --course "Anatomia dell'uomo"   un singolo corso
//   npm run barb:check-updates             confronta gli hash delle pagine ufficiali
//   npm run barb:apply                     applica l'ultimo candidato dopo la revisione
//   npm run barb:status                    stato overlay + Firecrawl
//   npm run barb:validate                  validazione offline di seed + overlay
//   npm run firecrawl:up                   avvia lo stack docker locale e attende l'API
//
// Opzioni: --fresh (ignora cache) · --cache-ttl 2h · --concurrency 4 · --autostart
//          (avvia Firecrawl se spento) · --offline · --force · --json · --exit-code

await import("./lib/register-ts.mjs");

const [, , cmd = "help", ...rest] = process.argv;

const flags = {};
for (let index = 0; index < rest.length; index += 1) {
  const arg = rest[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = rest[index + 1];
  if (next !== undefined && !next.startsWith("--")) {
    flags[key] = next;
    index += 1;
  } else {
    flags[key] = true;
  }
}

const parseDuration = (value) => {
  if (value === undefined || value === true) return undefined;
  const match = String(value).match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
  if (!match) throw new Error(`Durata non valida: ${value} (es. 30m, 2h, 0)`);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? "m"];
  return Number(match[1]) * unit;
};

const scopeFromFlags = () => {
  if (typeof flags.scope === "string") return flags.scope;
  for (const scope of ["schedule", "teachers", "courses", "contacts"]) if (flags[scope]) return scope;
  return "all";
};

const quiet = Boolean(flags.json);
const log = (message) => {
  if (!quiet) console.log(message);
};

const printSummary = (report) => {
  if (quiet) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const errors = report.errors.length;
  console.log("");
  console.log(`Sync ${report.provider} · ${report.scope} — ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log(`  pagine: ${report.pages.length} (${report.pages.filter((p) => p.fromCache).length} da cache) · errori: ${errors}`);
  if (report.scope === "check-updates") {
    console.log(`  pagine cambiate/nuove: ${report.updates.length}`);
    for (const update of report.updates) {
      console.log(`   - [${update.status}] ${update.url}`);
      if (update.diff) {
        for (const line of update.diff.removed.slice(0, 2)) console.log(`       − ${line}`);
        for (const line of update.diff.added.slice(0, 2)) console.log(`       + ${line}`);
      }
    }
  } else {
    console.log(`  modifiche vs overlay attuale: ${report.changes.length}`);
    const bySection = report.changes.reduce((acc, change) => ({ ...acc, [change.section]: (acc[change.section] ?? 0) + 1 }), {});
    for (const [section, count] of Object.entries(bySection)) console.log(`   - ${section}: ${count}`);
  }
  console.log(`  validazione: ${report.validation.errors.length} errori · ${report.validation.warnings.length} avvisi`);
  for (const note of report.notes) console.log(`  • ${note}`);
  for (const error of report.errors.slice(0, 10)) console.log(`  ✗ [${error.stage}] ${error.url ?? ""} ${error.message}`);
  if (report.applied) console.log("  ✓ overlay applicato: src/data/university/barb.synced.json");
  else if (report.applyBlockedReason) console.log(`  ⚠ non applicato: ${report.applyBlockedReason}`);
  else if (report.candidatePath && report.changes.length) console.log(`  → revisiona ${report.reportPath} poi: npm run barb:apply`);
  console.log(`  report: ${report.reportPath}`);
};

try {
  switch (cmd) {
    case "sync":
    case "check-updates": {
      const { runSync } = await import("./university/pipeline.mjs");
      const report = await runSync({
        provider: flags.provider ?? "barb",
        scope: cmd === "check-updates" ? "check-updates" : scopeFromFlags(),
        course: typeof flags.course === "string" ? flags.course : undefined,
        apply: Boolean(flags.apply),
        force: Boolean(flags.force),
        fresh: Boolean(flags.fresh),
        cacheTtlMs: parseDuration(flags["cache-ttl"]),
        concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
        offline: Boolean(flags.offline),
        autostart: Boolean(flags.autostart) || process.env.FIRECRAWL_AUTOSTART === "1",
        log,
      });
      printSummary(report);
      const crawlDown = report.errors.some((error) => error.stage === "crawl" && /non raggiungibile/.test(error.message));
      if (crawlDown || report.errors.length || report.validation.errors.length || (flags.apply && !report.applied)) process.exit(1);
      if (flags["exit-code"] && report.scope === "check-updates" && report.updates.length) process.exit(2);
      process.exit(0);
    }
    case "apply": {
      const { applyCandidate } = await import("./university/pipeline.mjs");
      const result = await applyCandidate({ provider: flags.provider ?? "barb", file: typeof flags.file === "string" ? flags.file : undefined, force: Boolean(flags.force) });
      if (!result.applied) {
        console.error(`Candidato NON applicato: ${result.errors.length} errori di validazione.`);
        for (const error of result.errors.slice(0, 20)) console.error(`  ✗ ${error.scope} · ${error.field}: ${error.message}`);
        process.exit(1);
      }
      console.log(`✓ Overlay applicato (${result.changes.length} modifiche) da ${result.path}`);
      process.exit(0);
    }
    case "validate": {
      const { runValidation } = await import("./university/validate-seed.mjs");
      const result = await runValidation({ provider: flags.provider ?? "barb" });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors.length ? 1 : 0);
    }
    case "status": {
      const { getProvider, readSynced } = await import("./university/unimiProvider.mjs");
      const { checkHealth } = await import("./university/firecrawlLocal.mjs");
      const provider = getProvider(flags.provider ?? "barb");
      const synced = readSynced(provider);
      const health = await checkHealth();
      console.log(
        JSON.stringify(
          {
            provider: provider.key,
            firecrawl: health,
            overlay: synced
              ? {
                  lastRun: synced.lastRun,
                  cohort: synced.cohort,
                  courses: Object.keys(synced.courses).length,
                  teachers: synced.teachers.length,
                  semesters: synced.semesters.map((s) => `${s.id}: ${s.startDate} → ${s.endDate} (${s.scheduleStatus ?? "?"})`),
                  timetable: synced.timetable,
                  sources: Object.keys(synced.sources).length,
                }
              : "nessun overlay applicato (solo seed)",
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }
    case "firecrawl-up": {
      const { ensureFirecrawl } = await import("./university/firecrawlLocal.mjs");
      const health = await ensureFirecrawl({ autostart: true, log: console.log });
      console.log(JSON.stringify(health, null, 2));
      process.exit(health.ok ? 0 : 1);
    }
    case "firecrawl-health": {
      const { checkHealth } = await import("./university/firecrawlLocal.mjs");
      const health = await checkHealth();
      console.log(JSON.stringify(health, null, 2));
      process.exit(health.ok ? 0 : 1);
    }
    default:
      console.log(`Uso:
  node scripts/barb.mjs sync [--scope all|courses|teachers|schedule|contacts] [--course <nome>] [--apply] [--fresh]
  node scripts/barb.mjs check-updates [--exit-code]
  node scripts/barb.mjs apply [--file <candidato.json>] [--force]
  node scripts/barb.mjs status | validate | firecrawl-up | firecrawl-health`);
      process.exit(cmd === "help" ? 0 : 1);
  }
} catch (error) {
  console.error(`Errore: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
