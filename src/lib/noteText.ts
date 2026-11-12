// Testo di una nota: può averlo scritto un agente o un'altra persona, quindi si mostra come testo
// semplice (mai HTML). I link riconosciuti diventano link solo se `safeHref` li accetta (http, https,
// mailto). Logica pura, testata con node --test.
import { safeHref } from "./safeUrl";

export type NoteTextPart = { text: string; href?: string };

const LINK = /\b(?:https?:\/\/|mailto:|www\.)[^\s<>"«»]+/gi;
/** Punteggiatura in coda che chiude la frase, non il link. */
const TRAILING_PUNCTUATION = ".,;:!?}'’";
const PAIRS: Record<string, string> = { ")": "(", "]": "[" };

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * Toglie dalla coda la punteggiatura della frase. Una ")" o "]" finale resta solo se apre nel link
 * (es. …/Ciclo_di_Krebs_(biochimica)); se è in più chiude il testo intorno, come «(vedi https://…)».
 */
const trimLink = (raw: string) => {
  let url = raw;
  while (url) {
    const last = url[url.length - 1];
    const open = PAIRS[last];
    if (TRAILING_PUNCTUATION.includes(last) || (open && count(url, open) < count(url, last))) url = url.slice(0, -1);
    else break;
  }
  return url;
};

export function noteTextParts(body: string): NoteTextPart[] {
  const parts: NoteTextPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.href === undefined) last.text += text;
    else parts.push({ text });
  };
  let cursor = 0;
  for (const match of body.matchAll(LINK)) {
    const start = match.index ?? 0;
    const raw = trimLink(match[0]);
    const href = raw ? safeHref(raw) : undefined;
    if (!href) continue;
    pushText(body.slice(cursor, start));
    parts.push({ text: raw, href });
    cursor = start + raw.length;
  }
  pushText(body.slice(cursor));
  return parts;
}
