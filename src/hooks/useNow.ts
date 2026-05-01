import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return undefined;
    const interval = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs]);

  return now;
}
