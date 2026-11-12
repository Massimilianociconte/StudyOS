// Registro unico delle collezioni dati di StudyOS: usato da persistenza, backup e cloud sync.
import type { StudySnapshot } from "../types";

export const COLLECTIONS = [
  "subjects",
  "exams",
  "events",
  "tasks",
  "sessions",
  "topics",
  "attachments",
  "goals",
  "notes",
  "tags",
  "reminders",
  "widgets",
  "preferences",
  "notifications",
  "studyGroups",
  "groupInvites",
  "groupResources",
  "groupActivities",
  "examPlans"
] as const;

export type CollectionKey = (typeof COLLECTIONS)[number];

export type CollectionsState = Pick<StudySnapshot, CollectionKey>;

export interface SyncableEntity {
  id: string;
  updatedAt: string;
}

/** Nome dell'entità lato cloud (colonna `entity_type` di studyos_items). */
export const ENTITY_TYPES: Record<CollectionKey, string> = {
  subjects: "subject",
  exams: "exam",
  events: "calendarEvent",
  tasks: "task",
  sessions: "studySession",
  topics: "studyTopic",
  attachments: "attachment",
  goals: "goal",
  notes: "note",
  tags: "tag",
  reminders: "reminder",
  widgets: "widget",
  preferences: "preferences",
  notifications: "notification",
  studyGroups: "studyGroup",
  groupInvites: "groupInvite",
  groupResources: "groupResource",
  groupActivities: "groupActivity",
  examPlans: "examPlan"
};

export const COLLECTION_BY_ENTITY_TYPE: Record<string, CollectionKey> = Object.fromEntries(
  COLLECTIONS.map((key) => [ENTITY_TYPES[key], key])
) as Record<string, CollectionKey>;

export const pickCollections = (source: CollectionsState): CollectionsState =>
  Object.fromEntries(COLLECTIONS.map((key) => [key, source[key]])) as unknown as CollectionsState;

/** Garantisce che ogni collezione sia un array (backup vecchi/parziali, payload remoti incompleti). */
export const normalizeCollections = (source: Partial<Record<CollectionKey, unknown>> | null | undefined): CollectionsState =>
  Object.fromEntries(
    COLLECTIONS.map((key) => {
      const value = source?.[key];
      const items = Array.isArray(value)
        ? value.filter((item): item is SyncableEntity => Boolean(item) && typeof (item as SyncableEntity).id === "string")
        : [];
      return [key, items];
    })
  ) as unknown as CollectionsState;

export const countEntities = (source: CollectionsState) =>
  COLLECTIONS.reduce((sum, key) => sum + source[key].length, 0);

/** Confronto LWW tra timestamp ISO; valori non parsabili valgono 0. */
export const timestampOf = (value: string | undefined | null) => {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

/**
 * Timbro per una modifica che il cloud personale deve accettare: accetta solo un updatedAt più
 * recente, e con lo stesso timbro e un contenuto diverso rifiuta la riga per sempre ("Conflitto
 * cloud irrisolto"). Ora, come ogni modifica, ma sempre almeno 1 ms dopo il timbro attuale anche
 * con l'orologio indietro.
 */
export const laterStamp = (stamp: string | undefined | null, now = Date.now()) =>
  new Date(Math.max(now, timestampOf(stamp) + 1)).toISOString();
