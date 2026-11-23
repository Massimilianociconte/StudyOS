// Pannello dei progressi di una materia (schede di Materie ed Esami, dettaglio della materia): tre
// indicatori distinti, con nomi che dicono chi li muove. Logica in src/lib/subjectProgress.ts.

const countWord = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const PROGRESS_TEXT = {
  activity: "Avanzamento attività",
  /** «3 di 5 fatte»: le attività che contano, fatte su tutte. */
  activityDone: (done: number, counted: number) => (counted === 1 ? (done ? "1 di 1 fatta" : "0 di 1 fatta") : `${done} di ${counted} fatte`),
  activityPartial: (count: number) => `${countWord(count, "avviata", "avviate")} con passaggi fatti`,
  activityExcluded: (count: number) => `${count} non ${count === 1 ? "conta" : "contano"}`,
  activityNone: "Nessuna attività che conta",
  activityNoneHint: "Aggiungi le attività della materia: l'avanzamento si calcola da solo.",
  activityAll: "Tutte fatte",
  activityLink: "Attività",
  activityLinkAria: (name: string) => `Apri le attività di ${name}`,
  activityAria: (name: string) => `Avanzamento delle attività di ${name}`,

  preparation: "Livello di preparazione",
  preparationAria: (name: string) => `Livello di preparazione per ${name}`,
  preparationDown: (name: string) => `Abbassa del 5% la preparazione per ${name}`,
  preparationUp: (name: string) => `Alza del 5% la preparazione per ${name}`,
  preparationNone: "Nessun esame in programma",
  preparationNoneHint: "Il livello di preparazione si segna sull'esame: aggiungi la data quando la sai.",
  addExam: "Aggiungi l'esame",
  addExamAria: (name: string) => `Aggiungi l'esame di ${name}`,
  /** Attività tutte fatte, preparazione sotto il 100%: la materia si completa con la preparazione. */
  preparationNudge: "Attività finite: alza la preparazione quando ti senti pronto. Al 100% la materia è completata.",

  review: "Stato del ripasso",
  reviewDue: (due: number) => (due ? `${countWord(due, "argomento", "argomenti")} da ripassare oggi` : "Niente da ripassare oggi"),
  reviewTotal: (total: number) => `${countWord(total, "argomento", "argomenti")} in tutto`,
  reviewNone: "Nessun argomento nel ripasso",
  reviewNoneHint: "Gli argomenti del ripasso tornano a intervalli in Studio, finché non li sai.",
  reviewLink: "Ripassa",
  reviewLinkAria: (name: string) => `Apri gli argomenti da ripassare di ${name} in Studio`,

  /** «Aggiungi al ripasso» dal programma dell'esame: dice quanti, dove vanno e cosa succede. */
  programAdd: (count: number) => `Aggiungi ${countWord(count, "argomento", "argomenti")} al ripasso`,
  programAddAria: (count: number, name: string) =>
    `Aggiungi ${countWord(count, "argomento", "argomenti")} del programma di ${name} agli argomenti da ripassare in Studio`,
  programAddHint: "Dal programma dell'esame: ogni voce torna in Studio a intervalli. Quelle già nel ripasso si saltano.",
  programInReview: (total: number) => `Programma già nel ripasso (${countWord(total, "voce", "voci")})`,
  programAdded: (added: number, name: string) =>
    added
      ? `${countWord(added, "argomento aggiunto", "argomenti aggiunti")} al ripasso di ${name}: li trovi in Studio.`
      : "Tutti gli argomenti del programma sono già nel ripasso."
} as const;

export const PROGRESS_HELP = {
  activity: {
    title: "Avanzamento attività",
    text: "Si calcola da solo dalle attività della materia: ognuna vale una parte uguale (o il peso scelto nell'attività). Un'attività con passaggi conta la parte di passaggi fatti; spuntarli tutti la segna fatta. Le attività che «non contano» (ripasso, organizzazione) restano fuori.",
    example: "5 attività valgono il 20% l'una: una con 2 passaggi su 4 fatti aggiunge il 10%."
  },
  preparation: {
    title: "Livello di preparazione",
    text: "Quanto ti senti pronto per l'esame, da 0 a 100%. Lo decidi tu con − e +: è lo stesso numero in Materie ed Esami. Al 100% la materia passa a «Completata», con il voto da registrare.",
    example: "hai finito metà del programma → 50%."
  },
  review: {
    title: "Stato del ripasso",
    text: "Gli argomenti della materia nel ripasso a intervalli: quanti tornano oggi e quanti sono in tutto. Non cambia l'avanzamento né la preparazione.",
    example: "dopo un ripasso «Bene» l'argomento torna tra qualche giorno."
  }
} as const;
