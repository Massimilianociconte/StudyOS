// Pipeline UNIMI su richiesta, 100% locale:
//   Discovery (config provider) -> Firecrawl OSS locale (cache + retry + concorrenza)
//   -> parser (src/lib/university/parsers.ts) -> riconciliazione con il seed
//   -> validazione dell'intero dataset -> diff contro l'overlay attuale
//   -> report JSON + Markdown -> (--apply) scrittura atomica di barb.synced.json.
//
// Il seed resta la base verificata a mano; lo scraping non sovrascrive mai nulla da solo:
// senza --apply produce solo report + candidato (.cache/ai/university/<provider>.candidate.json).

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ensureFirecrawl, scrapeMany, FIRECRAWL_BASE } from "./firecrawlLocal.mjs";
import { findCourse, findYearCodes, fetchLessons, lessonsToRules } from "./easyAcademy.mjs";
import {
  ROOT,
  candidatePath,
  getProvider,
  isOfficial,
  loadSeed,
  readSynced,
  runDir,
  writeJsonAtomic,
} from "./unimiProvider.mjs";
import {
  parseContactsPage,
  parseCoursePage,
  parsePersonPage,
  parsePianoDidattico,
  parseSemesterDates,
  planCohortToCourses,
  stripBoilerplate,
} from "../../src/lib/university/parsers.ts";
import { slugifyCourse } from "../../src/lib/university/normalize.ts";
import { emptySyncedData, mergeUniversityDataset } from "../../src/lib/university/merge.ts";
import { validateDataset } from "../../src/lib/university/validate.ts";

export const SCOPES = ["all", "courses", "teachers", "schedule", "contacts", "check-updates"];

const sha = (value) => createHash("sha256").update(value).digest("hex");
export const pageHash = (markdown) => sha(stripBoilerplate(markdown ?? ""));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const nowIso = () => new Date().toISOString();

const provenance = (url, sourceType, fetchedAt, contentHash, confidence = 0.95, note) => ({
  sourceUrl: url,
  sourceType,
  retrievedAt: fetchedAt,
  lastVerifiedAt: nowIso(),
  officialSource: isOfficial(url),
  confidence,
  contentHash,
  ...(note ? { provenanceNote: note } : {}),
});

