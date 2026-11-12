import { useState } from "react";
import { createOnceGate } from "../lib/onceGate";

/**
 * Un solo Salva / Scarta / Elimina per volta: un Drawer che si chiude resta cliccabile per
 * l'animazione e un doppio tocco rifarebbe l'azione. La porta blocca subito (stesso tocco), `busy`
 * disattiva il pulsante. `release` dopo un errore del modulo e quando il modulo si riapre.
 */
export const useOnce = () => {
  const [gate] = useState(createOnceGate);
  const [busy, setBusy] = useState(false);
  return {
    busy,
    take: () => {
      if (!gate.take()) return false;
      setBusy(true);
      return true;
    },
    release: () => {
      gate.release();
      setBusy(false);
    }
  };
};
