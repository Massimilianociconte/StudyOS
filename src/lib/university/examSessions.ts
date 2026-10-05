import examJson from "../../data/university/barb.exams.json" with { type: "json" };
import { BARB_DATASET } from "../../data/university/barb.dataset";
import { contentHash } from "./validate";
import type { BarbCourse } from "./types";
import type { BarbExamDataset, BarbExamSession, BarbExamSourceReference } from "./examTypes";

export const BARB_EXAM_DATA = examJson as unknown as BarbExamDataset;
export const BARB_EXAM_SESSIONS = BARB_EXAM_DATA.sessions;
/** Legacy exam descriptors supplement the calendar, never the current study plan. */
export const BARB_EXAM_COURSES: BarbCourse[] = [...BARB_DATASET.courses, ...BARB_EXAM_DATA.additionalCourses];

const normalized = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();

export function resolveBarbCourse<T extends { id: string; name: string }>(
  subject: { universityCourseId?: string | null; name: string }, courses: readonly T[],
): T | null {
  if (subject.universityCourseId) {
    const linked = courses.filter(c => c.id === subject.universityCourseId);
    return linked.length === 1 ? linked[0] : null;
  }
  const matches = courses.filter(c => normalized(c.name) === normalized(subject.name));
  return matches.length === 1 ? matches[0] : null;
}

export function isExamDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const nullableText = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Campo testuale ufficiale non valido");
  return value.trim() || null;
};
const italianDate = (value: unknown, label: string, optional = false): string | null => {
  const text = nullableText(value);
  if (optional && text === null) return null;
  const m = text?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const result = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  if (!isExamDate(result)) throw new Error(`${label}: data ufficiale non valida (${text})`);
  return result;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Record appello non valido");
  return value as Record<string, unknown>;
};

