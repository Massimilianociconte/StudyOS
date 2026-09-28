// Parser delle pagine ufficiali UNIMI (markdown prodotto da Firecrawl locale).
// Funzioni pure, senza I/O: usate dalla pipeline CLI e verificate con fixture reali
// (tests/fixtures/unimi). Regola d'oro: si estrae solo ciò che è scritto nella pagina;
// ciò che manca resta null (mai dedotto).

import { normalizeCfu, normalizeCourseName, normalizeSsd, slugifyCourse } from "./normalize";
import type { CourseCharacter, SemesterId } from "./types";

// ——— utilità testo ———

const MARKDOWN_ESCAPES = /\\([\\`*_{}[\]()#+\-.!|>~])/g;

/** Testo leggibile da un blocco markdown: link -> testo, escape rimossi, spazi normalizzati. */
export const markdownToText = (block: string) =>
  block
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text: string, href: string) => {
      const label = text.replace(MARKDOWN_ESCAPES, "$1").trim();
      if (!label) return href;
      return /^https?:\/\//.test(label) ? label : label;
    })
    .replace(MARKDOWN_ESCAPES, "$1")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const clean = (value: string) => markdownToText(value).replace(/\s+/g, " ").trim();

const linkRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)(?:\s+"[^"]*")?\)/g;

export const extractLinks = (block: string) =>
  [...block.matchAll(linkRe)].map((match) => ({ text: clean(match[1]), href: match[2] }));

/** Link ufficiali storici che oggi rispondono con redirect permanente. */
export const canonicalUnimiUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    if (url.hostname === "easystaff.divsi.unimi.it") url.hostname = "orari.unimi.it";
    return url.toString();
  } catch {
    return null;
  }
};

const COOKIE_MARKERS = [/^Questo sito utilizza cookie/i, /^Impostazione dei cookie/i, /^\*\s+\[Privacy policy\]/i];

/** Markdown senza banner cookie/menu: base stabile per hash e confronti differenziali. */
export const stripBoilerplate = (markdown: string) => {
  const lines = markdown.split("\n");
  const end = lines.findIndex((line) => COOKIE_MARKERS.some((re) => re.test(line.trim())));
  return (end >= 0 ? lines.slice(0, end) : lines)
    .filter((line) => !/^\[Salta al contenuto principale\]/.test(line.trim()))
    .join("\n")
    .replace(/\?itok=[\w-]+/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

// ——— date italiane ———

const MONTHS_IT: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12
};

/** "28 settembre 2026" / "1° marzo 2027" -> "2026-09-28"; null se non valida. */
export const parseItalianDate = (raw: string): string | null => {
  const match = raw.trim().toLowerCase().match(/^(\d{1,2})\s*°?\s+([a-zà]+)\s+(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS_IT[match[2]];
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export interface SemesterDates {
  id: "primo" | "secondo";
  startDate: string;
  endDate: string;
  raw: string;
}

/** Pagina "Calendari e orari": seleziona il blocco dell'A.A. richiesto, se presente. */
export const parseSemesterDates = (markdown: string, academicYear?: string): { periodLabel: string | null; semesters: SemesterDates[] } => {
  const text = stripBoilerplate(markdown);
  const periods = [...text.matchAll(/Periodi di lezione\s+(\d{4}\s*[-/]\s*\d{4})/gi)];
  const expected = academicYear?.replace(/\s/g, "").replace("/", "-");
  const selectedIndex = expected
    ? periods.findIndex((match) => match[1].replace(/\s/g, "").replace("/", "-") === expected)
    : 0;
  const selected = periods[selectedIndex];
  const periodLabel = selected?.[1]?.replace(/\s/g, "") ?? periods[0]?.[1]?.replace(/\s/g, "") ?? null;
  if (expected && !selected) return { periodLabel, semesters: [] };
  const block = selected
    ? text.slice(selected.index, periods[selectedIndex + 1]?.index ?? text.length)
    : text;
  const semesters: SemesterDates[] = [];
  const re =
    /\*\*(Primo|Secondo)\s+semestre\*\*\s*:?\s*inizio\s+(\d{1,2}\s*°?\s+[a-zà]+\s+\d{4})\s*,?\s*termine\s+(\d{1,2}\s*°?\s+[a-zà]+\s+\d{4})/gi;
  for (const match of block.matchAll(re)) {
    const startDate = parseItalianDate(match[2]);
    const endDate = parseItalianDate(match[3]);
    if (!startDate || !endDate || startDate >= endDate) continue;
    const id = match[1].toLowerCase() === "primo" ? "primo" : "secondo";
    if (semesters.some((item) => item.id === id)) continue;
    semesters.push({ id, startDate, endDate, raw: clean(match[0]) });
  }
  return { periodLabel, semesters };
};

// ——— piano didattico ———

export interface PlanCourseRow {
  name: string;
  url: string | null;
  cfu: number | null;
  totalHours: number | null;
  language: "Italiano" | "Inglese" | null;
  ssd: string[];
  semester: SemesterId;
  year: 1 | 2 | null;
  mandatory: boolean | null;
  concluding: boolean;
}

export interface PlanChoiceGroup {
  index: number;
  pick: number | null;
  cfu: number | null;
  description: string;
  courses: Array<{ name: string; url: string | null; semester: SemesterId }>;
}

export interface PlanCohort {
  label: string;
  enrollmentYear: string | null;
  manifestoUrl: string | null;
  manifestoCode: string | null;
  curriculum: string | null;
  inactiveYearNote: string | null;
  rows: PlanCourseRow[];
  groups: PlanChoiceGroup[];
  notes: string[];
}

export interface PlanParseResult {
  academicYear: string | null;
  degreeLabel: string | null;
  cohorts: PlanCohort[];
}

const PERIOD_HEADINGS: Record<string, SemesterId> = {
  annuale: "annuale",
  "primo semestre": "primo",
  "secondo semestre": "secondo",
  "non definito": "non-definito",
  "periodo non definito": "non-definito"
};

const periodFromCell = (cell: string): SemesterId => PERIOD_HEADINGS[cell.trim().toLowerCase()] ?? "non-definito";

const languageFrom = (cell: string | undefined): "Italiano" | "Inglese" | null => {
  const value = (cell ?? "").trim().toLowerCase();
  if (value.startsWith("ital")) return "Italiano";
  if (value.startsWith("ingl") || value.startsWith("engl")) return "Inglese";
  return null;
};

const ssdFrom = (cell: string | undefined) =>
  (cell ?? "")
    .split(/\s+/)
    .map((item) => normalizeSsd(item))
    .filter((item): item is string => Boolean(item));

const numberFrom = (cell: string | undefined) => {
  const value = Number((cell ?? "").replace(",", ".").trim());
  return Number.isFinite(value) && (cell ?? "").trim() !== "" ? value : null;
};

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const parseCourseCell = (cell: string) => {
  const link = cell.match(/^\[(.+?)\]\((https?:\/\/[^)\s]+)\)$/);
  if (link) return { name: normalizeCourseName(clean(link[1])), url: link[2] };
  const name = normalizeCourseName(clean(cell));
  return { name, url: null };
};

export const parsePianoDidattico = (markdown: string): PlanParseResult => {
  const text = stripBoilerplate(markdown);
  const lines = text.split("\n");
  const academicYear = text.match(/piani didattici e manifesti per l'A\.A\.\s*(\d{4}\/\d{4})/i)?.[1] ?? null;
  const degreeLabel = lines.map((line) => line.trim()).find((line) => /\(Classe\s+L[M]?-/i.test(line)) ?? null;

  const cohortStarts = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => /^Immatricolati nell'anno accademico/i.test(line));

  const cohorts: PlanCohort[] = cohortStarts.map((start, cohortIndex) => {
    const end = cohortStarts[cohortIndex + 1]?.index ?? lines.length;
    const segment = lines.slice(start.index, end);
    const cohort: PlanCohort = {
      label: start.line,
      enrollmentYear: start.line.match(/(\d{4}\/\d{4})/)?.[1] ?? null,
      manifestoUrl: null,
      manifestoCode: null,
      curriculum: null,
      inactiveYearNote: null,
      rows: [],
      groups: [],
      notes: []
    };

    let period: SemesterId = "non-definito";
    let year: 1 | 2 = 1;
    let mandatory: boolean | null = null;
    let inRules = false;
    let concluding = false;
    let group: PlanChoiceGroup | null = null;

    for (const raw of segment) {
      const line = raw.trim();
      if (!line) continue;
      const lower = line.toLowerCase();

      const manifesto = line.match(/^\[Manifesto degli studi (.+?)\]\((https?:\/\/[^)\s]+)\)/i);
      if (manifesto) {
        cohort.manifestoUrl = manifesto[2];
        cohort.manifestoCode = clean(manifesto[1]).replace(/[[\]]/g, "") || null;
        cohort.curriculum = manifesto[2].match(/manifesto_([A-Za-z0-9]+?)_\d{4}\.pdf/i)?.[1] ?? null;
        continue;
      }
      if (lower.startsWith("annualità non più attiva")) {
        cohort.inactiveYearNote = line;
        continue;
      }
      if (PERIOD_HEADINGS[lower]) {
        period = PERIOD_HEADINGS[lower];
        mandatory = null;
        if (!inRules) group = null;
        continue;
      }
      if (lower.startsWith("attività a scelta e regole")) {
        inRules = true;
        continue;
      }
      if (lower.startsWith("sarà attivato dall")) {
        cohort.notes.push(line);
        inRules = false;
        group = null;
        year = 2;
        continue;
      }
      if (lower === "attività conclusive") {
        inRules = false;
        group = null;
        year = 2;
        concluding = true;
        period = "non-definito";
        continue;
      }
      if (lower.startsWith("per queste attività non è previsto")) continue;
      if (lower.startsWith("[propedeuticità")) {
        inRules = false;
        group = null;
        continue;
      }

      const rule = inRules ? line.match(/^(\d+)\s*-\s*(.+)$/) : null;
      if (rule) {
        const description = clean(rule[2]);
        group = {
          index: Number(rule[1]),
          pick: Number(description.match(/scegliere\s+(\d+)\s+de/i)?.[1]) || null,
          cfu: Number(description.match(/(?:totale di|acquisire)\s+(\d+)\s*cfu/i)?.[1]) || null,
          description,
          courses: []
        };
        cohort.groups.push(group);
        continue;
      }

      if (line.startsWith("|")) {
        const cells = splitRow(line);
        const head = cells[0]?.toLowerCase() ?? "";
        if (!cells[0] || head === "attività formative" || /^-+$/.test(cells[0].replace(/\s/g, ""))) continue;
        if (head === "obbligatorio") {
          mandatory = true;
          continue;
        }
        if (head === "facoltativo") {
          mandatory = false;
          continue;
        }
        const { name, url } = parseCourseCell(cells[0]);
        if (!name) continue;
        if (inRules && group) {
          // Tabelle delle regole: | nome | CFU | ore | lingua | periodo | SSD |
          group.courses.push({ name, url, semester: periodFromCell(cells[4] ?? "") });
          continue;
        }
        cohort.rows.push({
          name,
          url,
          cfu: normalizeCfu(cells[1]),
          totalHours: numberFrom(cells[2]),
          language: languageFrom(cells[3]),
          ssd: ssdFrom(cells[4]),
          semester: period,
          year,
          mandatory,
          concluding
        });
        continue;
      }

      if (inRules && group && !line.startsWith("|")) {
        // testo libero dopo una regola (es. "sarà attivato..." gestito sopra): accodato alla descrizione
        if (!/^\d+\s*-/.test(line)) cohort.notes.push(clean(line));
      }
    }
    return cohort;
  });

  return { academicYear, degreeLabel, cohorts };
};

export interface PlanCourse {
  name: string;
  slug: string;
  url: string | null;
  cfu: number | null;
  totalHours: number | null;
  language: "Italiano" | "Inglese" | null;
  ssd: string[];
  semester: SemesterId;
  year: 1 | 2 | null;
  character: CourseCharacter;
  choiceGroup: string | null;
}

/** Righe del piano -> corsi canonici (carattere e gruppo di scelta dedotti SOLO dalle regole pubblicate). */
export const planCohortToCourses = (cohort: PlanCohort): PlanCourse[] => {
  const groupOf = new Map<string, number>();
  for (const group of cohort.groups) {
    if (group.index > 3 && !group.courses.length) continue;
    for (const course of group.courses) groupOf.set(slugifyCourse(course.name), group.index);
  }
  const seen = new Set<string>();
  const courses: PlanCourse[] = [];
  for (const row of cohort.rows) {
    const slug = slugifyCourse(row.name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const groupIndex = groupOf.get(slug);
    let character: CourseCharacter;
    if (row.concluding) character = "tirocinio-tesi";
    else if (/lingua inglese/i.test(row.name)) character = "lingua";
    else if (/altre conoscenze/i.test(row.name)) character = "altre-conoscenze";
    else if (row.mandatory) character = "obbligatorio";
    else if (groupIndex !== undefined) character = "opzionale-scelta-guidata";
    else character = "scelta-libera";
    courses.push({
      name: row.name,
      slug,
      url: row.url,
      cfu: row.cfu,
      totalHours: row.totalHours,
      language: row.language,
      ssd: row.ssd,
      semester: row.semester,
      year: row.year,
      character,
      choiceGroup: groupIndex !== undefined && character === "opzionale-scelta-guidata" ? `gruppo-${groupIndex}` : null
    });
  }
  return courses;
};

// ——— scheda insegnamento (www.unimi.it/it/ugov/of/...) ———

export interface PersonRef {
  name: string;
  url: string | null;
}

export interface CoursePageTeacher extends PersonRef {
  officeHours: string | null;
  website: string | null;
}

export interface CoursePageData {
  title: string | null;
  academicYear: string | null;
  cfu: number | null;
  totalHours: number | null;
  ssd: string[];
  language: "Italiano" | "Inglese" | null;
  semester: SemesterId | null;
  periodLabel: string | null;
  examMode: string | null;
  grading: string | null;
  learningGoals: string | null;
  expectedOutcomes: string | null;
  syllabus: string | null;
  prerequisites: string | null;
  teachingMethods: string | null;
  references: string | null;
  examDetails: string | null;
  responsible: PersonRef[];
  teachers: CoursePageTeacher[];
  arielUrl: string | null;
  scheduleUrl: string | null;
  modules: Array<{ ssd: string | null; name: string | null; cfu: number | null }>;
  cohorts: string[];
  /** Edizioni dichiarate ("Edizione unica", "Edizione non erogata aa 2026/27", ...) */
  editions: Array<{ label: string; offered: boolean }>;
  /** false se TUTTE le edizioni risultano "non erogata"; null se la pagina non lo dice */
  offered: boolean | null;
}

type SectionKey =
  | "learningGoals"
  | "expectedOutcomes"
  | "syllabus"
  | "prerequisites"
  | "teachingMethods"
  | "references"
  | "examDetails";

const SECTION_MARKERS: Array<[RegExp, SectionKey]> = [
  [/^(Obiettivi formativi|Learning objectives|Course objectives)$/i, "learningGoals"],
  [/^(Risultati apprendimento attesi|Expected learning outcomes)$/i, "expectedOutcomes"],
  [/^\*\*(Programma|Course syllabus)\*\*$/i, "syllabus"],
  [/^\*\*(Prerequisiti|Prerequisites for admission)\*\*$/i, "prerequisites"],
  [/^\*\*(Metodi didattici|Teaching methods)\*\*$/i, "teachingMethods"],
  [/^\*\*(Materiale di riferimento|Teaching resources)\*\*$/i, "references"],
  [/^\*\*(Modalità di verifica dell.apprendimento e criteri di valutazione|Assessment methods and criteria)\*\*$/i, "examDetails"]
];

const STOP_MARKERS: RegExp[] = [
  /^\*\*Periodo:\*\*/i,
  /^\*\*Modalità di valutazione:\*\*/i,
  /^\[Orari delle lezioni\]/i,
  /^\[Calendario degli appelli\]/i,
  /^Corso singolo$/i,
  /^Programma e organizzazione didattica$/i,
  /^###\s/,
  /^Responsabile$/i,
  /^\*\s+\[(Programma|Organizzazione didattica)/i,
  /^Docent[ei](\/i)?:?/i,
  /^([A-Z]{2,5}-\d{2}\/[A-Z]|[A-Z]{2,5}\/\d{2}|\\?-)\s*-?\s*.*CFU:\s*\d+/,
  /^(Lezioni|Esercitazioni|Laboratori|Studio individuale|Attività didattiche):\s*\d+\s*ore/i,
  /^\[Corsi di laurea che utilizzano/i
];

const isMarker = (line: string) =>
  SECTION_MARKERS.some(([re]) => re.test(line)) || STOP_MARKERS.some((re) => re.test(line));

const personLinkRe = /\[([^\]]+)\]\((https?:\/\/www\.unimi\.it\/it\/ugov\/(?:person|rubrica)\/[^)\s]+)\)/g;

const personsIn = (line: string): PersonRef[] =>
  [...line.matchAll(personLinkRe)].map((match) => ({ name: clean(match[1]), url: match[2] }));

const uniquePeople = <T extends PersonRef>(people: T[]) => {
  const map = new Map<string, T>();
  for (const person of people) {
    const key = person.url ?? person.name.toLowerCase();
    const existing = map.get(key);
    map.set(key, existing ? { ...existing, ...Object.fromEntries(Object.entries(person).filter(([, v]) => v != null)) } : person);
  }
  return [...map.values()];
};

export const parseCoursePage = (markdown: string, extraLinks: string[] = []): CoursePageData => {
  const text = stripBoilerplate(markdown);
  const lines = text.split("\n").map((line) => line.trim());
  const nonEmpty = lines.filter(Boolean);

  const titleIndex = lines.findIndex((line, index) => /^=+$/.test(line) && index > 0);
  const title = titleIndex > 0 ? clean(lines.slice(0, titleIndex).filter(Boolean).at(-1) ?? "") || null : null;

  const data: CoursePageData = {
    title,
    academicYear: text.match(/A\.A\.\s*(\d{4}\/\d{4})/)?.[1] ?? null,
    cfu: null,
    totalHours: null,
    ssd: [],
    language: null,
    semester: null,
    periodLabel: null,
    examMode: null,
    grading: null,
    learningGoals: null,
    expectedOutcomes: null,
    syllabus: null,
    prerequisites: null,
    teachingMethods: null,
    references: null,
    examDetails: null,
    responsible: [],
    teachers: [],
    arielUrl: null,
    scheduleUrl: null,
    modules: [],
    cohorts: [],
    editions: [],
    offered: null
  };

  // Intestazione: valore sulla riga precedente/successiva all'etichetta.
  const headerEnd = nonEmpty.findIndex((line) => /^(Obiettivi formativi|\[Corsi di laurea che utilizzano)/i.test(line));
  const header = nonEmpty.slice(0, headerEnd > 0 ? headerEnd : Math.min(nonEmpty.length, 30));
  header.forEach((line, index) => {
    if (/^Crediti massimi$/i.test(line)) data.cfu = normalizeCfu(header[index - 1]);
    if (/^Ore totali$/i.test(line)) data.totalHours = numberFrom(header[index - 1]);
    if (/^SSD$/i.test(line)) data.ssd = ssdFrom(header[index + 1]);
    if (/^Lingua$/i.test(line)) data.language = languageFrom(header[index + 1]);
  });

  data.cohorts = [...text.matchAll(/\[([^\]]*immatricolati nell'anno accademico[^\]]*)\]\(/gi)].map((match) => clean(match[1]));

  // Sezioni di testo libero
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = SECTION_MARKERS.find(([re]) => re.test(line));
    if (!marker) continue;
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] && isMarker(lines[cursor])) break;
      body.push(lines[cursor]);
    }
    const value = markdownToText(body.join("\n"));
    if (value && !data[marker[1]]) data[marker[1]] = value;
  }

  for (const line of lines) {
    const period = line.match(/^\*\*Periodo:\*\*\s*(.+)$/i);
    if (period) {
      data.periodLabel = clean(period[1]);
      const lower = data.periodLabel.toLowerCase();
      data.semester = lower.includes("primo")
        ? "primo"
        : lower.includes("secondo")
          ? "secondo"
          : lower.includes("annual")
            ? "annuale"
            : "non-definito";
    }
    const exam = line.match(/^\*\*Modalità di valutazione:\*\*\s*(.+)$/i);
    if (exam) data.examMode = clean(exam[1]) || null;
    const grading = line.match(/^\*\*Giudizio di valutazione:\*\*\s*(.+)$/i);
    if (grading) data.grading = clean(grading[1]) || null;
    const schedule = line.match(/^\[Orari delle lezioni\]\((https?:\/\/[^)\s]+)\)/i);
    if (schedule) data.scheduleUrl = canonicalUnimiUrl(schedule[1]);
    const module = line.match(/^([A-Z]{2,5}-\d{2}\/[A-Z]|[A-Z]{2,5}\/\d{2})\s+-\s+(.+?)\s+-\s+CFU:\s*(\d+)/);
    if (module) data.modules.push({ ssd: normalizeSsd(module[1]), name: clean(module[2]), cfu: normalizeCfu(module[3]) });
  }

  const programIndex = lines.findIndex((line) => /^Programma e organizzazione didattica$/i.test(line));
  if (programIndex >= 0) {
    for (const line of lines.slice(programIndex + 1)) {
      const edition = line.match(/^###\s+(.+)$/);
      if (edition) {
        const label = clean(edition[1]);
        data.editions.push({ label, offered: !/non\s+erogat/i.test(label) });
      }
    }
    if (data.editions.length) data.offered = data.editions.some((edition) => edition.offered);
  }

  // Responsabile (righe di link subito dopo "Responsabile")
  const responsibleIndex = lines.findIndex((line) => /^Responsabile$/i.test(line));
  if (responsibleIndex >= 0) {
    for (let cursor = responsibleIndex + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line) continue;
      const people = personsIn(line);
      if (!people.length) break;
      data.responsible.push(...people);
    }
  }

  // Docenti: righe "Docente:/Docenti:" + blocchi "Docente/i" con ricevimento
  const teachers: CoursePageTeacher[] = [];
  lines.forEach((line, index) => {
    if (/^Docent[ei]:/i.test(line)) {
      for (let cursor = index; cursor < lines.length; cursor += 1) {
        const current = lines[cursor];
        if (cursor > index && !current.startsWith(",") && !current.startsWith("[")) break;
        teachers.push(...personsIn(current).map((person) => ({ ...person, officeHours: null, website: null })));
      }
    }
  });
  const docentiIndex = lines.findIndex((line) => /^Docente\/i$/i.test(line));
  if (docentiIndex >= 0) {
    let current: CoursePageTeacher | null = null;
    let collectingHours = false;
    const hours: string[] = [];
    const flush = () => {
      if (current) {
        current.officeHours = hours.length ? clean(hours.join(" · ")) : current.officeHours;
        teachers.push(current);
      }
      hours.length = 0;
    };
    for (let cursor = docentiIndex + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line) continue;
      const people = personsIn(line);
      if (people.length && line.startsWith("[")) {
        flush();
        current = { ...people[0], officeHours: null, website: null };
        collectingHours = false;
        continue;
      }
      if (!current) continue;
      const site = line.match(/^\[Sito web\]\((https?:\/\/[^)\s]+)/i);
      if (site) {
        current.website = site[1];
        continue;
      }
      if (/^Ricevimento:?$/i.test(line)) {
        collectingHours = true;
        continue;
      }
      if (collectingHours) hours.push(line);
    }
    flush();
  }
  data.teachers = uniquePeople(teachers);
  data.responsible = uniquePeople(data.responsible);

  const allLinks = [...extractLinks(text).map((link) => link.href), ...extractLinks(markdown).map((link) => link.href), ...extraLinks];
  const ariel = allLinks.find((href) => /^https?:\/\/(my)?ariel\.unimi\.it\//i.test(href));
  data.arielUrl = ariel ? canonicalUnimiUrl(ariel) : null;
  return data;
};

// ——— pagina persona (www.unimi.it/it/ugov/person/...) ———

export interface PersonPageData {
  name: string | null;
  role: string | null;
  department: string | null;
  ssd: string | null;
  email: string | null;
  phone: string | null;
  office: string | null;
  officeHours: string | null;
  officeHoursPlace: string | null;
  website: string | null;
}

const valueAfter = (lines: string[], label: RegExp, stop: RegExp[]) => {
  const index = lines.findIndex((line) => label.test(line));
  if (index < 0) return null;
  const values: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line) continue;
    if (stop.some((re) => re.test(line))) break;
    values.push(line);
  }
  const value = clean(values.join(", "));
  return value || null;
};

export const parsePersonPage = (markdown: string): PersonPageData => {
  const text = stripBoilerplate(markdown);
  const lines = text.split("\n").map((line) => line.trim());
  const nonEmpty = lines.filter(Boolean);
  const titleIndex = nonEmpty.findIndex((line) => /^=+$/.test(line));
  const name = titleIndex > 0 ? clean(nonEmpty[titleIndex - 1]) : null;

  let role: string | null = null;
  let department: string | null = null;
  for (let index = titleIndex + 1; index > 0 && index < Math.min(nonEmpty.length, titleIndex + 6); index += 1) {
    const line = nonEmpty[index];
    if (line.startsWith("![")) continue;
    if (!role && !line.startsWith("[")) {
      role = clean(line);
      continue;
    }
    const dep = line.match(/^\[([^\]]+)\]\(https?:\/\/www\.unimi\.it\/it\/ugov\/ou-structure/);
    if (dep) {
      department = clean(dep[1]);
      break;
    }
  }

  const stops = [
    /^Gruppo scientifico/i,
    /^Incarichi$/i,
    /^Competenze/i,
    /^###/,
    /^Numero di telefono/i,
    /^E-mail/i,
    /^\[Sito web\]/i,
    /^Ricevimento$/i,
    /^Luogo di ricevimento$/i,
    /^\*\s+\[(Modifica|Aiuto)\]/i,
    /^Didattica/i
  ];

  const email = text.match(/\[([A-Za-z0-9._%+-]+@unimi\.it)\]\(mailto:/i)?.[1]?.toLowerCase() ?? null;
  const website = text.match(/\[Sito web\]\((https?:\/\/[^)\s]+)/i)?.[1] ?? null;
  const ssdLine = valueAfter(lines, /^Settore scientifico-disciplinare$/i, stops);

  return {
    name,
    role,
    department,
    ssd: ssdLine ? normalizeSsd(ssdLine.split(" - ")[0]) : null,
    email,
    phone: valueAfter(lines, /^Numero di telefono/i, stops),
    office: valueAfter(lines, /^Sede di lavoro$/i, stops),
    officeHours: valueAfter(lines, /^Ricevimento$/i, stops),
    officeHoursPlace: valueAfter(lines, /^Luogo di ricevimento$/i, stops),
    website
  };
};

// ——— referenti e contatti del corso ———

export interface ContactsPageData {
  roles: Array<{ role: string; people: PersonRef[] }>;
  contacts: Array<{ label: string; value: string; url: string | null }>;
}

export const parseContactsPage = (markdown: string): ContactsPageData => {
  const text = stripBoilerplate(markdown);
  const lines = text.split("\n").map((line) => line.trim());
  const roles: ContactsPageData["roles"] = [];
  let currentRole: { role: string; people: PersonRef[] } | null = null;
  let contactsStart = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (/^(Contacts|Contatti)$/i.test(line)) {
      contactsStart = index + 1;
      break;
    }
    const heading = line.match(/^\*\*(.+?)\*\*$/);
    if (heading) {
      currentRole = { role: clean(heading[1]), people: [] };
      roles.push(currentRole);
      continue;
    }
    if (currentRole) {
      const people = personsIn(line);
      if (people.length) currentRole.people.push(...people);
    }
  }

  const contacts: ContactsPageData["contacts"] = [];
  if (contactsStart >= 0) {
    // Solo la lista puntata subito sotto "Contacts": elementi a colonna 0, continuazioni indentate.
    const rawLines = text.split("\n");
    const items: string[][] = [];
    for (const raw of rawLines.slice(contactsStart)) {
      if (!raw.trim()) continue;
      if (/^\*\s+/.test(raw)) items.push([raw.replace(/^\*\s+/, "").trim()]);
      else if (/^\s+/.test(raw) && items.length) items[items.length - 1].push(raw.trim());
      else break;
    }
    for (const item of items) {
      const block = item.join("\n");
      const links = extractLinks(block);
      const emails = [...new Set(links.filter((link) => link.href.startsWith("mailto:")).map((link) => link.href.slice(7).toLowerCase()))];
      const phones = links.filter((link) => link.href.startsWith("tel:")).map((link) => link.href.slice(4));
      const url = links.find((link) => /^https?:/.test(link.href))?.href ?? null;
      const label = clean(item[0]).replace(/:$/, "");
      const textLines = item
        .slice(1)
        .filter((line) => !line.startsWith("["))
        .map((line) => clean(line))
        .filter((line) => line && !/^https?:/.test(line));
      const value = [...emails, ...phones, ...textLines].filter(Boolean).join(" · ");
      if (label) contacts.push({ label, value: value || (url ?? ""), url });
    }
  }

  return { roles: roles.filter((role) => role.people.length > 0), contacts };
};
