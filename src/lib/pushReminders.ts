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
import { deviceTimeZone, isValidTimeZone, utcToZonedParts, zonedToUtc } from "./tz";

const DAY_MS = 24 * 60 * 60_000;

/** Fin dove si scrivono le righe (il server ne accetta fino a 14 giorni). */
export const PUSH_REMINDER_HORIZON_MS = 7 * DAY_MS;
/** Righe scritte al massimo (le più vicine): il server ne tiene al più 400 per account (anche mandate). */
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
  /** Fuso del dispositivo che ha scritto la riga (il testo «Oggi alle 09:00» è nel suo orario). */
  zone?: string | null;
}

/** Riga voluta da questo dispositivo, con ciò che serve a rifare il testo in un altro fuso. */
export interface PlannedPushRow extends PushReminderRow {
  /** Non sono colonne: inizio dell'evento e "tutto il giorno". */
  startMs: number;
  allDay: boolean;
}

/** Solo le colonne della tabella (l'upsert non accetta campi in più). */
export const serverRowOf = (row: PushReminderRow): PushReminderRow => ({
  id: row.id,
  fire_at: row.fire_at,
  title: row.title,
  body: row.body,
  url: row.url,
  tag: row.tag,
  zone: row.zone ?? null
});

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

/** Fuso che il server accetta (push-reminders.sql) e che questo browser conosce; altrimenti nessuno. */
const ZONE = /^[A-Za-z0-9_+/-]{1,64}$/;
export const rowZoneOf = (zone: unknown): string | null =>
  typeof zone === "string" && ZONE.test(zone) && isValidTimeZone(zone) ? zone : null;

/** Fuso del sistema (Date locale): quello in cui date-fns scrive le ore. */
const systemZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/** Istante locale con la stessa ora da orologio che `ms` ha nel fuso `zone` (per scrivere l'ora di là). */
const wallIn = (ms: number, zone: string) => {
  const parts = utcToZonedParts(ms, zone);
  return zonedToUtc([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond]).getTime();
};

/**
 * Testo della notifica ("Tra 15 minuti · 09:15", "Domani"…) all'istante `atMs`, con le ore del fuso
 * `zone` (assente o uguale al sistema: quelle del dispositivo).
 */
export const reminderTextIn = (startMs: number, allDay: boolean, atMs: number, zone?: string | null) => {
  const shift = Boolean(zone && zone !== systemZone() && isValidTimeZone(zone));
  const text = shift
    ? reminderWhenText(wallIn(startMs, zone as string), allDay, new Date(wallIn(atMs, zone as string)))
    : reminderWhenText(startMs, allDay, new Date(atMs));
  return clip(text, PUSH_REMINDER_BODY_MAX);
};

/** Interruttore dell'account (Impostazioni → Profilo): assente = acceso. */
export const pushRemindersWanted = (preferences: Pick<Preferences, "pushReminders"> | null | undefined) =>
  preferences?.pushReminders !== false;

/** Evento senza un fuso suo: i promemoria "alle 20:00" e "tutto il giorno" seguono l'orologio di chi li calcola. */
const isFloating = (event: Pick<CalendarEvent, "timeZone"> | undefined) => !isValidTimeZone(event?.timeZone);

/**
 * Righe dei promemoria che scattano dopo `now` ed entro `horizonMs` (al più `max`, le più vicine).
 * Il testo è quello che la scheda aperta mostrerebbe all'istante del promemoria ("Tra 15 minuti ·
 * 09:15", "Domani"…), nel fuso del dispositivo che scrive (`zone`, scritto nella riga).
 * `zone` diverso dal sistema: le righe che scriverebbe un dispositivo in quel fuso (gli eventi senza
 * fuso suo prendono quello), per riconoscere le righe scritte da un dispositivo in un altro fuso.
 */
