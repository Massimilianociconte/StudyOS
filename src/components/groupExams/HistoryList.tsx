// Cronologia di un appello o di una correzione del gruppo: si carica quando si apre, 20 voci alla volta,
// e ogni modifica si può annullare («Ripristina» → la riga torna com'era prima di quella modifica).
import { useEffect, useState } from "react";
import { Button } from "../ui";
import { InlineConfirm } from "../InlineConfirm";
import { formatNotificationTime } from "../NotificationsPanel";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import type { GroupHistoryEntry, GroupRecordKind } from "../../lib/groupExams";

const PAGE = 20;

export function HistoryList({
  groupId,
  recordKind,
  recordId,
  version,
  describe,
  confirmText,
  onMessage
}: {
  groupId: string;
  recordKind: GroupRecordKind;
  recordId?: string;
  /** Versione attuale della riga: il ripristino la manda al server. */
  version: number;
  describe: (entry: GroupHistoryEntry) => string[];
  confirmText: string;
  onMessage: (text: string) => void;
}) {
  const [entries, setEntries] = useState<GroupHistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (beforeId?: number) => {
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      const page = await groupExamWriter.listHistory({ groupId, recordKind, recordId, limit: PAGE, beforeId });
      if (!page) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setEntries((current) => [...(beforeId ? (current ?? []) : []), ...page]);
      setMore(page.length === PAGE);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
    // Si ricarica quando cambia la riga (nuova versione = nuova voce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, recordKind, recordId, version]);

  const restore = async (entry: GroupHistoryEntry) => {
    setBusy(true);
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      const result = await groupExamWriter.restore(entry.id, version);
      onMessage(result.status === "ok" ? T.restored : (result.message ?? T.actionFailed));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : T.actionFailed);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  if (failed && !entries) return <p className="text-sm font-bold text-[var(--muted)]">{T.syncError}</p>;
  if (!entries) return <p className="text-sm font-bold text-[var(--muted)]">{T.loading}</p>;
  if (!entries.length) return <p className="text-sm font-bold text-[var(--muted)]">{T.historyEmpty}</p>;

  return (
    <div className="grid grid-cols-1 gap-2">
      <ul className="grid grid-cols-1 gap-2">
        {entries.map((entry) => (
          <li key={entry.id} className="soft-panel grid grid-cols-1 gap-2 p-2.5">
            <p className="safe-text text-sm font-bold">
              {[entry.actorName, formatNotificationTime(entry.changedAt), ...describe(entry)].filter(Boolean).join(" · ")}
            </p>
            {entry.action === "create" ? null : confirming === entry.id ? (
              <InlineConfirm text={confirmText} confirmLabel={T.restore} icon="RotateCcw" busy={busy} onConfirm={() => void restore(entry)} onCancel={() => setConfirming(null)} />
            ) : (
              <Button variant="soft" icon="RotateCcw" className="justify-self-start" onClick={() => setConfirming(entry.id)}>
                {T.restore}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {more ? (
        <Button variant="ghost" className="justify-self-start" onClick={() => void load(entries[entries.length - 1]?.id)}>
          {T.historyMore}
        </Button>
      ) : null}
    </div>
  );
}
