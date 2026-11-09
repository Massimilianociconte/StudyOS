/** Proiezioni verso gli agenti: niente file, foto, email, codici di invito o segreti del vault. */

const clip = (value: string | undefined, max: number) => (value && value.length > max ? `${value.slice(0, max)}…` : value ?? "");

/** Campi mai inviati: copertine e file incorporati, stato interno del timer, UID degli import. */
const HIDDEN_FIELDS = new Set(["cover", "dataUrl", "avatarDataUrl", "timerStartedAt", "timerAccumulatedSeconds", "timerLastReminderAt", "sourceUid"]);

/**
 * Copia di un'entità senza i campi nascosti e senza stringhe data: (foto, file).
 * `brief` accorcia i testi lunghi negli elenchi; il dettaglio li restituisce interi.
 */
export const publicEntity = (item: object, extra: Record<string, unknown> = {}, brief: readonly string[] = []) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    if (typeof value === "string" && value.startsWith("data:")) continue;
    output[key] = brief.includes(key) && typeof value === "string" ? clip(value, 300) : value;
  }
  return { ...output, ...extra };
};

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
  ...(withNotes ? { notes: clip(item.notes, 8000) } : { notesPreview: clip(item.notes, 180) })
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
  description: clip(item.description, 500),
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
  name: item.name,
  description: item.description,
  ownerDisplayName: item.ownerDisplayName,
  archived: item.archived,
  updatedAt: item.updatedAt,
  members: item.members.map((member) => ({ displayName: member.displayName, role: member.role }))
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
