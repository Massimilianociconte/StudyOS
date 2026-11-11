import test from "node:test";
import assert from "node:assert/strict";
import {
  STATS_PERIODS,
  countInRange,
  largestRemainderPercents,
  minutesBySubject,
  minutesByTopic,
  periodRange,
  recentTrend,
  semesterRange,
  sessionSummary,
  sessionsInRange,
  studyTotals,
  subjectSessions,
  trendBuckets,
  trendUnit
} from "../src/lib/studyStats.ts";
import { workloadBySubject } from "../src/lib/selectors.ts";
import { NO_SUBJECT_LABEL, NO_TOPIC_LABEL } from "../src/lib/labels.ts";

// Date locali: i periodi seguono il calendario della persona, non UTC.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const OFFICIAL = [
  { id: "primo", startDate: "2026-09-28" },
  { id: "secondo", startDate: null }
];

let seq = 0;
const session = (start, minutes, extra = {}) => ({
  id: `s${++seq}`,
  title: "Studio",
  template: "new-topic",
  plannedMinutes: minutes,
  actualMinutes: minutes,
  start: start.toISOString(),
  end: new Date(start.getTime() + minutes * 60_000).toISOString(),
  focusLevel: 3,
  status: "completed",
  createdAt: start.toISOString(),
  updatedAt: start.toISOString(),
  ...extra
});

const subjects = [
  { id: "an", name: "Analisi", color: "#ff0000", archived: false },
  { id: "bio", name: "Biologia", color: "#00ff00", archived: true },
  { id: "chim", name: "Chimica", color: "#0000ff", archived: false }
];

test("periodi: settimana, mese, semestre", () => {
  assert.deepEqual([...STATS_PERIODS], ["week", "month", "semester"]);
  assert.equal(trendUnit("week"), "day");
  assert.equal(trendUnit("month"), "day");
  assert.equal(trendUnit("semester"), "week");
});

test("settimana: da lunedì a lunedì, con spostamento", () => {
  const now = local(2026, 11, 11, 10); // mercoledì
  const week = periodRange("week", now);
  assert.equal(week.period, "week");
  assert.equal(day(week.start), "2026-11-09");
  assert.equal(day(week.end), "2026-11-16");
  assert.equal(week.start.getHours(), 0);
  const before = periodRange("week", now, { offset: -1 });
  assert.equal(day(before.start), "2026-11-02");
  assert.equal(day(before.end), "2026-11-09");
});

test("mese: dal primo al primo del mese dopo, anche indietro di un anno", () => {
  const now = local(2026, 11, 11, 10);
  const month = periodRange("month", now);
  assert.equal(day(month.start), "2026-11-01");
  assert.equal(day(month.end), "2026-12-01");
  const old = periodRange("month", now, { offset: -11 });
  assert.equal(day(old.start), "2025-12-01");
  assert.equal(day(old.end), "2026-01-01");
});

test("semestre: date ufficiali quando ci sono, altrimenti 1 ottobre e 1 marzo", () => {
  const now = local(2026, 11, 11, 10);
  const current = periodRange("semester", now, { semesters: OFFICIAL });
  assert.equal(current.semesterId, "primo");
  assert.equal(current.academicYear, "2026/2027");
  assert.equal(day(current.start), "2026-09-28");
  assert.equal(day(current.end), "2027-03-01");

  const previous = periodRange("semester", now, { semesters: OFFICIAL, offset: -1 });
  assert.equal(previous.semesterId, "secondo");
  assert.equal(previous.academicYear, "2025/2026");
  assert.equal(day(previous.start), "2026-03-01");
  assert.equal(day(previous.end), "2026-09-28", "i semestri sono contigui: la sessione estiva sta nel secondo");

  const next = periodRange("semester", now, { semesters: OFFICIAL, offset: 1 });
  assert.equal(next.semesterId, "secondo");
  assert.equal(next.academicYear, "2026/2027");
  assert.equal(day(next.start), "2027-03-01");
  assert.equal(day(next.end), "2027-10-01");

  const twoBack = periodRange("semester", now, { semesters: OFFICIAL, offset: -2 });
  assert.equal(twoBack.semesterId, "primo");
  assert.equal(day(twoBack.start), "2025-10-01");
  assert.equal(day(twoBack.end), "2026-03-01");
});

