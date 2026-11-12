// Riquadro di un appello del gruppo: dettagli, modifica, eliminazione, «Il mio piano», collegamento ai
// miei eventi ed esami già presenti, cronologia. Caricato con lazy() da calendario, materie e gruppi.
import { useState } from "react";
import { Button, Drawer } from "../ui";
import { Icon } from "../Icon";
import { InlineConfirm } from "../InlineConfirm";
import { formatNotificationTime } from "../NotificationsPanel";
import { GroupExamForm } from "./GroupExamForm";
import { HistoryList } from "./HistoryList";
import { MyPlanSection } from "./MyPlanSection";
import { GROUP_EXAM_KIND_LABEL } from "../../lib/labels";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { describeHistoryEntry, formatDay, sessionTitle, type GroupExamSession } from "../../lib/groupExams";
import { personalMatches } from "../../lib/groupExamCalendar";
import { canDeleteSession, registrationText } from "../../lib/groupExamUi";
import type { SessionDraft } from "../../lib/groupExamForm";
import { ENTITY_TYPES } from "../../lib/collections";
import type { RestoreVersion } from "../../lib/sharing";
import { useGroupExamStore } from "../../store/useGroupExamStore";
import { useStudyStore } from "../../store/useStudyStore";
import type { CalendarEvent } from "../../types";

export interface GroupExamDrawerProps {
  sessionId: string | null;
  create?: { groupId?: string; draft?: Partial<SessionDraft>; fromEventId?: string } | null;
  onClose: () => void;
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-1 gap-0.5">
      <dt className="text-xs font-black uppercase text-[var(--faint)]">{label}</dt>
      <dd className="safe-text text-sm font-bold">{value}</dd>
    </div>
  );
}

