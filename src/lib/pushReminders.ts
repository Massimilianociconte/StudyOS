// Promemoria con l'app chiusa: quali righe di `studyos_push_reminders` (supabase/push-reminders.sql)
// servono per i prossimi 7 giorni e cosa cambiare rispetto a quelle già sul server.
// Puro e senza supabase-js: lo usano il watcher dei promemoria (stesso tag della notifica) e
// pushReminderSync (che scrive le righe), e i test.
//
// Stessi promemoria del watcher ad app aperta (planReminders): quelli degli eventi del calendario,
// compresi gli esami e gli appelli importati, che sono eventi. Attività ed esami senza evento non
// hanno promemoria impostabili.
import type { CalendarEvent, Preferences } from "../types";
import { planReminders, reminderWhenText } from "./eventReminders";
import { EVENT_REMINDER_TEXT } from "./labels/eventReminders";

const DAY_MS = 24 * 60 * 60_000;

/** Fin dove si scrivono le righe (il server ne accetta fino a 14 giorni). */
export const PUSH_REMINDER_HORIZON_MS = 7 * DAY_MS;
/** Righe scritte al massimo (le più vicine): il server ne tiene al più 300 in attesa per account. */
export const PUSH_REMINDER_MAX_ROWS = 200;
/** La notifica apre il calendario (?apri=calendario, vedi openLink.ts). */
export const PUSH_REMINDER_URL = "?apri=calendario";
/** Stessi limiti del Worker (worker/push.ts) e dei vincoli SQL. */
export const PUSH_REMINDER_TITLE_MAX = 120;
export const PUSH_REMINDER_BODY_MAX = 400;
/** Lunghezza massima della parte "chiave" di id e tag: id ≤ 166 e tag ≤ 177 caratteri (limite 200). */
const SAFE_KEY_MAX = 160;
const TAG_PREFIX = "studyos-reminder-";
const ID_PREFIX = "event:";

export interface PushReminderRow {
  id: string;
  /** ISO dell'istante del promemoria. */
  fire_at: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Hash a 53 bit (cyrb53), in esadecimale: stabile tra browser e versioni. */
const hash53 = (text: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
};

/**
 * Chiave del promemoria (evento + occorrenza + promemoria + istante) in soli caratteri ASCII
 * stampabili e senza spazi, al più 160: è così per le chiavi normali, che restano uguali. Una
 * chiave con altri caratteri o troppo lunga diventa prefisso + hash dell'originale (mai due chiavi
 * diverse sulla stessa riga per una semplice sostituzione).
 */
export const safeReminderKey = (key: string): string => {
  const text = typeof key === "string" ? key : String(key);
  const ascii = text.replace(/[^\x21-\x7e]/g, "_");
  if (ascii && ascii === text && ascii.length <= SAFE_KEY_MAX) return ascii;
  return `${ascii.slice(0, SAFE_KEY_MAX - 15)}~${hash53(text)}`;
};

/** Id della riga sul server: tipo + chiave (evento, occorrenza, promemoria, istante). */
export const reminderRowId = (key: string) => `${ID_PREFIX}${safeReminderKey(key)}`;

/**
 * Tag della notifica, uguale per la notifica mostrata dalla scheda aperta e per la push del server:
 * se partono tutte e due, la seconda sostituisce la prima e se ne vede una sola.
 */
export const reminderTagOf = (key: string) => `${TAG_PREFIX}${safeReminderKey(key)}`;

/** Taglia a `max` caratteri senza spezzare emoji (come il Worker e char_length in SQL). */
const clip = (value: string, max: number) => {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
};

/** Titolo della notifica: quello scritto nell'evento (stesso testo della notifica ad app aperta). */
export const reminderTitleOf = (title: unknown) =>
  clip((typeof title === "string" ? title : "").trim() || EVENT_REMINDER_TEXT.untitled, PUSH_REMINDER_TITLE_MAX);

/** Interruttore dell'account (Impostazioni → Profilo): assente = acceso. */
export const pushRemindersWanted = (preferences: Pick<Preferences, "pushReminders"> | null | undefined) =>
  preferences?.pushReminders !== false;

/**
 * Righe dei promemoria che scattano dopo `now` ed entro `horizonMs` (al più `max`, le più vicine).
 * Il testo è quello che la scheda aperta mostrerebbe all'istante del promemoria ("Tra 15 minuti ·
 * 09:15", "Domani"…), nel fuso del dispositivo che scrive.
 */
export function pushReminderRows(
  events: readonly CalendarEvent[],
  now: Date,
  { horizonMs = PUSH_REMINDER_HORIZON_MS, max = PUSH_REMINDER_MAX_ROWS }: { horizonMs?: number; max?: number } = {}
): PushReminderRow[] {
  const nowMs = now.getTime();
  const rows = new Map<string, PushReminderRow>();
  for (const item of planReminders(events, now, { horizonMs, graceMs: 0 })) {
    if (item.at <= nowMs) continue;
    if (rows.size >= Math.max(0, max)) break;
    const id = reminderRowId(item.key);
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      fire_at: new Date(item.at).toISOString(),
      title: reminderTitleOf(item.title),
      body: clip(reminderWhenText(item.startMs, item.allDay, new Date(item.at)), PUSH_REMINDER_BODY_MAX),
      url: PUSH_REMINDER_URL,
      tag: reminderTagOf(item.key)
    });
  }
  return [...rows.values()];
}

