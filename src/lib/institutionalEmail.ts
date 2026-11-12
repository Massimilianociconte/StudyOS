// Indirizzi email istituzionali (decisione della persona, 12/11): agli agenti arrivano solo gli
// indirizzi esattamente @unimi.it di docenti e contatti dell'università, mai quelli di studenti,
// membri, invitati o account. Il catalogo BARB usa solo @unimi.it (36 indirizzi, nessun sottodominio):
// i sottodomini (es. @studenti.unimi.it) restano fuori.
//
// Regola unica, identica a studyos_hide_emails / studyos_only_unimi_emails in supabase/group-exams.sql
// (stessi esempi in tests/fixtures/emailVectors.json, usati dai test dei due lati):
// 1. il testo si normalizza: NFKC («＠» e «﹫» diventano «@»), niente caratteri invisibili, gli spazi strani
//    (U+0085, U+2028, U+2029, U+1680) diventano spazi; «&#64;», «&#x40;», «&commat;» e «%40» diventano «@»,
//    «(at)», «[at]», «{at}» solo se attaccati a qualcosa da tutti e due i lati («bea(at)gmail.com» sì,
//    «Sede di Asti (AT), aula 3» no). Nei link (campi url e website) «%40» resta com'è nel percorso di un indirizzo
//    http(s), dalla prima «/», «?» o «#» dopo il nome del sito (link di Teams e di Google Calendar); vale «@» nel
//    destinatario di un «mailto:» e prima del percorso. Senza nessuna «@» il testo resta com'è stato scritto;
// 2. più di 10 «@» in un testo: tutto il testo diventa «[email nascosta]»;
// 3. ogni corsa di caratteri senza spazi ASCII che contiene una «@» è UN candidato (oltre 300 caratteri Unicode:
//    sempre nascosto per intero; una corsa lunga senza «@» resta);
// 4. tolti l'inizio (virgolette, parentesi aperte, «mailto:») e la fine (punteggiatura), il candidato resta solo se
//    è per intero «parte-locale@unimi.it» (parte locale ASCII, dominio confrontato solo con lettere ASCII);
//    altrimenti tutto il candidato diventa «[email nascosta]». Se il candidato nascosto inizia con «@» si nasconde
//    anche la corsa prima, se finisce con «@» anche quella dopo («mario @ gmail.com», «mario@ gmail.com»).
//    Gli indirizzi tenuti conservano le maiuscole.
// Tutto in tempo lineare: i testi lunghi (nomi di gruppo, note) non rallentano mai gli agenti.

export const INSTITUTIONAL_EMAIL_DOMAIN = "unimi.it";
export const EMAIL_HIDDEN = "[email nascosta]";

