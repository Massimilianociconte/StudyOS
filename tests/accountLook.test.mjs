// Tema e colori seguono l'account: la scelta va nelle preferenze sincronizzate e il dispositivo ne tiene
// una copia (avvio, schermata di blocco). Prima stavano solo su IndexedDB del browser e ogni dispositivo,
// browser, app installata o pulizia dello spazio ripartiva da «Scuro · Aurora».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookFromAccount, lookToMigrate } from "../src/lib/accountLook.ts";
import { DEFAULT_PREFERENCES, defaultSettings } from "../src/data/defaults.ts";
import { selectPreferences, useStudyStore } from "../src/store/useStudyStore.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const prefs = (extra) => ({ ...DEFAULT_PREFERENCES, ...stamp, ...extra });
const device = (extra = {}) => ({ ...defaultSettings(), ...extra });

test("lookFromAccount: l'account vince sul dispositivo, senza scelta resta quella del dispositivo", () => {
  const settings = device({ themeMode: "dark", palette: "aurora" });
  assert.equal(lookFromAccount(settings, undefined), settings, "senza preferenze: stesso oggetto");
  assert.equal(lookFromAccount(settings, prefs({})), settings, "preferenze senza tema: resta il dispositivo");
  assert.equal(lookFromAccount(settings, prefs({ themeMode: "dark", palette: "aurora" })), settings, "uguale: stesso oggetto");
  const next = lookFromAccount(settings, prefs({ themeMode: "light", palette: "forest" }));
  assert.equal(next.themeMode, "light");
  assert.equal(next.palette, "forest");
  assert.equal(next.density, settings.density, "la densità resta del dispositivo");
  const half = lookFromAccount(settings, prefs({ palette: "sunset" }));
  assert.equal(half.themeMode, "dark");
  assert.equal(half.palette, "sunset");
});

test("lookFromAccount: valori sconosciuti (altra versione, riga storta) non cambiano il tema", () => {
  const settings = device({ themeMode: "light", palette: "milk" });
  assert.equal(lookFromAccount(settings, prefs({ themeMode: "neon", palette: "__proto__" })), settings);
  assert.equal(lookFromAccount(settings, prefs({ themeMode: 3, palette: null })), settings);
  assert.equal(lookFromAccount(settings, prefs({ palette: "toString" })), settings);
});

test("lookToMigrate: il tema scelto qui prima di questa versione passa all'account una volta", () => {
  const defaults = defaultSettings();
  // Account senza scelta e tema personale qui: si copia.
  assert.deepEqual(lookToMigrate(device({ themeMode: "light", palette: "forest" }), prefs({}), defaults), { themeMode: "light", palette: "forest" });
  assert.deepEqual(lookToMigrate(device({ palette: "sunset" }), undefined, defaults), { themeMode: defaults.themeMode, palette: "sunset" });
  // Tema predefinito qui (es. telefono mai personalizzato): non deve coprire quello scelto altrove.
  assert.equal(lookToMigrate(device(), prefs({}), defaults), null);
  // L'account ha già una scelta (anche solo in parte): vince quella.
  assert.equal(lookToMigrate(device({ themeMode: "light", palette: "forest" }), prefs({ palette: "milk" }), defaults), null);
  assert.equal(lookToMigrate(device({ themeMode: "light" }), prefs({ themeMode: "dark" }), defaults), null);
  // Valori storti nell'account contano come «nessuna scelta».
  assert.deepEqual(lookToMigrate(device({ themeMode: "focus" }), prefs({ themeMode: "neon" }), defaults), { themeMode: "focus", palette: defaults.palette });
});

test("la copia nell'account parte solo dopo una sincronizzazione finita in questa sessione", () => {
  const app = source("src/App.tsx");
  assert.match(app, /previous === "syncing" && sync\.status === "idle"/);
  assert.match(app, /lookToMigrate\(state\.settings, selectPreferences\(state\), defaultSettings\(\)\)/);
});

const seed = (settings, preferences = []) =>
  useStudyStore.setState({ loading: false, locked: false, persistError: undefined, settings, preferences });

