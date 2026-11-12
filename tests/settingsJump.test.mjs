import test from "node:test";
import assert from "node:assert/strict";
import { settingsSectionFromEvent, takeSettingsSection } from "../src/lib/settingsJump.ts";
import { SETTINGS_TEXT } from "../src/lib/labels/settings.ts";

const withSessionStorage = (initial, run) => {
  const data = new Map(Object.entries(initial));
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
  try {
    return run(data);
  } finally {
    if (previous === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous;
  }
};

test("takeSettingsSection returns a known section once", () => {
  withSessionStorage({ "studyos-settings-jump": "agenti" }, (data) => {
    assert.equal(takeSettingsSection(), "agenti");
    assert.equal(data.size, 0);
    assert.equal(takeSettingsSection(), null);
  });
});

test("takeSettingsSection ignores unknown values but still clears them", () => {
  withSessionStorage({ "studyos-settings-jump": "impostazioni-segrete" }, (data) => {
    assert.equal(takeSettingsSection(), null);
    assert.equal(data.size, 0);
  });
});

test("takeSettingsSection without storage is null", () => {
  assert.equal(takeSettingsSection(), null);
});

test("settingsSectionFromEvent accepts only known sections", () => {
  assert.equal(settingsSectionFromEvent({ detail: "profilo" }), "profilo");
  assert.equal(settingsSectionFromEvent({ detail: "nope" }), null);
  assert.equal(settingsSectionFromEvent({ detail: 3 }), null);
  assert.equal(settingsSectionFromEvent({}), null);
});

test("every settings section has a title and a description", () => {
  for (const id of ["profilo", "aspetto", "account", "privacy", "backup", "agenti", "dati"]) {
    assert.ok(SETTINGS_TEXT.titles[id], id);
    assert.ok(SETTINGS_TEXT.descriptions[id], id);
  }
  assert.equal(SETTINGS_TEXT.summaries.data(1, 2, 1), "1 materia · 2 attività · 1 evento");
  assert.equal(SETTINGS_TEXT.summaries.data(0, 0, 3), "0 materie · 0 attività · 3 eventi");
});
