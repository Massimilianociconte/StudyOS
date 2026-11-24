// Identità delle materie: quando due nomi indicano la stessa materia. Logica pura (node --test), usata
// dallo store (che rifiuta i doppioni certi per l'app, gli agenti nel browser e il connettore remoto,
// che eseguono le stesse azioni), dagli strumenti degli agenti, dal modulo «Nuova materia» e dal
// riquadro «Possibili doppioni» di Materie.
//
// Tre livelli, dal più forte:
// - «same» (doppione certo): stesso nome a meno di maiuscole, accenti, apostrofi e spazi, oppure lo
//   stesso insegnamento del catalogo (`universityCourseId`). Lo store non crea il secondo.
// - «likely» (probabile doppione): una parola significativa in comune e lo stesso docente (anche con
//   nome e cognome invertiti), oppure le stesse parole significative («Anatomia umana» e «Anatomia
//   dell'uomo»). Si chiede alla persona (o l'agente deve confermare) e si propone l'unione.
// - «related» (solo un'indicazione): una parola in comune o un'abbreviazione («Anat.»). Non blocca.
//
// La somiglianza non unisce mai da sola: due materie diverse con un numero diverso («Fisica I» e
// «Fisica II») o un docente diverso restano al massimo «related».

export type SubjectMatchLevel = "same" | "likely" | "related";
export type SubjectMatchReason = "name" | "course" | "teacher" | "words" | "partial";

export interface SubjectIdentity {
  name: string;
  teacher?: string;
  universityCourseId?: string;
}

export interface SubjectMatch<S> {
  subject: S;
  level: SubjectMatchLevel;
  reason: SubjectMatchReason;
}

const RANK: Record<SubjectMatchLevel, number> = { same: 3, likely: 2, related: 1 };

/** Articoli, preposizioni e congiunzioni (italiano e inglese): non dicono di che materia si tratta. */
const STOPWORDS = new Set(
  (
    "di del dello della dei degli delle dell d e ed o con in nel nello nella nei negli nelle per a al allo alla ai agli alle " +
    "da dal dallo dalla dai dagli dalle il lo la i gli le l un uno una su sul sullo sulla sui sugli sulle tra fra " +
    "the of and for to an with on at by"
  ).split(" ")
);

/**
 * Parole da corso di laurea che molti insegnamenti hanno in comune: restano nel nome, ma da sole non
 * fanno pensare alla stessa materia («Laboratorio di X» e «Laboratorio di Y» con lo stesso docente).
 */
const GENERIC = new Set(
  (
    "principi elementi fondamenti introduzione laboratorio lab metodi metodologie metodologia corso modulo parte avanzata avanzato " +
    "avanzate avanzati generale generali speciale applicata applicato applicate applicati base istituzioni tecniche tecnica teoria " +
    "pratica sistema sistemi esame esami insegnamento course module methods principles introduction advanced general applied basic"
  ).split(" ")
);

/** Varianti con lo stesso significato: inglese → italiano, «umana/umano» → «uomo». */
const SYNONYMS: Record<string, string> = {
  umana: "uomo",
  umano: "uomo",
  umani: "uomo",
  umane: "uomo",
  human: "uomo",
  anatomy: "anatomia",
  physiology: "fisiologia",
  pathology: "patologia",
  pharmacology: "farmacologia",
  genetics: "genetica",
  genomics: "genomica",
  bioinformatics: "bioinformatica",
  biostatistics: "biostatistica",
  statistics: "statistica",
  chemistry: "chimica",
  biochemistry: "biochimica",
  physics: "fisica",
  biology: "biologia",
  molecular: "molecolare",
  cellular: "cellulare",
  cell: "cellulare",
  immunology: "immunologia",
  microbiology: "microbiologia",
  neuroscience: "neuroscienze",
  mathematics: "matematica",
  economics: "economia"
};

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** Titoli davanti al nome del docente: «Prof.ssa Rossi» è «Rossi». */
const TITLES = new Set(["prof", "ssa", "professore", "professoressa", "dott", "dr", "dottore", "dottoressa", "ing", "phd"]);

/** Minuscole, senza accenti né segni: «Anatomia dell'Uomo» → «anatomia dell uomo». */
export const normalizeSubjectName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const tokens = (name: string) => normalizeSubjectName(name).split(" ").filter(Boolean);

/**
 * Numeri che distinguono due insegnamenti («Fisica I», «Chimica 2», «Modulo 3»): cifre ovunque, numeri
 * romani solo in fondo (all'inizio o in mezzo «i» è un articolo).
 */
const ordinals = (name: string): string => {
  const list = tokens(name);
  const found = list.filter((token) => /^\d+$/.test(token)).map((token) => String(Number(token)));
  const last = list[list.length - 1];
  if (last && list.length > 1 && ROMAN[last]) found.push(ROMAN[last]);
  return [...new Set(found)].sort().join(",");
};

/** Parole che dicono di che materia si tratta: senza articoli, senza parole da corso, con i sinonimi. */
export const subjectWords = (name: string): string[] => [
  ...new Set(
    tokens(name)
      .filter((token) => !STOPWORDS.has(token) && !/^\d+$/.test(token) && !ROMAN[token])
      .map((token) => SYNONYMS[token] ?? token)
      .filter((token) => token.length > 2 && !GENERIC.has(token))
  )
];

const teacherTokens = (teacher: string | undefined) =>
  new Set(
    tokens(teacher ?? "")
      .filter((token) => !TITLES.has(token) && token.length > 1)
  );

/**
 * Stesso docente: le stesse parole in qualsiasi ordine («Graziella Cappelletti» = «Cappelletti
 * Graziella»), oppure una contenuta nell'altra («Rossi» e «Mario Rossi»). Due docenti vuoti non sono
 * «lo stesso».
 */
