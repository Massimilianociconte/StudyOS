// Contrasto dei colori del tema, misurato sui valori dei token in src/index.css: ogni palette × tema.
// Il CSS non passa da un browser: qui si risolvono var() e color-mix(in srgb, …) come fa il browser
// (interpolazione premoltiplicata) e si calcola il rapporto WCAG 2.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const PALETTES = ["aurora", "milk", "space", "university", "forest", "sunset", "graphite"];
const THEMES = ["dark", "light", "focus"];

/** Regole con proprietà personalizzate, in ordine nel file. */
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match, order) => ({
    selector: match[1].split(";").pop().trim(),
    decls: Object.fromEntries([...match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((decl) => [decl[1], decl[2].trim()])),
    order
  }))
  .filter((block) => Object.keys(block.decls).length);

/** Selettori `:root`, `[data-x="y"]`, `:not([data-x="y"])` e loro combinazioni sull'elemento html. */
const matches = (selector, attrs) => {
  let rest = selector.replace(/^:root/, "");
  let specificity = selector.startsWith(":root") ? 1 : 0;
  let ok = true;
  rest = rest.replace(/:not\(\[data-(\w+)="([\w-]+)"\]\)/g, (_, key, value) => {
    specificity += 1;
    if (attrs[key] === value) ok = false;
    return "";
  });
  rest = rest.replace(/\[data-(\w+)="([\w-]+)"\]/g, (_, key, value) => {
    specificity += 1;
    if (attrs[key] !== value) ok = false;
    return "";
  });
  return { ok: ok && rest.trim() === "" && specificity > 0, specificity };
};

const tokensFor = (theme, palette) => {
  const attrs = { theme, palette };
  const tokens = {};
  blocks
    .map((block) => ({ block, ...matches(block.selector, attrs) }))
    .filter((item) => item.ok)
    .sort((a, b) => a.specificity - b.specificity || a.block.order - b.block.order)
    .forEach(({ block }) => Object.assign(tokens, block.decls));
  return tokens;
};

const splitArgs = (text) => {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
};

const color = (value, tokens, depth = 0) => {
  assert.ok(depth < 20, `token circolare: ${value}`);
  const text = value.trim();
  if (text.startsWith("var(")) {
    const [name, fallback] = splitArgs(text.slice(4, -1));
    if (tokens[name] !== undefined) return color(tokens[name], tokens, depth + 1);
    assert.ok(fallback !== undefined, `token mancante: ${name}`);
    return color(fallback, tokens, depth + 1);
  }
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (text === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (text.startsWith("#")) {
    const hex = text.length === 4 ? [...text.slice(1)].map((c) => c + c).join("") : text.slice(1);
    const n = (i) => Number.parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  const rgba = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1].split(/[\s,/]+/).filter(Boolean);
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }
  if (text.startsWith("color-mix(")) {
    const [space, first, second] = splitArgs(text.slice("color-mix(".length, -1));
    assert.equal(space, "in srgb", `spazio colore non gestito: ${space}`);
    const part = (arg) => {
      const match = arg.match(/^(.*?)(?:\s+([\d.]+)%)?$/);
      return { c: color(match[1], tokens, depth + 1), p: match[2] === undefined ? undefined : Number(match[2]) / 100 };
    };
    const A = part(first);
    const B = part(second);
    let p1 = A.p ?? (B.p === undefined ? 0.5 : 1 - B.p);
    let p2 = B.p ?? 1 - p1;
    const sum = p1 + p2;
    p1 /= sum;
    p2 /= sum;
    const a = A.c.a * p1 + B.c.a * p2;
    const channel = (k) => (a === 0 ? 0 : (A.c[k] * A.c.a * p1 + B.c[k] * B.c.a * p2) / a);
    return { r: channel("r"), g: channel("g"), b: channel("b"), a: a * Math.min(1, sum) };
  }
  throw new Error(`colore non gestito: ${text}`);
};