export default function GroupExamDrawer({ sessionId, create, onClose }: GroupExamDrawerProps) {
  const [currentId, setCurrentId] = useState<string | null>(sessionId);
  const [mode, setMode] = useState<"view" | "edit" | "create">(sessionId ? "view" : "create");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offerRemove, setOfferRemove] = useState<string | null>(null);
  const [undo, setUndo] = useState<CalendarEvent | null>(null);

  const ready = useGroupExamStore((state) => state.ready);
  const available = useGroupExamStore((state) => state.available);
  const viewerId = useGroupExamStore((state) => state.viewerId);
  const session = useGroupExamStore((state) => (currentId ? state.sessions.find((item) => item.id === currentId) : undefined));
  const groupName = useGroupExamStore((state) => state.groups.find((group) => group.id === session?.groupId)?.name ?? "");
  const plan = useStudyStore((state) => (currentId ? state.examPlans.find((item) => item.sessionId === currentId) : undefined));
  const group = useStudyStore((state) => state.studyGroups.find((item) => item.id === session?.groupId));
  const events = useStudyStore((state) => state.events);
  const exams = useStudyStore((state) => state.exams);
  const subjects = useStudyStore((state) => state.subjects);
  const planExam = useStudyStore((state) => state.planExam);
  const deleteEvent = useStudyStore((state) => state.deleteEvent);
  const restoreEntities = useStudyStore((state) => state.restoreEntities);

  const shownGroup = groupName || plan?.snapshot.groupName || "";
  const title =
    mode === "create"
      ? T.newTitle
      : session
        ? sessionTitle(session)
        : plan
          ? sessionTitle({ kind: plan.snapshot.kind, courseName: plan.snapshot.courseName, label: "" })
          : T.sectionTitle;

  const linkFromEvent = async (saved: GroupExamSession, eventId: string) => {
    await planExam(saved.id, { selected: true, linkedEventId: eventId }, saved, groupName);
    setOfferRemove(eventId);
  };

  const removeDelete = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      const result = await groupExamWriter.deleteSession(session.id, session.version);
      setMessage(result.status === "ok" ? T.deleted : (result.message ?? T.actionFailed));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : T.actionFailed);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const removeMine = async (eventId: string) => {
    const event = useStudyStore.getState().events.find((item) => item.id === eventId);
    setOfferRemove(null);
    if (!event) return;
    await deleteEvent(eventId);
    setUndo(event);
    setMessage(T.removedMine);
  };

  const undoRemove = async () => {
    if (!undo || !currentId) return;
    const event = undo;
    setUndo(null);
    setMessage("");
    await restoreEntities([{ entityType: ENTITY_TYPES.events, entityId: event.id, payload: { ...event } as RestoreVersion["payload"], complete: true }]);
    await planExam(currentId, { linkedEventId: event.id }, session, groupName);
  };

  const body = () => {
    if (!available) return <p className="text-sm font-bold text-[var(--muted)]">{T.notActive}</p>;
    if (mode === "create") {
      return (
        <GroupExamForm
          groupId={create?.groupId}
          initial={create?.draft}
          onCancel={onClose}
          onOpenSession={(id) => {
            setCurrentId(id);
            setMode("view");
          }}
          onSaved={(saved, text) => {
            setCurrentId(saved.id);
            setMode("view");
            setMessage(text);
            if (create?.fromEventId) void linkFromEvent(saved, create.fromEventId);
          }}
        />
      );
    }
    if (mode === "edit" && session) {
      return (
        <GroupExamForm
          session={session}
          onCancel={() => setMode("view")}
          onOpenSession={(id) => {
            setCurrentId(id);
            setMode("view");
          }}
          onSaved={(_saved, text) => {
            setMode("view");
            setMessage(text);
          }}
        />
      );
    }
    if (!session && !ready) return <p className="text-sm font-bold text-[var(--muted)]">{T.loading}</p>;
    if (!session && !plan) return <p className="text-sm font-bold text-[var(--muted)]">{T.notFound}</p>;

    const date = session?.date ?? plan!.snapshot.date;
    const time = session ? session.time : plan!.snapshot.time;
    const room = session ? session.room : plan!.snapshot.room;
    const matches = session && !session.deletedAt ? personalMatches(session, { events, exams, subjects }, plan) : [];
    const match = matches[0];
    const canDelete = session ? canDeleteSession(session, viewerId, group) : false;

    return (
      <div className="grid grid-cols-1 gap-5">
        {!session ? <p className="soft-panel p-2.5 text-sm font-bold">{T.stale}</p> : null}
        {session?.deletedAt ? (
          <p className="soft-panel flex items-center gap-2 p-2.5 text-sm font-bold">
            <Icon name="AlertTriangle" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            {T.deletedInGroup}
            {session.deletedByName ? ` · ${session.deletedByName}` : ""}
          </p>
        ) : null}
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Detail label={T.form.date} value={`${formatDay(date)}${time ? ` · ${time}` : ` · ${T.allDay}`}`} />
          <Detail label={T.form.kind} value={GROUP_EXAM_KIND_LABEL[session?.kind ?? plan!.snapshot.kind]} />
          <Detail label={T.form.room} value={room} />
          <Detail label={T.registration} value={session ? registrationText(session.registrationOpens, session.registrationCloses) : ""} />
          <Detail label={T.form.label} value={session?.label ?? ""} />
          <Detail label={T.form.notes} value={session?.notes ?? ""} />
        </dl>
        {session ? (
          <p className="text-sm font-bold text-[var(--muted)]">
            {T.addedBy(session.createdByName)}
            {session.version > 1 ? ` · ${T.updatedBy(session.updatedByName, formatNotificationTime(session.updatedAt))}` : ""}
          </p>
        ) : null}

        {session && !session.deletedAt ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="soft" icon="PenLine" onClick={() => setMode("edit")}>
              {T.edit}
            </Button>
            {canDelete ? (
              confirmDelete ? null : (
                <Button variant="danger" icon="Trash2" onClick={() => setConfirmDelete(true)}>
                  {T.deleteAction}
                </Button>
              )
            ) : (
              <p className="safe-text text-sm font-bold text-[var(--muted)]">{T.deleteWho(session.createdByName)}</p>
            )}
          </div>
        ) : null}
        {confirmDelete ? (
          <InlineConfirm text={T.deleteConfirm} confirmLabel={T.deleteAction} icon="Trash2" busy={busy} onConfirm={() => void removeDelete()} onCancel={() => setConfirmDelete(false)} />
        ) : null}

        {match && session ? (
          <div className="soft-panel grid grid-cols-1 gap-2 p-2.5">
            <p className="safe-text text-sm font-bold">{T.match(match.title, formatDay(session.date))}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="primary"
                icon="Link"
                onClick={() => {
                  void planExam(session.id, { selected: true, ...(match.type === "event" ? { linkedEventId: match.id } : { examId: match.id }) }, session, groupName);
                  if (match.type === "event") setOfferRemove(match.id);
                }}
              >
                {T.link}
              </Button>
              <Button variant="soft" onClick={() => void planExam(session.id, { dismissMatch: match.key }, session, groupName)}>
                {T.keepSeparate}
              </Button>
            </div>
          </div>
        ) : null}
        {offerRemove ? (
          <div className="soft-panel grid grid-cols-1 gap-2 p-2.5">
            <p className="text-sm font-bold">{T.removeMineAsk}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="soft" icon="Trash2" onClick={() => void removeMine(offerRemove)}>
                {T.removeMine}
              </Button>
              <Button variant="ghost" onClick={() => setOfferRemove(null)}>
                {T.keepIt}
              </Button>
            </div>
          </div>
        ) : null}

        <MyPlanSection key={currentId ?? ""} sessionId={currentId ?? ""} session={session} groupName={shownGroup} onMessage={setMessage} />

        {session ? (
          <section className="grid grid-cols-1 gap-2">
            <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.historyTitle}</h4>
            <HistoryList
              groupId={session.groupId}
              recordKind="exam_session"
              recordId={session.id}
              version={session.version}
              describe={describeHistoryEntry}
              confirmText={T.restoreConfirm}
              onMessage={setMessage}
            />
          </section>
        ) : null}
      </div>
    );
  };

  return (
    <Drawer open onClose={onClose} title={title} eyebrow={shownGroup ? `${T.groupLabel} · ${shownGroup}` : undefined}>
      <div role="status" aria-live="polite">
        {message ? (
          <div className="soft-panel mb-4 flex flex-wrap items-center gap-2 p-2.5 text-sm font-bold">
            <span className="safe-text min-w-0 flex-1">{message}</span>
            {undo ? (
              <Button variant="soft" icon="RotateCcw" onClick={() => void undoRemove()}>
                {T.undo}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {body()}
    </Drawer>
  );
}
