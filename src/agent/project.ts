/**
 * Proiezioni verso gli agenti: niente file, foto, codici di invito o segreti del vault. Email: solo gli
 * indirizzi esattamente @unimi.it di docenti e contatti dell'università (AGENT_INSTITUTIONAL_EMAILS).
 */
import { institutionalEmail, redactEmails } from "../lib/institutionalEmail";

/** Lunghezza dei testi lunghi (descrizioni, note) negli elenchi. */
export const BRIEF_MAX = 300;

/** Anteprima delle note di una materia negli elenchi (il dettaglio le dà intere). */
export const SUBJECT_NOTES_PREVIEW = 180;

/** Descrizione di un materiale: sempre accorciata, non c'è un dettaglio che la dia intera. */
export const MATERIAL_DESCRIPTION_MAX = 500;

const clipped = (value: string, max: number) => `${value.slice(0, max)}…`;

const clip = (value: string | undefined, max: number) => (value && value.length > max ? clipped(value, max) : value ?? "");

/**
 * Testo inviato da un agente che contiene la copia accorciata di quello salvato (i primi `max` caratteri
 * seguiti da «…», come negli elenchi): l'agente l'ha ricostruito dall'elenco e salvarlo cancellerebbe tutto
 * ciò che stava dopo il taglio. Succedeva con le task di studio: le pagine scritte in fondo alla
 * descrizione sparivano o venivano ricontate su metà del testo.
 */
export const rebuiltFromClip = (stored: string | undefined, incoming: unknown, max = BRIEF_MAX) =>
  typeof incoming === "string" && typeof stored === "string" && stored.length > max && incoming.includes(clipped(stored, max));

/** Campi mai inviati: copertine e file incorporati, stato interno del timer, UID e impronte degli import. */
const HIDDEN_FIELDS = new Set(["cover", "dataUrl", "storedFile", "avatarDataUrl", "timerStartedAt", "timerAccumulatedSeconds", "timerLastReminderAt", "sourceUid", "sourceStamp"]);

/**
 * Copia di un'entità senza i campi nascosti e senza stringhe data: (foto, file).
 * `brief` accorcia i testi lunghi negli elenchi; il dettaglio li restituisce interi. I campi accorciati
 * finiscono in `truncated`, così l'agente sa che il testo continua (prima vedeva solo «…»).
 */
export const publicEntity = (item: object, extra: Record<string, unknown> = {}, brief: readonly string[] = []) => {
  const output: Record<string, unknown> = {};
  const truncated: string[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    if (typeof value === "string" && value.startsWith("data:")) continue;
    if (brief.includes(key) && typeof value === "string" && value.length > BRIEF_MAX) {
      output[key] = clipped(value, BRIEF_MAX);
      truncated.push(key);
    } else {
      output[key] = value;
    }
  }
  return { ...output, ...extra, ...(truncated.length ? { truncated } : {}) };
};

/** `description` di un evento negli elenchi: accorciata come le altre, con `truncated`. */
export const briefText = (value: string, field: string) =>
  value.length > BRIEF_MAX ? { [field]: clipped(value, BRIEF_MAX), truncated: [field] } : { [field]: value };

export const publicSubject = (item: {
  id: string;
  name: string;
  teacher: string;
  cfu: number;
  semester: string;
  semesterOverride?: string;
  status: string;
  targetGrade?: number;
  examDate?: string;
  color: string;
  archived: boolean;
  notes: string;
  updatedAt: string;
}, withNotes = false) => ({
  id: item.id,
  name: item.name,
  teacher: item.teacher,
  cfu: item.cfu,
  semester: item.semester,
  semesterOverride: item.semesterOverride,
  status: item.status,
  targetGrade: item.targetGrade,
  examDate: item.examDate,
  color: item.color,
  archived: item.archived,
  updatedAt: item.updatedAt,
  ...(withNotes
    ? { notes: clip(item.notes, 8000) }
    : { notesPreview: clip(item.notes, SUBJECT_NOTES_PREVIEW), ...(item.notes.length > SUBJECT_NOTES_PREVIEW ? { truncated: ["notesPreview"] } : {}) })
});