// Niente flag «i»: «İ» (I turca) non deve mai valere come «i». Le classi elencano le sole lettere ASCII.
const UNIMI_ADDRESS = /^[A-Za-z0-9._+-]+@[uU][nN][iI][mM][iI]\.[iI][tT]$/;
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const STRANGE_SPACES = /[\u0085\u2028\u2029\u1680]/g;
const AT_FORMS = /&#0*64;|&#[xX]0*40;|&[cC][oO][mM][mM][aA][tT];|(?<=[^ \t\n\r\f\v])(?:\([aA][tT]\)|\[[aA][tT]\]|\{[aA][tT]\})(?=[^ \t\n\r\f\v])/g;
/** Inizio di un indirizzo http(s) fino al percorso (nome del sito, ed eventuali utente e password). */
const URL_HEAD = /^[hH][tT][tT][pP][sS]?:\/\/[^/?# \t\n\r\f\v]*/;
/** Percorso, domanda e frammento di quell'indirizzo: fino al primo spazio. */
const URL_PATH = /^[^ \t\n\r\f\v]*/;
/** Spazi ASCII: separano i candidati (dopo la normalizzazione gli altri spazi Unicode sono già spazi). */
const RUNS = /[ \t\n\r\f\v]+|[^ \t\n\r\f\v]+/g;
const SPACE = /^[ \t\n\r\f\v]/;
const LAST_RUN = /[ \t\n\r\f\v]*[^ \t\n\r\f\v]*$/;
const FIRST_RUN = /^[ \t\n\r\f\v]*([^ \t\n\r\f\v]*)/;
/** Inizio di un candidato: virgolette e parentesi aperte, poi «mailto:» (come il primo gruppo di PARTS). */
const LEAD = /^['’`*"(<[]*(?:[mM][aA][iI][lL][tT][oO]:)?/;
const NOT_SPACE = /[^ \t\n\r\f\v]/;
const PARTS = /^(['’`*"(<[]*(?:[mM][aA][iI][lL][tT][oO]:)?)([\s\S]*?)([.,;:!?)>\]'’`*"]*)$/;
/** Un indirizzo vero sta in 254 caratteri: una corsa con «@» più lunga di così si nasconde senza analizzarla. */
const MAX_CANDIDATE = 300;
/** Oltre questo numero di «@» in un testo si nasconde tutto il testo: il lavoro per valore resta piccolo. */
const MAX_AT = 10;

/**
 * NFKC, senza invisibili, spazi strani e «@» scritte in altro modo: la forma su cui si applica la regola.
 * `url`: il testo è un link (campi url e website), e «%40» nel percorso di un indirizzo http(s) resta com'è.
 */
export const normalizeEmailText = (text: string, url = false): string => {
  const base = text.normalize("NFKC").replace(INVISIBLE, "").replace(STRANGE_SPACES, " ").replace(AT_FORMS, "@");
  const head = url ? URL_HEAD.exec(base)?.[0] : undefined;
  if (head === undefined) return base.replaceAll("%40", "@");
  const path = URL_PATH.exec(base.slice(head.length))?.[0] ?? "";
  return head.replaceAll("%40", "@") + path + base.slice(head.length + path.length).replaceAll("%40", "@");
};

/** L'indirizzo in minuscolo se è esattamente @unimi.it, altrimenti null. */
export const institutionalEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = normalizeEmailText(value).trim();
  return UNIMI_ADDRESS.test(email) ? email.toLowerCase() : null;
};

/**
 * Toglie gli indirizzi da un testo. Con `keepInstitutional` restano solo quelli esattamente @unimi.it
 * (con le loro maiuscole); gli altri candidati diventano «[email nascosta]». Senza «@» (dopo la normalizzazione)
 * il testo torna identico; altrimenti esce normalizzato. `url`: il testo è un link (campi url e website).
 */
export const redactEmails = (text: string, keepInstitutional: boolean, url = false): string => {
  const normalized = normalizeEmailText(text, url);
  if (!normalized.includes("@")) return text;
  return redactNormalized(normalized, keepInstitutional);
};

/** Più di `max` «@» nel testo? Si ferma appena le ha contate. */
const tooManyAt = (text: string, max: number) => {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 0x40) continue;
    count += 1;
    if (count > max) return true;
  }
  return false;
};

/** Caratteri Unicode (non unità UTF-16, come char_length in Postgres) oltre `max`? Una emoji conta uno. */
const longerThan = (text: string, max: number) => {
  if (text.length <= max) return false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
    if (count > max) return true;
  }
  return false;
};

const redactNormalized = (normalized: string, keepInstitutional: boolean): string => {
  if (tooManyAt(normalized, MAX_AT)) return EMAIL_HIDDEN;
  const tokens = normalized.match(RUNS) ?? [];
  const runs: number[] = [];
  tokens.forEach((token, index) => {
    if (!SPACE.test(token)) runs.push(index);
  });
  const pieces = tokens.slice();
  const full = new Set<number>();
  runs.forEach((index, position) => {
    const run = tokens[index];
    if (!run.includes("@")) return;
    if (longerThan(run, MAX_CANDIDATE)) {
      full.add(index);
      return;
    }
    const parts = PARTS.exec(run);
    const lead = parts?.[1] ?? "";
    const core = parts?.[2] ?? run;
    const trail = parts?.[3] ?? "";
    if (keepInstitutional && UNIMI_ADDRESS.test(core)) return;
    pieces[index] = `${lead}${EMAIL_HIDDEN}${trail}`;
    if (core.startsWith("@") && position > 0) full.add(runs[position - 1]);
    if (core.endsWith("@") && position < runs.length - 1) full.add(runs[position + 1]);
  });
  for (const index of full) pieces[index] = EMAIL_HIDDEN;
  return pieces.join("");
};

/**
 * true se ogni indirizzo nel testo è @unimi.it e non resta nessuna «@» (controllo prima di scrivere).
 * `url`: il testo è un link (campi url e website).
 */
export const onlyInstitutionalEmails = (text: string, url = false): boolean => {
  const normalized = normalizeEmailText(text, url);
  return !normalized.includes("@") || redactNormalized(normalized, true) === normalized;
};

/**
 * Taglia un testo a `max` caratteri Unicode al confine di una corsa (spazi ASCII): mai metà di una parola, quindi
 * mai un pezzo di indirizzo. Se la prima corsa tolta, normalizzata, inizia con «@» (dopo virgolette, parentesi e
 * «mailto:», e non supera 300 caratteri) nel testo intero la regola delle corse vicine nasconderebbe l'ultima corsa
 * tenuta («bea.privata @gmail.com» tagliato fra le due parole): si toglie anche quella (con le corse che,
 * normalizzate, restano vuote). Stesso taglio di studyos_cut_at_run in supabase/group-exams.sql.
 */
export const cutAtRunBoundary = (text: string, max: number): string => {
  if (!longerThan(text, max)) return text;
  let end = 0;
  for (let count = 0; count <= max && end < text.length; count += 1) {
    const code = text.charCodeAt(end);
    end += code >= 0xd800 && code <= 0xdbff && end + 1 < text.length && (text.charCodeAt(end + 1) & 0xfc00) === 0xdc00 ? 2 : 1;
  }
  let kept = text.slice(0, end).replace(LAST_RUN, "");
  const next = FIRST_RUN.exec(normalizeEmailText(text.slice(kept.length)))?.[1] ?? "";
  if (longerThan(next, MAX_CANDIDATE) || !next.replace(LEAD, "").startsWith("@")) return kept;
  for (;;) {
    const last = LAST_RUN.exec(kept)?.[0] ?? "";
    kept = kept.slice(0, kept.length - last.length);
    if (kept === "" || NOT_SPACE.test(normalizeEmailText(last))) return kept;
  }
};