const teacherIdFromUrl = (url) => {
  const slug = url?.match(/\/ugov\/(?:person|rubrica)\/([^/?#]+)/)?.[1];
  return slug ? `unimi-${slug}` : null;
};

const scopeIncludes = (scope, part) => scope === "all" || scope === part;

/** Controlla anche la destinazione finale: Firecrawl può seguire redirect esterni. */
export function acceptOfficialPage(doc) {
  if (!doc.ok) return doc;
  const finalUrl = doc.finalUrl ?? doc.url;
  if (finalUrl.startsWith("https://") && isOfficial(finalUrl)) return doc;
  return {
    ...doc,
    ok: false,
    markdown: "",
    links: [],
    error: `Redirect verso URL non ufficiale o non HTTPS: ${finalUrl}`,
  };
}

/** Il file candidato è un artefatto revisionabile, ma può essere scelto con --file. */
export function validateCandidateEnvelope(candidate, providerKey) {
  const issue = (field, message) => ({ level: "error", scope: "candidate", field, message });
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return [issue("format", "Il candidato deve essere un oggetto JSON.")];
  }
  const errors = [];
  if (candidate.version !== 1) errors.push(issue("version", "Versione overlay non supportata."));
  if (candidate.provider !== providerKey) errors.push(issue("provider", `Provider atteso: ${providerKey}.`));
  for (const field of ["semesters", "addedCourses", "missingCourseIds", "teachers", "roles", "contacts"]) {
    if (!Array.isArray(candidate[field])) errors.push(issue(field, "Campo array mancante o non valido."));
  }
  for (const field of ["courses", "sources", "timetable"]) {
    if (!candidate[field] || typeof candidate[field] !== "object" || Array.isArray(candidate[field])) {
      errors.push(issue(field, "Campo oggetto mancante o non valido."));
    }
  }
  return errors;
}

/** Un candidato senza prova di acquisizione riuscita richiede una decisione esplicita. */
export function candidateAcquisitionErrors(candidate) {
  const issue = (message) => ({ level: "error", scope: "candidate", field: "acquisition", message });
  const acquisition = candidate?.acquisition;
  if (!acquisition || typeof acquisition !== "object" || acquisition.status !== "complete") {
    return [issue("Acquisizione incompleta o non verificabile; rigenera il candidato o usa --force dopo revisione manuale.")];
  }
  if (!Number.isInteger(acquisition.pages) || acquisition.pages < 1 || acquisition.errors !== 0 || acquisition.validationErrors !== 0) {
    return [issue("Il candidato contiene errori di acquisizione o validazione.")];
  }
  return [];
}

export function selectCourseTargets(targets, filter) {
  if (!filter) return { targets, error: null };
  const query = slugifyCourse(filter);
  const exact = targets.filter(({ course }) => course.id === filter || slugifyCourse(course.name) === query);
  if (exact.length === 1) return { targets: exact, error: null };
  const matches = targets.filter(({ course }) => course.id.includes(query) || slugifyCourse(course.name).includes(query));
  if (matches.length === 1) return { targets: matches, error: null };
  if (!matches.length) return { targets: [], error: `Nessun corso corrisponde a "${filter}".` };
  return { targets: [], error: `Filtro corso ambiguo "${filter}": ${matches.map(({ course }) => course.name).join(", ")}. Usa il nome completo o l'ID.` };
}

/** Diff campo-per-campo tra overlay attuale e candidato (per report e revisione). */
export function diffSynced(before, after) {
  const changes = [];
  const add = (section, id, field, from, to) => changes.push({ section, id, field, before: from ?? null, after: to ?? null });

  for (const id of new Set([...Object.keys(before.courses ?? {}), ...Object.keys(after.courses ?? {})])) {
    const a = before.courses?.[id]?.fields ?? {};
    const b = after.courses?.[id]?.fields ?? {};
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!same(a[field], b[field])) add("courses", id, field, a[field], b[field]);
    }
    if (!same(before.courses?.[id]?.schedule, after.courses?.[id]?.schedule)) {
      add("courses", id, "schedule", before.courses?.[id]?.schedule?.length ?? 0, after.courses?.[id]?.schedule?.length ?? 0);
    }
  }
  const teachersBefore = new Map((before.teachers ?? []).map((t) => [t.id, t]));
  const teachersAfter = new Map((after.teachers ?? []).map((t) => [t.id, t]));
  for (const id of new Set([...teachersBefore.keys(), ...teachersAfter.keys()])) {
    const a = teachersBefore.get(id);
    const b = teachersAfter.get(id);
    if (!a || !b) {
      add("teachers", id, a ? "removed" : "added", a?.displayName, b?.displayName);
      continue;
    }
    for (const field of ["displayName", "email", "phone", "office", "officeHours", "officeHoursPlace", "role", "courseIds"]) {
      if (!same(a[field], b[field])) add("teachers", id, field, a[field], b[field]);
    }
  }
  for (const semester of new Set([...(before.semesters ?? []).map((s) => s.id), ...(after.semesters ?? []).map((s) => s.id)])) {
    const a = (before.semesters ?? []).find((s) => s.id === semester);
    const b = (after.semesters ?? []).find((s) => s.id === semester);
    for (const field of ["startDate", "endDate", "scheduleStatus"]) {
      if (!same(a?.[field], b?.[field])) add("semesters", semester, field, a?.[field], b?.[field]);
    }
  }
  if (!same(before.addedCourses?.map((c) => c.id), after.addedCourses?.map((c) => c.id))) {
    add("plan", "addedCourses", "ids", before.addedCourses?.map((c) => c.id), after.addedCourses?.map((c) => c.id));
  }
  if (!same(before.missingCourseIds, after.missingCourseIds)) {
    add("plan", "missingCourseIds", "ids", before.missingCourseIds, after.missingCourseIds);
  }
  if (!same(before.contacts, after.contacts)) add("contacts", "contacts", "list", before.contacts?.length ?? 0, after.contacts?.length ?? 0);
  if (!same(before.roles, after.roles)) add("contacts", "roles", "list", before.roles?.length ?? 0, after.roles?.length ?? 0);
  if (!same(before.timetable?.status, after.timetable?.status) || before.timetable?.lessons !== after.timetable?.lessons) {
    add("timetable", "status", "status", before.timetable?.status, after.timetable?.status);
  }
  if (!same(before.cohort, after.cohort)) add("plan", "cohort", "cohort", before.cohort?.manifestoUrl, after.cohort?.manifestoUrl);
  return changes;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Sync ${report.provider} · ${report.scope}${report.courseFilter ? ` · corso "${report.courseFilter}"` : ""}`);
  lines.push("");
  lines.push(`- Avvio: ${report.startedAt} · durata ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push(`- Firecrawl: ${report.firecrawl.base} (${report.firecrawl.ok ? "ok" : "NON disponibile"})`);
  lines.push(`- Pagine: ${report.pages.length} (cache: ${report.pages.filter((p) => p.fromCache).length}, errori: ${report.pages.filter((p) => !p.ok).length})`);
  lines.push(`- Modifiche rispetto all'overlay attuale: ${report.changes.length}`);
  lines.push(`- Validazione: ${report.validation.errors.length} errori, ${report.validation.warnings.length} avvisi`);
  lines.push(`- Applicato: ${report.applied ? "sì" : "no"}${report.applyBlockedReason ? ` (${report.applyBlockedReason})` : ""}`);
  if (report.updates?.length) {
    lines.push("", "## Pagine cambiate", "");
    for (const update of report.updates) lines.push(`- [${update.status}] ${update.url} → scope \`${update.scope}\``);
  }
  if (report.changes.length) {
    lines.push("", "## Modifiche", "", "| Sezione | Id | Campo | Prima | Dopo |", "| --- | --- | --- | --- | --- |");
    for (const change of report.changes.slice(0, 400)) {
      const fmt = (value) => String(typeof value === "string" ? value : JSON.stringify(value)).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 90);
      lines.push(`| ${change.section} | ${change.id} | ${change.field} | ${fmt(change.before)} | ${fmt(change.after)} |`);
    }
  }
  if (report.errors.length) {
    lines.push("", "## Errori", "");
    for (const error of report.errors) lines.push(`- [${error.stage}] ${error.url ?? ""} ${error.message}`);
  }
  if (report.validation.errors.length || report.validation.warnings.length) {
    lines.push("", "## Validazione", "");
    for (const issue of [...report.validation.errors, ...report.validation.warnings]) {
      lines.push(`- ${issue.level.toUpperCase()} ${issue.scope} · ${issue.field}: ${issue.message}`);
    }
  }
  if (report.notes.length) lines.push("", "## Note", "", ...report.notes.map((note) => `- ${note}`));
  return `${lines.join("\n")}\n`;
}

