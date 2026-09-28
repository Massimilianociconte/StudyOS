// Sorgenti ufficiali UNIMI — whitelist + registry BARB.
// Solo questi domini possono alimentare il dataset. Tutto il resto viene scartato.

export const UNIMI_OFFICIAL_HOSTS = [
  "barb.cdl.unimi.it",
  "www.unimi.it",
  "unimi.it",
  "apps.unimi.it",
  "easystaff.divsi.unimi.it",
  "ariel.unimi.it",
  "www.bioscienzebio.unimi.it",
  "bioscienzebio.unimi.it",
  "tesi.bioscienze.unimi.it",
  "studente.unimi.it",
  "informastudenti.unimi.it",
  "lezioniunimi.unimi.it",
  "orari.unimi.it",
  "myariel.unimi.it",
] as const;

export function isOfficialUnimiUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (UNIMI_OFFICIAL_HOSTS as readonly string[]).some(
      (allowed) => host === allowed.toLowerCase().replace(/^www\./, "") || host.endsWith(`.${allowed.toLowerCase().replace(/^www\./, "")}`),
    );
  } catch {
    return false;
  }
}

// Registro delle fonti primarie BARB (A.A. 2026/2027, curriculum FBG).
// La pipeline interroga SOLO queste fonti, in ordine di specificità decrescente.
export interface DiscoverySource {
  key: string;
  label: string;
  url: string;
  kind:
    | "piano-didattico"
    | "manifesto-pdf"
    | "scheda-corso"
    | "calendario-didattico"
    | "orario-lezioni"
    | "easyacademy"
    | "elenco-insegnamenti"
    | "dipartimento"
    | "contatti-ufficiali";
  priority: number; // 1 = più specifica/recente
}

export const BARB_DISCOVERY_SOURCES: DiscoverySource[] = [
  {
    key: "piano-didattico-26-27",
    label: "Piano didattico BARB 2026/2027 (FBG)",
    url: "https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico",
    kind: "piano-didattico",
    priority: 1,
  },
  {
    key: "elenco-insegnamenti",
    label: "Elenco insegnamenti A-Z BARB",
    url: "https://barb.cdl.unimi.it/it/insegnamenti/elenco-insegnamenti-z",
    kind: "elenco-insegnamenti",
    priority: 2,
  },
  {
    key: "scheda-corso-unimi",
    label: "Scheda corso UNIMI — Biologia applicata alla ricerca biomedica",
    url: "https://www.unimi.it/it/corsi/laurea-magistrale/biologia-applicata-alla-ricerca-biomedica",
    kind: "scheda-corso",
    priority: 2,
  },
  {
    key: "manifesto-26-27",
    label: "Manifesto degli studi FBG 2026/2027 (PDF, coorte FBGof2)",
    url: "https://apps.unimi.it/files/manifesti/ita_manifesto_FBGof2_2027.pdf",
    kind: "manifesto-pdf",
    priority: 3,
  },
  {
    key: "calendari-e-orari",
    label: "Calendari e orari BARB",
    url: "https://barb.cdl.unimi.it/it/studiare/calendari-e-orari",
    kind: "calendario-didattico",
    priority: 1,
  },
  // (rimossa "orario-delle-lezioni": la pagina risponde 404 dal 2026-09-28)
  {
    key: "portale-studenti-easyacademy",
    label: "Portale studenti EasyAcademy (orari ufficiali)",
    url: "https://orari.unimi.it/PortaleStudenti/",
    kind: "easyacademy",
    priority: 2,
  },
  {
    key: "orari-ateneo",
    label: "Orari delle lezioni — guida Ateneo + app lezioniUnimi",
    url: "https://www.unimi.it/it/studiare/frequentare-un-corso-di-laurea/seguire-il-percorso-di-studi/orari-delle-lezioni",
    kind: "orario-lezioni",
    priority: 3,
  },
  {
    key: "home-barb",
    label: "Home sito corso BARB",
    url: "https://barb.cdl.unimi.it/it",
    kind: "scheda-corso",
    priority: 4,
  },
  {
    key: "dipartimento-bioscienze",
    label: "Dipartimento di Bioscienze — pagina BARB",
    url: "https://www.bioscienzebio.unimi.it/barb",
    kind: "dipartimento",
    priority: 4,
  },
  {
    key: "referenti-contatti",
    label: "Referenti e contatti BARB",
    url: "https://barb.cdl.unimi.it/it/il-corso/referenti-e-contatti",
    kind: "contatti-ufficiali",
    priority: 2,
  },
];

export const BARB_CONTACTS_FALLBACK: Array<{ label: string; value: string; url: string | null }> = [
  { label: "Orientamento BARB (ammissione)", value: "orientamento.barb@unimi.it", url: null },
  { label: "Segreteria didattica — Via Celoria 26, Torre C piano terra", value: "cl.biol@unimi.it", url: "https://informastudenti.unimi.it/" },
  { label: "Sedi corsi: Via Celoria 26/20 — Via Golgi 19", value: "Edifici Biologici, Settore Didattico, Edificio Golgi", url: null },
];
