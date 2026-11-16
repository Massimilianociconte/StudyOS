// Contenuti strutturati di flashcard e domande (schema v1): validazione pura, senza DOM, usata
// dall'editor, dagli strumenti MCP e dal Worker. Il testo degli agenti è un dato non fidato:
// niente HTML, niente script, immagini solo https, SVG ricostruiti da un elenco consentito.
import type { CardBlock, CardBlockType, SourceRef } from "../types";

export const BLOCK_SCHEMA_VERSION = 1;

/**
 * Opzioni di KaTeX per le formule delle schede (Blocks.tsx). L'input viene dagli agenti: nessun
 * comando che apre link, include HTML, classi o stili (`trust: false`), espansioni e dimensioni
 * limitate. Provate con KaTeX vero in tests/learningCore.test.mjs.
 */
export const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: "ignore",
  maxSize: 20,
  maxExpand: 300,
  output: "htmlAndMathml"
} as const;

export const CARD_LIMITS = {
  blocksPerSide: 30,
  text: 4000,
  heading: 200,
  listItems: 50,
  listItem: 1000,
  latex: 2000,
  code: 8000,
  codeLanguage: 30,
  tableRows: 20,
  tableCols: 8,
  tableCell: 500,
  caption: 300,
  alt: 300,
  url: 2000,
  svgBytes: 60_000,
  referenceField: 300,
  /** Scheda intera (fronte + retro + spiegazione) in caratteri JSON. */
  cardChars: 96_000
} as const;

export const BLOCK_TYPES: readonly CardBlockType[] = [
  "text",
  "heading",
  "list",
  "formula",
  "image",
  "svg",
  "code",
  "table",
  "callout",
  "reference"
];

const CALLOUT_TONES = new Set(["info", "tip", "warning", "key"]);

export type BlocksResult = { ok: true; blocks: CardBlock[] } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Caratteri di controllo (tranne a capo e tab) fuori: non servono e confondono il rendering.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const cleanText = (value: unknown) => (typeof value === "string" ? value.replace(CONTROL, "").replace(/\r\n?/g, "\n") : "");

class BlockError extends Error {}

const text = (value: unknown, field: string, max: number, required = true) => {
  const out = cleanText(value).trim();
  if (!out) {
    if (required) throw new BlockError(`${field}: testo mancante`);
    return undefined;
  }
  if (out.length > max) throw new BlockError(`${field}: troppo lungo (${out.length} caratteri, massimo ${max})`);
  return out;
};

const optionalText = (value: unknown, field: string, max: number) =>
  value === undefined || value === null || value === "" ? undefined : text(value, field, max, false);

/** Nomi che restano nella rete di casa o dell'ufficio (router, NAS, domini riservati). */
const PRIVATE_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|home\.arpa|corp|private|test|invalid|example|fritz\.box|speedport\.ip)$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Indirizzi IPv4 non pubblici: locale, privati, CGNAT, link-local, benchmark, multicast e riservati. */
const privateIpv4 = (host: string) => {
  const match = IPV4.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
};

/**
 * URL accettato in una scheda: solo https (immagini) o http/https (riferimenti), senza credenziali
 * e senza host locali o privati (una raccolta condivisa non deve far chiamare la rete di casa).
 * L'host normalizzato da URL (numeri esadecimali e interi diventano IPv4, «%2e» diventa «.») perde
 * i punti finali; servono almeno due etichette e niente indirizzi IPv6 letterali.
 */
export const safeUrl = (value: unknown, { allowHttp = false } = {}): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > CARD_LIMITS.url) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/\.+$/, "").toLowerCase();
  if (!host || host.startsWith("[") || !host.includes(".") || host.split(".").some((label) => !label)) return null;
  if (PRIVATE_NAME.test(host) || privateIpv4(host)) return null;
  return url.toString();
};

// ─── SVG: ricostruzione da elenco consentito ──────────────────────────────────────────────

const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "marker",
  "title",
  "desc",
  "symbol",
  "use",
  "clippath",
  "mask",
  "pattern"
]);

