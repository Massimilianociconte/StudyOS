import test from "node:test";
import assert from "node:assert/strict";
import { dueTopics, scheduleReview } from "../src/lib/review.ts";
import { formatAverage, gradeStats, librettoEntries, projectedStats } from "../src/lib/grades.ts";
import { buildIcs, foldLine, guessCategory, matchSubject, parseIcs, unescapeText } from "../src/lib/ics.ts";

// --- Ripasso a intervalli ------------------------------------------------------------

test("ripasso: gli intervalli crescono con 'Bene' e ripartono con 'Non ricordavo'", () => {
  const now = new Date(2026, 8, 29, 10, 0);
  let topic = { completedReviews: 0, intervalDays: undefined, ease: undefined };
  const intervals = [];
  for (let index = 0; index < 4; index += 1) {
    const next = scheduleReview(topic, "good", now);
    intervals.push(next.intervalDays);
    topic = { completedReviews: next.completedReviews, intervalDays: next.intervalDays, ease: next.ease };
  }
  assert.deepEqual(intervals, [1, 3, 8, 20]);
  const lapse = scheduleReview(topic, "again", now);
  assert.equal(lapse.intervalDays, 1);
  assert.ok(lapse.ease < topic.ease);
  assert.equal(lapse.memorization, 1);
  assert.equal(lapse.completedReviews, 5);
});

test("ripasso: 'Facile' allunga più di 'Bene', 'Difficile' meno; data alla mezzanotte locale", () => {
  const now = new Date(2026, 8, 29, 22, 30);
  const topic = { completedReviews: 3, intervalDays: 10, ease: 2.5 };
  const easy = scheduleReview(topic, "easy", now);
  const good = scheduleReview(topic, "good", now);
  const hard = scheduleReview(topic, "hard", now);
  assert.ok(easy.intervalDays > good.intervalDays && good.intervalDays > hard.intervalDays);
  const next = new Date(good.nextReviewDate);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getDate(), new Date(2026, 8, 29 + good.intervalDays).getDate());
  assert.ok(scheduleReview({ completedReviews: 50, intervalDays: 300, ease: 3 }, "easy", now).intervalDays <= 365);
  assert.ok(scheduleReview({ completedReviews: 2, intervalDays: 2, ease: 1.3 }, "again", now).ease >= 1.3);
});

test("ripasso: in coda oggi gli argomenti scaduti o di oggi, non archiviati", () => {
  const now = new Date(2026, 8, 29, 9, 0);
  const topics = [
    { id: "a", nextReviewDate: new Date(2026, 8, 27).toISOString(), archived: false },
    { id: "b", nextReviewDate: new Date(2026, 8, 29, 23, 0).toISOString(), archived: false },
    { id: "c", nextReviewDate: new Date(2026, 8, 30).toISOString(), archived: false },
    { id: "d", nextReviewDate: new Date(2026, 8, 20).toISOString(), archived: true },
    { id: "e", nextReviewDate: "non-una-data", archived: false }
  ];
  assert.deepEqual(dueTopics(topics, now).map((topic) => topic.id), ["a", "b"]);
});

// --- Libretto --------------------------------------------------------------------------

const subject = (id, cfu) => ({ id, name: `Materia ${id}`, cfu, archived: false });
const exam = (id, subjectId, patch) => ({ id, subjectId, date: "2026-02-01T09:00:00.000Z", status: "done", targetGrade: 28, archived: false, ...patch });

test("libretto: media aritmetica, ponderata sui CFU, base 110; lode = 30; idoneità solo CFU", () => {
  const subjects = [subject("a", 6), subject("b", 12), subject("c", 3), subject("d", 6)];
  const exams = [
    exam("1", "a", { grade: 24 }),
    exam("2", "b", { grade: 30, honors: true }),
    exam("3", "c", { passFail: true }),
    exam("4", "d", { status: "studying", grade: undefined, targetGrade: 27 })
  ];
  const entries = librettoEntries(exams, subjects);
  assert.equal(entries.length, 3);
  const stats = gradeStats(entries);
  assert.equal(stats.graded, 2);
  assert.equal(stats.arithmetic, 27);
  assert.equal(stats.weighted, 28); // (24*6 + 30*12) / 18
  assert.equal(stats.cfuEarned, 21);
  assert.equal(stats.base110, 102.67);
  assert.equal(formatAverage(stats.weighted), "28,00");
  const projection = projectedStats(entries, exams, subjects);
  assert.equal(projection.weighted, 27.75); // + 27 su 6 CFU
});

test("libretto: voti fuori scala o esami non superati non entrano", () => {
  const subjects = [subject("a", 6)];
  const entries = librettoEntries(
    [exam("1", "a", { grade: 31 }), exam("2", "a", { grade: 17 }), exam("3", "a", { status: "ready", grade: 28 }), exam("4", "a", { grade: 28, archived: true })],
    subjects
  );
  assert.equal(entries.length, 0);
  const stats = gradeStats(entries);
  assert.equal(stats.weighted, null);
  assert.equal(formatAverage(stats.weighted), "—");
});

// --- iCalendar -----------------------------------------------------------------------

