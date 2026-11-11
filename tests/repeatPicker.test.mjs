import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptRuleToStart,
  customError,
  customFromRule,
  monthlyChoiceId,
  monthlyChoices,
  presetIdOf,
  repeatPresets,
  ruleFromCustom,
  weekdayOf,
  weekdayPosition
} from "../src/lib/repeatPicker.ts";
import { describeRule } from "../src/lib/repeat.ts";

// 12 novembre 2026 è il secondo giovedì del mese.
const START = "2026-11-12";

test("scelte pronte: calcolate dalla data d'inizio, con le frasi del modulo", () => {
  const presets = repeatPresets(START);
  assert.deepEqual(
    presets.map((preset) => preset.label),
    [
      "Non si ripete",
      "Ogni giorno",
      "Ogni settimana il giovedì",
      "Ogni mese il 12",
      "Ogni mese il secondo giovedì",
      "Ogni anno il 12 novembre",
      "Giorni feriali (lun–ven)"
    ]
  );
  assert.equal(presets[0].rule, null);
  assert.deepEqual(presets.find((preset) => preset.id === "monthlyNth").rule, { freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TH" } });
  assert.deepEqual(presets.find((preset) => preset.id === "workdays").rule, { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] });
});

test("scelte pronte: l'ultimo giovedì del mese e il quinto (che diventa l'ultimo)", () => {
  // 26/11/2026 è il quarto e ultimo giovedì: si propongono entrambi.
  const fourth = repeatPresets("2026-11-26").map((preset) => preset.label);
  assert.ok(fourth.includes("Ogni mese il quarto giovedì"));
  assert.ok(fourth.includes("Ogni mese l'ultimo giovedì"));
  // 30/10/2026 è il quinto venerdì: solo "l'ultimo".
  const fifth = repeatPresets("2026-10-30").map((preset) => preset.label);
  assert.ok(fifth.includes("Ogni mese l'ultimo venerdì"));
  assert.equal(fifth.some((label) => label.includes("quinto")), false);
});

test("posizione del giorno nel mese e giorno della settimana", () => {
  assert.equal(weekdayOf(START), "TH");
  assert.equal(weekdayOf("2026-11-15"), "SU");
  assert.deepEqual(weekdayPosition(START), { nth: 2, last: false });
  assert.deepEqual(weekdayPosition("2026-11-26"), { nth: 4, last: true });
  assert.deepEqual(weekdayPosition("2026-10-30"), { nth: 5, last: true });
});

test("la riga riconosce la scelta pronta, anche scritta in modo equivalente", () => {
  assert.equal(presetIdOf(null, START), "none");
  assert.equal(presetIdOf({ freq: "weekly" }, START), "weekly");
  assert.equal(presetIdOf({ freq: "weekly", byWeekday: ["TH"] }, START), "weekly");
  assert.equal(presetIdOf({ freq: "monthly", monthly: { by: "day" } }, START), "monthlyDay");
  assert.equal(presetIdOf({ freq: "weekly", byWeekday: ["FR", "MO", "TU", "WE", "TH"] }, START), "workdays");
  // Con una fine o un intervallo non è più una scelta pronta.
  assert.equal(presetIdOf({ freq: "weekly", end: { type: "count", count: 5 } }, START), "custom");
  assert.equal(presetIdOf({ freq: "weekly", interval: 2 }, START), "custom");
  assert.equal(presetIdOf({ freq: "weekly", byWeekday: ["MO", "WE"] }, START), "custom");
});

test("cambiando la data, le scelte legate al giorno seguono il nuovo inizio", () => {
  // "Ogni settimana il giovedì" scritta con il giorno: diventa venerdì.
  assert.deepEqual(adaptRuleToStart({ freq: "weekly", byWeekday: ["TH"] }, START, "2026-11-13"), { freq: "weekly", byWeekday: ["FR"] });
  // "Ogni mese il secondo giovedì" → il terzo venerdì (20/11).
  assert.deepEqual(adaptRuleToStart({ freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TH" } }, START, "2026-11-20"), {
    freq: "monthly",
    monthly: { by: "weekday", nth: 3, weekday: "FR" }
  });
  // "L'ultimo giovedì" resta l'ultimo, del nuovo giorno.
  assert.deepEqual(adaptRuleToStart({ freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "TH" } }, "2026-11-26", "2026-11-30"), {
    freq: "monthly",
    monthly: { by: "weekday", nth: -1, weekday: "MO" }
  });
  // Quinto lunedì → l'ultimo.
  assert.deepEqual(adaptRuleToStart({ freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TH" } }, START, "2026-11-30"), {
    freq: "monthly",
    monthly: { by: "weekday", nth: -1, weekday: "MO" }
  });
  // Scelte esplicite di più giorni o di un altro giovedì restano come sono; nessuna regola resta nessuna.
  const several = { freq: "weekly", byWeekday: ["MO", "TH"] };
  assert.equal(adaptRuleToStart(several, START, "2026-11-13"), several);
  const other = { freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "TH" } };
  assert.equal(adaptRuleToStart(other, START, "2026-11-13"), other);
  assert.equal(adaptRuleToStart(null, START, "2026-11-13"), null);
});

test("personalizza: da regola a modulo e ritorno", () => {
  const empty = customFromRule(null, START);
  assert.deepEqual(empty, {
    unit: "week",
    interval: 1,
    weekdays: ["TH"],
    monthly: "day",
    clamp: false,
    nth: 2,
    weekday: "TH",
    end: "never",
    until: "2026-12-12",
    count: 10
  });
  const cases = [
    { freq: "daily", interval: 3 },
    { freq: "weekly", interval: 2, byWeekday: ["MO", "WE", "FR"], end: { type: "until", date: "2026-12-18" } },
    { freq: "monthly", monthly: { by: "lastDay" }, end: { type: "count", count: 6 } },
    { freq: "monthly", interval: 3 },
    { freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "FR" } },
    { freq: "monthly", monthly: { by: "clampDay" } },
    { freq: "yearly", interval: 2 }
  ];
  for (const rule of cases) assert.deepEqual(ruleFromCustom(customFromRule(rule, START), START), rule, JSON.stringify(rule));
  // Un solo giorno uguale all'inizio: si scrive anche quello (la regola non dipende dall'inizio).
  assert.deepEqual(ruleFromCustom({ ...empty, weekdays: ["TH"] }, START), { freq: "weekly", byWeekday: ["TH"] });
  // Una regola vecchia senza giorni si legge con il giorno dell'inizio.
  assert.deepEqual(ruleFromCustom(customFromRule({ freq: "weekly" }, START), START), { freq: "weekly", byWeekday: ["TH"] });
  // Ogni 3 mesi e ogni 6 mesi.
  assert.equal(describeRule(ruleFromCustom({ ...empty, unit: "month", interval: 6 }, START), START), "Ogni 6 mesi il 12");
});

