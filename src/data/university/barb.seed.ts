// Seed BARB — A.A. 2026/2027 (curriculum FBG), Laurea Magistrale LM-6 R, codice corso F92/BARB.
// Base verificata a mano. Gli aggiornamenti successivi arrivano dall'overlay generato dalla
// pipeline locale (barb.synced.json, vedi docs/barb-sync.md): questo file non va riscritto dagli script.
// Fonti ESCLUSIVE: piano didattico ufficiale + scheda corso UNIMI + manifesto PDF + calendari ufficiali.
// Ricerca effettuata il 2026-09-28. NESSUN dato inventato:
// - docenti/syllabus/orari giornalieri NON pubblicati in queste fonti -> restano null/vuoti;
// - gli orari dettagliati del 1° semestre attendono il PDF ufficiale fornito dall'utente;
// - il 2° semestre non è pubblicato (stato esplicito, nessun calendario ipotetico).
// Ogni corso conserva sourceUrl + retrievedAt + lastVerifiedAt per dimostrare la provenienza.

import type { BarbCourse, BarbDataset, DataProvenance, SemesterId } from "../../lib/university/types";
import { slugifyCourse } from "../../lib/university/normalize";

const VERIFIED_AT = "2026-09-28T00:00:00.000Z";

const PIANO_URL = "https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico";
const SCHEDA_URL = "https://www.unimi.it/it/corsi/laurea-magistrale/biologia-applicata-alla-ricerca-biomedica";
// Coorte immatricolati 2026/2027 = FBGof2 (FBGof1 è la coorte 2025/2026: link corretto il 2026-09-28).
const MANIFESTO_URL = "https://apps.unimi.it/files/manifesti/ita_manifesto_FBGof2_2027.pdf";
const ORARI_URL = "https://orari.unimi.it/PortaleStudenti/";
const CALENDARI_URL = "https://barb.cdl.unimi.it/it/studiare/calendari-e-orari";

function prov(sourceUrl: string, sourceType: DataProvenance["sourceType"], note?: string): DataProvenance {
  return {
    sourceUrl,
    sourceType,
    retrievedAt: VERIFIED_AT,
    lastVerifiedAt: VERIFIED_AT,
    officialSource: true,
    confidence: 0.95,
    provenanceNote: note,
  };
}

interface SeedRow {
  name: string;
  cfu: number;
  totalHours: number | null;
  year: 1 | 2 | null;
  semester: SemesterId;
  choiceGroup: string | null;
  character: BarbCourse["character"];
  ssd: string[];
  language: "Italiano" | "Inglese" | null;
  sourceUrl: string;
}