const calendarEvent = (patch) => ({
  id: "ev1",
  archived: false,
  title: "Lezione; Anatomia, aula G21",
  description: "Prima riga\nSeconda",
  notes: "",
  category: "lesson",
  // 9:00–11:00 a Roma (ora legale): istanti fissi, indipendenti dal fuso di chi esegue i test.
  start: new Date(Date.UTC(2026, 8, 28, 7, 0)).toISOString(),
  end: new Date(Date.UTC(2026, 8, 28, 9, 0)).toISOString(),
  recurrence: "weekly",
  recurrenceUntil: "2026-12-18",
  status: "planned",
  ...patch
});

test("ics: export con ricorrenza, testo escapato, ora locale col fuso, righe ≤ 75 ottetti", () => {
  const text = buildIcs({
    events: [calendarEvent({})],
    exams: [{ id: "x1", subjectId: "s1", date: new Date(2026, 11, 20, 9, 0).toISOString(), archived: false }],
    tasks: [
      { id: "t1", title: "Consegna relazione", dueDate: new Date(2026, 9, 3, 18).toISOString(), status: "todo" },
      { id: "t2", title: "Già fatta", dueDate: new Date(2026, 9, 3, 18).toISOString(), status: "done" }
    ],
    subjects: [{ id: "s1", name: "Anatomia" }],
    timeZone: "Europe/Rome",
    now: new Date(Date.UTC(2026, 8, 29, 8))
  });
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /DTSTART;TZID=Europe\/Rome:20260928T090000/);
  assert.match(text, /RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z/);
  assert.match(text, /SUMMARY:Lezione\\; Anatomia\\, aula G21/);
  assert.match(text, /DESCRIPTION:Prima riga\\nSeconda/);
  assert.match(text, /SUMMARY:Esame: Anatomia/);
  assert.match(text, /DTSTART;VALUE=DATE:20261003/);
  assert.doesNotMatch(text, /Già fatta/);
  for (const line of text.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(foldLine("x".repeat(160)).split("\r\n ").join(""), "x".repeat(160));
});

test("ics: import di un orario con TZID, BYDAY su più giorni, COUNT, DURATION e VALARM", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:lez-1@unimi",
    "DTSTART;TZID=Europe/Rome:20260928T090000",
    "DTEND;TZID=Europe/Rome:20260928T110000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T225959Z",
    "SUMMARY:Anatomia dell'uomo - lezione",
    "LOCATION:Aula G21\\, Via Celoria 26",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "DESCRIPTION:Non è il testo dell'evento",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:lab-1",
    "DTSTART:20261001T130000Z",
    "DURATION:PT3H",
    "RRULE:FREQ=WEEKLY;COUNT=4",
    "SUMMARY:Laboratorio di bioinformatica con un titolo molto lungo che viene piegato su più",
    "  righe dal generatore", // piegatura RFC: il primo spazio è il marcatore, il secondo fa parte del testo
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:day-1",
    "DTSTART;VALUE=DATE:20261102",
    "SUMMARY:Sospensione didattica",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:bad",
    "SUMMARY:Senza data",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  const { events, warnings } = parseIcs(ics);
  assert.equal(events.length, 4); // lunedì + mercoledì + laboratorio + giornata intera
  const [monday, wednesday] = events;
  assert.equal(new Date(monday.start).toISOString(), "2026-09-28T07:00:00.000Z"); // 9:00 ora legale di Roma
  assert.equal(new Date(wednesday.start).getUTCDay(), 3);
  assert.equal(monday.recurrence, "weekly");
  assert.equal(monday.recurrenceUntil.slice(0, 7), "2026-12");
  assert.match(monday.description, /Luogo: Aula G21, Via Celoria 26/);
  assert.notEqual(monday.uid, wednesday.uid);
  const lab = events.find((event) => event.uid === "lab-1");
  assert.equal(new Date(lab.end).getTime() - new Date(lab.start).getTime(), 3 * 3600_000);
  assert.equal(lab.title, "Laboratorio di bioinformatica con un titolo molto lungo che viene piegato su più righe dal generatore");
  assert.equal(lab.recurrenceUntil, "2026-10-22");
  const allDay = events.find((event) => event.uid === "day-1");
  assert.equal(allDay.allDay, true);
  assert.ok(warnings.some((warning) => warning.includes("senza data valida")));
});

test("ics: round trip export → import mantiene titolo, orari e ricorrenza", () => {
  const source = calendarEvent({ title: "Fisiologia: esercitazione", recurrence: "monthly", recurrenceUntil: undefined });
  const text = buildIcs({ events: [source], exams: [], tasks: [], subjects: [], timeZone: "Europe/Rome" });
  const { events } = parseIcs(text);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, source.title);
  assert.equal(events[0].start, source.start);
  assert.equal(events[0].end, source.end);
  assert.equal(events[0].recurrence, "monthly");
});

test("ics: testo non calendario, categorie e materie suggerite", () => {
  assert.equal(parseIcs("ciao").events.length, 0);
  assert.equal(unescapeText("a\\, b\\; c\\nd\\\\e"), "a, b; c\nd\\e");
  assert.equal(guessCategory("Appello di Patologia", "lesson"), "exam");
  assert.equal(guessCategory("Laboratorio NGS", "lesson"), "lab");
  assert.equal(guessCategory("Anatomia", "lesson"), "lesson");
  const subjects = [
    { id: "g", name: "Genetica", archived: false },
    { id: "gg", name: "Genetica e genomica umana", archived: false }
  ];
  assert.equal(matchSubject("Lezione di Genetica e genomica umana (aula 3)", subjects).id, "gg");
  assert.equal(matchSubject("Biochimica", subjects), undefined);
});
