// Guida a importazione ed esportazione: riconoscimento del dispositivo, app sensate per dispositivo,
// passi per ogni combinazione (o un rimando esplicito alla strada che funziona).
import test from "node:test";
import assert from "node:assert/strict";
import { GUIDE_APPS, GUIDE_DEVICES, appsFor, detectDevice, guideFor } from "../src/lib/calendarGuide.ts";

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
  assert.equal(guideFor("import", "samsung", "samsung").needsComputer, false);
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
  assert.deepEqual(guideFor("import", "android", "samsung").to, { device: "samsung", app: "samsung" });
  assert.deepEqual(guideFor("import", "macos", "outlook").to, { device: "windows", app: "outlook" });
  assert.deepEqual(guideFor("import", "android", "outlook").to, { device: "windows", app: "outlook" });
});
