// Scelta pura di timerCloud.ts (senza Supabase né import.meta.env): la usano il modulo e i test.
import type { TimerState } from "./studyTimer";

const stampOf = (timer: Pick<TimerState, "changedAt"> | null | undefined) => timer?.changedAt ?? 0;

/**
 * Cosa fare dopo aver letto il timer del cloud: "adopt" = quello del cloud è più recente; "push" = è
 * più recente quello qui e appartiene a questo account (un timer avviato con un altro account sullo
 * stesso dispositivo non finisce in questo); "none" = già uguali.
 */
export const timerCloudPlan = (local: TimerState, remote: TimerState | null, owner: string | null, user: string): "adopt" | "push" | "none" => {
  if (remote && stampOf(remote) > stampOf(local)) return "adopt";
  if (stampOf(local) > stampOf(remote) && (owner === null || owner === user)) return "push";
  return "none";
};