/**
 * Esegue la pipeline. Opzioni: { provider, scope, course, apply, force, fresh, cacheTtlMs,
 * concurrency, offline, autostart, log }.
 */
export async function runSync(options = {}) {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const provider = getProvider(options.provider ?? "barb");
  const scope = options.scope ?? "all";
  if (!SCOPES.includes(scope)) throw new Error(`Scope non valido: ${scope}. Usa: ${SCOPES.join(", ")}`);
  if (options.course && scope !== "teachers") throw new Error("--course richiede --scope teachers: solo le schede e i docenti sono filtrabili per corso.");
  const checkOnly = scope === "check-updates";
  const cacheTtlMs = options.fresh || checkOnly ? 0 : options.cacheTtlMs ?? 30 * 60_000;
  const concurrency = options.concurrency ?? 3;
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${scope}`;

  const seed = await loadSeed(provider);
  const current = readSynced(provider) ?? emptySyncedData(provider.key);
  const candidate = structuredClone(current);
  candidate.provider = provider.key;

  const report = {
    id: runId,
    provider: provider.key,
    scope,
    courseFilter: options.course ?? null,
    startedAt: new Date(started).toISOString(),
    firecrawl: { base: FIRECRAWL_BASE, ok: false },
    pages: [],
    errors: [],
    notes: [],
    changes: [],
    updates: [],
    validation: { errors: [], warnings: [] },
    applied: false,
    applyBlockedReason: null,
  };

  const recordPage = (doc) => {
    report.pages.push({
      url: doc.url,
      finalUrl: doc.finalUrl ?? doc.url,
      ok: doc.ok,
      statusCode: doc.statusCode ?? doc.pageStatus ?? null,
      fromCache: Boolean(doc.fromCache),
      durationMs: doc.durationMs ?? null,
      attempts: doc.attempts ?? null,
      chars: doc.markdown?.length ?? 0,
      contentHash: doc.ok ? pageHash(doc.markdown) : null,
      error: doc.ok ? null : doc.error,
    });
    if (!doc.ok) report.errors.push({ stage: "crawl", url: doc.url, message: doc.error });
    else {
      candidate.sources[doc.url] = {
        url: doc.url,
        title: doc.title ?? null,
        statusCode: doc.statusCode ?? 200,
        contentHash: pageHash(doc.markdown),
        fetchedAt: doc.fetchedAt ?? nowIso(),
      };
    }
  };

  const scrape = async (urls, label) => {
    const official = urls.filter((url) => {
      if (isOfficial(url)) return true;
      report.errors.push({ stage: "discovery", url, message: "URL fuori whitelist UNIMI: scartata" });
      return false;
    });
    if (!official.length) return [];
    log(`→ ${label}: ${official.length} pagine`);
    const docs = (await scrapeMany(official, {
      concurrency,
      cacheTtlMs,
      onRetry: ({ url, attempt, delay }) => log(`  ↻ retry ${attempt} ${url} tra ${delay}ms`),
      onProgress: ({ done, total, result }) =>
        log(`  ${result.ok ? (result.fromCache ? "◦" : "✓") : "✗"} [${done}/${total}] ${result.url}${result.ok ? "" : ` — ${result.error}`}`),
    })).map(acceptOfficialPage);
    docs.forEach(recordPage);
    return docs;
  };

  // ——— Firecrawl ———
  if (options.offline) {
    report.notes.push("Modalità --offline: nessuna pagina scaricata (solo validazione dell'overlay attuale).");
  } else {
    const health = await ensureFirecrawl({ autostart: options.autostart ?? false, log });
    report.firecrawl = { base: FIRECRAWL_BASE, ...health };
    if (!health.ok) {
      report.errors.push({
        stage: "crawl",
        url: FIRECRAWL_BASE,
        message: `Firecrawl locale non raggiungibile (${health.error ?? health.liveness ?? "?"}). Avvia: npm run firecrawl:up (oppure docker compose -f ~/firecrawl-oss/docker-compose.yaml up -d) o usa --autostart.`,
      });
    }
  }
  const online = !options.offline && report.firecrawl.ok;

  // ——— check-updates: confronto hash delle pagine note ———
  if (online && checkOnly) {
    const known = new Map();
    known.set(provider.pages.plan, "courses");
    known.set(provider.pages.calendar, "schedule");
    known.set(provider.pages.contacts, "contacts");
    for (const url of Object.keys(current.sources ?? {})) {
      if (!known.has(url)) known.set(url, /\/ugov\/person\//.test(url) || /\/ugov\/of\//.test(url) ? "teachers" : "courses");
    }
    const docs = await scrape([...known.keys()], "controllo aggiornamenti");
    for (const doc of docs) {
      const previous = current.sources?.[doc.url]?.contentHash ?? null;
      const status = !doc.ok ? "errore" : !previous ? "nuova" : previous === pageHash(doc.markdown) ? "invariata" : "cambiata";
      if (status !== "invariata") report.updates.push({ url: doc.url, status, scope: known.get(doc.url) });
    }
    const scopes = [...new Set(report.updates.filter((u) => u.status !== "errore").map((u) => u.scope))];
    report.notes.push(
      scopes.length
        ? `Aggiornamenti rilevati: esegui ${scopes.map((s) => `npm run barb:sync -- --scope ${s}`).join(" · ")} (poi --apply dopo la revisione).`
        : "Nessuna modifica nelle pagine ufficiali rispetto all'ultima sincronizzazione applicata.",
    );
  }

  // ——— piano didattico (serve a courses e teachers per conoscere le schede ufficiali) ———
  let planCourses = [];
  let cohort = null;
  let planDoc = null;
  if (online && !checkOnly && (scopeIncludes(scope, "courses") || scopeIncludes(scope, "teachers"))) {
    [planDoc] = await scrape([provider.pages.plan], "piano didattico");
    if (planDoc?.ok) {
      const parsed = parsePianoDidattico(planDoc.markdown);
      if (parsed.academicYear !== provider.academicYear) {
        report.errors.push({ stage: "parse", url: planDoc.url, message: `Anno del piano ${parsed.academicYear ?? "assente"}, atteso ${provider.academicYear}.` });
      }
      cohort = parsed.cohorts.find((item) => provider.cohortPattern.test(item.label)) ?? null;
      if (!cohort) {
        report.errors.push({ stage: "parse", url: planDoc.url, message: "Coorte configurata non trovata nel piano didattico." });
      } else {
        planCourses = planCohortToCourses(cohort);
        report.notes.push(`Piano ${parsed.academicYear ?? "?"}: coorte "${cohort.label}" (${cohort.curriculum ?? "?"}), ${planCourses.length} attività.`);
      }
    }
  }

  const seedBySlug = new Map(seed.courses.map((course) => [slugifyCourse(course.name), course]));
  const planBySlug = new Map(planCourses.map((course) => [course.slug, course]));
  const minPlausible = Math.ceil(seed.courses.length * 0.5);
  const planPlausible = planCourses.length >= minPlausible;
  if (planCourses.length && !planPlausible) {
    report.errors.push({
      stage: "parse",
      url: provider.pages.plan,
      message: `Solo ${planCourses.length} attività estratte (attese >= ${minPlausible}): layout cambiato? Il piano NON viene applicato.`,
    });
  }

  // ——— scope courses ———
  if (planPlausible && scopeIncludes(scope, "courses") && !options.course) {
    const fetchedAt = planDoc.fetchedAt ?? nowIso();
    const hash = pageHash(planDoc.markdown);
    candidate.cohort = { label: cohort.label, manifestoUrl: cohort.manifestoUrl, curriculum: cohort.curriculum };
    candidate.addedCourses = [];
    for (const planCourse of planCourses) {
      const base = seedBySlug.get(planCourse.slug);
      const fields = {
        name: planCourse.name,
        cfu: planCourse.cfu ?? base?.cfu,
        totalHours: planCourse.totalHours,
        year: planCourse.year,
        semester: planCourse.semester,
        language: planCourse.language,
        ssd: planCourse.ssd,
        character: planCourse.character,
        choiceGroup: planCourse.choiceGroup,
        ...(planCourse.url ? { officialPageUrl: planCourse.url } : {}),
      };
      if (base) {
        const previous = candidate.courses[base.id] ?? {};
        candidate.courses[base.id] = {
          ...previous,
          fields: { ...(previous.fields ?? {}), ...fields },
          provenance: previous.provenance?.sourceType === "scheda-insegnamento"
            ? previous.provenance
            : provenance(provider.pages.plan, "piano-didattico", fetchedAt, hash),
        };
      } else {
        candidate.addedCourses.push({
          id: `${provider.idPrefix}${planCourse.slug}`,
          englishName: null,
          code: null,
          responsibleTeacherId: null,
          teacherIds: [],
          syllabus: null,
          learningGoals: null,
          prerequisites: null,
          examMode: null,
          officialPageUrl: planCourse.url,
          arielUrl: null,
          schedule: [],
          exceptions: [],
          conflicts: [],
          ...fields,
          cfu: planCourse.cfu ?? 0,
          provenance: provenance(provider.pages.plan, "piano-didattico", fetchedAt, hash, 0.9, "Attività presente nel piano ufficiale ma non nel seed."),
        });
      }
    }
    candidate.missingCourseIds = seed.courses.filter((course) => !planBySlug.has(slugifyCourse(course.name))).map((course) => course.id);
    if (candidate.missingCourseIds.length) {
      report.notes.push(`Attività del seed assenti dal piano ufficiale (segnalate, non rimosse): ${candidate.missingCourseIds.join(", ")}`);
    }
  } else if (options.course && scopeIncludes(scope, "courses")) {
    report.notes.push("Con --course il piano didattico viene solo usato per trovare la scheda: nessuna modifica ai campi del piano.");
  }

  // ——— scope teachers: schede insegnamento + pagine docenti ———
  if (planPlausible && scopeIncludes(scope, "teachers")) {
    const available = seed.courses
      .map((course) => ({ course, plan: planBySlug.get(slugifyCourse(course.name)) }))
      .filter(({ plan }) => plan?.url);
    const { targets, error: courseError } = selectCourseTargets(available, options.course);
    if (courseError) report.errors.push({ stage: "discovery", url: null, message: courseError });
    const docs = await scrape(targets.map(({ plan }) => plan.url), "schede insegnamento");
    const peopleUrls = new Map();
    const parsedByCourse = new Map();
    docs.forEach((doc, index) => {
      if (!doc.ok) return;
      const { course, plan } = targets[index];
      const page = parseCoursePage(doc.markdown, doc.links);
      parsedByCourse.set(course.id, { page, doc, plan });
      for (const person of [...page.responsible, ...page.teachers]) {
        if (person.url && /\/ugov\/person\//.test(person.url)) peopleUrls.set(person.url, person);
      }
      // Riconciliazione: i campi del piano restano la fonte per la coorte, le divergenze vengono tracciate.
      const conflicts = [];
      for (const [field, pageValue, planValue] of [
        ["cfu", page.cfu, plan.cfu],
        ["semester", page.semester, plan.semester],
        ["language", page.language, plan.language],
        ["ssd", page.ssd, plan.ssd],
      ]) {
        if (pageValue !== null && planValue !== null && !same(pageValue, planValue) && !(Array.isArray(pageValue) && !pageValue.length)) {
          conflicts.push({
            field,
            values: [
              { value: JSON.stringify(planValue), sourceUrl: provider.pages.plan, retrievedAt: planDoc.fetchedAt },
              { value: JSON.stringify(pageValue), sourceUrl: doc.url, retrievedAt: doc.fetchedAt },
            ],
            note: "Piano didattico e scheda insegnamento divergono: mostrato il valore del piano (coorte), verificare.",
          });
        }
      }
      if (conflicts.length) report.notes.push(`${course.name}: ${conflicts.length} divergenze piano/scheda registrate.`);
      if (page.offered === false) report.notes.push(`${course.name}: scheda ufficiale "${page.editions.map((e) => e.label).join(", ")}".`);
      const detailFields = {
        offered: page.offered,
        offeringNote: page.editions.length ? page.editions.map((edition) => edition.label).join(" · ") : null,
        learningGoals: page.learningGoals,
        expectedOutcomes: page.expectedOutcomes,
        syllabus: page.syllabus,
        prerequisites: page.prerequisites,
        teachingMethods: page.teachingMethods,
        references: page.references,
        examMode: page.examMode,
        grading: page.grading,
        examDetails: page.examDetails,
        arielUrl: page.arielUrl,
        scheduleUrl: page.scheduleUrl,
        officialPageUrl: doc.url,
        responsibleTeacherId: teacherIdFromUrl(page.responsible[0]?.url) ?? null,
        teacherIds: [...new Set([...page.responsible, ...page.teachers].map((p) => teacherIdFromUrl(p.url)).filter(Boolean))],
      };
      const previous = candidate.courses[course.id] ?? {};
      candidate.courses[course.id] = {
        ...previous,
        fields: { ...(previous.fields ?? {}), ...detailFields },
        conflicts,
        provenance: provenance(doc.url, "scheda-insegnamento", doc.fetchedAt, pageHash(doc.markdown)),
      };
    });

    const personDocs = await scrape([...peopleUrls.keys()], "pagine docenti");
    // Si riparte dai docenti già noti togliendo i corsi appena riletti: così una scheda non
    // raggiungibile non fa sparire i suoi docenti, e chi non insegna più resta senza corsi (rimosso sotto).
    const processed = new Set(parsedByCourse.keys());
    const teachers = new Map(
      (candidate.teachers ?? []).map((t) => [t.id, { ...t, courseIds: t.courseIds.filter((id) => !processed.has(id)) }]),
    );
    personDocs.forEach((doc) => {
      const ref = peopleUrls.get(doc.url);
      const id = teacherIdFromUrl(doc.url);
      if (!id) return;
      const person = doc.ok ? parsePersonPage(doc.markdown) : null;
      const courseIds = [...parsedByCourse.entries()]
        .filter(([, value]) => [...value.page.responsible, ...value.page.teachers].some((p) => p.url === doc.url))
        .map(([courseId]) => courseId);
      const fromCourse = [...parsedByCourse.values()]
        .flatMap((value) => value.page.teachers)
        .find((teacher) => teacher.url === doc.url);
      const previous = teachers.get(id);
      teachers.set(id, {
        id,
        displayName: person?.name ?? ref?.name ?? previous?.displayName ?? id,
        email: person?.email ?? previous?.email ?? null,
        unimiProfileUrl: doc.url,
        ssd: person?.ssd ?? previous?.ssd ?? null,
        courseIds: [...new Set([...(previous?.courseIds ?? []), ...courseIds])].sort(),
        role: person?.role ?? previous?.role ?? null,
        department: person?.department ?? previous?.department ?? null,
        phone: person?.phone ?? previous?.phone ?? null,
        office: person?.office ?? previous?.office ?? null,
        officeHours: person?.officeHours ?? fromCourse?.officeHours ?? previous?.officeHours ?? null,
        officeHoursPlace: person?.officeHoursPlace ?? previous?.officeHoursPlace ?? null,
        website: person?.website ?? fromCourse?.website ?? previous?.website ?? null,
        provenance: provenance(doc.url, "pagina-docente", doc.fetchedAt ?? nowIso(), doc.ok ? pageHash(doc.markdown) : null, doc.ok ? 0.95 : 0.7,
          doc.ok ? undefined : "Pagina docente non raggiungibile: dati minimi dalla scheda insegnamento."),
      });
    });
    candidate.teachers = [...teachers.values()]
      .filter((teacher) => teacher.courseIds.length > 0)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "it"));
  }

  // ——— scope schedule: date semestri + portale orari ———
  if (online && scopeIncludes(scope, "schedule")) {
    const [calendarDoc] = await scrape([provider.pages.calendar], "calendari e orari");
    if (calendarDoc?.ok) {
      const { periodLabel, semesters } = parseSemesterDates(calendarDoc.markdown, provider.academicYear);
      if (!semesters.length) report.errors.push({ stage: "parse", url: calendarDoc.url, message: `Date dei semestri per l'A.A. ${provider.academicYear} non trovate (periodo letto: ${periodLabel ?? "assente"}).` });
      const hash = pageHash(calendarDoc.markdown);
      const previous = new Map((candidate.semesters ?? []).map((s) => [s.id, s]));
      for (const semester of semesters) {
        previous.set(semester.id, {
          ...(previous.get(semester.id) ?? {}),
          id: semester.id,
          startDate: semester.startDate,
          endDate: semester.endDate,
          provenance: provenance(calendarDoc.url, "calendario-didattico", calendarDoc.fetchedAt, hash, 0.98, semester.raw),
        });
      }
      candidate.semesters = [...previous.values()];
    }

    log("→ portale orari EasyAcademy (orari.unimi.it)");
    try {
      const { academicYear, courseCode } = provider.easyAcademy;
      const course = await findCourse({ academicYear, courseCode });
      const periods = course?.pub_periodi?.map((p) => p.label) ?? [];
      const yearCodes = course ? await findYearCodes({ academicYear, courseCode, fallback: course.elenco_anni ?? [] }) : [];
      let lessons = [];
      let weeks = 0;
      if (course && yearCodes.length) {
        for (const semester of candidate.semesters.filter((s) => s.startDate && s.endDate)) {
          const result = await fetchLessons({ academicYear, courseCode, yearCodes, from: semester.startDate, to: semester.endDate });
          lessons = lessons.concat(result.lessons);
          weeks += result.weeks;
        }
      }
      const checkedAt = nowIso();
      const source = "https://orari.unimi.it/PortaleStudenti/";
      if (lessons.length) {
        const rules = lessonsToRules(lessons);
        let matched = 0;
        for (const [slug, value] of rules) {
          const course = seedBySlug.get(slug);
          if (!course) {
            report.notes.push(`Lezioni EasyAcademy per "${value.courseName}" senza corso corrispondente nel seed.`);
            continue;
          }
          matched += 1;
          const prov = provenance(source, "easyacademy", checkedAt, null, 0.9);
          const previous = candidate.courses[course.id] ?? { fields: {}, provenance: prov };
          candidate.courses[course.id] = {
            ...previous,
            schedule: value.rules.map((rule, index) => ({
              id: `${course.id}-r${index + 1}`,
              weekday: rule.weekday,
              startTime: rule.start,
              endTime: rule.end,
              room: rule.room,
              building: null,
              site: null,
              validFrom: rule.validFrom,
              validTo: rule.validTo,
              provenance: prov,
            })),
            exceptions: value.exceptions.map((item, index) => ({
              id: `${course.id}-x${index + 1}`,
              date: item.date,
              startTime: item.start,
              endTime: item.end,
              room: item.room,
              building: null,
              site: null,
              kind: item.kind,
              note: item.teacher ? `Docente: ${item.teacher}` : null,
              provenance: prov,
            })),
          };
        }
        candidate.timetable = { status: "pubblicato", checkedAt, source, lessons: lessons.length, note: `${lessons.length} lezioni in ${weeks} settimane, ${matched} corsi collegati.` };
      } else {
        candidate.timetable = {
          status: "non-pubblicato",
          checkedAt,
          source,
          lessons: 0,
          note: course
            ? `Corso ${courseCode} presente nel portale (periodi: ${periods.join(", ") || "nessuno"}), ma nessuna lezione pubblicata.`
            : `Corso ${courseCode} non presente nel portale orari per l'A.A. ${academicYear}.`,
        };
      }
      for (const semester of candidate.semesters) {
        semester.scheduleStatus = lessons.length ? "pubblicato" : semester.id === "primo" ? "in-attesa-pdf" : "non-pubblicato";
        semester.scheduleNote = lessons.length
          ? `Orario ufficiale pubblicato su EasyAcademy (verificato il ${checkedAt.slice(0, 10)}).`
          : `Date ufficiali confermate dalla pagina Calendari e orari. Orario giornaliero non ancora pubblicato sul portale EasyAcademy (verificato il ${checkedAt.slice(0, 10)}): nessun orario ipotizzato.`;
      }
      report.notes.push(`EasyAcademy: ${candidate.timetable.note}`);
    } catch (error) {
      report.errors.push({ stage: "easyacademy", url: "https://orari.unimi.it/PortaleStudenti/", message: error instanceof Error ? error.message : String(error) });
    }
  }

  // ——— scope contacts ———
  if (online && scopeIncludes(scope, "contacts")) {
    const [contactsDoc] = await scrape([provider.pages.contacts], "referenti e contatti");
    if (contactsDoc?.ok) {
      const parsed = parseContactsPage(contactsDoc.markdown);
      if (!parsed.roles.length && !parsed.contacts.length) {
        report.errors.push({ stage: "parse", url: contactsDoc.url, message: "Nessun referente/contatto estratto." });
      } else {
        candidate.roles = parsed.roles;
        candidate.contacts = parsed.contacts.filter((contact) => !contact.url || isOfficial(contact.url));
      }
    }
  }

  // ——— validazione + diff ———
  candidate.generatedAt = nowIso();
  const merged = mergeUniversityDataset(seed, candidate);
  const issues = validateDataset(merged);
  report.validation.errors = issues.filter((issue) => issue.level === "error");
  report.validation.warnings = issues.filter((issue) => issue.level === "warning");
  report.changes = checkOnly ? [] : diffSynced(current, candidate);

  const finishedAt = nowIso();
  report.durationMs = Date.now() - started;
  report.finishedAt = finishedAt;

  const crawlFailed = !online && !options.offline;
  candidate.acquisition = {
    runId,
    scope: options.course ? `${scope}:${options.course}` : scope,
    startedAt: report.startedAt,
    finishedAt,
    status: !options.offline && online && report.pages.length > 0 && report.errors.length === 0 && report.validation.errors.length === 0 ? "complete" : "incomplete",
    pages: report.pages.length,
    errors: report.errors.length,
    validationErrors: report.validation.errors.length,
  };
  if (options.apply && !checkOnly) {
    if (options.offline) report.applyBlockedReason = "modalità offline";
    else if (crawlFailed) report.applyBlockedReason = "Firecrawl non disponibile";
    else if (report.validation.errors.length && !options.force) report.applyBlockedReason = "errori di validazione (usa --force solo dopo verifica manuale)";
    else if (report.errors.length && !options.force) report.applyBlockedReason = "errori di acquisizione/parsing (rivedi il report o usa --force)";
    else {
      candidate.lastRun = {
        id: runId,
        scope: options.course ? `${scope}:${options.course}` : scope,
        startedAt: report.startedAt,
        finishedAt,
        pages: report.pages.length,
        errors: report.errors.length,
        changes: report.changes.length,
      };
      writeJsonAtomic(provider.syncedFile, candidate);
      report.applied = true;
    }
  }

  const dir = runDir(runId);
  writeJsonAtomic(join(dir, "report.json"), report);
  writeFileSync(join(dir, "report.md"), renderMarkdown(report));
  if (!checkOnly) writeJsonAtomic(candidatePath(provider), candidate);
  report.reportPath = relative(ROOT, join(dir, "report.md"));
  report.candidatePath = checkOnly ? null : relative(ROOT, candidatePath(provider));
  return report;
}

