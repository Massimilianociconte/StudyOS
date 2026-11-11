import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Gli stessi calcoli girano due volte: con Date nativo in Europe/Rome (riferimento) e in UTC con
// globalThis.Date = ZonedDate("Europe/Rome"), come sul Worker. I risultati devono coincidere.
const root = fileURLToPath(new URL("..", import.meta.url));

const cases = String.raw`
const fns = await import("date-fns");
const out = {};
const iso = (d) => Number.isNaN(d.getTime()) ? "NaN" : d.toISOString();
out.ctor = [
  [2026, 2, 29, 2, 30], [2026, 9, 25, 2, 30], [2026, 10, 11, 14, 30], [2026, 0, 1],
  [2026, 11, 31, 23, 59, 59, 999], [2026, 12, 1], [99, 0, 1], [2026, 2, 29, 3, 0], [2026, 9, 25, 3, 0], [2026, 1, 30]
].map((args) => iso(new Date(...args)));
out.parse = ["2026-11-11T14:30", "2026-11-11T14:30:15.5", "2026-11-11 14:30", "2026-11-11", "2026-11-11T14:30Z",
  "2026-03-29T02:30", "2026-10-25T02:30", "2026-07-01T00:00:00+02:00"].map((value) => [new Date(value).getTime(), Date.parse(value)]);
const instants = ["2026-03-28T23:00:00Z", "2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z", "2026-10-25T00:30:00Z",
  "2026-10-25T01:30:00Z", "2026-11-10T23:30:00Z", "2026-12-31T23:00:00Z", "2027-06-15T12:34:56.789Z"].map((value) => new Date(value));
out.fields = instants.map((d) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getHours(), d.getMinutes(),
  d.getSeconds(), d.getMilliseconds(), d.getTimezoneOffset()]);
out.setters = instants.map((d) => {
  const a = new Date(d.getTime()); a.setHours(0, 0, 0, 0);
  const b = new Date(d.getTime()); b.setDate(31);
  const c = new Date(d.getTime()); c.setMonth(1);
  const e = new Date(d.getTime()); e.setFullYear(2028, 1, 29);
  const f = new Date(d.getTime()); f.setMinutes(90);
  const g = new Date(d.getTime()); g.setHours(2, 30);
  return [a, b, c, e, f, g].map(iso);
});
out.fns = instants.map((d) => [
  iso(fns.startOfDay(d)), iso(fns.endOfDay(d)), iso(fns.addDays(d, 1)), iso(fns.addHours(d, 24)),
  fns.differenceInCalendarDays(d, new Date("2026-03-01T12:00:00Z")),
  fns.format(d, "yyyy-MM-dd'T'HH:mm:ssXXX EEEE"), iso(fns.startOfWeek(d, { weekStartsOn: 1 })),
  fns.isSameDay(d, fns.addHours(d, 1)), iso(fns.parseISO(fns.format(d, "yyyy-MM-dd'T'HH:mm"))),
  iso(fns.startOfMonth(d)), fns.getDay(d)
]);
out.parseISO = ["2026-03-29T02:30", "2026-10-25T02:30", "2026-11-11", "2026-11-11T09:00:00"].map((value) => iso(fns.parseISO(value)));
console.log(JSON.stringify(out));
`;

const run = (env, patched) => {
  const script = patched
    ? `const { createZonedDate } = await import("./src/agent/zonedDate.ts"); globalThis.Date = createZonedDate("Europe/Rome");\n${cases}`
    : cases;
  const result = spawnSync(process.execPath, ["--import", "./scripts/lib/register-ts.mjs", "--input-type=module", "-e", script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").pop());
};

test("ZonedDate in UTC si comporta come Date nativo in Europe/Rome", () => {
  const native = run({ TZ: "Europe/Rome" }, false);
  const zoned = run({ TZ: "UTC" }, true);
  assert.deepEqual(zoned.ctor, native.ctor);
  assert.deepEqual(zoned.parse, native.parse);
  assert.deepEqual(zoned.fields, native.fields);
  assert.deepEqual(zoned.setters, native.setters);
  assert.deepEqual(zoned.fns, native.fns);
  assert.deepEqual(zoned.parseISO, native.parseISO);
  // Il controllo serve: senza ZonedDate, in UTC i risultati sarebbero diversi.
  assert.notDeepEqual(run({ TZ: "UTC" }, false).fields, native.fields);
});

test("ZonedDate funziona anche per un fuso lontano", () => {
  const cases = String.raw`
const { createZonedDate } = await import("./src/agent/zonedDate.ts");
const Zoned = createZonedDate("America/New_York");
const d = new Zoned(2026, 10, 1, 1, 30);
console.log(JSON.stringify([d.toISOString(), d.getHours(), d.getTimezoneOffset(), new Zoned("2026-07-04T09:00").toISOString()]));
`;
  const result = spawnSync(process.execPath, ["--import", "./scripts/lib/register-ts.mjs", "--input-type=module", "-e", cases], {
    cwd: root,
    env: { ...process.env, TZ: "Asia/Tokyo" },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  // 1 novembre 2026 01:30 a New York esiste due volte: vale la prima (EDT, -4).
  assert.deepEqual(JSON.parse(result.stdout.trim()), ["2026-11-01T05:30:00.000Z", 1, 240, "2026-07-04T13:00:00.000Z"]);
});

test("withZonedDate rimette sempre il Date originale", async () => {
  const { withZonedDate, isTimeZone } = await import("../src/agent/zonedDate.ts");
  const original = globalThis.Date;
  const hours = await withZonedDate("Asia/Tokyo", async () => new Date("2026-11-11T00:00:00Z").getHours());
  assert.equal(hours, 9);
  assert.equal(globalThis.Date, original);
  await assert.rejects(withZonedDate("Europe/Rome", async () => {
    throw new Error("boom");
  }));
  assert.equal(globalThis.Date, original);
  assert.equal(isTimeZone("Europe/Rome"), true);
  assert.equal(isTimeZone("Marte/Base"), false);
  assert.equal(isTimeZone(""), false);
});

test("withZonedDate: anche il fuso «del dispositivo» (deviceTimeZone) è quello scelto, poi torna quello vero", async () => {
  const { withZonedDate } = await import("../src/agent/zonedDate.ts");
  const { deviceTimeZone } = await import("../src/lib/tz.ts");
  const native = deviceTimeZone();
  const inside = await withZonedDate("America/New_York", async () => deviceTimeZone());
  assert.equal(inside, "America/New_York");
  assert.equal(deviceTimeZone(), native);
  const nested = await withZonedDate("Asia/Tokyo", () => withZonedDate("Pacific/Honolulu", async () => deviceTimeZone()).then((zone) => [zone, deviceTimeZone()]));
  assert.deepEqual(nested, ["Pacific/Honolulu", "Asia/Tokyo"]);
  await assert.rejects(withZonedDate("Europe/Rome", async () => {
    throw new Error("boom");
  }));
  assert.equal(deviceTimeZone(), native);
});
