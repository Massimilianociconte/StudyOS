import { useEffect, useState } from "react";
import { dayWatcher, localDayKey } from "../lib/dates";

/**
 * Giorno di oggi ("2026-11-16") che si aggiorna da solo: per i totali di oggi, della settimana e
 * del mese nelle viste che restano aperte oltre la mezzanotte (o fino a lunedì). Controlla ogni
 * minuto e tornando sulla scheda; ridisegna solo quando il giorno cambia. Da usare come dipendenza
 * dei `useMemo` che leggono `new Date()`.
 */
export function useToday(intervalMs = 60_000): string {
  const [day, setDay] = useState(() => localDayKey(new Date()));
  useEffect(() => {
    const check = dayWatcher(day, setDay);
    const id = window.setInterval(check, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [day, intervalMs]);
  return day;
}