test("personalizza: giorni del mese proponibili dall'inizio", () => {
  assert.deepEqual(
    monthlyChoices(START).map((choice) => choice.label),
    ["Il giorno 12", "Il secondo giovedì"]
  );
  // 30/11/2026: quinto lunedì (solo "l'ultimo") e ultimo giorno del mese.
  assert.deepEqual(
    monthlyChoices("2026-11-30").map((choice) => choice.id),
    ["day", "weekday:-1:MO", "lastDay"]
  );
  // Una scelta già salvata resta tra le opzioni anche se l'inizio non la propone.
  const saved = { ...customFromRule({ freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "TU" } }, START) };
  assert.ok(monthlyChoices(START, saved).some((choice) => choice.id === monthlyChoiceId(saved)));
});

test("personalizza: errori in italiano semplice", () => {
  const base = customFromRule(null, START);
  assert.equal(customError(base, START), "");
  assert.match(customError({ ...base, interval: 0 }, START), /1 e 99/);
  assert.match(customError({ ...base, interval: 120 }, START), /1 e 99/);
  assert.match(customError({ ...base, weekdays: [] }, START), /almeno un giorno/);
  assert.match(customError({ ...base, end: "until", until: "2026-11-01" }, START), /dopo l'inizio/);
  assert.match(customError({ ...base, end: "count", count: 0 }, START), /1 e 999/);
  assert.equal(customError({ ...base, unit: "day", weekdays: [] }, START), "");
});
