import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const colors = await import("../src/lib/eventColors.ts");
const {
  EVENT_TYPE_KEYS,
  EVENT_TYPE_COLORS,
  EVENT_TYPE_ICON,
  LEGACY_AUTO_COLOR,
  contrastRatio,
  eventColorStyle,
  eventTypeKey,
  eventTypeLabel,
  relativeLuminance,
  resolveEventColor,
  sanitizeTypeColorOverrides,
  themeTone,
  typeDefaultColor
} = colors;
const { EVENT_CATEGORY_LABEL } = await import("../src/lib/labels.ts");

const PAGE = { dark: "#171A27", light: "#FFFAF2" };

test("tipologie: ogni categoria dell'evento più vacanza, compleanno, anniversario, festività", () => {
  for (const category of Object.keys(EVENT_CATEGORY_LABEL)) assert.ok(EVENT_TYPE_KEYS.includes(category), category);
  for (const extra of ["vacation", "birthday", "anniversary", "holiday"]) assert.ok(EVENT_TYPE_KEYS.includes(extra), extra);
  assert.equal(new Set(EVENT_TYPE_KEYS).size, EVENT_TYPE_KEYS.length, "nessun doppione");
  for (const key of EVENT_TYPE_KEYS) {
    assert.match(EVENT_TYPE_COLORS[key], /^#[0-9A-F]{6}$/, key);
    assert.notEqual(eventTypeLabel(key), "", key);
  }
  assert.equal(eventTypeLabel("vacation"), "Vacanza");
  assert.equal(eventTypeLabel("birthday"), "Compleanno");
  assert.equal(eventTypeLabel("exam"), "Esame");
});

test("colori predefiniti dal design: esame rosso, palestra bianco, personale verde, vacanza giallo…", () => {
  const hue = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const between = (value, from, to) => value !== null && value >= from && value <= to;
  assert.ok(between(hue(EVENT_TYPE_COLORS.exam), 345, 360) || between(hue(EVENT_TYPE_COLORS.exam), 0, 10), "esame rosso");
  assert.equal(EVENT_TYPE_COLORS.gym, "#FFFFFF", "palestra bianco");
  assert.ok(between(hue(EVENT_TYPE_COLORS.personal), 100, 160), "personale verde");
  assert.ok(between(hue(EVENT_TYPE_COLORS.vacation), 40, 60), "vacanza giallo");
  assert.ok(between(hue(EVENT_TYPE_COLORS.birthday), 260, 290), "compleanno viola");
  assert.equal(hue(EVENT_TYPE_COLORS.holiday), null, "festività grigio");
  assert.ok(relativeLuminance(EVENT_TYPE_COLORS.holiday) > 0.6, "grigio chiaro");
  // Le altre tipologie hanno ciascuna un colore proprio.
  assert.equal(new Set(Object.values(EVENT_TYPE_COLORS)).size, EVENT_TYPE_KEYS.length);
});

test("icone: ogni tipologia ha un'icona che esiste in Icon.tsx", () => {
  const source = readFileSync(new URL("../src/components/Icon.tsx", import.meta.url), "utf8");
  const map = source.slice(source.indexOf("const icons = {"));
  for (const key of EVENT_TYPE_KEYS) {
    const name = EVENT_TYPE_ICON[key];
    assert.ok(name, key);
    assert.match(map, new RegExp(`\\n\\s+${name},`), `${key}: ${name} manca in Icon.tsx`);
  }
  assert.equal(EVENT_TYPE_ICON.vacation, "Luggage");
  assert.equal(EVENT_TYPE_ICON.birthday, "Cake");
  assert.equal(EVENT_TYPE_ICON.gym, "Dumbbell");
});

test("eventTypeKey: la ricorrenza vince sulla categoria, categoria sconosciuta = altro", () => {
  assert.equal(eventTypeKey({ category: "personal", occasionKind: "birthday" }), "birthday");
  assert.equal(eventTypeKey({ category: "vacation" }), "vacation");
  assert.equal(eventTypeKey({ category: "exam" }), "exam");
  assert.equal(eventTypeKey({ category: "made-up" }), "other");
  assert.equal(eventTypeKey({ category: "exam", occasionKind: "nonsense" }), "exam");
});

test("typeDefaultColor: lezione, studio, laboratorio e ripasso prendono il colore della materia", () => {
  const subjectColor = "#9FB7FF";
  for (const type of ["lesson", "study", "lab", "review"]) {
    assert.equal(typeDefaultColor(type, { subjectColor }), subjectColor, type);
    assert.equal(typeDefaultColor(type, {}), EVENT_TYPE_COLORS[type], `${type} senza materia: colore proprio`);
  }
  assert.equal(typeDefaultColor("exam", { subjectColor }), EVENT_TYPE_COLORS.exam, "l'esame resta rosso");
  // Le preferenze dell'utente valgono per la tipologia; con la materia vince la materia.
  assert.equal(typeDefaultColor("exam", { overrides: { exam: "#B91C1C" } }), "#B91C1C");
  assert.equal(typeDefaultColor("lesson", { subjectColor, overrides: { lesson: "#000000" } }), subjectColor);
  assert.equal(typeDefaultColor("lesson", { overrides: { lesson: "#000000" } }), "#000000");
  // Colori non validi (anche dalla materia di un altro) non entrano.
  assert.equal(typeDefaultColor("lesson", { subjectColor: "url(https://x)" }), EVENT_TYPE_COLORS.lesson);
  assert.equal(typeDefaultColor("exam", { overrides: { exam: "red" } }), EVENT_TYPE_COLORS.exam);
});

test("resolveEventColor: colore scelto a mano, colore della tipologia, eventi salvati prima", () => {
  const base = { category: "exam", subjectColor: "#9FB7FF" };
  // Scelto a mano: resta anche cambiando tipologia.
  assert.equal(resolveEventColor({ ...base, color: "#123456", colorCustom: true }), "#123456");
  assert.equal(resolveEventColor({ ...base, category: "gym", color: "#123456", colorCustom: true }), "#123456");
  assert.equal(resolveEventColor({ ...base, color: "javascript:1", colorCustom: true }), EVENT_TYPE_COLORS.exam, "valore non valido: tipologia");
  // Non scelto a mano: segue la tipologia (con le preferenze dell'utente).
  assert.equal(resolveEventColor({ ...base, color: "#123456", colorCustom: false }), EVENT_TYPE_COLORS.exam);
  assert.equal(resolveEventColor({ ...base, colorCustom: false, overrides: { exam: "#B91C1C" } }), "#B91C1C");
  assert.equal(resolveEventColor({ category: "lesson", subjectColor: "#9FB7FF", color: "#123456", colorCustom: false }), "#9FB7FF");
  // Salvati prima (colorCustom assente): il vecchio colore automatico o quello della materia seguono la tipologia…
  assert.equal(resolveEventColor({ ...base, color: LEGACY_AUTO_COLOR }), EVENT_TYPE_COLORS.exam);
  assert.equal(resolveEventColor({ ...base, color: "#7cf7c8" }), EVENT_TYPE_COLORS.exam, "maiuscole e minuscole");
  assert.equal(resolveEventColor({ ...base, color: "#9fb7ff" }), EVENT_TYPE_COLORS.exam);
  assert.equal(resolveEventColor({ category: "lesson", subjectColor: "#9FB7FF", color: "#9FB7FF" }), "#9FB7FF");
  assert.equal(resolveEventColor({ category: "gym" }), EVENT_TYPE_COLORS.gym, "senza colore");
  // …un altro colore era stato scelto a mano e resta.
  assert.equal(resolveEventColor({ ...base, color: "#123456" }), "#123456");
  // Ricorrenze e festività.
  assert.equal(resolveEventColor({ category: "personal", occasionKind: "birthday" }), EVENT_TYPE_COLORS.birthday);
  assert.equal(resolveEventColor({ category: "other", occasionKind: "holiday", color: LEGACY_AUTO_COLOR }), EVENT_TYPE_COLORS.holiday);
});

test("contrasto WCAG: calcolo di luminanza e rapporto", () => {
  assert.equal(relativeLuminance("#FFFFFF"), 1);
  assert.equal(relativeLuminance("#000000"), 0);
  assert.ok(Math.abs(contrastRatio("#FFFFFF", "#000000") - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio("#777777", "#FFFFFF") - 4.48) < 0.01);
  assert.equal(contrastRatio("#fff", "#FFFFFF"), 1, "esadecimale corto");
  assert.equal(contrastRatio("#123456", "#ABCDEF"), contrastRatio("#ABCDEF", "#123456"), "simmetrico");
});

test("eventColorStyle: testo AA (≥ 4.5:1) e bordo visibile (≥ 3:1) per ogni colore, in chiaro e scuro", () => {
  const subjectSwatches = ["#7CF7C8", "#9FB7FF", "#F7A8C4", "#FFD37C", "#C8A2FF", "#7FE3F5", "#FFAE7C", "#A6E3A1"];
  const extremes = ["#000000", "#FFFFFF", "#808080", "#FFFF00", "#0000FF", "#00FF00", "#1E1E1E", "#B91C1C"];
  for (const hex of [...Object.values(EVENT_TYPE_COLORS), ...subjectSwatches, ...extremes]) {
    for (const theme of ["dark", "light"]) {
      const style = eventColorStyle(hex, theme);
      for (const value of Object.values(style)) assert.match(value, /^#[0-9A-F]{6}$/);
      assert.ok(contrastRatio(style.text, style.background) >= 4.5, `${hex} ${theme}: testo ${contrastRatio(style.text, style.background).toFixed(2)}`);
      assert.ok(contrastRatio(style.border, style.background) >= 3, `${hex} ${theme}: bordo sul fondo`);
      assert.ok(contrastRatio(style.border, PAGE[theme]) >= 3, `${hex} ${theme}: bordo sulla pagina`);
    }
  }
});

test("eventColorStyle: bianco, giallo e grigio chiaro in tema chiaro hanno fondo tenue, bordo e testo scuri", () => {
  for (const hex of [EVENT_TYPE_COLORS.gym, EVENT_TYPE_COLORS.vacation, EVENT_TYPE_COLORS.holiday]) {
    const style = eventColorStyle(hex, "light");
    assert.notEqual(style.background, PAGE.light, `${hex}: fondo diverso dalla pagina`);
    assert.ok(contrastRatio(style.background, PAGE.light) >= 1.05, `${hex}: fondo tenue ma visibile`);
    assert.ok(relativeLuminance(style.background) > 0.6, `${hex}: fondo chiaro`);
    assert.ok(relativeLuminance(style.border) < relativeLuminance(hex), `${hex}: bordo più scuro del colore`);
    assert.ok(relativeLuminance(style.text) < 0.05, `${hex}: testo scuro`);
  }
  // In tema scuro: fondo scuro tinto, testo chiaro, bordo del colore.
  const dark = eventColorStyle(EVENT_TYPE_COLORS.vacation, "dark");
  assert.ok(relativeLuminance(dark.background) < 0.15);
  assert.ok(relativeLuminance(dark.text) > 0.8);
  assert.equal(dark.border, EVENT_TYPE_COLORS.vacation);
  // Colore non valido: nessun errore, colore di "Altro".
  assert.deepEqual(eventColorStyle("url(x)", "dark"), eventColorStyle(EVENT_TYPE_COLORS.other, "dark"));
  assert.equal(themeTone("light"), "light");
  assert.equal(themeTone("focus"), "dark");
  assert.equal(themeTone(undefined), "dark");
});

test("sanitizeTypeColorOverrides: solo tipologie note e colori esadecimali", () => {
  assert.deepEqual(sanitizeTypeColorOverrides(null), {});
  assert.deepEqual(sanitizeTypeColorOverrides("exam"), {});
  assert.deepEqual(sanitizeTypeColorOverrides(["#fff"]), {});
  assert.deepEqual(
    sanitizeTypeColorOverrides({
      exam: " #B91C1C ",
      gym: "white",
      vacation: "url(https://example.com/x.png)",
      birthday: "#C8A2FF",
      unknown: "#000000",
      __proto__: { lesson: "#111111" },
      lesson: 12
    }),
    { exam: "#B91C1C", birthday: "#C8A2FF" }
  );
});
