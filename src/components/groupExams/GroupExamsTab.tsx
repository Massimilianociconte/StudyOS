// Scheda «Appelli» nel dettaglio del gruppo: appelli futuri, «Aggiungi un appello» ed «Eliminati di
// recente» con «Ripristina» (la voce di eliminazione si cerca nella cronologia di quell'appello).
import { lazy, Suspense, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../ui";
import { InlineConfirm } from "../InlineConfirm";
import { GroupExamList } from "./GroupExamList";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { formatDay, sessionTitle, type GroupExamSession } from "../../lib/groupExams";
import { localDay } from "../../lib/groupExamCalendar";
import { lastDeletions } from "../../lib/groupExamUi";
import { useGroupExamStore } from "../../store/useGroupExamStore";

const GroupExamDrawer = lazy(() => import("./GroupExamDrawer"));

function RecentlyDeleted({ sessions, onMessage }: { sessions: readonly GroupExamSession[]; onMessage: (text: string) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const restore = async (session: GroupExamSession) => {
    setBusy(true);
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      const page = await groupExamWriter.listHistory({ groupId: session.groupId, recordKind: "exam_session", recordId: session.id, limit: 10 });
      const entry = lastDeletions(page ?? []).get(session.id);
      if (!entry) {
        onMessage(T.actionFailed);
        return;
      }
      const result = await groupExamWriter.restore(entry.id, session.version);
      onMessage(result.status === "ok" ? T.restored : (result.message ?? T.actionFailed));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : T.actionFailed);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <section className="grid grid-cols-1 gap-2">
      <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.recentlyDeleted}</h4>
      <ul className="grid grid-cols-1 gap-2">
        {sessions.map((session) => (
          <li key={session.id} className="quiet-panel grid grid-cols-1 gap-2 p-3">
            <p className="safe-text text-sm font-bold">
              {[sessionTitle(session), formatDay(session.date), session.deletedByName ? `${T.deletedInGroup} · ${session.deletedByName}` : T.deletedInGroup].join(" · ")}
            </p>
            {confirming === session.id ? (
              <InlineConfirm text={T.restoreConfirm} confirmLabel={T.restore} icon="RotateCcw" busy={busy} onConfirm={() => void restore(session)} onCancel={() => setConfirming(null)} />
            ) : (
              <Button variant="soft" icon="RotateCcw" className="justify-self-start" onClick={() => setConfirming(session.id)}>
                {T.restore}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GroupExamsTab({ groupId }: { groupId: string }) {
  const { ready, available, online, sessions } = useGroupExamStore(
    useShallow((state) => ({ ready: state.ready, available: state.available, online: state.groups.some((group) => group.id === groupId), sessions: state.sessions }))
  );
  const [target, setTarget] = useState<{ key: number; sessionId: string | null } | null>(null);
  const [message, setMessage] = useState("");
  const today = localDay(new Date().toISOString()) ?? "";
  const upcoming = useMemo(() => sessions.filter((item) => item.groupId === groupId && !item.deletedAt && item.date >= today), [sessions, groupId, today]);
  const deleted = useMemo(
    () => sessions.filter((item) => item.groupId === groupId && item.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
    [sessions, groupId]
  );

  if (!available) return <p className="text-sm font-bold text-[var(--muted)]">{T.notActive}</p>;
  if (!online) return <p className="text-sm font-bold text-[var(--muted)]">{T.notShared}</p>;
  if (!ready) return <p className="text-sm font-bold text-[var(--muted)]">{T.loading}</p>;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div role="status" aria-live="polite">
        {message ? <p className="soft-panel p-2.5 text-sm font-bold">{message}</p> : null}
      </div>
      <Button variant="primary" icon="Plus" className="justify-self-start" onClick={() => setTarget({ key: Date.now(), sessionId: null })}>
        {T.add}
      </Button>
      <GroupExamList sessions={upcoming} emptyText={T.empty} showGroup={false} onOpen={(id) => setTarget({ key: Date.now(), sessionId: id })} />
      {deleted.length ? <RecentlyDeleted sessions={deleted} onMessage={setMessage} /> : null}
      {target ? (
        <Suspense fallback={null}>
          <GroupExamDrawer key={target.key} sessionId={target.sessionId} create={target.sessionId ? null : { groupId }} onClose={() => setTarget(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}
