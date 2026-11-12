// Indirizzi email istituzionali (decisione della persona, 12/11): agli agenti arrivano solo gli
// indirizzi esattamente @unimi.it di docenti e contatti dell'università, mai quelli di studenti,
// membri, invitati o account. Il catalogo BARB usa solo @unimi.it (36 indirizzi, nessun sottodominio):
// i sottodomini (es. @studenti.unimi.it) restano fuori.
//
// Regola unica, identica a studyos_hide_emails / studyos_only_unimi_emails in supabase/group-exams.sql
// (stessi esempi in tests/fixtures/emailVectors.json, usati dai test dei due lati):
// 1. il testo si normalizza: NFKC («＠» e «﹫» diventano «@»), niente caratteri invisibili, gli spazi strani
//    (U+0085, U+2028, U+2029, U+1680) diventano spazi, e «%40», «&#64;», «&commat;», «(at)», «[at]», «{at}»
//    diventano «@». Senza nessuna «@» il testo resta com'è stato scritto (nessuna normalizzazione visibile);
// 2. ogni corsa di caratteri senza spazi ASCII che contiene una «@» è UN candidato (oltre 300 caratteri: sempre
//    nascosto per intero);
// 3. tolti l'inizio (virgolette, parentesi aperte, «mailto:») e la fine (punteggiatura), il candidato resta solo se
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
const AT_FORMS = /%40|&#0*64;|&#[xX]0*40;|&[cC][oO][mM][mM][aA][tT];|\([aA][tT]\)|\[[aA][tT]\]|\{[aA][tT]\}/g;
/** Spazi ASCII: separano i candidati (dopo la normalizzazione gli altri spazi Unicode sono già spazi). */
const RUNS = /[ \t\n\r\f\v]+|[^ \t\n\r\f\v]+/g;
const SPACE = /^[ \t\n\r\f\v]/;
const PARTS = /^(['’`*"(<[]*(?:[mM][aA][iI][lL][tT][oO]:)?)([\s\S]*?)([.,;:!?)>\]'’`*"]*)$/;
/** Un indirizzo vero sta in 254 caratteri: una corsa con «@» più lunga di così si nasconde senza analizzarla. */
const MAX_CANDIDATE = 300;

/** NFKC, senza invisibili, spazi strani e «@» scritte in altro modo: la forma su cui si applica la regola. */
export const normalizeEmailText = (text: string): string =>
  text.normalize("NFKC").replace(INVISIBLE, "").replace(STRANGE_SPACES, " ").replace(AT_FORMS, "@");

/** L'indirizzo in minuscolo se è esattamente @unimi.it, altrimenti null. */
export const institutionalEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = normalizeEmailText(value).trim();
  return UNIMI_ADDRESS.test(email) ? email.toLowerCase() : null;
};

/**
 * Toglie gli indirizzi da un testo. Con `keepInstitutional` restano solo quelli esattamente @unimi.it
 * (con le loro maiuscole); gli altri candidati diventano «[email nascosta]». Senza «@» (dopo la normalizzazione)
 * il testo torna identico; altrimenti esce normalizzato.
 */
export const redactEmails = (text: string, keepInstitutional: boolean): string => {
  const normalized = normalizeEmailText(text);
  if (!normalized.includes("@")) return text;
  return redactNormalized(normalized, keepInstitutional);
};

const redactNormalized = (normalized: string, keepInstitutional: boolean): string => {
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
    if (run.length > MAX_CANDIDATE) {
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

/** true se ogni indirizzo nel testo è @unimi.it e non resta nessuna «@» (controllo prima di scrivere). */
export const onlyInstitutionalEmails = (text: string): boolean => {
  const normalized = normalizeEmailText(text);
  return !normalized.includes("@") || redactNormalized(normalized, true) === normalized;
};
