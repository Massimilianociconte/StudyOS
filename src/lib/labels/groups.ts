// Testi della sezione Gruppi che si caricano con la schermata (le etichette condivise sono in ../labels).

/** «Nuovo gruppo» e «Aggiungi alla bacheca»: chiudere con qualcosa di scritto chiede prima. */
export const GROUP_FORM_TEXT = {
  createEyebrow: "Nuovo gruppo",
  createTitle: "Con chi studi?",
  resourceEyebrow: (group: string) => `Bacheca · ${group}`,
  resourceTitle: "Cosa vuoi condividere?",
  unsavedTitle: "Scartare le modifiche?",
  unsavedCreateText: "Hai scritto il nome o la descrizione del gruppo senza crearlo.",
  unsavedResourceText: "Hai scritto qualcosa per la bacheca senza aggiungerlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche"
} as const;
