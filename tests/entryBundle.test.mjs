import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Bundle iniziale: ciò che si importa in modo statico a partire da main.tsx finisce nel file che si scarica
// prima del primo disegno. I pezzi pesanti devono restare dietro `import()`.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const resolveLocal = (from, spec) => {
  const base = resolve(dirname(from), spec);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
};

/** Import statici di valori (niente `import type`, niente `import()`, niente righe in commento). */
const staticSpecifiers = (source) => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found = [];
  const pattern = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  for (const match of withoutComments.matchAll(pattern)) {
    if (match[2]) continue;
    found.push(match[4] ?? match[5]);
  }
  return found;
};

const reachable = (entry) => {
  const seen = new Map(); // file -> chi lo importa
  const external = new Map(); // pacchetto -> file che lo importa
  const queue = [entry];
  seen.set(entry, null);
  while (queue.length) {
    const file = queue.shift();
    for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const target = resolveLocal(file, spec);
        if (target && !seen.has(target)) {
          seen.set(target, file);
          queue.push(target);
        }
      } else {
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        if (!external.has(name)) external.set(name, file);
      }
    }
  }
  return { seen, external };
};

const chain = (seen, file) => {
  const steps = [];
  for (let current = file; current; current = seen.get(current)) steps.push(current.replace(`${SRC}/`, ""));
  return steps.reverse().join(" -> ");
};

const { seen, external } = reachable(join(SRC, "main.tsx"));

test("bundle iniziale: il grafo degli import è letto davvero", () => {
  assert.ok(seen.size > 30, `grafo troppo piccolo: ${seen.size} file`);
  assert.ok(seen.has(join(SRC, "store/useStudyStore.ts")));
  assert.ok(seen.has(join(SRC, "components/AppShell.tsx")));
  assert.ok(external.has("react") && external.has("dexie"));
});

test("bundle iniziale: nessun pacchetto pesante (grafici, supabase) importato in modo statico", () => {
  for (const pkg of ["recharts", "@supabase/supabase-js", "uqr"]) {
    assert.equal(external.has(pkg), false, `${pkg} è nel bundle iniziale (da ${external.get(pkg)})`);
  }
});

test("bundle iniziale: sync, supabase, dati BARB, ICS e grafici restano dietro import()", () => {
  const heavy = [
    "lib/supabase.ts",
    "lib/cloudSync.ts",
    "lib/groupSync.ts",
    "lib/shareSync.ts",
    "lib/peopleSync.ts",
    "lib/ics.ts",
    "data/university/barb.dataset.ts",
    "data/university/barb.seed.ts",
    "components/SubjectStudyStats.tsx",
    "views/StatsView.tsx",
    "views/CalendarView.tsx",
    "views/BarbView.tsx",
    "views/SettingsView.tsx",
    "components/QuickAddModal.tsx",
    "components/NotificationsPanel.tsx",
    "components/AgentDesk.tsx",
    "components/NoteDrawer.tsx",
    "components/CourseIcon.tsx",
    "components/DatePicker.tsx",
    "lib/agentLink.ts"
  ];
  for (const rel of heavy) {
    const file = join(SRC, rel);
    if (!existsSync(file)) continue;
    assert.equal(seen.has(file), false, `${rel} è importato in modo statico dal bundle iniziale: ${chain(seen, file)}`);
  }
});

test("bundle iniziale: le funzioni di animazione e le viste si caricano in differita", () => {
  const main = readFileSync(join(SRC, "main.tsx"), "utf8");
  assert.match(main, /features=\{loadMotionFeatures\}/);
  assert.doesNotMatch(main, /domAnimation\s*\}\s*from/);
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");
  assert.match(app, /import\("\.\/lib\/agentLink"\)/);
  for (const view of ["Dashboard", "Calendar", "Stats", "Barb", "Settings"]) {
    assert.match(app, new RegExp(`lazyView\\(\\(\\) => import\\("\\./views/${view}View"\\)`));
  }
});

test("il grafico non è mai importato da codice raggiungibile dall'avvio", () => {
  const importers = [...seen.keys()].filter((file) => /from\s*["']recharts["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(importers, []);
});
