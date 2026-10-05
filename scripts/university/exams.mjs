import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// Register extension resolution before loading the shared browser TypeScript modules.
const { BARB_DATASET } = await import("../../src/data/university/barb.dataset.ts");
const { BARB_EXAM_DATA, parseUnimiExamFeed, dedupeExamSessions, validateExamDataset, reconcileExamSessionIdentities } =
  await import("../../src/lib/university/examSessions.ts");

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TARGET = resolve(ROOT, "src/data/university/barb.exams.json");
const CANDIDATE = resolve(ROOT, ".cache/ai/university/barb.exams.candidate.json");
const CALENDAR = "https://www.unimi.it/it/studiare/frequentare-un-corso-di-laurea/seguire-il-percorso-di-studi/esami/calendario-degli-appelli";
const ALIAS = "https://myariel.unimi.it/course/search.php?lang=it&perpage=all&search=Cellule+staminali";
const LEGACY = "https://www.unimi.it/it/ugov/of/af20260000f1b-10";

export function assertOfficialExamUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !(url.hostname === "unimi.it" || url.hostname.endsWith(".unimi.it"))) throw new Error(`Fonte o redirect non ufficiale: ${value}`);
  return url.href;
}

export async function fetchOfficialExamSource(url, fetcher = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let current = assertOfficialExamUrl(url);
      for (let hop = 0; hop < 6; hop++) {
        const response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(25000) });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect ufficiale senza destinazione");
          current = assertOfficialExamUrl(new URL(location, current).href);
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${current}`);
        return { text: await response.text(), finalUrl: current };
      }
      throw new Error(`Troppi redirect: ${url}`);
    } catch (error) {
      lastError = error;
      if (/non ufficiale/.test(error.message)) throw error;
    }
  }
  throw lastError;
}

const htmlText = (text) => text.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/g, " ").replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export async function retrieveBarbExams({ acquire = fetchOfficialExamSource, checkedAt = new Date().toISOString() } = {}) {
  const sources = [], sessions = [], unmatched = [], errors = [];
  const get = async (url, note) => {
    try {
      const result = await acquire(url);
      sources.push({ url, status: "verificato", note });
      return result;
    } catch (error) {
      sources.push({ url, status: "non-verificato", note: error.message });
      errors.push(`${url}: ${error.message}`);
      return null;
    }
  };
  await get("https://barb.cdl.unimi.it/it/studiare/appelli-esame", "Pagina ufficiale BARB; calendario pubblico e prenotazione Unimia.");
  await get(CALENDAR, "Calendario pubblico ufficiale: servizio JSON completo, senza filtro oggi/mese.");
  const aliasPage = await get(ALIAS, "Avviso pubblico di Graziella Messina: ridenominazione dal 2025/26 in Cellule staminali e medicina rigenerativa.");
  const aliasConfirmed = aliasPage && /Biologia del Differenziamento e Terapie che dall'a\.a\. 2025-2026 si chiama Cellule Staminali e Medicina Rigenerativa/i.test(htmlText(aliasPage.text));
  if (!aliasConfirmed) errors.push("Evidenza della ridenominazione non verificata; nessuna associazione dedotta");
  const legacyPage = await get(LEGACY, "Scheda ufficiale dell'insegnamento F1B-10: Patenting and technology transfer, 6 CFU.");
  const legacyName = "Patenting and technology transfer";
  const legacyCfu = Number(legacyPage?.text.match(/views-label-cfu[^>]*>\s*(\d+)\s*</)?.[1]);
  if (!legacyPage || !htmlText(legacyPage.text).includes(legacyName) || !Number.isFinite(legacyCfu) || legacyCfu <= 0) errors.push("Scheda ufficiale legacy senza nome/CFU verificabili");
  const additionalCourses = legacyPage && legacyCfu > 0 ? [{
    id: "f92-patenting-and-technology-transfer", name: legacyName, englishName: legacyName,
    code: "F1B-10", cfu: legacyCfu, totalHours: null, year: null, semester: "non-definito", choiceGroup: null,
    character: "scelta-libera", ssd: [], language: null, responsibleTeacherId: null, teacherIds: [],
    syllabus: null, learningGoals: null, prerequisites: null, examMode: null, offered: null,
    offeringNote: "Insegnamento presente negli appelli del precedente ordinamento F92; non incluso nel piano attuale di 33 attività.",
    officialPageUrl: LEGACY, arielUrl: null, schedule: [], exceptions: [], conflicts: [],
    provenance: { sourceUrl: LEGACY, sourceType: "scheda-insegnamento", retrievedAt: checkedAt,
      lastVerifiedAt: checkedAt, officialSource: true, confidence: 1 },
  }] : [];
  const courses = [...BARB_DATASET.courses, ...additionalCourses];
  const stemCells = BARB_DATASET.courses.find(c => normalize(c.name) === "cellule staminali e medicina rigenerativa");
  const aliases = aliasConfirmed && stemCells ? {
    "biologia del differenziamento e terapie cellulari": { courseId: stemCells.id, evidenceUrl: ALIAS },
  } : {};
  for (const degree of ["FBG", "F92"]) {
    const url = `https://work.unimi.it/foProssimiEsami/json/${degree}`;
    const result = await get(url, `Tutti gli appelli futuri pubblicati per ${degree}; nessun filtro per insegnamento o mese.`);
    if (!result) continue;
    try {
      const parsed = parseUnimiExamFeed(JSON.parse(result.text), { courses, sourceUrl: url, retrievedAt: checkedAt, aliases });
      sessions.push(...parsed.sessions); unmatched.push(...parsed.unmatched);
      if (!parsed.sessions.length && !parsed.unmatched.length) sources.find(s => s.url === url).status = "non-pubblicato";
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
      Object.assign(sources.find(s => s.url === url), { status: "non-verificato", note: error.message });
    }
  }
  // Every current syllabus is checked for separate public exam-date links.
  const links = new Set();
  for (let i = 0; i < BARB_DATASET.courses.length; i += 4) {
    await Promise.all(BARB_DATASET.courses.slice(i, i + 4).map(async course => {
      if (!course.officialPageUrl) { errors.push(`Scheda ufficiale assente: ${course.name}`); return; }
      const result = await get(course.officialPageUrl, `Scheda ${course.name}: controllo dei collegamenti pubblici agli appelli.`);
      if (!result) return;
      const examLinks = [...result.text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .filter(m => /calendario.{0,40}appelli|appelli.{0,40}esame/i.test(htmlText(m[2])));
      for (const match of examLinks) links.add(assertOfficialExamUrl(new URL(match[1].replace(/&amp;/g, "&"), result.finalUrl).href));
    }));
  }
  for (const url of links) {
    if (![CALENDAR, "https://www.unimi.it/it/node/134"].includes(url)) errors.push(`Nuova fonte di appelli da analizzare prima dell'applicazione: ${url}`);
  }
  const data = { checkedAt, sessions: reconcileExamSessionIdentities(dedupeExamSessions(sessions), BARB_EXAM_DATA.sessions), additionalCourses, sources, unmatched };
  errors.push(...validateExamDataset(data));
  const knownIds = new Set(courses.map(c => c.id));
  for (const session of data.sessions) if (!knownIds.has(session.courseId)) errors.push(`Appello collegato a corso sconosciuto: ${session.courseId}`);
  if (unmatched.length) errors.push(`${unmatched.length} appelli senza associazione verificata; conservati integralmente nel candidato`);
  return { data, errors, sourceRows: sessions.length + unmatched.length };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--validate", "--json"].includes(arg))) throw new Error("Opzioni: --apply, --validate, --json");
  if (args.includes("--validate")) {
    const data = JSON.parse(await readFile(TARGET, "utf8"));
    const errors = validateExamDataset(data);
    const known = new Set([...BARB_DATASET.courses, ...data.additionalCourses].map(c => c.id));
    for (const session of data.sessions) if (!known.has(session.courseId)) errors.push(`Corso sconosciuto: ${session.courseId}`);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(JSON.stringify({ valid: true, sessions: data.sessions.length, checkedAt: data.checkedAt }));
    return;
  }
  const result = await retrieveBarbExams();
  await atomicJson(CANDIDATE, { ...result.data, acquisitionErrors: result.errors });
  if (result.errors.length) {
    console.error(`Acquisizione incompleta: dataset verificato conservato. Candidato: ${CANDIDATE}\n${result.errors.join("\n")}`);
    process.exitCode = 1; return;
  }
  if (args.includes("--apply")) await atomicJson(TARGET, result.data);
  console.log(JSON.stringify({ candidate: CANDIDATE, applied: args.includes("--apply"), sessions: result.data.sessions.length,
    courses: new Set(result.data.sessions.map(s => s.courseId)).size, sourceRows: result.sourceRows, checkedAt: result.data.checkedAt }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
import "../lib/register-ts.mjs";
