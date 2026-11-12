// Indirizzi email istituzionali (decisione della persona, 12/11): agli agenti arrivano solo gli
// indirizzi esattamente @unimi.it di docenti e contatti dell'università, mai quelli di studenti,
// membri, invitati o account. Il catalogo BARB usa solo @unimi.it (41 indirizzi, nessun sottodominio):
// i sottodomini (es. @studenti.unimi.it) restano fuori. Stessa regola di studyos_only_unimi_emails.

export const INSTITUTIONAL_EMAIL_DOMAIN = "unimi.it";
export const EMAIL_HIDDEN = "[email nascosta]";

const EXACT = /^[a-z0-9._%+-]+@unimi\.it$/;
const ALLOWED_IN_TEXT = /[a-z0-9._%+-]+@unimi\.it(?![a-z0-9-]|\.[a-z0-9])/gi;
/** Qualunque corsa di caratteri non separatori che contiene una «@» (anche larga ＠ o piccola ﹫). */
const AT_TOKEN = /[^\s<>()[\]",;:]*[@＠﹫][^\s<>()[\]",;:]*/gu;

/** L'indirizzo in minuscolo se è esattamente @unimi.it, altrimenti null. */
export const institutionalEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EXACT.test(email) ? email : null;
};

/** true se ogni indirizzo nel testo è @unimi.it e non resta nessuna «@» (controllo prima di scrivere). */
export const onlyInstitutionalEmails = (text: string) => !text.replace(ALLOWED_IN_TEXT, "").includes("@");

/**
 * Toglie gli indirizzi da un testo. Con `keepInstitutional` restano solo quelli esattamente @unimi.it
 * (in minuscolo) e non attaccati a un'altra «@»; tutti gli altri diventano «[email nascosta]».
 */
export const redactEmails = (text: string, keepInstitutional: boolean): string => {
  const out = text.replace(AT_TOKEN, (token: string) => {
    // Ogni corsa di caratteri attorno a una «@» è un solo candidato (lettere Unicode, apostrofi,
    // caratteri invisibili, più «@»): si tiene solo se l'intero candidato è un indirizzo istituzionale.
    const lead = /^['’`*]*/.exec(token)?.[0] ?? "";
    const trail = /[.'’`*!?]*$/.exec(token.slice(lead.length))?.[0] ?? "";
    const core = token.slice(lead.length, token.length - trail.length);
    const kept = keepInstitutional ? institutionalEmail(core) : null;
    return `${lead}${kept ?? EMAIL_HIDDEN}${trail}`;
  });
  // Ultima guardia: senza permesso non resta nessuna «@» (nemmeno quelle larghe o piccole).
  return keepInstitutional ? out : out.replace(/[@＠﹫]/g, EMAIL_HIDDEN);
};
