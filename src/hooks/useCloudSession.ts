import { useEffect, useState } from "react";
import { getCloudSyncState, subscribeCloudSync } from "../lib/cloudSyncState";

/** Sessione cloud corrente (senza caricare supabase-js: lo stato arriva dal motore di sync). */
export function useCloudSession() {
  const [session, setSession] = useState(() => getCloudSyncState().session);
  useEffect(() => subscribeCloudSync((state) => setSession(state.session)), []);
  return session;
}
