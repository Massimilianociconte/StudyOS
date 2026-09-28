// Adapter per il portale orari ufficiale UNIMI (EasyAcademy "Agenda web").
// Il portale è migrato da easystaff.divsi.unimi.it a orari.unimi.it (redirect 301).
// Espone dati JSON (combo.php / call_redis.php / grid_call.php) che Firecrawl non può
// interrogare (grid_call richiede POST): si usa fetch diretto verso l'host ufficiale
// whitelisted, sempre in locale e con ritmo cortese. Se l'orario non è pubblicato,
// lo si dichiara esplicitamente: nessun calendario ipotetico.

import { isOfficialUnimiUrl } from "../../src/lib/university/officialSources.ts";
import { normalizeTime, slugifyCourse } from "../../src/lib/university/normalize.ts";

export const EASYACADEMY_BASE = process.env.EASYACADEMY_BASE_URL ?? "https://orari.unimi.it/PortaleStudenti";
const UA = "StudyOS-local-sync/1.0 (+uso personale, sincronizzazione su richiesta)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const url = `${EASYACADEMY_BASE}/${path}`;
  if (!isOfficialUnimiUrl(url)) throw new Error(`Host non ufficiale: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "User-Agent": UA,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
      },
      body,
      signal: controller.signal,
      redirect: "follow",
    });
    const finalUrl = res.url || url;
    if (!finalUrl.startsWith("https://") || !isOfficialUnimiUrl(finalUrl)) {
      throw new Error(`EasyAcademy: redirect verso URL non ufficiale o non HTTPS: ${finalUrl}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`EasyAcademy ${path} -> HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** `var elenco_x = [...];` -> array JSON */
const parseJsVar = (text, name) => {
  const match = text.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

/** Metadati del corso di laurea nel portale (codice, scuola, periodi pubblicati). */
export async function findCourse({ academicYear, courseCode }) {
  const text = await request(`combo.php?sw=ec_&aa=${academicYear}&page=corsi`);
  const courses = parseJsVar(text, "elenco_corsi") ?? [];
  return courses.find((course) => course.valore === courseCode) ?? null;
}

/** Codici anno/curriculum pubblicati per il corso ("anno2"); [] se l'orario non è pubblicato. */
export async function findYearCodes({ academicYear, courseCode, fallback = [] }) {
  try {
    const text = await request(`call_redis.php?key=unimi_${academicYear}_ec_elenco_anno2_${courseCode}`);
    const direct = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    const parsed = Array.isArray(direct) ? direct : text.includes("=") ? parseJsVar(`var x = ${text.split(" = ").slice(1).join(" = ")}`, "x") : null;
    const codes = (parsed ?? []).map((item) => item?.valore).filter(Boolean);
    if (codes.length) return codes;
  } catch {
    // chiave redis assente: si usa il fallback dal combo
  }
  return fallback.map((item) => item?.valore ?? item).filter(Boolean);
}

const toIsoDate = (ddmmyyyy) => {
  const match = String(ddmmyyyy ?? "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

const toPortalDate = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
};

const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Converte una "cella" del portale in una lezione normalizzata (campi mancanti -> null). */
export function normalizeCell(cell) {
  const date = toIsoDate(cell.data);
  const [rawStart, rawEnd] = String(cell.orario ?? "").split("-").map((part) => part.trim());
  const start = normalizeTime(cell.ora_inizio ?? rawStart);
  const end = normalizeTime(cell.ora_fine ?? rawEnd);
  const name = String(cell.nome_insegnamento ?? cell.name_original ?? cell.titolo ?? "").trim();
  if (!date || !start || !end || !name) return null;
  const room = String(cell.aula ?? "").replace(/\s+/g, " ").trim() || null;
  return {
    date,
    weekday: ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1,
    start,
    end,
    courseName: name,
    courseSlug: slugifyCourse(name),
    code: cell.codice_insegnamento ?? null,
    teacher: String(cell.docente ?? "").trim() || null,
    room,
    cancelled: String(cell.Annullato ?? cell.annullato ?? "0") === "1",
    type: cell.tipo ?? null,
  };
}

/** Lezioni settimana per settimana nell'intervallo [from, to] (date ISO). */
export async function fetchLessons({ academicYear, courseCode, yearCodes, from, to, delayMs = 350, onWeek } = {}) {
  const lessons = [];
  let weeks = 0;
  for (let day = from; day <= to; day = addDays(day, 7)) {
    const params = new URLSearchParams({
      view: "easycourse",
      "form-type": "corso",
      include: "corso",
      txtcurr: "",
      anno: String(academicYear),
      corso: courseCode,
      visualizzazione_orario: "cal",
      date: toPortalDate(day),
      periodo_didattico: "",
      _lang: "it",
      list: "0",
      week_grid_type: "-1",
      col_cells: "0",
      empty_box: "0",
      only_grid: "0",
      highlighted_date: "0",
      all_events: "0",
      faculty_group: "0",
    });
    for (const code of yearCodes) params.append("anno2[]", code);
    const text = await request("grid_call.php", { method: "POST", body: params.toString() });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Risposta grid_call non JSON");
    }
    const cells = Array.isArray(json.celle) ? json.celle : [];
    for (const cell of cells) {
      const lesson = normalizeCell(cell);
      if (lesson) lessons.push(lesson);
    }
    weeks += 1;
    onWeek?.({ week: day, cells: cells.length });
    if (delayMs) await sleep(delayMs);
  }
  const unique = new Map(lessons.map((lesson) => [`${lesson.date}|${lesson.start}|${lesson.courseSlug}|${lesson.room}`, lesson]));
  return { lessons: [...unique.values()], weeks };
}

/**
 * Lezioni -> regole ricorrenti (stesso giorno/orario/aula visto >= minOccurrences volte)
 * + eccezioni (lezioni isolate, annullamenti). Nessuna regola viene estrapolata oltre le date osservate.
 */
export function lessonsToRules(lessons, { minOccurrences = 3 } = {}) {
  const byCourse = new Map();
  for (const lesson of lessons) {
    const list = byCourse.get(lesson.courseSlug) ?? [];
    list.push(lesson);
    byCourse.set(lesson.courseSlug, list);
  }
  const result = new Map();
  for (const [slug, list] of byCourse) {
    const groups = new Map();
    for (const lesson of list.filter((item) => !item.cancelled)) {
      const key = `${lesson.weekday}|${lesson.start}|${lesson.end}|${lesson.room ?? ""}`;
      const group = groups.get(key) ?? [];
      group.push(lesson);
      groups.set(key, group);
    }
    const rules = [];
    const exceptions = [];
    for (const [key, group] of groups) {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      const runs = [];
      let run = [];
      for (const item of sorted) {
        if (run.length && item.date !== addDays(run.at(-1).date, 7)) {
          runs.push(run);
          run = [];
        }
        run.push(item);
      }
      if (run.length) runs.push(run);
      for (const consecutive of runs) {
        if (consecutive.length >= minOccurrences) {
          const [weekday, start, end] = key.split("|");
          rules.push({ weekday: Number(weekday), start, end, room: consecutive[0].room, validFrom: consecutive[0].date, validTo: consecutive.at(-1).date, occurrences: consecutive.length });
        } else {
          for (const item of consecutive) exceptions.push({ ...item, kind: "lezione-straordinaria" });
        }
      }
    }
    for (const item of list.filter((lesson) => lesson.cancelled)) exceptions.push({ ...item, kind: "cancellazione" });
    result.set(slug, { courseName: list[0].courseName, rules, exceptions, lessons: list.length });
  }
  return result;
}