const ROWS: SeedRow[] = [
  // ——— Obbligatori 1° anno ———
  { name: "Anatomia dell'uomo", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: null, character: "obbligatorio", ssd: ["BIOS-12/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Farmacologia speciale", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: null, character: "obbligatorio", ssd: ["BIOS-11/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Genetica e genomica umana con elementi di bioinformatica", cfu: 6, totalHours: 64, year: 1, semester: "primo", choiceGroup: null, character: "obbligatorio", ssd: ["BIOS-14/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Patologia", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: null, character: "obbligatorio", ssd: ["MEDS-02/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Principi di fisiologia", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: null, character: "obbligatorio", ssd: ["BIOS-06/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Biostatistica", cfu: 6, totalHours: 64, year: 1, semester: "secondo", choiceGroup: null, character: "obbligatorio", ssd: ["MEDS-24/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Accertamento di lingua inglese - livello B2 (3 CFU)", cfu: 3, totalHours: 0, year: null, semester: "non-definito", choiceGroup: null, character: "lingua", ssd: [], language: "Inglese", sourceUrl: PIANO_URL },
  { name: "Altre conoscenze utili per l'inserimento nel mondo del lavoro", cfu: 3, totalHours: 24, year: null, semester: "annuale", choiceGroup: null, character: "altre-conoscenze", ssd: [], language: "Italiano", sourceUrl: PIANO_URL },
  // ——— Gruppo 1: scelta guidata, 1 esame da 6 CFU ———
  { name: "Antropologia", cfu: 6, totalHours: 48, year: 1, semester: "non-definito", choiceGroup: "gruppo-1", character: "opzionale-scelta-guidata", ssd: ["BIOS-03/B"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Ecotossicologia", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-1", character: "opzionale-scelta-guidata", ssd: ["BIOS-05/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Generazione di modelli di malattie umane e loro applicazione", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-1", character: "opzionale-scelta-guidata", ssd: ["BIOS-04/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Meccanismi molecolari di trasduzione del segnale in biologia cellulare e patologia", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-1", character: "opzionale-scelta-guidata", ssd: ["BIOS-04/A"], language: "Italiano", sourceUrl: PIANO_URL },
  // ——— Gruppo 2: scelta guidata, 2 esami da 12 CFU ———
  { name: "Approcci per l'identificazione di bersagli farmacologici nelle malattie genetiche", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-11/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Biochimica clinica e biologia molecolare clinica", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-09/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Cellule staminali e medicina rigenerativa", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-13/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Farmaci biologici e terapie avanzate", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-11/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Fisiologia cellulare e molecolare", cfu: 6, totalHours: 48, year: 1, semester: "non-definito", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-06/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Fisiologia e farmacologia del sistema endocrino", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-06/A", "BIOS-11/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Microbiologia clinica e igiene", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["MEDS-03/A", "MEDS-24/B"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Neuroanatomia umana e sperimentale", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-12/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Neurofisiologia", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["BIOS-06/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Oncologia sperimentale", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["MEDS-02/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Patologia cellulare e molecolare", cfu: 6, totalHours: 48, year: 1, semester: "non-definito", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["MEDS-02/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Scienze epidemiologiche e della prevenzione", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-2", character: "opzionale-scelta-guidata", ssd: ["MEDS-24/B"], language: "Italiano", sourceUrl: PIANO_URL },
  // ——— Gruppo 3: scelta guidata, 2 esami da 12 CFU ———
  { name: "Basi molecolari e funzionali dei disturbi cardiovascolari e metabolici", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-06/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Biologia e basi molecolari delle malattie neuromuscolari", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-12/A", "BIOS-13/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Biologia molecolare applicata alla ricerca biomedica", cfu: 6, totalHours: 48, year: 1, semester: "secondo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-08/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Diagnostica avanzata di laboratorio biosanitario", cfu: 6, totalHours: 64, year: 1, semester: "secondo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-09/A", "MEDS-01/A", "MEDS-03/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Methods in bioinformatics", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-08/A"], language: "Inglese", sourceUrl: PIANO_URL },
  { name: "Microbiologia cellulare e immunologia", cfu: 6, totalHours: 56, year: 1, semester: "primo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-15/A"], language: "Italiano", sourceUrl: PIANO_URL },
  { name: "Tecniche avanzate di indagine biomedica", cfu: 6, totalHours: 48, year: 1, semester: "primo", choiceGroup: "gruppo-3", character: "opzionale-scelta-guidata", ssd: ["BIOS-06/A"], language: "Italiano", sourceUrl: PIANO_URL },
  // ——— 2° anno: attività conclusive (nomi ufficiali dal piano didattico, 36 CFU complessivi) ———
  { name: "Tirocinio formativo e di orientamento", cfu: 6, totalHours: null, year: 2, semester: "non-definito", choiceGroup: null, character: "tirocinio-tesi", ssd: [], language: null, sourceUrl: MANIFESTO_URL },
  { name: "Prova finale", cfu: 30, totalHours: null, year: 2, semester: "non-definito", choiceGroup: null, character: "tirocinio-tesi", ssd: [], language: null, sourceUrl: MANIFESTO_URL },
];

function toCourse(row: SeedRow): BarbCourse {
  return {
    id: `barb-26-27-${slugifyCourse(row.name)}`,
    name: row.name,
    englishName: row.name === "Methods in bioinformatics" ? "Methods in bioinformatics" : null,
    code: null, // non esposto dal piano didattico: mai inventato
    cfu: row.cfu,
    totalHours: row.totalHours,
    year: row.year,
    semester: row.semester,
    choiceGroup: row.choiceGroup,
    character: row.character,
    ssd: row.ssd,
    language: row.language,
    responsibleTeacherId: null, // da schede insegnamento via sync: mai dedotto
    teacherIds: [],
    syllabus: null,
    learningGoals: null,
    prerequisites: null,
    examMode: null,
    officialPageUrl: row.sourceUrl === MANIFESTO_URL ? null : "https://barb.cdl.unimi.it/it/insegnamenti/elenco-insegnamenti-z",
    arielUrl: null,
    schedule: [],
    exceptions: [],
    provenance: prov(
      row.sourceUrl,
      row.sourceUrl === MANIFESTO_URL ? "manifesto-pdf" : "piano-didattico",
      "Dato verificato il 2026-09-28 su fonte ufficiale. Docenti, syllabus, orari giornalieri e aule non pubblicati in questa fonte: campi a null intentional.",
    ),
    conflicts: [],
  };
}

export const BARB_SEED: BarbDataset = {
  version: 1,
  exportedAt: VERIFIED_AT,
  degreeName: "Biologia Applicata alla Ricerca Biomedica (BARB)",
  degreeClass: "LM-6 R — Biologia",
  degreeCode: "F92 / FBG (coorte 2026/2027)",
  academicYear: "2026/2027",
  courses: ROWS.map(toCourse),
  teachers: [],
  semesters: [
    {
      id: "primo",
      label: "Primo semestre",
      startDate: "2026-09-28",
      endDate: "2027-01-15",
      scheduleStatus: "in-attesa-pdf",
      scheduleNote:
        "Date ufficiali confermate da calendari-e-orari BARB. Orario giornaliero con aule in attesa del PDF ufficiale fornito dall'utente + verifica su portale EasyAcademy/lezioniUnimi. Nessun orario ipotizzato.",
      provenance: prov(CALENDARI_URL, "calendario-didattico"),
    },
    {
      id: "secondo",
      label: "Secondo semestre",
      startDate: null,
      endDate: null,
      scheduleStatus: "non-pubblicato",
      scheduleNote: "Orari del secondo semestre non ancora pubblicati dall'Università.",
      provenance: prov(CALENDARI_URL, "calendario-didattico", "Pagina calendari consultata il 2026-09-28: date 2° semestre non estraibili con certezza, nessun calendario generato."),
    },
  ],
  contacts: [
    { label: "Orientamento BARB (ammissione)", value: "orientamento.barb@unimi.it", url: null },
    { label: "Segreteria didattica Biologia — Via Celoria 26, Torre C piano terra", value: "cl.biol@unimi.it", url: "https://informastudenti.unimi.it/" },
    { label: "Sedi corsi", value: "Via Celoria 26 (Edifici Biologici) — Via Celoria 20 (Settore Didattico) — Via Golgi 19 (Edificio Golgi)", url: null },
    { label: "Portale orari ufficiale (EasyAcademy)", value: "Agenda web studenti UNIMI", url: ORARI_URL },
    { label: "App ufficiale orari", value: "lezioniUnimi (iOS/Android)", url: "https://www.unimi.it/it/studiare/frequentare-un-corso-di-laurea/seguire-il-percorso-di-studi/orari-delle-lezioni" },
  ],
  sources: [
    { label: "Piano didattico BARB 2026/2027", url: PIANO_URL, kind: "piano-didattico" },
    { label: "Scheda corso UNIMI", url: SCHEDA_URL, kind: "scheda-corso" },
    { label: "Manifesto degli studi FBG 2026/2027 (PDF)", url: MANIFESTO_URL, kind: "manifesto-pdf" },
    { label: "Calendari e orari BARB", url: CALENDARI_URL, kind: "calendario-didattico" },
    { label: "Elenco insegnamenti A-Z", url: "https://barb.cdl.unimi.it/it/insegnamenti/elenco-insegnamenti-z", kind: "elenco-insegnamenti" },
    { label: "Referenti e contatti", url: "https://barb.cdl.unimi.it/it/il-corso/referenti-e-contatti", kind: "contatti-ufficiali" },
  ],
};