/** Applica l'ultimo candidato prodotto da `sync` (dopo revisione del report). */
export async function applyCandidate({ provider: providerKey = "barb", file, force = false } = {}) {
  const provider = getProvider(providerKey);
  const { readFileSync } = await import("node:fs");
  const path = file ?? candidatePath(provider);
  const candidate = JSON.parse(readFileSync(path, "utf8"));
  const envelopeErrors = validateCandidateEnvelope(candidate, provider.key);
  if (envelopeErrors.length) return { applied: false, errors: envelopeErrors, path };
  const acquisitionErrors = candidateAcquisitionErrors(candidate);
  if (acquisitionErrors.length && !force) return { applied: false, errors: acquisitionErrors, path };
  const seed = await loadSeed(provider);
  const issues = validateDataset(mergeUniversityDataset(seed, candidate));
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length && !force) return { applied: false, errors, path };
  const current = readSynced(provider) ?? emptySyncedData(provider.key);
  const changes = diffSynced(current, candidate);
  const acquisition = candidate.acquisition;
  candidate.lastRun = {
    id: acquisition?.runId ?? `apply-${Date.now()}`,
    scope: acquisition?.scope ?? "apply",
    startedAt: acquisition?.startedAt ?? candidate.generatedAt,
    finishedAt: acquisition?.finishedAt ?? new Date().toISOString(),
    pages: acquisition?.pages ?? Object.keys(candidate.sources ?? {}).length,
    errors: acquisition?.errors ?? 0,
    changes: changes.length,
  };
  writeJsonAtomic(provider.syncedFile, candidate);
  return { applied: true, errors, changes, path };
}
