// Correzioni del gruppo al catalogo BARB: campi permessi, controllo (specchio di
// studyos_catalog_override_clean) e valori effettivi (ufficiale + correzione del gruppo).
// Il catalogo ufficiale resta com'è: la correzione vale solo per chi è nel gruppo.
import type { CatalogOverride, CatalogTargetKind, CleanResult } from "./groupExams";
import { CATALOG_OVERRIDE_FIELDS, normalizeCourseName, safeOverrideValue } from "./groupExams";
import { institutionalEmail, onlyInstitutionalEmails } from "./institutionalEmail";
import { GROUP_EXAM_FIELD_ERROR } from "./labels";
import { GROUP_EXAM_TEXT } from "./labels/groupExams";
import type { GroupHistoryEntry } from "./groupExams";

export { CATALOG_OVERRIDE_FIELDS };

const MAX_LENGTH: Record<string, number> = { phone: 40, note: 500, officeHours: 300, lessonTimes: 300, value: 300, url: 300, website: 300 };
const PHONE = /^[0-9 +()./-]{3,40}$/;
const LINK = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;

/** Campi puliti: vuoti e null tolti, spazi compattati, email in minuscolo; errori con gli stessi testi del server. */
export const cleanOverrideFields = (kind: CatalogTargetKind, input: unknown): CleanResult<Record<string, string>> => {
  const allowed = CATALOG_OVERRIDE_FIELDS[kind];
  if (!allowed) return { ok: false, field: "targetKind", message: GROUP_EXAM_FIELD_ERROR.overrideKind };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: "fields", message: GROUP_EXAM_FIELD_ERROR.overrideFields };
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.includes(key)) return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.overrideUnknown };
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "string") return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.value };
    let value = raw.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const max = MAX_LENGTH[key] ?? 160;
    if (value.length > max) return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.overrideTooLong(max) };
    if (key === "email") {
      const email = institutionalEmail(value);
      if (!email) return { ok: false, field: "email", message: GROUP_EXAM_FIELD_ERROR.overrideEmail };
      value = email;
    } else if (key === "phone" && !PHONE.test(value)) {
      return { ok: false, field: "phone", message: GROUP_EXAM_FIELD_ERROR.overridePhone };
    } else if ((key === "website" || key === "url") && !LINK.test(value)) {
      return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.overrideUrl };
    } else if (key === "website" && /^mailto:/i.test(value)) {
      return { ok: false, field: "website", message: GROUP_EXAM_FIELD_ERROR.overrideWebsite };
    }
    // url e website sono link: «%40» nel percorso (Teams, Google Calendar) non è una chiocciola.
    if (!onlyInstitutionalEmails(value, key === "url" || key === "website")) return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.overrideEmail };
    out[key] = value;
  }
  if (!Object.keys(out).length) return { ok: false, field: "fields", message: GROUP_EXAM_FIELD_ERROR.overrideEmpty };
  return { ok: true, value: out };
};

/** Id stabile di un contatto ufficiale (i contatti del catalogo non hanno id): `contatto:segreteria-studenti`. */
export const contactTargetId = (label: string) => `contatto:${normalizeCourseName(label).replaceAll(" ", "-")}`.slice(0, 160);

/** Regola d'orario di un corso: gli id delle regole valgono dentro il corso. */
export const scheduleRuleTargetId = (courseId: string, ruleId: string) => `${courseId}:${ruleId}`.slice(0, 160);

/** Contatto aggiunto dal gruppo (non c'è nel catalogo). */
export const newContactTargetId = (id: string) => `nuovo:${id}`.slice(0, 160);

/** Correzioni vive di un elemento: prima quella del gruppo scelto, poi le altre (una per gruppo). */
export const overridesOf = (overrides: readonly CatalogOverride[], kind: CatalogTargetKind, targetId: string, groupId?: string) =>
  overrides
    .filter((item) => !item.deletedAt && item.targetKind === kind && item.targetId === targetId)
    .sort((a, b) => Number(b.groupId === groupId) - Number(a.groupId === groupId) || b.updatedAt.localeCompare(a.updatedAt));

/**
 * Valori effettivi: quelli ufficiali con sopra la correzione del gruppo `groupId` (se c'è).
 * `changed` elenca i campi corretti, così l'interfaccia mostra «corretto dal gruppo».
 */
export const withOverride = <T extends Record<string, unknown>>(official: T, override: CatalogOverride | undefined) => {
  if (!override) return { value: official, changed: [] as string[], override: undefined };
  const value: Record<string, unknown> = { ...official };
  const changed: string[] = [];
  for (const [key, text] of Object.entries(override.fields)) {
    // Il client controlla di nuovo: solo campi previsti per quel tipo e indirizzi istituzionali.
    const safe = safeOverrideValue(override.targetKind, key, text);
    if (key === "note" || safe === null) continue;
    if (value[key] !== safe) changed.push(key);
    value[key] = safe;
  }
  return { value: value as T, changed, override };
};

const historyFields = (row: Record<string, unknown> | null): Record<string, string> =>
  row && row.fields && typeof row.fields === "object" ? (row.fields as Record<string, string>) : {};

/** «Ricevimento: — → mar 10-12» per ogni campo cambiato; «Correzione tolta.» / «Ripristinato.». */
export const describeOverrideEntry = (entry: GroupHistoryEntry): string[] => {
  const before = historyFields(entry.before);
  const after = historyFields(entry.after);
  const lines = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => before[field] !== after[field])
    .map((field) => `${GROUP_EXAM_TEXT.overrideField[field] ?? field}: ${before[field] || "—"} → ${after[field] || "—"}`);
  const wasDeleted = Boolean(entry.before?.deleted_at);
  const isDeleted = Boolean(entry.after?.deleted_at);
  if (wasDeleted !== isDeleted) lines.push(isDeleted ? GROUP_EXAM_TEXT.correctionRemoved : GROUP_EXAM_TEXT.restored);
  return lines;
};

/** Campo di un errore (client o server) → input di «Correggi»; il nome di un contatto è «targetLabel» per il server. */
export const overrideInputField = (kind: CatalogTargetKind, field: string | undefined): string | undefined => {
  if (!field) return undefined;
  if (field === "targetLabel") return kind === "contact" ? "label" : undefined;
  return CATALOG_OVERRIDE_FIELDS[kind]?.includes(field) ? field : undefined;
};