test("semestre senza date ufficiali e ai confini", () => {
  const winter = semesterRange(local(2026, 2, 15));
  assert.equal(winter.semesterId, "primo");
  assert.equal(winter.academicYear, "2025/2026");
  assert.equal(day(winter.start), "2025-10-01");
  assert.equal(day(winter.end), "2026-03-01");

  const summer = semesterRange(local(2026, 7, 15));
  assert.equal(summer.semesterId, "secondo");
  assert.equal(day(summer.start), "2026-03-01");
  assert.equal(day(summer.end), "2026-10-01");

  assert.equal(semesterRange(local(2026, 3, 1)).semesterId, "secondo", "il primo giorno appartiene al semestre che inizia");
  assert.equal(semesterRange(local(2026, 2, 28, 23, 59)).semesterId, "primo");

  const officialSecond = semesterRange(local(2027, 2, 24), [
    { id: "primo", startDate: "2026-09-28" },
    { id: "secondo", startDate: "2027-02-23" }
  ]);
  assert.equal(officialSecond.semesterId, "secondo");
  assert.equal(day(officialSecond.start), "2027-02-23");

  const broken = semesterRange(local(2026, 11, 11), [{ id: "primo", startDate: "non è una data" }]);
  assert.equal(day(broken.start), "2026-10-01", "date ufficiali non valide vengono ignorate");
});

test("sessioni nel periodo: solo completate, inizio dentro [start, end)", () => {
  const range = periodRange("week", local(2026, 11, 11, 10));
  const inside = session(local(2026, 11, 9, 0, 0), 30);
  const sunday = session(local(2026, 11, 15, 23, 30), 60);
  const nextMonday = session(local(2026, 11, 16, 0, 0), 40);
  const before = session(local(2026, 11, 8, 23, 59), 20);
  const planned = session(local(2026, 11, 10, 9), 50, { status: "planned" });
  const broken = { ...session(local(2026, 11, 10, 9), 10), start: "boh" };
  const result = sessionsInRange([inside, sunday, nextMonday, before, planned, broken], range);
  assert.deepEqual(result.map((item) => item.id), [inside.id, sunday.id]);
});

test("ore per materia: 'Senza materia' raccoglie il resto, il totale torna", () => {
  const list = [
    session(local(2026, 11, 9, 9), 60, { subjectId: "an" }),
    session(local(2026, 11, 9, 11), 30, { subjectId: "bio" }),
    session(local(2026, 11, 10, 9), 20),
    session(local(2026, 11, 10, 11), 10, { subjectId: "deleted" }),
    session(local(2026, 11, 10, 15), 100, { subjectId: "an", status: "skipped" })
  ];
  const entries = minutesBySubject(subjects, list);
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.name, entry.minutes]),
    [
      ["an", "Analisi", 60],
      ["bio", "Biologia", 30],
      [null, NO_SUBJECT_LABEL, 30]
    ]
  );
  assert.equal(entries[0].color, "#ff0000");
  assert.equal(typeof entries[2].color, "string");
  const total = list.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.actualMinutes, 0);
  assert.equal(entries.reduce((sum, entry) => sum + entry.minutes, 0), total);
  assert.deepEqual(minutesBySubject(subjects, []), []);
});

