// Appelli e correzioni dei miei gruppi, solo in memoria (mai su disco, mai nella sync personale): li
// riempie lib/groupExamSync in app e cloudRunner sul connettore remoto. Senza Supabase: lo leggono
// calendario, viste, agenti e test.
import { create } from "zustand";
import type { CatalogOverride, GroupExamSession } from "../lib/groupExams";
import { mergeOverrideRow, mergeSessionRow } from "../lib/groupExams";

export interface GroupExamGroup {
  id: string;
  name: string;
}

interface GroupExamState {
  /** Account che ha letto gli appelli ("remote" sul connettore remoto); null = niente letto. */
  viewerId: string | null;
  /** Primo pull fatto: prima di allora non si dice mai «non c'è». */
  ready: boolean;
  /** false se group-exams.sql non è stato eseguito (tabelle o funzione mancanti). */
  available: boolean;
  groups: GroupExamGroup[];
  sessions: GroupExamSession[];
  overrides: CatalogOverride[];
  error: string;
  setSnapshot: (snapshot: { viewerId: string; groups: GroupExamGroup[]; sessions: GroupExamSession[]; overrides: CatalogOverride[] }) => void;
  /** Inizio di un pull: le righe scritte o arrivate in tempo reale da adesso non si perdono se il pull non le contiene. */
  beginPull: () => void;
  setGroups: (groups: GroupExamGroup[]) => void;
  applySession: (row: GroupExamSession) => void;
  applyOverride: (row: CatalogOverride) => void;
  dropSession: (id: string) => void;
  dropOverride: (id: string) => void;
  setUnavailable: () => void;
  setError: (text: string) => void;
  reset: () => void;
}

/** Id toccati (scrittura locale o realtime) dall'inizio dell'ultimo pull. */
let touched = new Set<string>();

const EMPTY = { viewerId: null, ready: false, available: true, groups: [], sessions: [], overrides: [], error: "" };

const bySessionDate = (a: GroupExamSession, b: GroupExamSession) =>
  a.date.localeCompare(b.date) || a.courseName.localeCompare(b.courseName) || a.id.localeCompare(b.id);

/** Una riga per id (vince la versione più alta), solo dei gruppi indicati. */
const latest = <T extends { id: string; groupId: string; version: number }>(rows: readonly T[], groupIds: ReadonlySet<string>) => {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!groupIds.has(row.groupId)) continue;
    const current = byId.get(row.id);
    if (!current || row.version > current.version) byId.set(row.id, row);
  }
  return [...byId.values()];
};

export const groupNamesOf = (groups: readonly GroupExamGroup[]): ReadonlyMap<string, string> => new Map(groups.map((group) => [group.id, group.name]));

export const useGroupExamStore = create<GroupExamState>()((set, get) => ({
  ...EMPTY,
  setSnapshot: ({ viewerId, groups, sessions, overrides }) => {
    const ids = new Set(groups.map((group) => group.id));
    // Stesso account: una riga già in memoria più nuova di quella letta (scrittura o evento realtime arrivati
    // durante il pull) non perde mai; una cancellazione non torna viva. Righe assenti dal pull: tolte.
    const keep = get().viewerId === viewerId;
    const newest = <T extends { id: string; groupId: string; version: number }>(pulled: readonly T[], memory: readonly T[]) => {
      if (!keep) return latest(pulled, ids);
      const held = new Map(memory.map((row) => [row.id, row]));
      const inPull = new Set(pulled.map((row) => row.id));
      // Righe nate (o cambiate) dopo l'inizio del pull e assenti da lui: restano, tranne le cancellate.
      const late = memory.filter((row) => touched.has(row.id) && !inPull.has(row.id) && !(row as { deletedAt?: string | null }).deletedAt);
      return latest(
        [
          ...pulled.map((row) => {
            const mine = held.get(row.id);
            return mine && mine.version > row.version ? mine : row;
          }),
          ...late
        ],
        ids
      );
    };
    set((state) => ({
      viewerId,
      groups,
      ready: true,
      available: true,
      error: "",
      sessions: newest(sessions, state.sessions).sort(bySessionDate),
      overrides: newest(overrides, state.overrides)
    }));
  },
  beginPull: () => {
    touched = new Set();
  },
  setGroups: (groups) => {
    const ids = new Set(groups.map((group) => group.id));
    set((state) => ({
      groups,
      sessions: state.sessions.filter((item) => ids.has(item.groupId)),
      overrides: state.overrides.filter((item) => ids.has(item.groupId))
    }));
  },
  applySession: (row) => {
    if (!get().groups.some((group) => group.id === row.groupId)) return;
    touched.add(row.id);
    set((state) => ({ sessions: mergeSessionRow(state.sessions, row) }));
  },
  applyOverride: (row) => {
    if (!get().groups.some((group) => group.id === row.groupId)) return;
    touched.add(row.id);
    set((state) => ({ overrides: mergeOverrideRow(state.overrides, row) }));
  },
  dropSession: (id) => set((state) => ({ sessions: state.sessions.filter((item) => item.id !== id) })),
  dropOverride: (id) => set((state) => ({ overrides: state.overrides.filter((item) => item.id !== id) })),
  setUnavailable: () => set({ available: false, ready: true, sessions: [], overrides: [] }),
  setError: (text) => set({ error: text }),
  reset: () => {
    touched = new Set();
    set({ ...EMPTY });
  }
}));
