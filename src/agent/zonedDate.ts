// Date con l'ora locale di un fuso a scelta. Gli strumenti degli agenti ragionano in ora locale
// (date-fns, getHours, startOfDay) come nel browser della persona; sul server il runtime è in UTC.
// Durante un'esecuzione remota globalThis.Date diventa questa classe: l'istante resta lo stesso
// (getTime, toISOString, Date.now), cambiano solo i campi locali e l'interpretazione delle date
// senza offset. Logica pura, testata contro Node con TZ=Europe/Rome in tests/zonedDate.test.mjs.

const NativeDate = Date;
const QUARTER_HOUR = 15 * 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
/** Per fuso: offset per quarto d'ora (chiave numerica) e l'ultimo usato, che è quasi sempre quello giusto. */
type OffsetCache = { quarter: number; value: number; byQuarter: Map<number, number> };
const caches = new Map<string, OffsetCache>();

const formatterFor = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      era: "short"
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

export const isTimeZone = (value: unknown): value is string => {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
};

const exactOffset = (timeZone: string, time: number) => {
  const fields: Record<string, number> = {};
  let bc = false;
  for (const part of formatterFor(timeZone).formatToParts(new NativeDate(time))) {
    if (part.type === "era") bc = part.value.startsWith("B");
    else if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  // setUTCFullYear, non Date.UTC: gli anni 0–99 non diventano 1900–1999.
  const wall = new NativeDate(0);
  wall.setUTCFullYear(bc ? 1 - fields.year : fields.year, fields.month - 1, fields.day);
  wall.setUTCHours(fields.hour % 24, fields.minute, fields.second, 0);
  return Math.round((wall.getTime() - Math.floor(time / 1000) * 1000) / 60_000);
};

const cacheFor = (timeZone: string) => {
  let cache = caches.get(timeZone);
  if (!cache) {
    cache = { quarter: NaN, value: 0, byQuarter: new Map() };
    caches.set(timeZone, cache);
  }
  return cache;
};

const cachedOffset = (cache: OffsetCache, timeZone: string, time: number) => {
  if (!Number.isFinite(time)) return NaN;
  // I cambi d'ora cadono su quarti d'ora: un offset per quarto d'ora basta e resta in cache.
  const quarter = Math.floor(time / QUARTER_HOUR);
  if (quarter === cache.quarter) return cache.value;
  let value = cache.byQuarter.get(quarter);
  if (value === undefined) {
    value = exactOffset(timeZone, time);
    if (cache.byQuarter.size > 20_000) cache.byQuarter.clear();
    cache.byQuarter.set(quarter, value);
  }
  cache.quarter = quarter;
  cache.value = value;
  return value;
};

/** Minuti da aggiungere all'UTC per avere l'ora locale del fuso in quell'istante (come -getTimezoneOffset). */
export const zoneOffsetMinutes = (timeZone: string, time: number): number => cachedOffset(cacheFor(timeZone), timeZone, time);

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/** Classe Date con i campi locali nel fuso indicato. */
export const createZonedDate = (timeZone: string): DateConstructor => {
  if (!isTimeZone(timeZone)) throw new RangeError(`Fuso orario non valido: ${String(timeZone)}`);
  const cache = cacheFor(timeZone);
  const offset = (time: number) => cachedOffset(cache, timeZone, time);
  /**
   * Istante UTC dell'ora locale `wall` (millisecondi «come se» fosse UTC), con la regola di
   * ECMAScript: un'ora che esiste due volte prende la prima, un'ora che non esiste usa l'offset
   * di prima del cambio (quindi va avanti).
   */
  const fromWall = (wall: number) => {
    if (!Number.isFinite(wall)) return NaN;
    const before = offset(wall - 86_400_000);
    const after = offset(wall + 86_400_000);
    const early = wall - before * 60_000;
    if (before === after) return early;
    const late = wall - after * 60_000;
    const earlyValid = offset(early) === before;
    const lateValid = offset(late) === after;
    if (earlyValid && lateValid) return Math.min(early, late);
    if (lateValid) return late;
    return early;
  };
  const parse = (value: string) => {
    const match = LOCAL_ISO.exec(value.trim());
    if (!match) return NativeDate.parse(value);
    const [, year, month, day, hour, minute, second = "0", fraction = "0"] = match;
    const wall = NativeDate.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction.slice(0, 3).padEnd(3, "0")));
    return fromWall(wall);
  };

  class ZonedDate extends NativeDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super();
      } else if (args.length === 1) {
        const [value] = args;
        if (typeof value === "string") super(parse(value));
        else super(value as number);
      } else {
        const [year, month, day = 1, hour = 0, minute = 0, second = 0, ms = 0] = args.map(Number);
        super(fromWall(NativeDate.UTC(year, month, day, hour, minute, second, ms)));
      }
    }

    static parse(value: string) {
      return parse(String(value));
    }

    private wall() {
      const time = this.getTime();
      return new NativeDate(time + offset(time) * 60_000);
    }

    private setWall(change: (wall: Date) => void) {
      const time = this.getTime();
      const wall = new NativeDate(Number.isNaN(time) ? 0 : time + offset(time) * 60_000);
      change(wall);
      return this.setTime(fromWall(wall.getTime()));
    }

    getFullYear() { return this.wall().getUTCFullYear(); }
    getMonth() { return this.wall().getUTCMonth(); }
    getDate() { return this.wall().getUTCDate(); }
    getDay() { return this.wall().getUTCDay(); }
    getHours() { return this.wall().getUTCHours(); }
    getMinutes() { return this.wall().getUTCMinutes(); }
    getSeconds() { return this.wall().getUTCSeconds(); }
    getMilliseconds() { return this.wall().getUTCMilliseconds(); }
    getTimezoneOffset() {
      const time = this.getTime();
      return Number.isNaN(time) ? NaN : -offset(time);
    }

    setFullYear(...args: [number, number?, number?]) { return this.setWall((wall) => wall.setUTCFullYear(...(args as [number]))); }
    setMonth(...args: [number, number?]) { return this.setWall((wall) => wall.setUTCMonth(...(args as [number]))); }
    setDate(date: number) { return this.setWall((wall) => wall.setUTCDate(date)); }
    setHours(...args: [number, number?, number?, number?]) { return this.setWall((wall) => wall.setUTCHours(...(args as [number]))); }
    setMinutes(...args: [number, number?, number?]) { return this.setWall((wall) => wall.setUTCMinutes(...(args as [number]))); }
    setSeconds(...args: [number, number?]) { return this.setWall((wall) => wall.setUTCSeconds(...(args as [number]))); }
    setMilliseconds(ms: number) { return this.setWall((wall) => wall.setUTCMilliseconds(ms)); }
  }

  return ZonedDate as unknown as DateConstructor;
};

/**
 * Esegue `task` con globalThis.Date nel fuso indicato e lo ripristina sempre. Chi chiama deve
 * evitare esecuzioni sovrapposte (CloudRunner le serializza): il Date globale è uno solo.
 */
export const withZonedDate = async <T>(timeZone: string, task: () => Promise<T>): Promise<T> => {
  const Zoned = createZonedDate(timeZone);
  const previous = globalThis.Date;
  globalThis.Date = Zoned;
  try {
    return await task();
  } finally {
    globalThis.Date = previous;
  }
};