/** Nomi in camelCase dell'output (il confronto avviene in minuscolo). */
const CAMEL = new Map(
  [
    "linearGradient",
    "radialGradient",
    "clipPath",
    "viewBox",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "markerUnits",
    "clipPathUnits",
    "maskUnits",
    "patternUnits",
    "patternTransform",
    "preserveAspectRatio",
    "pathLength"
  ].map((name) => [name.toLowerCase(), name])
);
const camel = (name: string) => CAMEL.get(name) ?? name;

const SVG_ATTRS = new Set([
  "viewbox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "transform",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "baseline-shift",
  "letter-spacing",
  "dx",
  "dy",
  "rotate",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "fx",
  "fy",
  "markerwidth",
  "markerheight",
  "refx",
  "refy",
  "orient",
  "markerunits",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "clip-rule",
  "clippathunits",
  "mask",
  "maskunits",
  "patternunits",
  "patterntransform",
  "preserveaspectratio",
  "vector-effect",
  "xmlns",
  "version",
  "href",
  "xlink:href",
  "xmlns:xlink",
  "style",
  "role",
  "aria-label",
  "visibility",
  "display",
  "color",
  "pathlength"
]);

/** Valori ammessi: niente url() verso l'esterno, niente javascript:, niente escape CSS. */
const safeAttrValue = (name: string, value: string): string | null => {
  const v = value.replace(CONTROL, "");
  if (v.length > 20_000) return null;
  const lower = v.toLowerCase();
  if (/(javascript|vbscript|data)\s*:/.test(lower)) return null;
  if (name === "href" || name === "xlink:href") return /^#[\w.-]{1,100}$/.test(v.trim()) ? v.trim() : null;
  if (name === "xmlns") return v === "http://www.w3.org/2000/svg" ? v : null;
  if (name === "xmlns:xlink") return v === "http://www.w3.org/1999/xlink" ? v : null;
  if (lower.includes("url(")) {
    // Solo riferimenti interni: url(#gradiente)
    const urls = lower.match(/url\(([^)]*)\)/g) ?? [];
    if (!urls.every((item) => /^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/.test(item))) return null;
  }
  if (name === "style" && (/[\\@<>]/.test(v) || lower.includes("expression") || lower.includes("import"))) return null;
  return v;
};

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Decodifica le entità XML predefinite e numeriche (il risultato viene sempre ri-escapato). */
const decodeEntities = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const n = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 && n !== 0xfffe ? String.fromCodePoint(n) : "";
  });

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export interface SvgCheck {
  ok: boolean;
  /** SVG ricostruito (solo tag e attributi consentiti, testi ri-escapati). */
  svg?: string;
  error?: string;
  /** Elementi o attributi scartati durante la ricostruzione. */
  dropped: number;
}

/**
 * Ricostruisce un SVG dai soli tag e attributi consentiti. L'output è generato, non filtrato:
 * qualunque cosa il parser non capisca resta fuori, e testi e valori sono ri-escapati.
 * Nell'app l'SVG si mostra comunque dentro <img> (nessuno script né risorsa esterna).
 */
