import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBarbExamImport } from '../src/lib/barbExamImport.ts';

const course = { id: 'stem', name: 'Cellule staminali', semester: 'primo' };
const subject = { id: 's1', name: course.name, universityCourseId: course.id, status: 'active', archived: false, color: '#123456' };
const session = { id: 'stem-2027-01-18', courseId: course.id, date: '2027-01-18', type: 'Orale', time: null, location: null, notes: null, registrationOpens: null, registrationCloses: null, provenance: { sourceUrl: 'https://work.unimi.it/foProssimiEsami/pdf/FBG', retrievedAt: '2026-10-05T10:00:00Z', lastVerifiedAt: '2026-10-05T10:00:00Z', sourcePage: 1 } };
// «Oggi» fisso: i test non dipendono dal giorno in cui girano.
const TODAY = '2026-10-05';
const prepare = (sessions = [session], subjects = [subject], events = []) => prepareBarbExamImport(sessions, [course], subjects, events, sessions, TODAY);

test('Import: data senza orario diventa promemoria giornaliero senza aula o durata inventata', () => {
  const { events, skipped } = prepare();
  assert.equal(skipped, 0);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.subjectId, subject.id);
  assert.equal(event.category, 'exam');
  assert.equal(event.allDay, true);
  assert.equal(new Date(event.start).getDate(), 18);
  assert.equal(new Date(event.start).getHours(), 0);
  assert.equal(new Date(event.end).getDate(), 19);
  assert.ok(event.sourceUid);
  assert.deepEqual(event.links, [session.provenance.sourceUrl]);
  assert.match(event.description, /Orario non pubblicato/);
  assert.match(event.description, /Sede non pubblicata/);
});

test('Import: import ripetuto e selezione ripetuta non creano duplicati', () => {
  const first = prepare();
  const second = prepare([session, session], [subject], first.events);
  assert.equal(second.events.length, 0);
  assert.equal(second.skipped, 2);
  assert.equal(prepare([session, session]).events.length, 1);
});

test('Import: ignora corsi fuori dal piano, archiviati e superati', () => {
  assert.equal(prepare([session], []).events.length, 0);
  for (const patch of [{ archived: true }, { status: 'archived' }, { status: 'completed' }]) {
    assert.equal(prepare([session], [{ ...subject, ...patch }]).events.length, 0);
  }
});

test('Import: mantiene orari e sede ufficiali nei dettagli senza inventare una fine', () => {
  const official = { ...session, time: '14:30', location: 'Aula B8', notes: 'Portare documento', registrationCloses: '2027-01-14' };
  const event = prepare([official]).events[0];
  assert.equal(event.allDay, true);
  assert.match(event.description, /14:30/);
  assert.match(event.description, /Aula B8/);
  assert.match(event.description, /Portare documento/);
  // Date leggibili, niente ISO grezzo né «(Europe/Rome)».
  assert.match(event.notes, /Chiusura iscrizioni: 14 gennaio 2027/);
  assert.doesNotMatch(event.description, /Europe\/Rome/);
  assert.match(event.notes, /Verificato il 5 ottobre 2026/);
  assert.doesNotMatch(event.notes, /T10:00:00Z/);
});

test('Import: impedisce date impossibili e origini non ufficiali', () => {
  assert.equal(prepare([{ ...session, date: '2027-02-30' }]).events.length, 0);
  assert.equal(prepare([{ ...session, provenance: { ...session.provenance, sourceUrl: 'https://fake.unimi.it.example.com/data' } }]).events.length, 0);
});