test("updateAppearance: la scelta va sia sul dispositivo sia nelle preferenze dell'account", async () => {
  seed(device({ themeMode: "dark", palette: "aurora" }), [prefs({ displayName: "Ada", weeklyTargetMinutes: 600 })]);
  await useStudyStore.getState().updateAppearance({ palette: "graphite" });
  let state = useStudyStore.getState();
  assert.equal(state.settings.palette, "graphite");
  const saved = selectPreferences(state);
  assert.equal(saved.palette, "graphite");
  assert.equal(saved.displayName, "Ada", "gli altri campi restano");
  assert.equal(saved.weeklyTargetMinutes, 600);
  assert.ok(saved.updatedAt > stamp.updatedAt, "timbro nuovo: il cloud accetta la modifica");

  await useStudyStore.getState().updateAppearance({ themeMode: "light" });
  state = useStudyStore.getState();
  assert.equal(state.settings.themeMode, "light");
  assert.equal(selectPreferences(state).themeMode, "light");
  assert.equal(selectPreferences(state).palette, "graphite");
});

test("updateAppearance senza preferenze salvate: le crea con i valori predefiniti", async () => {
  seed(device(), []);
  await useStudyStore.getState().updateAppearance({ themeMode: "focus", palette: "space" });
  const state = useStudyStore.getState();
  assert.equal(state.preferences.length, 1);
  assert.equal(state.preferences[0].themeMode, "focus");
  assert.equal(state.preferences[0].palette, "space");
  assert.equal(state.preferences[0].weeklyTargetMinutes, DEFAULT_PREFERENCES.weeklyTargetMinutes);
});

test("updateAppearance ignora valori non validi", async () => {
  seed(device({ themeMode: "dark", palette: "aurora" }), []);
  await useStudyStore.getState().updateAppearance({ themeMode: "neon", palette: "rosa" });
  const state = useStudyStore.getState();
  assert.equal(state.settings.themeMode, "dark");
  assert.equal(state.settings.palette, "aurora");
  assert.equal(state.preferences.length, 0, "niente da salvare");
});

test("preferenze arrivate dal cloud (altro dispositivo): il tema dell'account si applica qui", () => {
  seed(device({ themeMode: "dark", palette: "aurora" }), []);
  useStudyStore.setState({ preferences: [prefs({ themeMode: "light", palette: "university" })] });
  const { settings } = useStudyStore.getState();
  assert.equal(settings.themeMode, "light");
  assert.equal(settings.palette, "university");
});

test("preferenze senza tema (account di prima): il tema del dispositivo resta", () => {
  seed(device({ themeMode: "light", palette: "forest" }), []);
  useStudyStore.setState({ preferences: [prefs({ displayName: "Ada" })] });
  const { settings } = useStudyStore.getState();
  assert.equal(settings.themeMode, "light");
  assert.equal(settings.palette, "forest");
});

test("workspace bloccato o uscita: preferenze vuote, il dispositivo tiene l'ultimo tema", () => {
  seed(device({ themeMode: "dark", palette: "aurora" }), [prefs({ themeMode: "light", palette: "sunset" })]);
  useStudyStore.setState({ preferences: [prefs({ themeMode: "light", palette: "sunset" })] });
  useStudyStore.setState({ locked: true, preferences: [] });
  const { settings } = useStudyStore.getState();
  assert.equal(settings.themeMode, "light");
  assert.equal(settings.palette, "sunset");
});

test("i comandi del tema usano updateAppearance, non solo le impostazioni del dispositivo", () => {
  const settingsView = source("src/views/SettingsView.tsx");
  assert.doesNotMatch(settingsView, /updateSettings\(\{ (themeMode|palette):/);
  assert.match(settingsView, /updateAppearance\(\{ themeMode: mode \}\)/);
  assert.match(settingsView, /updateAppearance\(\{ palette: palette\.id \}\)/);
  const shell = source("src/components/AppShell.tsx");
  assert.doesNotMatch(shell, /updateSettings\(\{ themeMode:/);
  assert.match(shell, /updateAppearance\(\{ themeMode:/);
  // Gli agenti non cambiano il tema: non è nella lista dei campi permessi.
  assert.doesNotMatch(source("src/agent/execute.ts"), /pick\(args, \[[^\]]*"(themeMode|palette)"/);
});