export const sanitizeSvg = (input: unknown): SvgCheck => {
  if (typeof input !== "string") return { ok: false, error: "svg: deve essere testo", dropped: 0 };
  const source = input.replace(CONTROL, "");
  if (new TextEncoder().encode(source).length > CARD_LIMITS.svgBytes) {
    return { ok: false, error: `svg: troppo grande (massimo ${CARD_LIMITS.svgBytes / 1000} kB)`, dropped: 0 };
  }
  if (/<!ENTITY/i.test(source)) return { ok: false, error: "svg: entità DTD non ammesse", dropped: 0 };
  let out = "";
  let dropped = 0;
  let skipDepth = 0; // > 0 dentro un sottoalbero scartato
  const stack: string[] = [];
  let sawRoot = false;
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const textPart = lt === -1 ? source.slice(i) : source.slice(i, lt);
    if (textPart && skipDepth === 0 && stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === "text" || top === "tspan" || top === "title" || top === "desc") out += escapeXml(decodeEntities(textPart));
    }
    if (lt === -1) break;
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      dropped++;
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<?", lt) || source.startsWith("<!", lt)) {
      const end = source.indexOf(">", lt + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    const gt = source.indexOf(">", lt + 1);
    if (gt === -1) break;
    const raw = source.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      const expected = skipDepth > 0 ? `!${name}` : name;
      // Chiusure che non corrispondono al tag aperto: ignorate (l'output resta ben formato).
      if (stack.length && stack[stack.length - 1] === expected) {
        stack.pop();
        if (skipDepth > 0) skipDepth--;
        else out += `</${camel(name)}>`;
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([A-Za-z][\w:.-]*)/.exec(body);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    if (skipDepth > 0) {
      if (!selfClosing) {
        stack.push(`!${name}`);
        skipDepth++;
      }
      continue;
    }
    // Tag non consentito (script, style, foreignObject, image, a, animate…): via con tutto il contenuto.
    if (!SVG_TAGS.has(name)) {
      dropped++;
      if (!selfClosing) {
        stack.push(`!${name}`);
        skipDepth++;
      }
      continue;
    }
    if (name === "svg") sawRoot = true;
    if (!sawRoot) {
      dropped++;
      continue;
    }
    const attrs: string[] = [];
    const attrSource = body.slice(nameMatch[0].length);
    let match: RegExpExecArray | null;
    const seen = new Set<string>();
    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(attrSource))) {
      const attr = match[1].toLowerCase();
      if (seen.has(attr)) continue;
      seen.add(attr);
      const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
      if (!SVG_ATTRS.has(attr) || attr.startsWith("on")) {
        dropped++;
        continue;
      }
      const safe = safeAttrValue(attr, value);
      if (safe === null) {
        dropped++;
        continue;
      }
      attrs.push(`${camel(attr)}="${escapeXml(safe)}"`);
    }
    if (name === "svg" && stack.length === 0 && !seen.has("xmlns")) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    out += `<${camel(name)}${attrs.length ? ` ${attrs.join(" ")}` : ""}${selfClosing ? "/>" : ">"}`;
    if (!selfClosing) stack.push(name);
  }
  // Tag rimasti aperti: si chiudono (l'output resta XML ben formato).
  while (stack.length) {
    const name = stack.pop() as string;
    if (!name.startsWith("!")) out += `</${camel(name)}>`;
  }
  if (!sawRoot || !out.startsWith("<svg")) return { ok: false, error: "svg: manca l'elemento <svg>", dropped };
  return { ok: true, svg: out, dropped };
};

/** Controllo all'ingresso: rifiuta i casi evidentemente pericolosi con un messaggio chiaro per l'agente. */
const svgIntakeError = (svg: string) => {
  const lower = svg.toLowerCase();
  if (/<script[\s>/]/.test(lower)) return "svg: <script> non ammesso";
  if (lower.includes("<foreignobject")) return "svg: <foreignObject> non ammesso";
  if (/\son[a-z]+\s*=/.test(lower)) return "svg: attributi evento (onload, onclick…) non ammessi";
  if (/(javascript|vbscript)\s*:/.test(lower)) return "svg: URL javascript: non ammessi";
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?!#)[a-z]/.test(lower)) return "svg: riferimenti esterni non ammessi (solo href=\"#id\")";
  return null;
};

// ─── Blocchi ──────────────────────────────────────────────────────────────────────────────

