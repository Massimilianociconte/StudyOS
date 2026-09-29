// Import/export iCalendar (.ics, RFC 5545) per il calendario di StudyOS.
// Export: eventi (con ricorrenza), esami e scadenze delle task aperte, leggibili da Google
// Calendar, Apple Calendario e Outlook. Import: orari delle lezioni o calendari esportati da
// altre app, con ricorrenze giornaliere/settimanali/mensili (anche settimanali su più giorni).
import type { CalendarEvent, EventCategory, Exam, Subject, Task } from "../types";

// ---------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

const utcStamp = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

/** Ora "da orologio" di `date` nel fuso IANA `timeZone` (YYYYMMDDTHHMMSS). */
const zonedStamp = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
};

const dateStamp = (date: Date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

export const escapeText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Piega le righe a 75 ottetti (RFC 5545 §3.1) senza spezzare caratteri multibyte. */
export const foldLine = (line: string) => {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75; // le righe di continuazione iniziano con uno spazio
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
};

const RRULE_FREQ: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };

export interface IcsExportInput {
  events: CalendarEvent[];
  exams: Exam[];
  tasks: Task[];
  subjects: Subject[];
  categoryLabel?: (category: EventCategory) => string;
  now?: Date;
  timeZone?: string;
}

export const buildIcs = ({ events, exams, tasks, subjects, categoryLabel, now = new Date(), timeZone }: IcsExportInput) => {
  const zone = timeZone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  const stamp = utcStamp(now);
  const subjectName = (id?: string) => subjects.find((subject) => subject.id === id)?.name;
  // Con un fuso noto si scrive l'ora locale: una lezione settimanale resta alle 9 anche dopo il
  // cambio dell'ora. Senza fuso si usa UTC.
  const when = (name: "DTSTART" | "DTEND", date: Date) => {
    if (zone) {
      try {
        return `${name};TZID=${zone}:${zonedStamp(date, zone)}`;
      } catch {
        // fuso non riconosciuto da Intl: si ripiega su UTC
      }
    }
    return `${name}:${utcStamp(date)}`;
  };

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudyOS//Calendario//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:StudyOS",
    ...(zone ? [`X-WR-TIMEZONE:${zone}`] : [])
  ];

  for (const event of events) {
    if (event.archived) continue;
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const description = [event.description, event.notes].filter((part) => part?.trim()).join("\n\n");
    lines.push("BEGIN:VEVENT", `UID:${event.sourceUid ?? `${event.id}@studyos`}`, `DTSTAMP:${stamp}`, when("DTSTART", start), when("DTEND", end));
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    const subject = subjectName(event.subjectId);
    const category = categoryLabel ? categoryLabel(event.category) : event.category;
    lines.push(`CATEGORIES:${[category, subject].filter(Boolean).map((value) => escapeText(String(value))).join(",")}`);
    const freq = event.recurrence ? RRULE_FREQ[event.recurrence] : undefined;
    if (freq) {
      let rule = `RRULE:FREQ=${freq}`;
      if (event.recurrenceUntil && /^\d{4}-\d{2}-\d{2}$/.test(event.recurrenceUntil)) {
        const until = new Date(`${event.recurrenceUntil}T23:59:59`);
        if (!Number.isNaN(until.getTime())) rule += `;UNTIL=${utcStamp(until)}`;
      }
      lines.push(rule);
    }
    if (event.status === "skipped") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }

  for (const exam of exams) {
    if (exam.archived) continue;
    const start = new Date(exam.date);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + 2 * 60 * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${exam.id}@studyos`,
      `DTSTAMP:${stamp}`,
      when("DTSTART", start),
      when("DTEND", end),
      `SUMMARY:${escapeText(`Esame: ${subjectName(exam.subjectId) ?? "materia"}`)}`,
      "CATEGORIES:Esame",
      "END:VEVENT"
    );
  }

  for (const task of tasks) {
    if (!task.dueDate || task.status === "done" || task.status === "archived") continue;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const next = new Date(due);
    next.setDate(next.getDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${task.id}@studyos`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateStamp(due)}`,
      `DTEND;VALUE=DATE:${dateStamp(next)}`,
      `SUMMARY:${escapeText(`Scadenza: ${task.title}`)}`,
      "TRANSP:TRANSPARENT",
      "CATEGORIES:Scadenza",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
};

// ---------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------

export interface IcsImportedEvent {
  uid?: string;
  title: string;
  description: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: NonNullable<CalendarEvent["recurrence"]>;
  recurrenceUntil?: string;
}

export interface IcsParseResult {
  events: IcsImportedEvent[];
  /** Avvisi leggibili (regole non supportate, eventi scartati). */
  warnings: string[];
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

const unfold = (text: string) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");

const parseProperty = (line: string): Property | null => {
  // Il primo ":" fuori dalle virgolette separa nome/parametri dal valore.
  let quoted = false;
  let split = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      split = index;
      break;
    }
  }
  if (split < 0) return null;
  const [rawName, ...rawParams] = line.slice(0, split).split(";");
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const [key, ...rest] = param.split("=");
    if (key) params[key.toUpperCase()] = rest.join("=").replace(/^"|"$/g, "");
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(split + 1) };
};

export const unescapeText = (value: string) =>
  value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));

/** Offset (ms) del fuso `timeZone` nell'istante `utc`: ora locale del fuso - UTC. */
const zoneOffset = (utc: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(utc));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utc;
};

/** Converte un'ora "da orologio" in un fuso IANA nel corrispondente istante UTC. */
const zonedToUtc = (fields: number[], timeZone: string) => {
  const guess = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]);
  let result = guess - zoneOffset(guess, timeZone);
  result = guess - zoneOffset(result, timeZone); // secondo passaggio per i giorni del cambio d'ora
  return new Date(result);
};

const parseDateValue = (property: Property): { date: Date; allDay: boolean } | null => {
  const value = property.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || property.params.VALUE === "DATE") {
    const match = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!match) return null;
    return { date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])), allDay: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!match) return null;
  const fields = [1, 2, 3, 4, 5, 6].map((index) => Number(match[index] ?? 0));
  if (match[7]) return { date: new Date(Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5])), allDay: false };
  const zone = property.params.TZID;
  if (zone) {
    try {
      return { date: zonedToUtc(fields, zone), allDay: false };
    } catch {
      // fuso non riconosciuto (es. nomi Windows): si usa l'ora locale del dispositivo
    }
  }
  return { date: new Date(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]), allDay: false };
};

const parseDuration = (value: string) => {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total = ((Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 24 * 60 * 60 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000;
  return sign === "-" ? -total : total;
};

const ymd = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const FREQ: Record<string, IcsImportedEvent["recurrence"]> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly" };
const MAX_EVENTS = 2000;

export const parseIcs = (text: string): IcsParseResult => {
  const warnings = new Set<string>();
  const events: IcsImportedEvent[] = [];
  if (!/BEGIN:VCALENDAR/i.test(text)) return { events, warnings: ["Il file non è un calendario .ics valido."] };

  const lines = unfold(text).split("\n");
  let current: Property[] | null = null;
  let depth = 0; // VALARM e altri blocchi annidati dentro VEVENT
  let skipped = 0;

  const finish = (props: Property[]) => {
    const get = (name: string) => props.find((property) => property.name === name);
    const startProp = get("DTSTART");
    const start = startProp ? parseDateValue(startProp) : null;
    if (!start) {
      skipped += 1;
      return;
    }
    if (get("STATUS")?.value.toUpperCase() === "CANCELLED") return;
    if (get("RECURRENCE-ID")) {
      warnings.add("Le modifiche a singole occorrenze di una serie non sono supportate: vale la serie originale.");
      return;
    }
    const endProp = get("DTEND");
    const durationProp = get("DURATION");
    let end = endProp ? parseDateValue(endProp)?.date : undefined;
    if (!end && durationProp) {
      const duration = parseDuration(durationProp.value);
      if (duration !== null) end = new Date(start.date.getTime() + duration);
    }
    if (!end || end.getTime() <= start.date.getTime()) {
      end = new Date(start.date.getTime() + (start.allDay ? 24 * 60 : 60) * 60_000);
    }
    const title = unescapeText(get("SUMMARY")?.value ?? "").trim() || "Evento importato";
    const location = unescapeText(get("LOCATION")?.value ?? "").trim() || undefined;
    const description = [unescapeText(get("DESCRIPTION")?.value ?? "").trim(), location ? `Luogo: ${location}` : ""].filter(Boolean).join("\n\n");
    const base: IcsImportedEvent = {
      uid: get("UID")?.value.trim() || undefined,
      title,
      description,
      location,
      start: start.date.toISOString(),
      end: end.toISOString(),
      allDay: start.allDay,
      recurrence: "none"
    };

    const rruleProp = get("RRULE");
    if (!rruleProp) {
      events.push(base);
      return;
    }
    const rule = Object.fromEntries(
      rruleProp.value.split(";").map((part) => {
        const [key, ...rest] = part.split("=");
        return [key.toUpperCase(), rest.join("=").toUpperCase()];
      })
    );
    const freq = FREQ[rule.FREQ];
    if (!freq || (rule.INTERVAL && rule.INTERVAL !== "1")) {
      warnings.add("Alcune ripetizioni (es. ogni 2 settimane o annuali) non sono supportate: importata solo la prima data.");
      events.push(base);
      return;
    }
    if (get("EXDATE")) warnings.add("Le date escluse dalle serie (EXDATE) vengono ignorate: controlla festività e sospensioni.");

    let until: string | undefined;
    if (rule.UNTIL) {
      const parsed = parseDateValue({ name: "UNTIL", params: {}, value: rule.UNTIL });
      if (parsed) until = ymd(parsed.date);
    }
    const duration = end.getTime() - start.date.getTime();
    const days = freq === "weekly" && rule.BYDAY ? rule.BYDAY.split(",").map((day: string) => WEEKDAY[day.replace(/^[+-]?\d+/, "")]).filter((day: number | undefined) => day !== undefined) : [];

    if (rule.COUNT && !until) {
      // COUNT (numero di occorrenze) diventa la data dell'ultima occorrenza.
      const count = Math.min(1000, Math.max(1, Number(rule.COUNT) || 1));
      const last = new Date(start.date);
      if (freq === "daily") last.setDate(last.getDate() + (count - 1));
      else if (freq === "monthly") last.setMonth(last.getMonth() + (count - 1));
      else {
        const weekdays = new Set(days.length ? days : [start.date.getDay()]);
        const cursor = new Date(start.date);
        let seen = 0;
        for (let step = 0; step < 7 * 1000 && seen < count; step += 1) {
          if (weekdays.has(cursor.getDay())) {
            seen += 1;
            last.setTime(cursor.getTime());
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      until = ymd(last);
    }

    if (days.length > 1 || (days.length === 1 && days[0] !== start.date.getDay())) {
      // StudyOS ripete un evento nello stesso giorno della settimana: una lezione il lunedì e
      // il mercoledì diventa due serie settimanali.
      for (const weekday of days) {
        const first = new Date(start.date);
        first.setDate(first.getDate() + ((weekday - first.getDay() + 7) % 7));
        if (until && ymd(first) > until) continue;
        events.push({
          ...base,
          uid: base.uid ? `${base.uid}#${weekday}` : undefined,
          start: first.toISOString(),
          end: new Date(first.getTime() + duration).toISOString(),
          recurrence: "weekly",
          recurrenceUntil: until
        });
      }
      return;
    }
    events.push({ ...base, recurrence: freq, recurrenceUntil: until });
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (upper === "END:VEVENT") {
      if (events.length < MAX_EVENTS) finish(current);
      current = null;
      continue;
    }
    if (upper.startsWith("BEGIN:")) depth += 1;
    else if (upper.startsWith("END:")) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const property = parseProperty(line);
      if (property) current.push(property);
    }
  }

  if (skipped) warnings.add(`${skipped} ${skipped === 1 ? "evento senza data valida è stato scartato" : "eventi senza data valida sono stati scartati"}.`);
  if (events.length >= MAX_EVENTS) warnings.add(`Importati solo i primi ${MAX_EVENTS} eventi.`);
  return { events, warnings: [...warnings] };
};

/** Categoria suggerita dal titolo (es. "Esame di…" → esame, "Laboratorio…" → laboratorio). */
export const guessCategory = (title: string, fallback: EventCategory): EventCategory => {
  if (/\b(esame|appello|prova (scritta|orale)|exam)\b/i.test(title)) return "exam";
  if (/\b(lab|laboratorio|esercitazion)/i.test(title)) return "lab";
  if (/\b(ricevimento|seminario|webinar)\b/i.test(title)) return "other";
  return fallback;
};

/** Materia il cui nome compare nel titolo dell'evento (la corrispondenza più lunga vince). */
export const matchSubject = (title: string, subjects: Subject[]) => {
  const normalized = title.toLowerCase();
  return subjects
    .filter((subject) => !subject.archived && subject.name.trim().length >= 4 && normalized.includes(subject.name.trim().toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
};
