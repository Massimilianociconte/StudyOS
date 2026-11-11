// Collegamenti tra le schermate ("vai a X già filtrato / con l'elemento aperto"): chi porta scrive una
// chiave di `uiState` e cambia sezione, la sezione d'arrivo la legge. Se la sezione è già aperta non si
// rimonta: questo calcolo dice quando una chiave è cambiata da fuori e va applicata. Senza DOM, testabile.

/**
 * `stored` = valore salvato ora, `seen` = l'ultimo già visto. Un valore nuovo si ricorda come visto e
 * si applica solo se valido; uno già visto non si riapplica (nel frattempo l'utente può averlo cambiato).
 */
export function linkedUiChange(stored: unknown, seen: unknown, validate: (value: unknown) => boolean): { seen: unknown; apply: boolean } {
  if (Object.is(stored, seen)) return { seen, apply: false };
  return { seen: stored, apply: stored !== undefined && validate(stored) };
}