export function pushReminderRows(
  events: readonly CalendarEvent[],
  now: Date,
  { horizonMs = PUSH_REMINDER_HORIZON_MS, max = PUSH_REMINDER_MAX_ROWS, zone = deviceTimeZone() }: { horizonMs?: number; max?: number; zone?: string } = {}
): PlannedPushRow[] {
  const nowMs = now.getTime();
  const rowZone = rowZoneOf(zone);
  const foreign = rowZone && rowZone !== systemZone() ? rowZone : null;
  const list = foreign ? events.map((event) => (isFloating(event) ? { ...event, timeZone: foreign } : event)) : events;
  const rows = new Map<string, PlannedPushRow>();
  for (const item of planReminders(list, now, { horizonMs, graceMs: 0 })) {
    if (item.at <= nowMs) continue;
    if (rows.size >= Math.max(0, max)) break;
    const id = reminderRowId(item.key);
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      fire_at: new Date(item.at).toISOString(),
      title: reminderTitleOf(item.title),
      body: reminderTextIn(item.startMs, item.allDay, item.at, foreign),
      url: PUSH_REMINDER_URL,
      tag: reminderTagOf(item.key),
      zone: rowZone,
      startMs: item.startMs,
      allDay: item.allDay
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

/** Evento, occorrenza e promemoria senza l'istante (`…@<ms>` in fondo alla chiave). */
export const reminderSlotOf = (id: string) => id.replace(/@\d{1,16}$/, "");

/**
 * Cosa scrivere: le righe volute che mancano o sono cambiate (`upserts`) e le righe ancora in
 * attesa sul server che non servono più (`deletes`). Le righe già scattate (fire_at ≤ now) non si
 * toccano: le manda o le salta il server.
 *
 * Dispositivi in fusi diversi (`rowsInZone`, le righe che vorrebbe un dispositivo in quel fuso):
 * una riga scritta in un altro fuso e ancora giusta per quel fuso resta. Non si riscrive per il
 * testo («Oggi alle 09:00» è nell'ora di chi l'ha scritta) e, per un evento senza fuso suo, copre lo
 * stesso promemoria anche se l'istante è un altro (vince chi l'ha scritto per primo). Così due
 * dispositivi non si cancellano le righe a vicenda. Senza `rowsInZone` (interruttore spento, nessun
 * dispositivo) si tolgono tutte le righe future non volute, di ogni fuso.
 */
export function diffPushReminders(
  desired: readonly (PushReminderRow | PlannedPushRow)[],
  server: readonly ServerReminderRow[],
  nowMs: number,
  { zone, rowsInZone }: { zone?: string | null; rowsInZone?: (zone: string) => readonly PushReminderRow[] } = {}
): { upserts: PushReminderRow[]; deletes: string[] } {
  const own = zone === undefined ? desired.find((row) => row.zone)?.zone ?? null : zone;
  const mine = new Map(desired.map((row) => [row.id, row]));
  const elsewhere = new Map<string, Map<string, PushReminderRow>>();
  const wantedIn = (rowZone: string) => {
    let rows = elsewhere.get(rowZone);
    if (!rows) {
      let list: readonly PushReminderRow[] = [];
      try {
        list = rowsInZone?.(rowZone) ?? [];
      } catch {
        list = [];
      }
      rows = new Map(list.map((row) => [row.id, row]));
      elsewhere.set(rowZone, rows);
    }
    return rows;
  };
  const isForeign = (row: ServerReminderRow) => Boolean(rowsInZone && row.zone && row.zone !== own && rowZoneOf(row.zone));
  /** La riga sul server è ancora giusta: per questo fuso, o per il fuso di chi l'ha scritta. */
  const stillRight = (row: ServerReminderRow) => {
    if (isForeign(row)) {
      const there = wantedIn(row.zone as string).get(row.id);
      return Boolean(there && sameRow(row, there));
    }
    const here = mine.get(row.id);
    return Boolean(here && sameRow(row, here));
  };

  const future = server.filter((row) => Date.parse(row.fire_at) > nowMs);
  const keep = new Set<string>();
  const covered = new Set<string>();
  // Prima le righe uguali alle proprie (stesso id), poi quelle di altri fusi ancora giuste per il loro.
  for (const row of future) {
    if (mine.has(row.id) && stillRight(row)) {
      keep.add(row.id);
      covered.add(reminderSlotOf(row.id));
    }
  }
  for (const row of future) {
    if (keep.has(row.id) || !isForeign(row) || !stillRight(row)) continue;
    const slot = reminderSlotOf(row.id);
    // Due righe per lo stesso promemoria: ne resta una (la prima trovata qui sopra).
    if (covered.has(slot)) continue;
    keep.add(row.id);
    covered.add(slot);
  }
  const onServer = new Map(server.map((row) => [row.id, row]));
  const upserts = desired.filter((row) => {
    if (keep.has(row.id)) return false;
    const current = onServer.get(row.id);
    if (current && Date.parse(current.fire_at) <= nowMs) return !sameRow(current, row);
    return !covered.has(reminderSlotOf(row.id));
  });
  const written = new Set(upserts.map((row) => row.id));
  const deletes = future.filter((row) => !keep.has(row.id) && !written.has(row.id)).map((row) => row.id);
  return { upserts, deletes: [...new Set(deletes)] };
}

/** Impronta delle righe volute: se non cambia, la sincronizzazione può saltare la rete. */
export const pushReminderFingerprint = (rows: readonly PushReminderRow[]) =>
  hash53(rows.map((row) => [row.id, row.fire_at, row.title, row.body, row.url, row.tag, row.zone ?? ""].join("\u0001")).join("\u0002"));

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

/** Account della sessione seguito dalla sincronizzazione dei promemoria e da quando è quello. */
export interface ReminderAccountTrack {
  userId: string | null;
  sinceMs: number;
}

/**
 * Il primo account visto vale dall'apertura della pagina; un account diverso (anche dopo un'uscita)
 * vale da adesso: il suo `lastSync` salvato da prima non basta più.
 */
export const trackReminderAccount = (
  previous: ReminderAccountTrack | null,
  userId: string | null | undefined,
  nowMs: number,
  pageStartMs: number
): ReminderAccountTrack => {
  const id = userId ?? null;
  if (!previous) return { userId: id, sinceMs: pageStartMs };
  if (previous.userId === id) return previous;
  return { userId: id, sinceMs: nowMs };
};

/**
 * I dati nello store sono quelli dell'account della sessione e aggiornati: sync ferma, nessuna
 * scelta in sospeso tra i dati di due account («ask»), un giro finito dopo che questo account è
 * diventato quello della sessione. Altrimenti le righe di un account finirebbero in un altro.
 */
export const reminderSyncReady = (
  cloud: { userId?: string | null; status: string; lastSync?: string | null; accountChoice?: boolean },
  track: ReminderAccountTrack | null
) =>
  Boolean(
    cloud.userId &&
      track &&
      track.userId === cloud.userId &&
      cloud.status === "idle" &&
      !cloud.accountChoice &&
      syncedSincePageStart(cloud.lastSync, track.sinceMs)
  );
