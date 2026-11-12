// Indirizzi email istituzionali (decisione della persona, 12/11): agli agenti arrivano solo gli
// indirizzi esattamente @unimi.it di docenti e contatti dell'università, mai quelli di studenti,
// membri, invitati o account. Il catalogo BARB usa solo @unimi.it (41 indirizzi, nessun sottodominio):
// i sottodomini (es. @studenti.unimi.it) restano fuori. Stessa regola di studyos_only_unimi_emails.

export const INSTITUTIONAL_EMAIL_DOMAIN = "unimi.it";
export const EMAIL_HIDDEN = "[email nascosta]";

const EXACT = /^[a-z0-9._%+-]+@unimi\.it$/;
const ALLOWED_IN_TEXT = /[a-z0-9._%+-]+@unimi\.it(?![a-z0-9-]|\.[a-z0-9])/gi;
const ANY_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g;

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
export const redactEmails = (text: string, keepInstitutional: boolean): string =>
  text.replace(ANY_EMAIL, (match: string, offset: number, whole: string) => {
    const touching = whole[offset - 1] === "@" || whole[offset + match.length] === "@";
    if (keepInstitutional && !touching && institutionalEmail(match)) return match.toLowerCase();
    return EMAIL_HIDDEN;
  });
