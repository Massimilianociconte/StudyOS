import {
  createClient,
  type RealtimeChannel,
  type Session,
  type SupabaseClient
} from "@supabase/supabase-js";
import type { StudySnapshot } from "../types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "studyos-auth"
        }
      })
    : null;

export const isCloudConfigured = () => supabase !== null;

const SNAPSHOT_TYPE = "snapshot";
const SNAPSHOT_ID = "main";

export const signUp = async (email: string, password: string) => {
  if (!supabase) throw new Error("Supabase non configurato.");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
};

export const signIn = async (email: string, password: string) => {
  if (!supabase) throw new Error("Supabase non configurato.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const signOut = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

export const getSession = async (): Promise<Session | null> => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const onAuthChange = (cb: (session: Session | null) => void) => {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
};

export interface CloudSnapshotRow {
  payload: StudySnapshot;
  updated_at: string;
  version: number;
}

export const pushSnapshot = async (snapshot: StudySnapshot, clientId: string): Promise<CloudSnapshotRow> => {
  if (!supabase) throw new Error("Supabase non configurato.");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sessione non trovata.");

  const { data, error } = await supabase
    .from("studyos_items")
    .upsert(
      {
        user_id: userData.user.id,
        entity_type: SNAPSHOT_TYPE,
        entity_id: SNAPSHOT_ID,
        payload: snapshot as unknown as Record<string, unknown>,
        encrypted: false,
        deleted: false,
        client_id: clientId
      },
      { onConflict: "user_id,entity_type,entity_id" }
    )
    .select("payload, updated_at, version")
    .single();

  if (error) throw error;
  return data as CloudSnapshotRow;
};

export const pullSnapshot = async (): Promise<CloudSnapshotRow | null> => {
  if (!supabase) throw new Error("Supabase non configurato.");
  const { data, error } = await supabase
    .from("studyos_items")
    .select("payload, updated_at, version")
    .eq("entity_type", SNAPSHOT_TYPE)
    .eq("entity_id", SNAPSHOT_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return data as CloudSnapshotRow;
};

export interface RemoteSnapshotPayload {
  client_id: string | null;
  updated_at: string;
  version: number;
}

export const subscribeRemoteSnapshot = (
  userId: string,
  onChange: (row: RemoteSnapshotPayload) => void
): RealtimeChannel | null => {
  if (!supabase) return null;
  const channel = supabase
    .channel(`studyos-snapshot:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "studyos_items",
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
        if (!row) return;
        if (row.entity_type !== SNAPSHOT_TYPE || row.entity_id !== SNAPSHOT_ID) return;
        onChange({
          client_id: (row.client_id as string | null) ?? null,
          updated_at: row.updated_at as string,
          version: (row.version as number) ?? 0
        });
      }
    )
    .subscribe();
  return channel;
};

export const unsubscribeChannel = (channel: RealtimeChannel | null) => {
  if (!supabase || !channel) return;
  supabase.removeChannel(channel);
};
