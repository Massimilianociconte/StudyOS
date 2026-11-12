// Guida a importazione ed esportazione: riconoscimento del dispositivo, app sensate per dispositivo,
// passi per ogni combinazione (o un rimando esplicito alla strada che funziona).
import test from "node:test";
import assert from "node:assert/strict";
import { GUIDE_APPS, GUIDE_DEVICES, appsFor, detectDevice, guideFor, previewSpan, previewWhen } from "../src/lib/calendarGuide.ts";
import { parseIcs } from "../src/lib/ics.ts";
import { CALENDAR_GUIDE_STEPS, CALENDAR_GUIDE_TEXT } from "../src/lib/labels/calendarGuide.ts";

const UA = {
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36",
  chromeOnSamsung: "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  pixel: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  reducedAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadOld: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

test("riconosce il dispositivo: Samsung, Android, iPhone e iPad (anche iPadOS che si presenta come Mac), Mac, Windows", () => {
  assert.equal(detectDevice({ userAgent: UA.samsungInternet, platform: "Linux armv81", maxTouchPoints: 5 }), "samsung");
  assert.equal(detectDevice({ userAgent: UA.chromeOnSamsung, maxTouchPoints: 5 }), "samsung");
  assert.equal(detectDevice({ userAgent: UA.pixel, maxTouchPoints: 5 }), "android");
  // Chrome nasconde il modello: un Samsung con Chrome sembra un Android qualsiasi (si cambia a mano).
  assert.equal(detectDevice({ userAgent: UA.reducedAndroid, maxTouchPoints: 5 }), "android");
  assert.equal(detectDevice({ userAgent: UA.iphone, platform: "iPhone", maxTouchPoints: 5 }), "ios");
  assert.equal(detectDevice({ userAgent: UA.ipadOld, platform: "iPad", maxTouchPoints: 5 }), "ios");
  assert.equal(detectDevice({ userAgent: UA.mac, platform: "MacIntel", maxTouchPoints: 5 }), "ios");
  assert.equal(detectDevice({ userAgent: UA.mac, platform: "MacIntel", maxTouchPoints: 0 }), "macos");
  assert.equal(detectDevice({ userAgent: UA.windows, platform: "Win32", maxTouchPoints: 0 }), "windows");
  assert.equal(detectDevice({ userAgent: UA.windows, platform: "Win32", maxTouchPoints: 10 }), "windows", "PC con schermo touch");
  // Linux e Chromebook: i passi per computer (browser) sono quelli di Windows.
  assert.equal(detectDevice({ userAgent: UA.linux, platform: "Linux x86_64", maxTouchPoints: 0 }), "windows");
  // Senza dati: un computer.
  assert.equal(detectDevice({}), "windows");
  // userAgentData (Chrome): la piattaforma basta.
  assert.equal(detectDevice({ userAgent: UA.reducedAndroid, platform: "Android" }), "android");
  assert.equal(detectDevice({ userAgent: "", platform: "macOS", maxTouchPoints: 0 }), "macos");
});

test("solo le app sensate per il dispositivo, la sua per prima", () => {
  assert.deepEqual(appsFor("samsung"), ["samsung", "google", "outlook"]);
  assert.deepEqual(appsFor("android"), ["google", "outlook"]);
  assert.deepEqual(appsFor("ios"), ["apple", "google", "outlook"]);
  assert.deepEqual(appsFor("windows"), ["outlook", "google"]);
  assert.deepEqual(appsFor("macos"), ["apple", "google", "outlook"]);
});

const all = () => GUIDE_DEVICES.flatMap((device) => GUIDE_APPS.flatMap((app) => ["export", "import"].map((direction) => ({ direction, device, app }))));

test("ogni combinazione ha dei passi o un rimando esplicito a una strada che funziona", () => {
  assert.equal(all().length, 40);
  for (const { direction, device, app } of all()) {
    const label = `${direction} ${device} ${app}`;
    const guide = guideFor(direction, device, app);
    if (guide.kind === "redirect") {
      assert.ok(guide.reason.trim().length > 20, label);
      assert.ok(guide.to, label);
      const target = guideFor(direction, guide.to.device, guide.to.app);
      assert.equal(target.kind, "steps", `${label} -> ${guide.to.device} ${guide.to.app}`);
      continue;
    }
    assert.equal(guide.kind, "steps", label);
    assert.ok(guide.steps.length >= 2, label);
    for (const step of guide.steps) {
      assert.ok(step.text.trim().length > 10, label);
      assert.ok(step.icon, label);
    }
    const actions = guide.steps.map((step) => step.action).filter(Boolean);
    if (direction === "export") {
      // Il pulsante per scaricare sta nel passo che lo chiede, una volta sola.
      assert.deepEqual(actions, ["download"], label);
      // Prima si scarica, poi si apre l'altra app: il download non è mai l'ultimo passo.
      assert.ok(guide.steps.findIndex((step) => step.action) < guide.steps.length - 1, label);
    } else {
      // Il file si sceglie alla fine, in StudyOS.
      assert.deepEqual(actions, ["chooseFile"], label);
      assert.equal(guide.steps.at(-1).action, "chooseFile", label);
    }
  }
});

test("le app sensate esportano sempre dal dispositivo scelto (con o senza computer)", () => {
  for (const device of GUIDE_DEVICES) for (const app of appsFor(device)) assert.equal(guideFor("export", device, app).kind, "steps", `${device} ${app}`);
});

test("i passi che chiedono un computer lo dicono; quelli fattibili qui no", () => {
  for (const device of ["samsung", "android", "ios"]) {
    assert.equal(guideFor("export", device, "google").needsComputer, true, device);
    assert.equal(guideFor("import", device, "google").needsComputer, true, device);
    assert.equal(guideFor("export", device, "outlook").needsComputer, true, device);
  }
  for (const device of ["windows", "macos"]) {
    assert.equal(guideFor("export", device, "google").needsComputer, false, device);
    assert.equal(guideFor("import", device, "google").needsComputer, false, device);
  }
  assert.equal(guideFor("export", "ios", "apple").needsComputer, false);
  assert.equal(guideFor("export", "samsung", "samsung").needsComputer, false);
  // Google: sempre calendar.google.com.
  assert.ok(guideFor("export", "android", "google").steps.some((step) => step.text.includes("calendar.google.com")));
  assert.ok(guideFor("import", "windows", "google").steps.some((step) => step.text.includes("calendar.google.com")));
});

test("rimandi: da iPhone il Calendario di Apple non esporta (serve un Mac); app che non esistono sul dispositivo", () => {
  const ios = guideFor("import", "ios", "apple");
  assert.equal(ios.kind, "redirect");
  assert.deepEqual(ios.to, { device: "macos", app: "apple" });
  assert.match(ios.reason, /Mac/);
  assert.deepEqual(guideFor("export", "windows", "apple").to, { device: "ios", app: "apple" });
  // Il Calendario Samsung non salva file: si passa da Google, sul dispositivo scelto.
  assert.deepEqual(guideFor("import", "android", "samsung").to, { device: "android", app: "google" });
  const samsung = guideFor("import", "samsung", "samsung");
  assert.equal(samsung.kind, "redirect");
  assert.deepEqual(samsung.to, { device: "samsung", app: "google" });
  assert.match(samsung.reason, /calendar\.google\.com/);
  assert.deepEqual(guideFor("import", "macos", "outlook").to, { device: "windows", app: "outlook" });
  assert.deepEqual(guideFor("import", "android", "outlook").to, { device: "windows", app: "outlook" });
});

test("testi onesti: copia e non collegamento, eventi eliminati, e come ripartire puliti in ogni app che lo permette", () => {
  assert.match(CALENDAR_GUIDE_TEXT.honesty, /copia/);
  assert.match(CALENDAR_GUIDE_TEXT.honesty, /non un collegamento/);
  assert.match(CALENDAR_GUIDE_TEXT.honesty, /eliminato nell'altra app resta in StudyOS/);
  // Ogni esportazione che arriva a dei passi finisce con lo stesso consiglio, con il perché.
  for (const device of GUIDE_DEVICES)
    for (const app of GUIDE_APPS) {
      const guide = guideFor("export", device, app);
      if (guide.kind !== "steps") continue;
      assert.equal(guide.steps.at(-1).text, CALENDAR_GUIDE_STEPS.startClean, `${device} ${app}`);
    }
  assert.match(CALENDAR_GUIDE_STEPS.startClean, /non toglie quelli che hai eliminato in StudyOS/);
  // Il file troppo grande: Google e Apple non esportano un periodo, si esporta un calendario alla volta.
  assert.match(CALENDAR_GUIDE_TEXT.tooBig, /un calendario alla volta/);
  assert.doesNotMatch(CALENDAR_GUIDE_TEXT.tooBig, /periodo più breve dal tuo calendario/);
});

test("menu verificati: Google «Importazione ed esportazione»; Samsung solo strade che esistono", () => {
  const texts = (direction, device, app) => {
    const guide = guideFor(direction, device, app);
    return guide.kind === "steps" ? guide.steps.map((step) => step.text).join("\n") : guide.reason;
  };
  assert.match(texts("export", "windows", "google"), /«Importazione ed esportazione»/);
  assert.match(texts("import", "windows", "google"), /«Importazione ed esportazione»/);
  assert.doesNotMatch(Object.values(CALENDAR_GUIDE_STEPS).join("\n"), /«Importa ed esporta»/);
  const samsung = texts("export", "samsung", "samsung");
  assert.match(samsung, /«Archivio»/);
  assert.match(samsung, /calendar\.google\.com/);
  // Niente voci «Importa» o «Esporta» nelle impostazioni del Calendario Samsung: non si sono potute verificare.
  assert.doesNotMatch(samsung, /impostazioni/);
  assert.doesNotMatch(texts("import", "samsung", "samsung"), /«Esporta»/);
});

test("il consiglio dell'account (aprire StudyOS dal computer) solo se i dati si sincronizzano davvero", () => {
  const texts = (direction, synced) => {
    const guide = guideFor(direction, "android", "google", synced === undefined ? undefined : { synced });
    return guide.steps.map((step) => step.text).join("\n");
  };
  for (const synced of [undefined, false]) {
    assert.doesNotMatch(texts("export", synced), /account|apri(re)? StudyOS dal computer/i);
    assert.doesNotMatch(texts("import", synced), /account|apri(re)? StudyOS dal computer/i);
  }
  assert.match(texts("export", true), /stesso account/);
  assert.match(texts("import", true), /apri StudyOS dal computer/);
  // Senza account il passo resta completo: scaricare e mandare il file al computer.
  assert.match(texts("export", false), /mandalo al computer/);
});

// Il file di prova del ricontrollo: una serie, un giorno spostato, una gita di più giorni, un evento di New York.
const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//UI check//IT",
  "BEGIN:VEVENT",
  "UID:ui-check-weekly@test",
  "DTSTART;TZID=Europe/Rome:20261116T140000",
  "DTEND;TZID=Europe/Rome:20261116T160000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8",
  "SUMMARY:Seminario importato",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ui-check-weekly@test",
  "RECURRENCE-ID;TZID=Europe/Rome:20261123T140000",
  "DTSTART;TZID=Europe/Rome:20261123T150000",
  "DTEND;TZID=Europe/Rome:20261123T170000",
  "SUMMARY:Seminario importato (spostato)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ui-check-trip@test",
  "DTSTART;VALUE=DATE:20261207",
  "DTEND;VALUE=DATE:20261211",
  "SUMMARY:Gita a Torino",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ui-check-ny@test",
  "DTSTART;TZID=America/New_York:20261125T090000",
  "DTEND;TZID=America/New_York:20261125T100000",
  "SUMMARY:Call da New York",
  "END:VEVENT",
  "END:VCALENDAR"
].join("\r\n");

test("anteprima: un tutto il giorno di più giorni mostra i suoi giorni (la fine del file è esclusa)", () => {
  const events = parseIcs(SAMPLE, { timeZone: "Europe/Rome" }).events;
  const trip = events.find((event) => event.title === "Gita a Torino");
  assert.equal(previewWhen(trip, "Europe/Rome"), "7–10 dic");
  assert.equal(previewWhen({ allDay: true, start: "2026-12-07T00:00:00", end: "2026-12-08T00:00:00" }, "Europe/Rome"), "7 dic");
  assert.equal(previewWhen({ allDay: true, start: "2026-12-28T00:00:00", end: "2027-01-03T00:00:00" }, "Europe/Rome"), "28 dic – 2 gen");
  assert.equal(previewWhen({ allDay: true, start: "2026-11-30T00:00:00", end: "2026-12-02T00:00:00" }, "Europe/Rome"), "30 nov – 1 dic");
  // Con l'ora: nel fuso di chi guarda.
  assert.equal(previewWhen(events.find((event) => event.title === "Call da New York"), "Europe/Rome"), "25 nov 15:00");
  assert.equal(previewWhen(events.find((event) => event.title === "Call da New York"), "America/New_York"), "25 nov 09:00");
});

test("anteprima: il periodo del file va dal primo inizio all'ultima fine, non all'ultimo inizio", () => {
  const masters = parseIcs(SAMPLE, { timeZone: "Europe/Rome" }).events.filter((event) => !event.recurrenceId);
  assert.deepEqual(previewSpan(masters, "Europe/Rome"), { from: "16 nov 2026", to: "10 dic 2026" });
  // Un evento solo, di un giorno: niente «al».
  assert.deepEqual(previewSpan([{ allDay: true, start: "2026-12-07T00:00:00", end: "2026-12-08T00:00:00" }], "Europe/Rome"), { from: "7 dic 2026" });
  // Un evento con orario che finisce a mezzanotte non conta il giorno dopo.
  assert.deepEqual(previewSpan([{ allDay: false, start: "2026-12-06T22:00:00.000Z", end: "2026-12-06T23:00:00.000Z" }], "Europe/Rome"), { from: "6 dic 2026" });
  assert.deepEqual(previewSpan([], "Europe/Rome"), { from: "" });
});

const SERIES_FILE = (rrule) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:serie@test",
    "DTSTART;TZID=Europe/Rome:20261110T100000",
    "DTEND;TZID=Europe/Rome:20261110T120000",
    rrule,
    "SUMMARY:Fisiologia",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

test("anteprima: una serie mostra il periodo fino all'ultima volta, o «in poi» se non finisce", () => {
  // 8 settimane dal martedì 10 novembre: l'ultima volta è martedì 29 dicembre.
  const eight = parseIcs(SERIES_FILE("RRULE:FREQ=WEEKLY;COUNT=8"), { timeZone: "Europe/Rome" }).events;
  assert.deepEqual(previewSpan(eight, "Europe/Rome"), { from: "10 nov 2026", to: "29 dic 2026" });
  // Fino a una domenica: l'ultima volta vera (martedì 22 dicembre), non la data scritta.
  const until = parseIcs(SERIES_FILE("RRULE:FREQ=WEEKLY;UNTIL=20261227T225959Z"), { timeZone: "Europe/Rome" }).events;
  assert.deepEqual(previewSpan(until, "Europe/Rome"), { from: "10 nov 2026", to: "22 dic 2026" });
  const endless = parseIcs(SERIES_FILE("RRULE:FREQ=WEEKLY"), { timeZone: "Europe/Rome" }).events;
  assert.deepEqual(previewSpan(endless, "Europe/Rome"), { from: "10 nov 2026", open: true });
  assert.equal(CALENDAR_GUIDE_TEXT.previewRange("10 nov 2026", undefined, true), "Dal 10 nov 2026 in poi.");
});

test("anteprima e risultato: «L'8», «dall'11», singolare e plurale", () => {
  const range = CALENDAR_GUIDE_TEXT.previewRange;
  assert.equal(range("11 nov 2026"), "L'11 nov 2026.");
  assert.equal(range("8 nov 2026"), "L'8 nov 2026.");
  assert.equal(range("10 nov 2026"), "Il 10 nov 2026.");
  assert.equal(range("18 nov 2026"), "Il 18 nov 2026.", "18 non vuole l'apostrofo");
  assert.equal(range("8 nov 2026", "11 dic 2026"), "Dall'8 nov 2026 all'11 dic 2026.");
  assert.equal(range("1 nov 2026", "8 dic 2026"), "Dal 1 nov 2026 all'8 dic 2026.");
  assert.equal(range("11 nov 2026", undefined, true), "Dall'11 nov 2026 in poi.");
  const result = CALENDAR_GUIDE_TEXT.result;
  assert.equal(result(1, 0), "Fatto: 1 evento aggiunto nel calendario. Puoi modificarlo o eliminarlo come gli altri.");
  assert.equal(result(0, 1), "Fatto: 1 evento aggiornato nel calendario. Puoi modificarlo o eliminarlo come gli altri.");
  assert.equal(result(2, 1), "Fatto: 2 eventi aggiunti, 1 evento aggiornato nel calendario. Puoi modificarli o eliminarli come gli altri.");
});

test("guida: prima si apre l'app o il sito, poi si crea il calendario «StudyOS», poi si importa", () => {
  const texts = (device, app) => guideFor("export", device, app).steps.map((step) => step.text);
  const order = (list, ...keys) => keys.map((key) => list.indexOf(CALENDAR_GUIDE_STEPS[key]));
  const ascending = (indexes) => indexes.every((value, index) => value >= 0 && (index === 0 || value > indexes[index - 1]));
  assert.ok(ascending(order(texts("windows", "google"), "download", "googleSettings", "googleOwnCalendar", "googleImport")));
  assert.ok(ascending(order(texts("android", "google"), "googleOnComputer", "googleOwnCalendar", "googleImport")));
  assert.ok(ascending(order(texts("macos", "apple"), "download", "macNewCalendar", "macOpen", "macPick")));
  assert.ok(ascending(order(texts("ios", "apple"), "iosNewCalendar", "downloadIos", "iosAddAll")));
});