export const publicAttachment = (item: {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  addedAt: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  description: string;
  externalUrl?: string;
  updatedAt: string;
}) => ({
  id: item.id,
  name: item.name,
  mimeType: item.mimeType,
  size: item.size,
  addedAt: item.addedAt,
  linkedEntityType: item.linkedEntityType,
  linkedEntityId: item.linkedEntityId,
  description: clip(item.description, MATERIAL_DESCRIPTION_MAX),
  ...(item.description.length > MATERIAL_DESCRIPTION_MAX ? { truncated: ["description"] } : {}),
  externalUrl: item.externalUrl,
  updatedAt: item.updatedAt
});

export const publicGroup = (item: {
  id: string;
  name: string;
  description: string;
  ownerDisplayName: string;
  archived: boolean;
  updatedAt: string;
  members: Array<{ displayName: string; role: string }>;
}) => ({
  id: item.id,
  // Nomi, descrizioni e nomi dei membri li scrivono i membri: mai un indirizzo agli agenti (spec §9.3).
  name: agentMemberText(item.name),
  description: agentMemberText(item.description),
  ownerDisplayName: agentMemberText(item.ownerDisplayName),
  archived: item.archived,
  updatedAt: item.updatedAt,
  members: item.members.map((member) => ({ displayName: agentMemberText(member.displayName), role: member.role }))
});

export const publicPreferences = (item: {
  displayName: string;
  weeklyTargetMinutes: number;
  degreeCfu: number;
  showBarb: boolean;
  degreeProgram?: string;
  sbThesisGrade?: number;
  barbThesisPoints?: number;
  abroad?: boolean;
}) => ({
  displayName: item.displayName,
  weeklyTargetMinutes: item.weeklyTargetMinutes,
  degreeCfu: item.degreeCfu,
  showBarb: item.showBarb,
  degreeProgram: item.degreeProgram,
  sbThesisGrade: item.sbThesisGrade,
  barbThesisPoints: item.barbThesisPoints,
  abroad: item.abroad ?? false
});

/**
 * Decisione della persona (12/11): agli agenti arrivano gli indirizzi esattamente @unimi.it di docenti e
 * contatti dell'università. Mai quelli di studenti, membri, invitati o account. false = nessun indirizzo.
 */
export const AGENT_INSTITUTIONAL_EMAILS = true;

let institutionalAllowed = AGENT_INSTITUTIONAL_EMAILS;
/** Solo per i test: prova che con l'interruttore spento nessuno strumento mostra un indirizzo. */
export const setInstitutionalEmailsForTests = (value: boolean) => {
  institutionalAllowed = value;
};

/** Email di un docente o di un contatto: in minuscolo se è esattamente @unimi.it, altrimenti null. */
export const agentTeacherEmail = (value: unknown, allow = institutionalAllowed) => (allow ? institutionalEmail(value) : null);

/** Testo del catalogo (recapito di un contatto): restano solo gli indirizzi @unimi.it (nessuno con allow=false). */
export const agentCatalogText = (text: string | null | undefined, allow = institutionalAllowed) => redactEmails(text ?? "", allow);

/** Testo scritto dai membri (note, aule, nomi, cronologia): tutti gli indirizzi oscurati, sempre. */
export const agentMemberText = (text: string | null | undefined) => redactEmails(text ?? "", false);

/**
 * Indirizzo scritto da un membro (risorsa di un gruppo): solo http(s), mai mailto, e solo se nemmeno la
 * forma decodificata (%40) contiene un indirizzo o un @nome. Altrimenti null (undefined se lo schema non è sicuro).
 */
export const agentUrl = (value: string | null | undefined, safe: (value: string) => string | null | undefined): string | null | undefined => {
  if (!value) return undefined;
  const href = safe(value);
  // Schema non sicuro: come prima, nessun valore. Indirizzi dei membri: null.
  if (!href) return undefined;
  if (/^mailto:/i.test(href)) return null;
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // Percentuali non valide: si controlla la forma scritta.
  }
  return agentMemberText(href) !== href || agentMemberText(decoded) !== decoded ? null : href;
};