test("andamento: un punto al giorno per settimana e mese, a settimana per il semestre", () => {
  const week = periodRange("week", local(2026, 11, 11, 10));
  const list = [
    session(local(2026, 11, 9, 9), 60),
    session(local(2026, 11, 9, 20), 30),
    session(local(2026, 11, 15, 23, 30), 45),
    session(local(2026, 11, 20, 9), 999)
  ];
  const days = trendBuckets(list, week);
  assert.equal(days.length, 7);
  assert.equal(day(days[0].start), "2026-11-09");
  assert.equal(days[0].minutes, 90);
  assert.equal(days[6].minutes, 45, "conta il giorno di inizio");
  assert.equal(days.slice(1, 6).reduce((sum, bucket) => sum + bucket.minutes, 0), 0);

  const month = trendBuckets(list, periodRange("month", local(2026, 11, 11)));
  assert.equal(month.length, 30);
  assert.equal(month.reduce((sum, bucket) => sum + bucket.minutes, 0), 60 + 30 + 45 + 999);

  const semester = periodRange("semester", local(2026, 11, 11), { semesters: OFFICIAL });
  const weeks = trendBuckets([session(local(2026, 9, 28, 9), 50), session(local(2026, 10, 4, 22), 10), session(local(2026, 10, 5, 8), 25), session(local(2027, 2, 28, 9), 5)], semester);
  assert.equal(day(weeks[0].start), "2026-09-28");
  assert.equal(weeks[0].minutes, 60, "la settimana va da lunedì a domenica");
  assert.equal(weeks[1].minutes, 25);
  assert.equal(weeks.at(-1).minutes, 5);
  assert.equal(weeks.reduce((sum, bucket) => sum + bucket.minutes, 0), 90);
  for (const bucket of weeks.slice(1)) assert.equal(bucket.start.getDay(), 1, "dopo la prima, le settimane iniziano di lunedì");
  assert.ok(weeks.every((bucket) => bucket.end <= semester.end));
});

