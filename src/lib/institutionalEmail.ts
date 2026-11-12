// Indirizzi email istituzionali (decisione della persona, 12/11): agli agenti arrivano solo gli
// indirizzi esattamente @unimi.it di docenti e contatti dell'università, mai quelli di studenti,
// membri, invitati o account. Il catalogo BARB usa solo @unimi.it (41 indirizzi, nessun sottodominio):
// i sottodomini (es. @studenti.unimi.it) restano fuori.
//
// Regola unica, identica a studyos_hide_emails / studyos_only_unimi_emails in supabase/group-exams.sql
// (stessi esempi in tests/fixtures/emailVectors.json, usati dai test dei due lati):
// 1. il testo si normalizza in NFKC («＠» e «﹫» diventano «@») e perde i caratteri invisibili;
// 2. ogni corsa di caratteri senza spazi ASCII che contiene una «@» è UN candidato;
// 3. tolti l'inizio (virgolette, parentesi aperte, «mailto:») e la fine (punteggiatura), il candidato resta solo se
//    è per intero «parte-locale@unimi.it» (parte locale ASCII, dominio confrontato solo con lettere ASCII);
//    altrimenti tutto il candidato diventa «[email nascosta]». Gli indirizzi tenuti conservano le maiuscole.

export const INSTITUTIONAL_EMAIL_DOMAIN = "unimi.it";
export const EMAIL_HIDDEN = "[email nascosta]";

// Niente flag «i»: «İ» (I turca) non deve mai valere come «i». Le classi elencano le sole lettere ASCII.
const UNIMI_ADDRESS = /^[A-Za-z0-9._%+-]+@[uU][nN][iI][mM][iI]\.[iI][tT]$/;
const INVISIBLE = /[­​-‏‪-‮⁠⁦-⁩﻿]/g;
/** Spazi ASCII: separano i candidati (dopo la normalizzazione gli altri spazi Unicode sono già spazi). */
const RUNS = /([ \t\n\r\f\v]+)|([^ \t\n\r\f\v]+)/g;
const PARTS = /^(['’`*"(<[]*(?:[mM][aA][iI][lL][tT][oO]:)?)([\s\S]*?)([.,;:!?)>\]'’`*"]*)$/;

/** NFKC e senza caratteri invisibili: la forma su cui si applica la regola. */
export const normalizeEmailText = (text: string): string => text.normalize("NFKC").replace(INVISIBLE, "");

/** L'indirizzo in minuscolo se è esattamente @unimi.it, altrimenti null. */
export const institutionalEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = normalizeEmailText(value).trim();
  return UNIMI_ADDRESS.test(email) ? email.toLowerCase() : null;
};

/**
 * Toglie gli indirizzi da un testo. Con `keepInstitutional` restano solo quelli esattamente @unimi.it
 * (con le loro maiuscole); tutti gli altri candidati diventano «[email nascosta]». Il testo esce normalizzato.
 */
export const redactEmails = (text: string, keepInstitutional: boolean): string =>
  normalizeEmailText(text).replace(RUNS, (run: string, space: string | undefined) => {
    if (space !== undefined || !run.includes("@")) return run;
    const parts = PARTS.exec(run);
    const lead = parts?.[1] ?? "";
    const core = parts?.[2] ?? run;
    const trail = parts?.[3] ?? "";
    return `${lead}${keepInstitutional && UNIMI_ADDRESS.test(core) ? core : EMAIL_HIDDEN}${trail}`;
  });

/** true se ogni indirizzo nel testo è @unimi.it e non resta nessuna «@» (controllo prima di scrivere). */
export const onlyInstitutionalEmails = (text: string): boolean =>
  redactEmails(text, true) === normalizeEmailText(text);
