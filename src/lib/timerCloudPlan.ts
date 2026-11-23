// Scelta pura di timerCloud.ts (senza Supabase né import.meta.env): la usano il modulo e i test.
import type { TimerState } from "./studyTimer";

const stampOf = (timer: Pick<TimerState, "changedAt"> | null | undefined) => timer?.changedAt ?? 0;

export interface TimerCloudStep {
  /** "adopt" = quello del cloud è più recente; "push" = è più recente quello qui ed è di questo account. */
  action: "adopt" | "push" | "none";
  /**
   * Account a cui appartiene da ora il timer di questo dispositivo. Un timer avviato con un altro
   * account sullo stesso dispositivo resta di quello: non finisce nel cloud di questo, nemmeno ai
   * controlli successivi.
   */
  owner: string | null;
}

export const timerCloudPlan = (local: TimerState, remote: TimerState | null, owner: string | null, user: string): TimerCloudStep => {
  if (remote && stampOf(remote) > stampOf(local)) return { action: "adopt", owner: user };
  const mine = owner === null || owner === user;
  if (stampOf(local) > stampOf(remote)) return mine ? { action: "push", owner: user } : { action: "none", owner };
  // Già uguali (o entrambi vuoti): il timer qui è quello dell'account.
  return { action: "none", owner: remote ? user : owner };
};