/** `lenient`: dati già salvati (sync): un SVG si ricostruisce invece di essere respinto. */
const toBlock = (value: unknown, index: number, field: string, lenient = false): CardBlock => {
  const where = `${field}[${index}]`;
  if (typeof value === "string") return { type: "text", text: text(value, `${where}.text`, CARD_LIMITS.text) as string };
  if (!isRecord(value)) throw new BlockError(`${where}: blocco non valido`);
  const type = value.type;
  switch (type) {
    case "text":
      return { type, text: text(value.text, `${where}.text`, CARD_LIMITS.text) as string };
    case "heading": {
      const level = value.level === 3 ? 3 : 2;
      return { type, text: text(value.text, `${where}.text`, CARD_LIMITS.heading) as string, level };
    }
    case "list": {
      if (!Array.isArray(value.items) || value.items.length === 0) throw new BlockError(`${where}.items: elenco vuoto`);
      if (value.items.length > CARD_LIMITS.listItems) throw new BlockError(`${where}.items: massimo ${CARD_LIMITS.listItems} voci`);
      const items = value.items.map((item, i) => text(item, `${where}.items[${i}]`, CARD_LIMITS.listItem) as string);
      return value.ordered === true ? { type, items, ordered: true } : { type, items };
    }
    case "formula": {
      const latex = text(value.latex, `${where}.latex`, CARD_LIMITS.latex) as string;
      const caption = optionalText(value.caption, `${where}.caption`, CARD_LIMITS.caption);
      return { type, latex, ...(value.display === false ? { display: false } : {}), ...(caption ? { caption } : {}) };
    }
    case "image": {
      if (typeof value.url === "string" && /^\s*data:/i.test(value.url)) {
        throw new BlockError(`${where}.url: immagini base64 non ammesse, usa un link https`);
      }
      const url = safeUrl(value.url);
      if (!url) throw new BlockError(`${where}.url: serve un link https pubblico`);
      const alt = text(value.alt, `${where}.alt`, CARD_LIMITS.alt) as string;
      const caption = optionalText(value.caption, `${where}.caption`, CARD_LIMITS.caption);
      const dims: { width?: number; height?: number } = {};
      for (const key of ["width", "height"] as const) {
        const n = value[key];
        if (typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 10_000) dims[key] = Math.round(n);
      }
      return { type, url, alt, ...(caption ? { caption } : {}), ...dims };
    }
    case "svg": {
      if (typeof value.svg !== "string" || !value.svg.trim()) throw new BlockError(`${where}.svg: SVG mancante`);
      const intake = lenient ? null : svgIntakeError(value.svg);
      if (intake) throw new BlockError(`${where}.${intake}`);
      const checked = sanitizeSvg(value.svg);
      if (!checked.ok || !checked.svg) throw new BlockError(`${where}.${checked.error ?? "svg non valido"}`);
      const alt = text(value.alt, `${where}.alt`, CARD_LIMITS.alt) as string;
      const caption = optionalText(value.caption, `${where}.caption`, CARD_LIMITS.caption);
      const background = value.background === "transparent" ? "transparent" : "light";
      return { type, svg: checked.svg, alt, background, ...(caption ? { caption } : {}) };
    }
    case "code": {
      const code = cleanText(value.code);
      if (!code.trim()) throw new BlockError(`${where}.code: codice mancante`);
      if (code.length > CARD_LIMITS.code) throw new BlockError(`${where}.code: troppo lungo (massimo ${CARD_LIMITS.code})`);
      const language = optionalText(value.language, `${where}.language`, CARD_LIMITS.codeLanguage);
      return { type, code: code.replace(/^\n+|\s+$/g, ""), ...(language ? { language: language.replace(/[^\w+#.-]/g, "") } : {}) };
    }
    case "table": {
      if (!Array.isArray(value.rows) || value.rows.length === 0) throw new BlockError(`${where}.rows: tabella vuota`);
      if (value.rows.length > CARD_LIMITS.tableRows) throw new BlockError(`${where}.rows: massimo ${CARD_LIMITS.tableRows} righe`);
      const cell = (item: unknown, path: string) => {
        const out = cleanText(typeof item === "number" ? String(item) : item).trim();
        if (out.length > CARD_LIMITS.tableCell) throw new BlockError(`${path}: cella troppo lunga (massimo ${CARD_LIMITS.tableCell})`);
        return out;
      };
      const rows = value.rows.map((row, r) => {
        if (!Array.isArray(row)) throw new BlockError(`${where}.rows[${r}]: deve essere un elenco di celle`);
        if (row.length === 0 || row.length > CARD_LIMITS.tableCols) throw new BlockError(`${where}.rows[${r}]: da 1 a ${CARD_LIMITS.tableCols} colonne`);
        return row.map((item, c) => cell(item, `${where}.rows[${r}][${c}]`));
      });
      let header: string[] | undefined;
      if (Array.isArray(value.header) && value.header.length > 0) {
        if (value.header.length > CARD_LIMITS.tableCols) throw new BlockError(`${where}.header: massimo ${CARD_LIMITS.tableCols} colonne`);
        header = value.header.map((item, c) => cell(item, `${where}.header[${c}]`));
      }
      const caption = optionalText(value.caption, `${where}.caption`, CARD_LIMITS.caption);
      return { type, rows, ...(header ? { header } : {}), ...(caption ? { caption } : {}) };
    }
    case "callout": {
      const tone = typeof value.tone === "string" && CALLOUT_TONES.has(value.tone) ? (value.tone as "info" | "tip" | "warning" | "key") : "info";
      const title = optionalText(value.title, `${where}.title`, CARD_LIMITS.heading);
      return { type, text: text(value.text, `${where}.text`, CARD_LIMITS.text) as string, tone, ...(title ? { title } : {}) };
    }
    case "reference": {
      const note = optionalText(value.note, `${where}.note`, CARD_LIMITS.referenceField);
      const { attachmentId: _attachment, ...ref } = normalizeSource(value, where);
      return { type, ...ref, ...(note ? { note } : {}) };
    }
    default:
      throw new BlockError(`${where}.type: tipo sconosciuto (${String(type).slice(0, 30)}); ammessi: ${BLOCK_TYPES.join(", ")}`);
  }
};

const normalizeSource = (value: Record<string, unknown>, where: string): SourceRef => {
  const title = text(value.title, `${where}.title`, CARD_LIMITS.referenceField) as string;
  const out: SourceRef = { title };
  for (const key of ["chapter", "section", "pages"] as const) {
    const item = optionalText(value[key], `${where}.${key}`, CARD_LIMITS.referenceField);
    if (item) out[key] = item;
  }
  if (value.url !== undefined && value.url !== null && value.url !== "") {
    const url = safeUrl(value.url, { allowHttp: true });
    if (!url) throw new BlockError(`${where}.url: link non valido (solo http/https pubblici)`);
    out.url = url;
  }
  if (typeof value.attachmentId === "string" && value.attachmentId.trim()) out.attachmentId = value.attachmentId.trim().slice(0, 100);
  return out;
};

/** Fonti di un contenuto (al massimo 10). */
export const normalizeSources = (value: unknown, field = "sources"): { ok: true; sources: SourceRef[] } | { ok: false; error: string } => {
  if (value === undefined || value === null) return { ok: true, sources: [] };
  const list = Array.isArray(value) ? value : [value];
  if (list.length > 10) return { ok: false, error: `${field}: massimo 10 fonti` };
  try {
    return {
      ok: true,
      sources: list.map((item, i) => {
        if (typeof item === "string") return { title: text(item, `${field}[${i}]`, CARD_LIMITS.referenceField) as string };
        if (!isRecord(item)) throw new BlockError(`${field}[${i}]: fonte non valida`);
        return normalizeSource(item, `${field}[${i}]`);
      })
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

/**
 * Valida e normalizza un lato della scheda. Accetta anche un testo semplice (diventa uno o più
 * blocchi di testo, uno per paragrafo) per gli agenti che non usano i blocchi.
 */
export const normalizeBlocks = (value: unknown, field: string, { required = true } = {}): BlocksResult => {
  try {
    let list: unknown[];
    if (value === undefined || value === null || value === "") {
      if (required) return { ok: false, error: `${field}: contenuto mancante` };
      return { ok: true, blocks: [] };
    }
    if (typeof value === "string") {
      list = cleanText(value)
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);
    } else if (Array.isArray(value)) {
      list = value;
    } else if (isRecord(value) && Array.isArray(value.blocks)) {
      if (value.v !== undefined && value.v !== BLOCK_SCHEMA_VERSION) {
        return { ok: false, error: `${field}: versione dello schema non supportata (${String(value.v)}; atteso ${BLOCK_SCHEMA_VERSION})` };
      }
      list = value.blocks;
    } else if (isRecord(value)) {
      list = [value];
    } else {
      return { ok: false, error: `${field}: atteso un elenco di blocchi o un testo` };
    }
    if (list.length === 0 && required) return { ok: false, error: `${field}: contenuto mancante` };
    if (list.length > CARD_LIMITS.blocksPerSide) return { ok: false, error: `${field}: massimo ${CARD_LIMITS.blocksPerSide} blocchi` };
    return { ok: true, blocks: list.map((item, i) => toBlock(item, i, field)) };
  } catch (error) {
    if (error instanceof BlockError) return { ok: false, error: error.message };
    throw error;
  }
};

/** Blocchi già salvati (sync, altre versioni dell'app): si tengono solo quelli validi, mai un errore. */
export const safeBlocks = (value: unknown): CardBlock[] => {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? [{ type: "text", text: value.slice(0, CARD_LIMITS.text) }] : [];
  const out: CardBlock[] = [];
  for (const [i, item] of value.slice(0, CARD_LIMITS.blocksPerSide).entries()) {
    try {
      out.push(toBlock(item, i, "b", true));
    } catch {
      // blocco scartato: il resto della scheda si vede lo stesso
    }
  }
  return out;
};

/** Testo semplice dei blocchi: ricerca, duplicati, anteprime e strumenti degli agenti. */
export const blocksPlainText = (blocks: readonly CardBlock[] | undefined, max = Infinity): string => {
  const parts: string[] = [];
  // Righe scritte fuori dall'app (sync, raccolte condivise): un blocco malformato si salta, mai un errore.
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    try {
      switch (block.type) {
        case "text":
        case "heading":
        case "callout":
          parts.push(stripInline(block.text));
          break;
        case "list":
          parts.push(block.items.map(stripInline).join("; "));
          break;
        case "formula":
          parts.push(block.latex);
          break;
        case "image":
        case "svg":
          parts.push(`[${block.alt}]`);
          break;
        case "code":
          parts.push(block.code);
          break;
        case "table":
          parts.push([block.header ?? [], ...block.rows].map((row) => row.join(" | ")).join(" / "));
          break;
        case "reference":
          parts.push([block.title, block.chapter, block.section, block.pages && `pp. ${block.pages}`].filter(Boolean).join(", "));
          break;
      }
    } catch {
      continue;
    }
    if (parts.join(" ").length > max) break;
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > max ? `${joined.slice(0, Math.max(0, max - 1))}…` : joined;
};

/** Caratteri JSON di una scheda (limite complessivo). */
export const contentChars = (...sides: (readonly CardBlock[] | undefined)[]) => sides.reduce((sum, side) => sum + (side ? JSON.stringify(side).length : 0), 0);

// ─── Testo con markdown ridotto ───────────────────────────────────────────────────────────

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "math"; text: string }
  | { kind: "sup"; text: string }
  | { kind: "sub"; text: string };

const INLINE_RE = /\*\*([^*\n]+?)\*\*|`([^`\n]+?)`|\$([^$\n]+?)\$|\*([^*\n]+?)\*|\^([^^\s]{1,40})\^|~([^~\s]{1,40})~/g;

/**
 * Divide un testo in segmenti: **grassetto**, *corsivo*, `codice`, $formula$, ^apice^, ~pedice~.
 * Nessun HTML: il renderer crea elementi React con testo puro (\$ resta un dollaro).
 */
export const parseInline = (source: string): InlineSegment[] => {
  const out: InlineSegment[] = [];
  const placeholder = "\u0000D";
  const input = source.replace(/\\\$/g, placeholder);
  const restore = (value: string) => value.split(placeholder).join("$");
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(input))) {
    if (match.index > last) out.push({ kind: "text", text: restore(input.slice(last, match.index)) });
    if (match[1] !== undefined) out.push({ kind: "bold", text: restore(match[1]) });
    else if (match[2] !== undefined) out.push({ kind: "code", text: restore(match[2]) });
    else if (match[3] !== undefined) out.push({ kind: "math", text: restore(match[3]) });
    else if (match[4] !== undefined) out.push({ kind: "italic", text: restore(match[4]) });
    else if (match[5] !== undefined) out.push({ kind: "sup", text: restore(match[5]) });
    else if (match[6] !== undefined) out.push({ kind: "sub", text: restore(match[6]) });
    last = match.index + match[0].length;
  }
  if (last < input.length) out.push({ kind: "text", text: restore(input.slice(last)) });
  return out;
};

const stripInline = (value: string) => parseInline(value).map((segment) => segment.text).join("");

/** Chiavi già calcolate per elenco di blocchi (le schede salvate non cambiano sul posto). */
const duplicateKeys = new WeakMap<readonly CardBlock[], string>();

/** Testo normalizzato per il confronto dei duplicati (minuscole, senza punteggiatura e spazi doppi). */
export const duplicateKey = (blocks: readonly CardBlock[] | undefined) => {
  if (Array.isArray(blocks)) {
    const cached = duplicateKeys.get(blocks);
    if (cached !== undefined) return cached;
  }
  const key = blocksPlainText(blocks)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (Array.isArray(blocks)) duplicateKeys.set(blocks, key);
  return key;
};