/** Riga letta dal server (stesse colonne di PushReminderRow; fire_at nel formato di Postgres). */
export type ServerReminderRow = PushReminderRow;

const sameInstant = (a: string, b: string) => {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && left === right;
};

const sameRow = (server: ServerReminderRow, row: PushReminderRow) =>
  sameInstant(server.fire_at, row.fire_at) &&
  server.title === row.title &&
  server.body === row.body &&
  server.url === row.url &&
  server.tag === row.tag;

/**
 * Cosa scrivere: le righe volute che mancano o sono cambiate (`upserts`) e le righe ancora in
 * attesa sul server che non servono più (`deletes`). Le righe già scattate (fire_at ≤ now) non si
 * toccano: le manda o le salta il server.
 */
export function diffPushReminders(
  desired: readonly PushReminderRow[],
  server: readonly ServerReminderRow[],
  nowMs: number
): { upserts: PushReminderRow[]; deletes: string[] } {
  const onServer = new Map(server.map((row) => [row.id, row]));
  const wanted = new Set(desired.map((row) => row.id));
  const upserts = desired.filter((row) => {
    const current = onServer.get(row.id);
    return !current || !sameRow(current, row);
  });
  const deletes = server
    .filter((row) => !wanted.has(row.id) && Date.parse(row.fire_at) > nowMs)
    .map((row) => row.id);
  return { upserts, deletes: [...new Set(deletes)] };
}

/** Impronta delle righe volute: se non cambia, la sincronizzazione può saltare la rete. */
export const pushReminderFingerprint = (rows: readonly PushReminderRow[]) =>
  hash53(rows.map((row) => [row.id, row.fire_at, row.title, row.body, row.url, row.tag].join("\u0001")).join("\u0002"));

/** A pezzi da `size`: le richieste restano corte (URL di `in.(…)` e corpo degli upsert). */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let index = 0; index < items.length; index += step) result.push(items.slice(index, index + step));
  return result;
};

/** Tabella assente (push-reminders.sql non ancora eseguito): si smette di provare fino al riavvio. */
export const isMissingReminderTable = (error: { code?: string | null; message?: string | null } | null | undefined) =>
  Boolean(error && /42P01|PGRST205|does not exist|Could not find the table/i.test(`${error.code ?? ""} ${error.message ?? ""}`));

/**
 * La sincronizzazione cloud ha finito un giro dopo l'apertura di questa pagina: i dati locali sono
 * quelli dell'account. Prima, un dispositivo rimasto chiuso a lungo riscriverebbe promemoria di
 * eventi già cancellati altrove o toglierebbe quelli creati altrove.
 */
export const syncedSincePageStart = (lastSync: string | null | undefined, pageStartMs: number) => {
  if (!lastSync) return false;
  const at = Date.parse(lastSync);
  return Number.isFinite(at) && at >= pageStartMs;
};