test("riepilogo: numero di sessioni, media e provenienza", () => {
  const list = [
    session(local(2026, 11, 9, 9), 25, { source: "pomodoro" }),
    session(local(2026, 11, 9, 10), 25, { source: "pomodoro" }),
    session(local(2026, 11, 9, 14), 70, { source: "stopwatch" }),
    session(local(2026, 11, 9, 16), 90, { source: "timer" }),
    session(local(2026, 11, 10, 9), 60, { source: "manual" }),
    session(local(2026, 11, 10, 15), 21),
    session(local(2026, 11, 10, 18), 500, { status: "planned", source: "manual" })
  ];
  const summary = sessionSummary(list);
  assert.equal(summary.count, 6);
  assert.equal(summary.totalMinutes, 291);
  assert.equal(summary.averageMinutes, 49, "291 / 6 = 48,5 → 49");
  assert.deepEqual(summary.bySource, {
    pomodoro: { count: 2, minutes: 50 },
    timer: { count: 1, minutes: 90 },
    stopwatch: { count: 1, minutes: 70 },
    manual: { count: 1, minutes: 60 },
    unknown: { count: 1, minutes: 21 }
  });
  const empty = sessionSummary([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.averageMinutes, 0);
});

test("workloadBySubject non perde più le sessioni senza materia", () => {
  const list = [
    session(local(2026, 11, 9, 9), 60, { subjectId: "an" }),
    session(local(2026, 11, 9, 11), 40),
    session(local(2026, 11, 9, 12), 15, { subjectId: "gone" }),
    session(local(2026, 11, 9, 13), 99, { status: "planned" })
  ];
  const workload = workloadBySubject(subjects, list);
  assert.equal(workload.reduce((sum, item) => sum + item.minutes, 0), 115);
  const none = workload.find((item) => item.name === NO_SUBJECT_LABEL);
  assert.equal(none?.minutes, 55);
  assert.equal(workloadBySubject(subjects, [list[0]]).some((item) => item.name === NO_SUBJECT_LABEL), false, "nessuna riga vuota in più");
});

// ---------- percentuali, materia, argomenti ----------

test("largestRemainderPercents: la somma fa sempre 100", () => {
  assert.deepEqual(largestRemainderPercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(largestRemainderPercents([50, 30, 20]), [50, 30, 20]);
  assert.deepEqual(largestRemainderPercents([2, 1]), [67, 33]);
  assert.deepEqual(largestRemainderPercents([0, 0]), [0, 0], "senza minuti nessuna percentuale");
  assert.deepEqual(largestRemainderPercents([]), []);
  const many = largestRemainderPercents([13, 27, 7, 7, 46, 1]);
  assert.equal(many.reduce((sum, value) => sum + value, 0), 100);
  assert.ok(many.every((value) => Number.isInteger(value) && value >= 0));
});

test("subjectSessions e studyTotals: solo le sessioni completate della materia, una volta sola", () => {
  const now = local(2026, 11, 11, 18);
  const list = [
    session(local(2026, 11, 11, 9), 50, { subjectId: "an" }),
    session(local(2026, 11, 11, 14), 25, { subjectId: "an" }),
    session(local(2026, 11, 10, 9), 60, { subjectId: "an" }),
    session(local(2026, 11, 3, 9), 40, { subjectId: "an" }),
    session(local(2026, 10, 30, 9), 30, { subjectId: "an" }),
    session(local(2026, 11, 11, 10), 90, { subjectId: "chim" }),
    session(local(2026, 11, 11, 11), 45, { subjectId: "an", status: "planned" })
  ];
  const mine = subjectSessions(list, "an");
  assert.equal(mine.length, 5);
  assert.deepEqual(mine.map((item) => item.actualMinutes), [25, 50, 60, 40, 30], "dalla più recente");
  assert.deepEqual(studyTotals(mine, now), { total: 205, today: 75, week: 135, month: 175, count: 5 });
  assert.deepEqual(studyTotals([], now), { total: 0, today: 0, week: 0, month: 0, count: 0 });
});

test("recentTrend: ultimi giorni, settimane o mesi fino a oggi", () => {
  const now = local(2026, 11, 11, 18);
  const list = [
    session(local(2026, 11, 11, 9), 50),
    session(local(2026, 11, 10, 9), 60),
    session(local(2026, 11, 2, 9), 30),
    session(local(2026, 10, 15, 9), 20),
    session(local(2025, 12, 1, 9), 99)
  ];
  const days = recentTrend(list, "day", now);
  assert.equal(days.length, 14);
  assert.equal(day(days.at(-1).start), "2026-11-11");
  assert.equal(day(days[0].start), "2026-10-29");
  assert.deepEqual(days.slice(-2).map((bucket) => bucket.minutes), [60, 50]);
  const weeks = recentTrend(list, "week", now);
  assert.equal(weeks.length, 12);
  assert.equal(day(weeks.at(-1).start), "2026-11-09", "da lunedì");
  assert.equal(weeks.at(-1).minutes, 110);
  assert.equal(weeks.at(-2).minutes, 30);
  const months = recentTrend(list, "month", now);
  assert.equal(months.length, 12);
  assert.equal(day(months.at(-1).start), "2026-11-01");
  assert.equal(day(months[0].start), "2025-12-01");
  assert.deepEqual([months[0].minutes, months.at(-2).minutes, months.at(-1).minutes], [99, 20, 140]);
  assert.equal(months.reduce((sum, bucket) => sum + bucket.minutes, 0), 259, "ogni sessione in un solo mese");
  assert.equal(recentTrend(list, "day", now, 3).length, 3);
});

test("minutesByTopic: tempo per argomento, 'Senza argomento' in fondo", () => {
  const topics = [
    { id: "lim", subjectId: "an", title: "Limiti" },
    { id: "der", subjectId: "an", title: "Derivate" }
  ];
  const list = [
    session(local(2026, 11, 11, 9), 50, { topicId: "der" }),
    session(local(2026, 11, 11, 10), 30, { topicId: "lim" }),
    session(local(2026, 11, 11, 11), 40, { topicId: "lim" }),
    session(local(2026, 11, 11, 12), 15),
    session(local(2026, 11, 11, 13), 5, { topicId: "gone" }),
    session(local(2026, 11, 11, 14), 99, { topicId: "lim", status: "planned" })
  ];
  assert.deepEqual(minutesByTopic(list, topics), [
    { id: "lim", title: "Limiti", minutes: 70, count: 2 },
    { id: "der", title: "Derivate", minutes: 50, count: 1 },
    { id: null, title: NO_TOPIC_LABEL, minutes: 20, count: 2 }
  ]);
  assert.deepEqual(minutesByTopic([], topics), []);
});

test("countInRange: attività completate e ripassi nel periodo scelto", () => {
  const range = periodRange("week", local(2026, 11, 11, 12));
  const dates = [local(2026, 11, 9, 0).toISOString(), local(2026, 11, 15, 23, 59).toISOString(), local(2026, 11, 16).toISOString(), undefined, "rotto"];
  assert.equal(countInRange(dates, range), 2);
});