test('Import: la data ufficiale resta la stessa tra dispositivi in fusi diversi e nell’export ICS', async () => {
  const { buildIcs } = await import('../src/lib/ics.ts');
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Rome';
    const event = prepare().events[0];
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(new Date(event.start).getDate(), 18);
    const ics = buildIcs({ events: [{ id: 'e', ...event }], exams: [], tasks: [], subjects: [] });
    assert.match(ics, /DTSTART;VALUE=DATE:20270118/);
    assert.match(ics, /DTEND;VALUE=DATE:20270119/);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('Import: due dispositivi e un backup parziale uniscono lo stesso promemoria senza duplicarlo', async () => {
  const { barbReminderEventId } = await import('../src/lib/barbExamImport.ts');
  const { planMerge } = await import('../src/lib/syncMerge.ts');
  const { normalizeCollections } = await import('../src/lib/collections.ts');
  const fromA = prepare().events[0], fromB = prepare().events[0];
  const a = { ...fromA, id: barbReminderEventId(fromA.sourceUid), updatedAt: '2026-10-05T10:00:00Z' };
  const b = { ...fromB, id: barbReminderEventId(fromB.sourceUid), updatedAt: '2026-10-05T11:00:00Z' };
  assert.equal(a.id, b.id);
  const plan = planMerge([{ entity_type: 'calendarEvent', entity_id: b.id, payload: b, deleted: false, updated_at: b.updatedAt }], normalizeCollections({ events: [a] }), new Map());
  const merged = new Map([[a.id, a]]);
  plan.changes.forEach(change => merged.set(change.entity.id, change.entity));
  assert.equal(merged.size, 1);
});

test('Import ICS ed editing: un appello resta date-only dopo il salvataggio e cambio fuso', async () => {
  const { buildIcs, parseIcs } = await import('../src/lib/ics.ts');
  const { preserveBarbReminderDates } = await import('../src/lib/barbExamImport.ts');
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Rome';
    const event = prepare().events[0];
    const imported = parseIcs(buildIcs({ events: [{ id: 'e', ...event }], exams: [], tasks: [], subjects: [] })).events[0];
    const saved = preserveBarbReminderDates({ ...imported, sourceUid: imported.uid });
    assert.match(saved.start, /^2027-01-18T00:00:00$/);
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(new Date(saved.start).getDate(), 18);
    assert.equal(new Date(saved.end).getDate(), 19);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('Import: un appello già passato non si aggiunge (neanche da agenti o MCP); quello di oggi sì', () => {
  const past = { ...session, id: 'stem-2026-07-01', date: '2026-07-01' };
  const today = { ...session, id: 'stem-2026-10-05', date: TODAY };
  const { events, skipped } = prepare([past, today]);
  assert.equal(skipped, 1);
  assert.deepEqual(events.map((event) => event.start.slice(0, 10)), [TODAY]);
});

test('Import: senza «oggi» esplicito vale il giorno di Roma (un appello del 2020 è passato)', async () => {
  const { barbTodayKey } = await import('../src/lib/barbExamImport.ts');
  // Le 23:30 UTC del 9 sono già il 10 a Roma.
  assert.equal(barbTodayKey(new Date('2026-11-09T23:30:00Z')), '2026-11-10');
  const old = { ...session, id: 'stem-2020-01-10', date: '2020-01-10' };
  assert.equal(prepareBarbExamImport([old], [course], [subject], []).events.length, 0);
});

test('Import: dal feed JSON il link va alla pagina degli appelli BARB; il feed resta come dato tecnico', async () => {
  const { BARB_EXAMS_PAGE_URL, BARB_EXAM_DATA } = await import('../src/lib/university/examSessions.ts');
  const feed = 'https://work.unimi.it/foProssimiEsami/json/FBG';
  const event = prepare([{ ...session, time: '14:00', provenance: { ...session.provenance, sourceUrl: feed } }]).events[0];
  assert.deepEqual(event.links, [BARB_EXAMS_PAGE_URL]);
  assert.match(event.notes, /Dati ufficiali UNIMI \(formato tecnico\): https:\/\/work\.unimi\.it\/foProssimiEsami\/json\/FBG/);
  assert.match(event.description, /Orario ufficiale: 14:00$/m);
  // La pagina non è inventata: è tra le fonti verificate del dataset.
  assert.ok(BARB_EXAM_DATA.sources.some((source) => source.url === BARB_EXAMS_PAGE_URL && source.status === 'verificato'));
});

test('Fonti: la nota del feed dice il giorno della verifica, non un timestamp', async () => {
  const { BARB_EXAM_DATA, barbCheckedDay, isTechnicalFeedUrl } = await import('../src/lib/university/examSessions.ts');
  const note = BARB_EXAM_DATA.sources.find((source) => source.url.endsWith('/json/FBG'))?.note ?? '';
  assert.doesNotMatch(note, /\d{4}-\d{2}-\d{2}T/);
  assert.equal(barbCheckedDay('2026-11-09T17:09:19.598Z'), '9 novembre 2026');
  // Le 23:30 UTC del 9 sono già il 10 a Roma.
  assert.equal(barbCheckedDay('2026-11-09T23:30:00.000Z'), '10 novembre 2026');
  assert.equal(isTechnicalFeedUrl('https://work.unimi.it/foProssimiEsami/json/F92'), true);
  assert.equal(isTechnicalFeedUrl('https://work.unimi.it/foProssimiEsami/pdf/F92'), false);
  assert.equal(isTechnicalFeedUrl('non un url'), false);
});