/** Code matching is exact: codW4 comes from the feed and the URL from the verified syllabus. */
function feedCourse(code: string | null, name: string, courses: readonly Pick<BarbCourse, "id" | "name" | "code" | "officialPageUrl">[]) {
  if (code) {
    const matches = courses.filter(c => normalized(c.code ?? "") === normalized(code) ||
      c.officialPageUrl?.toLowerCase().match(/\/af\d+(?:0)?([a-z0-9]+-\d+)$/)?.[1]?.toUpperCase() === code.toUpperCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }
  return resolveBarbCourse({ name }, courses);
}

export function parseUnimiExamFeed(raw: unknown, options: {
  courses: readonly Pick<BarbCourse, "id" | "name" | "code" | "officialPageUrl">[];
  sourceUrl: string; retrievedAt: string;
  /** Only aliases supported by published official evidence may be supplied. */
  aliases?: Readonly<Record<string, { courseId: string; evidenceUrl: string }>>;
}): Pick<BarbExamDataset, "sessions" | "unmatched"> {
  if (!Array.isArray(raw)) throw new Error("Il servizio ufficiale deve restituire un array di insegnamenti");
  const sessions: BarbExamSession[] = [], unmatched: BarbExamDataset["unmatched"] = [];
  for (const value of raw) {
    const entry = object(value), name = nullableText(entry.descrIns), code = nullableText(entry.codW4);
    if (!name || !Array.isArray(entry.appelli)) throw new Error("Insegnamento ufficiale privo di nome o elenco appelli");
    const alias = options.aliases?.[normalized(name)];
    const course = alias ? options.courses.find(c => c.id === alias.courseId) : feedCourse(code, name, options.courses);
    for (const value of entry.appelli) {
      const record = object(value), date = italianDate(record.dataStr, "Appello")!;
      const time = nullableText(record.ora);
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Orario ufficiale non valido: ${time}`);
      const registrationOpens = italianDate(record.aperturaStr, "Apertura", true);
      const registrationCloses = italianDate(record.chiusuraStr, "Chiusura", true);
      if ((registrationOpens && registrationCloses && registrationOpens > registrationCloses) || (registrationCloses && registrationCloses > date)) {
        throw new Error(`Intervallo di iscrizione incoerente per ${name} (${date})`);
      }
      if (!course) {
        unmatched.push({ courseName: name, courseCode: code, date, sourceUrl: options.sourceUrl,
          reason: "Nessuna corrispondenza univoca per codice ufficiale o nome esatto", sourceRecord: record });
        continue;
      }
      const teacher = record.docente == null ? {} : object(record.docente);
      const commission = [nullableText(teacher.cognome), nullableText(teacher.nome)].filter(Boolean).join(" ") || null;
      const officialId = nullableText(record.idAppello);
      const sourceReference: BarbExamSourceReference = {
        sourceUrl: options.sourceUrl, officialId, sourceCourseCode: code, sourceCourseName: name,
        degreeCode: options.sourceUrl.match(/\/json\/([A-Z0-9]+)/)?.[1] ?? null,
        registrationOpens, registrationCloses, sourceRecord: record,
        lastVerifiedAt: options.retrievedAt, historical: false,
      };
      const noteParts = [nullableText(record.avviso), nullableText(record.piuGiorni)];
      if (alias) noteParts.push(`Pubblicato anche per il precedente ordinamento come «${name}». Ridenominazione verificata: ${alias.evidenceUrl}`);
      const session: BarbExamSession = {
        id: "", courseId: course.id, date, type: nullableText(record.prova), time,
        location: nullableText(record.luogo), notes: noteParts.filter(Boolean).join("\n") || null,
        registrationOpens, registrationCloses, officialId, commission, sourceCourseCode: code,
        component: nullableText(record.nomeAppello), sourceReferences: [sourceReference],
        ...(alias ? { aliasEvidenceUrl: alias.evidenceUrl } : {}),
        provenance: { sourceUrl: options.sourceUrl, retrievedAt: options.retrievedAt, lastVerifiedAt: options.retrievedAt },
      };
      session.id = barbExamSourceUid(session);
      sessions.push(session);
    }
  }
  return { sessions, unmatched };
}

/** Independent of feed URL and retrieval date; time/place edits retain the imported identity. */
export function barbExamSourceUid(session: BarbExamSession): string {
  if (session.canonicalOfficialId) return `barb-exam-unimi-${session.canonicalOfficialId}`;
  if (session.officialId) return `barb-exam-unimi-${session.officialId}`;
  const identity = [session.courseId, session.date, normalized(session.type ?? ""),
    normalized(session.commission ?? ""), normalized(session.component ?? "")];
  return `barb-exam-${contentHash(JSON.stringify(identity))}`;
}

/** A surviving verified enrolment keeps the UID previously imported for its merged sitting. */
export function reconcileExamSessionIdentities(sessions: readonly BarbExamSession[], previousSessions: readonly BarbExamSession[]): BarbExamSession[] {
  const officialIds = (session: BarbExamSession) => new Set([session.officialId, ...(session.sourceReferences ?? []).map(ref => ref.officialId)].filter(Boolean));
  return sessions.map(session => {
    const ids = officialIds(session);
    // An unchanged enrolment id is direct source evidence even after an official date/type correction.
    const previous = previousSessions.filter(old => old.courseId === session.courseId &&
      [...officialIds(old)].some(id => ids.has(id)));
    if (previous.length !== 1) return session;
    const old = previous[0], currentRefs = (session.sourceReferences ?? []).map(ref => ({ ...ref, historical: false }));
    const history = (old.sourceReferences ?? []).filter(ref => !currentRefs.some(current => current.sourceUrl === ref.sourceUrl && current.officialId === ref.officialId))
      .map(ref => ({ ...ref, historical: true, lastVerifiedAt: ref.lastVerifiedAt ?? old.provenance.lastVerifiedAt }));
    return { ...session, id: old.id, canonicalOfficialId: old.canonicalOfficialId ?? old.officialId,
      sourceReferences: [...currentRefs, ...history] };
  });
}

export function dedupeExamSessions(sessions: readonly BarbExamSession[]): BarbExamSession[] {
  const unique = new Map<string, BarbExamSession>();
  for (const session of sessions) {
    const key = barbExamSourceUid(session);
    const sameSitting = (candidate: BarbExamSession) =>
      (candidate.aliasEvidenceUrl || session.aliasEvidenceUrl) &&
      candidate.courseId === session.courseId && candidate.date === session.date &&
      candidate.type === session.type && candidate.commission === session.commission &&
      candidate.component === session.component && candidate.time === session.time && candidate.location === session.location;
    const previous = unique.get(key) ?? [...unique.values()].find(sameSitting);
    if (!previous) { unique.set(key, { ...session, sourceReferences: [...(session.sourceReferences ?? [])] }); continue; }
    if (previous.date !== session.date || previous.type !== session.type || previous.time !== session.time || previous.location !== session.location) {
      throw new Error(`Fonti discordanti per l'appello ufficiale ${session.officialId}`);
    }
    const refs = [...(previous.sourceReferences ?? []), ...(session.sourceReferences ?? [])];
    previous.sourceReferences = refs.filter((ref, i) => refs.findIndex(r => r.sourceUrl === ref.sourceUrl && r.officialId === ref.officialId) === i);
    previous.notes = [...new Set([previous.notes, session.notes].filter(Boolean))].join("\n") || null;
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.courseId.localeCompare(b.courseId));
}

export function getExamStatus(session: BarbExamSession, allSessions: readonly BarbExamSession[], today: string): "passato" | "prossimo" | "futuro" {
  if (session.date < today) return "passato";
  const earliest = allSessions.filter(s => s.courseId === session.courseId && s.date >= today).map(s => s.date).sort()[0];
  return !earliest || session.date === earliest ? "prossimo" : "futuro";
}

export function findSameDayExamCollisions(sessions: readonly BarbExamSession[]): Array<{ date: string; courseIds: string[]; sessions: BarbExamSession[] }> {
  const dates = new Map<string, BarbExamSession[]>();
  for (const session of sessions) dates.set(session.date, [...(dates.get(session.date) ?? []), session]);
  return [...dates].map(([date, values]) => ({ date, courseIds: [...new Set(values.map(s => s.courseId))].sort(), sessions: values }))
    .filter(group => group.courseIds.length > 1).sort((a, b) => a.date.localeCompare(b.date));
}

export function validateExamDataset(data: BarbExamDataset): string[] {
  const errors: string[] = [], ids = new Set<string>(), uids = new Set<string>();
  if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.sources) || !Array.isArray(data.additionalCourses) || !Array.isArray(data.unmatched)) return ["Struttura dataset appelli non valida"];
  const officialUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        (url.hostname === "unimi.it" || url.hostname.endsWith(".unimi.it"));
    } catch { return false; }
  };
  const courseIds = new Set([...BARB_DATASET.courses, ...data.additionalCourses].map(c => c.id));
  if (data.checkedAt !== null && !Number.isFinite(Date.parse(data.checkedAt))) errors.push("Data di verifica non valida");
  if (data.sessions.length && !data.checkedAt) errors.push("Dataset con appelli senza data di verifica");
  for (const source of data.sources) {
    if (!officialUrl(source.url)) errors.push(`Fonte non ufficiale: ${source.url}`);
    if (!["verificato", "non-verificato", "non-pubblicato"].includes(source.status)) errors.push(`Stato fonte non valido: ${source.url}`);
  }
  for (const session of data.sessions) {
    if (!session.id || ids.has(session.id)) errors.push(`Identità appello duplicata o assente: ${session.id}`);
    ids.add(session.id);
    const uid = barbExamSourceUid(session);
    if (uids.has(uid)) errors.push(`Identità di import duplicata: ${uid}`);
    uids.add(uid);
    if (!courseIds.has(session.courseId)) errors.push(`Corso sconosciuto: ${session.courseId}`);
    if (!session.courseId || !isExamDate(session.date)) errors.push(`Corso o data non validi: ${session.id}`);
    for (const field of ["type", "time", "location", "notes", "registrationOpens", "registrationCloses"] as const) {
      if (session[field] !== null && typeof session[field] !== "string") errors.push(`Campo ${field} non valido o assente: ${session.id}`);
    }
    if (session.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.time)) errors.push(`Ora non valida: ${session.id}`);
    for (const value of [session.registrationOpens, session.registrationCloses]) if (value !== null && !isExamDate(value)) errors.push(`Iscrizione non valida: ${session.id}`);
    if ((session.registrationOpens && session.registrationCloses && session.registrationOpens > session.registrationCloses) ||
      (session.registrationCloses && session.registrationCloses > session.date)) errors.push(`Iscrizioni incoerenti: ${session.id}`);
    if (!session.provenance || !officialUrl(session.provenance.sourceUrl)) { errors.push(`Fonte non ufficiale: ${session.id}`); continue; }
    if (![session.provenance.retrievedAt, session.provenance.lastVerifiedAt].every(value => Number.isFinite(Date.parse(value)))) errors.push(`Provenienza senza data: ${session.id}`);
    for (const ref of session.sourceReferences ?? []) {
      if (!officialUrl(ref.sourceUrl)) errors.push(`Fonte di iscrizione non ufficiale: ${session.id}`);
      if (!ref.sourceRecord || typeof ref.sourceRecord !== "object") errors.push(`Record fonte assente: ${session.id}`);
      for (const date of [ref.registrationOpens, ref.registrationCloses]) if (date !== null && !isExamDate(date)) errors.push(`Data fonte non valida: ${session.id}`);
      if ((ref.registrationOpens && ref.registrationCloses && ref.registrationOpens > ref.registrationCloses) ||
        (ref.registrationCloses && ref.registrationCloses > session.date)) errors.push(`Iscrizione fonte incoerente: ${session.id}`);
    }
  }
  return errors;
}
