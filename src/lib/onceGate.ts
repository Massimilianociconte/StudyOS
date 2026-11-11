/**
 * Un'azione per volta (Salva, Registra, Elimina): `take` lascia passare solo il primo tocco finché
 * qualcuno non chiama `release` (errore del modulo, modulo riaperto). Il doppio tocco su un pulsante
 * che salva in più passi altrimenti rifarebbe tutto (due esami, due materie). Vedi `useOnce`.
 */
export const createOnceGate = () => {
  let busy = false;
  return {
    take: () => {
      if (busy) return false;
      busy = true;
      return true;
    },
    release: () => {
      busy = false;
    },
    taken: () => busy
  };
};

export type OnceGate = ReturnType<typeof createOnceGate>;