const over = (top, bottom) => {
  const a = top.a + bottom.a * (1 - top.a);
  const channel = (k) => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
  return { r: channel("r"), g: channel("g"), b: channel("b"), a };
};

const luminance = ({ r, g, b }) => {
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (fg, bg) => {
  const [hi, lo] = [luminance(fg.a < 1 ? over(fg, bg) : fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Dove stanno testo e anelli: la pagina (`--bg`), l'angolo della pagina tinto dall'accento (`.app-bg`)
 * e il punto più chiaro (scuro nel tema chiaro) di un pannello (`.soft-panel`: `--surface-strong` sopra
 * `--bg-2` al 78%).
 */
const backgrounds = (tokens) => {
  const page = color("var(--bg)", tokens);
  return {
    page,
    tint: over(color("color-mix(in srgb, var(--bg) 88%, var(--accent) 12%)", tokens), page),
    panel: over(color("var(--surface-strong)", tokens), over(color("color-mix(in srgb, var(--bg-2) 78%, transparent)", tokens), page))
  };
};

const combos = THEMES.flatMap((theme) => PALETTES.map((palette) => ({ theme, palette, tokens: tokensFor(theme, palette) })));

test("palette: ogni PaletteName ha i suoi colori nel CSS (aurora è quella di base)", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const declared = [...types.match(/export type PaletteName =([^;]+);/)[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...PALETTES].sort());
  for (const palette of PALETTES.filter((name) => name !== "aurora")) {
    assert.ok(blocks.some((block) => block.selector === `[data-palette="${palette}"]`), palette);
  }
});

// Il testo scuro sui fondi accento (pulsanti primari, passi della guida, icone delle materie).
const ON_ACCENT = color("#10131d", {});

test("testo #10131d su fondo accento: almeno 4,5:1 in ogni palette", () => {
  for (const { theme, palette, tokens } of combos) {
    const value = ratio(ON_ACCENT, color("var(--accent)", tokens));
    assert.ok(value >= 4.5, `${palette}/${theme}: ${value.toFixed(2)}:1`);
  }
});

test("testo color accento (--accent-ink): almeno 4,5:1 su pagina, angolo tinto e pannelli in ogni palette e tema", () => {
  for (const { theme, palette, tokens } of combos) {
    const ink = color("var(--accent-ink)", tokens);
    assert.equal(ink.a, 1, `${palette}/${theme}: inchiostro trasparente`);
    for (const [where, bg] of Object.entries(backgrounds(tokens))) {
      const value = ratio(ink, bg);
      assert.ok(value >= 4.5, `${palette}/${theme} su ${where}: ${value.toFixed(2)}:1`);
    }
  }
});

test("anello del focus: tinta piena da --focus-ring, almeno 3:1 su pagina e pannelli in ogni palette e tema", () => {
  const rule = css.match(/([^{}]*button:focus-visible[^{]*)\{([^}]*)\}/);
  assert.ok(rule, "regola del focus");
  for (const target of ["button", "a", "input", "select", "textarea", "summary", '[role="button"]']) {
    assert.ok(rule[1].includes(`${target}:focus-visible`), `anello anche su ${target}`);
  }
  assert.match(rule[2], /outline:\s*3px solid var\(--focus-ring\)/);
  for (const { theme, palette, tokens } of combos) {
    const ring = color("var(--focus-ring)", tokens);
    assert.equal(ring.a, 1, `${palette}/${theme}: anello trasparente`);
    for (const [where, bg] of Object.entries(backgrounds(tokens))) {
      const value = ratio(ring, bg);
      assert.ok(value >= 3, `${palette}/${theme} su ${where}: ${value.toFixed(2)}:1`);
    }
  }
});

test("Bianco latte: resta un blu vicino a quello di prima", () => {
  const accent = color(tokensFor("dark", "milk")["--accent"], {});
  assert.ok(accent.b > accent.r + 100 && accent.b > accent.g + 80, "ancora blu");
  assert.ok(ratio(ON_ACCENT, accent) < 6, "non sbiadito più del necessario");
});
