// Pezzi di schema dei cataloghi nuovi (appelli, extra, università). Copie delle costanti di catalog.ts:
// importarle da lì farebbe un giro (catalog.ts importa questi cataloghi). tests/agentGroupExams.test.mjs
// verifica che EVENT_REMINDERS resti uguale a quello di studyos_create_event.
import type { JsonSchema } from "./schema";

export const ID = { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9_.:-]{1,120}$", description: "Id StudyOS restituito da una lettura precedente." } as const satisfies JsonSchema;
export const LIMIT = { type: "integer", minimum: 1, maximum: 100, default: 30, description: "Quanti elementi restituire (1–100, default 30)." } as const satisfies JsonSchema;
export const OFFSET = { type: "integer", minimum: 0, maximum: 10000, default: 0, description: "Quanti elementi saltare." } as const satisfies JsonSchema;
export const QUERY = { type: "string", minLength: 0, maxLength: 200, default: "", description: "Testo da cercare nel titolo o nel nome. Vuoto = nessun filtro." } as const satisfies JsonSchema;
export const CONFIRM = { type: "boolean", enum: [true], description: "Deve essere true. Usalo solo se la persona ha chiesto esplicitamente di eliminare questo elemento." } as const satisfies JsonSchema;
export const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Giorno YYYY-MM-DD." } as const satisfies JsonSchema;
export const DAY_OR_EMPTY = { type: "string", pattern: "^(\\d{4}-\\d{2}-\\d{2})?$", description: "Giorno YYYY-MM-DD; stringa vuota = togli." } as const satisfies JsonSchema;
export const TIME_OR_EMPTY = { type: "string", pattern: "^(([01][0-9]|2[0-3]):[0-5][0-9])?$", description: "Ora HH:mm; stringa vuota = nessuna ora." } as const satisfies JsonSchema;
export const VERSION = {
  type: "integer",
  minimum: 1,
  maximum: 1000000,
  description: "version letta da un elenco. Se nel frattempo qualcuno l'ha cambiato, la scrittura si ferma con code=conflict e data.current."
} as const satisfies JsonSchema;
export const KIND = {
  type: "string",
  enum: ["appello", "preappello", "prova_in_itinere", "scritto", "orale", "laboratorio", "altro"],
  description: "Tipo di prova: appello, preappello, prova in itinere, scritto, orale, laboratorio, altra prova."
} as const satisfies JsonSchema;
export const HISTORY_ID = { type: "string", pattern: "^[0-9]{1,18}$", description: "historyId restituito da studyos_list_group_history." } as const satisfies JsonSchema;
export const EVENT_REMINDERS = {
  type: "array",
  maxItems: 10,
  description: "Promemoria (sostituiscono quelli che ci sono; [] = nessuno). Con orario: minutesBefore. Tutto il giorno: at (HH:mm) con daysBefore facoltativo.",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      minutesBefore: { type: "integer", minimum: 0, maximum: 40320 },
      daysBefore: { type: "integer", minimum: 0, maximum: 28 },
      at: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "Ora HH:mm." }
    }
  }
} as const satisfies JsonSchema;

export const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {})
});

export const pageProps = { limit: LIMIT, offset: OFFSET, query: QUERY };

/** Testo per i riassunti delle conferme. */
export const label = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim() : fallback);
