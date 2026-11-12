// Testi della schermata «aperto in un'altra scheda» (src/components/TabGuard.tsx, src/lib/activeTab.ts).
// File piccolo: fa parte del bundle iniziale, come la schermata.

export const TAB_GUARD_TEXT = {
  titleElsewhere: "StudyOS è aperto in un'altra scheda",
  bodyElsewhere: "Per non perdere modifiche, StudyOS si usa in una scheda alla volta.",
  titleMoved: "StudyOS è passato a un'altra scheda",
  bodyMoved: "Ora StudyOS è aperto nell'altra scheda. Puoi continuare lì o tornare qui.",
  use: "Usa questa scheda",
  useNote: "L'altra scheda si mette in pausa: non si perde nulla.",
  waiting: "Sto passando StudyOS a questa scheda…",
  slow: "L'altra scheda non risponde: forse è in pausa sullo sfondo.",
  force: "Usa comunque qui",
  forceNote: "Quello che era già salvato resta. L'altra scheda si ferma."
} as const;