export const sameTeacher = (a: string | undefined, b: string | undefined): boolean => {
  const left = teacherTokens(a);
  const right = teacherTokens(b);
  if (!left.size || !right.size) return false;
  const [small, big] = left.size <= right.size ? [left, right] : [right, left];
  return [...small].every((token) => big.has(token));
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((word) => b.includes(word));

/** Abbreviazione («anat» di «anatomia»): almeno 4 lettere, all'inizio di una parola dell'altro nome. */
const abbreviates = (a: readonly string[], b: readonly string[]) =>
  a.some((short) => short.length >= 4 && b.some((long) => long !== short && long.startsWith(short))) ||
  b.some((short) => short.length >= 4 && a.some((long) => long !== short && long.startsWith(short)));

/** Quanto due materie sono la stessa, o `null` se non hanno niente in comune. */
export const compareSubjects = (a: SubjectIdentity, b: SubjectIdentity): { level: SubjectMatchLevel; reason: SubjectMatchReason } | null => {
  if (a.universityCourseId && a.universityCourseId === b.universityCourseId) return { level: "same", reason: "course" };
  // Due insegnamenti diversi del catalogo non sono mai la stessa materia, nemmeno con lo stesso nome
  // (lo stesso corso in due lauree): al massimo si somigliano.
  const otherCourses = Boolean(a.universityCourseId && b.universityCourseId);
  const nameA = normalizeSubjectName(a.name);
  const nameB = normalizeSubjectName(b.name);
  if (!nameA || !nameB) return null;
  if (nameA === nameB) return otherCourses ? { level: "related", reason: "name" } : { level: "same", reason: "name" };
  const wordsA = subjectWords(a.name);
  const wordsB = subjectWords(b.name);
  const shared = wordsA.some((word) => wordsB.includes(word));
  const sameNumbers = ordinals(a.name) === ordinals(b.name);
  if (!otherCourses && sameNumbers) {
    if (wordsA.length && sameSet(wordsA, wordsB)) return { level: "likely", reason: "words" };
    if (shared && sameTeacher(a.teacher, b.teacher)) return { level: "likely", reason: "teacher" };
  }
  if (shared) return { level: "related", reason: "words" };
  if (abbreviates(wordsA, wordsB)) return { level: "related", reason: "partial" };
  return null;
};

/**
 * Materie già presenti che somigliano a `candidate`, dalla più somigliante. `exceptId`: la materia
 * stessa (quando si rinomina). `minLevel`: il livello più debole da restituire.
 */
export const subjectMatches = <S extends SubjectIdentity & { id: string }>(
  candidate: SubjectIdentity,
  subjects: readonly S[],
  options: { exceptId?: string; minLevel?: SubjectMatchLevel } = {}
): SubjectMatch<S>[] => {
  const floor = RANK[options.minLevel ?? "related"];
  const found: SubjectMatch<S>[] = [];
  for (const subject of subjects) {
    if (subject.id === options.exceptId) continue;
    const match = compareSubjects(candidate, subject);
    if (match && RANK[match.level] >= floor) found.push({ subject, ...match });
  }
  return found.sort((x, y) => RANK[y.level] - RANK[x.level] || x.subject.name.localeCompare(y.subject.name, "it"));
};

/** Chiave della coppia, uguale in qualsiasi ordine (per «Sono diverse» salvato nelle preferenze). */
export const subjectPairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Coppie dette diverse salvate nelle preferenze, solo quelle ben formate (arrivano dalla sincronizzazione). */
export const dismissedSubjectPairs = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[^|]{1,120}\|[^|]{1,120}$/.test(item)).slice(0, 500) : [];

export interface SubjectPair<S> {
  a: S;
  b: S;
  level: SubjectMatchLevel;
  reason: SubjectMatchReason;
  key: string;
}

/**
 * Coppie di materie che sembrano la stessa (solo «same» e «likely»), senza quelle che la persona ha
 * già detto diverse (`dismissed`, chiavi di `subjectPairKey`). Le archiviate non contano: chi archivia
 * una materia l'ha già tolta di mezzo.
 */
export const duplicateSubjectPairs = <S extends SubjectIdentity & { id: string; archived?: boolean; status?: string }>(
  subjects: readonly S[],
  dismissed: Iterable<string> = []
): SubjectPair<S>[] => {
  const skip = new Set(dismissed);
  const open = subjects.filter((subject) => !subject.archived && subject.status !== "archived");
  const pairs: SubjectPair<S>[] = [];
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const a = open[i];
      const b = open[j];
      const key = subjectPairKey(a.id, b.id);
      if (skip.has(key)) continue;
      const match = compareSubjects(a, b);
      if (match && match.level !== "related") pairs.push({ a, b, ...match, key });
    }
  }
  return pairs;
};

/** Doppione certo, con la materia già presente: lo store e gli strumenti non creano la seconda. */
export class SubjectDuplicateError extends Error {
  readonly existingId: string;
  readonly existingName: string;
  constructor(existing: { id: string; name: string }, reason: SubjectMatchReason) {
    super(
      reason === "course"
        ? `Questo insegnamento è già collegato alla materia «${existing.name}».`
        : `Esiste già la materia «${existing.name}»: usa quella invece di crearne un'altra.`
    );
    this.name = "SubjectDuplicateError";
    this.existingId = existing.id;
    this.existingName = existing.name;
  }
}

/** Il primo doppione certo di `candidate` tra le materie (comprese le archiviate), se c'è. */
export const exactDuplicate = <S extends SubjectIdentity & { id: string }>(
  candidate: SubjectIdentity,
  subjects: readonly S[],
  exceptId?: string
): SubjectMatch<S> | undefined => subjectMatches(candidate, subjects, { exceptId, minLevel: "same" })[0];
