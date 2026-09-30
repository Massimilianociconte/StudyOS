import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => new Date());
  // Quando il tick riparte dopo una pausa, `now` sarebbe congelato al valore di
  // prima della pausa: il countdown mostrerebbe secondi fantasma pari alla pausa
  // fino al primo tick. Si riallinea subito, nello stesso render (nessun frame sporco).
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled);
    if (enabled) setNow(new Date());
  }

  useEffect(() => {
    if (!enabled) return undefined;
    const interval = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs]);

  return now;
}
