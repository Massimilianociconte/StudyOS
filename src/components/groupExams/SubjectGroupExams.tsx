// «Appelli del gruppo» nella pagina della materia, sotto gli appelli ufficiali: appelli futuri dei miei
// gruppi per questo corso (id del catalogo o nome), «Aggiungi un appello» già compilato.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../ui";
import { GroupExamList } from "./GroupExamList";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { sessionMatchesSubject } from "../../lib/groupExams";
import { localDay } from "../../lib/groupExamCalendar";
import { courseFromSubject, emptyDraft, type SessionDraft } from "../../lib/groupExamForm";
import { useGroupExamStore } from "../../store/useGroupExamStore";
import type { Subject } from "../../types";

const GroupExamDrawer = lazy(() => import("./GroupExamDrawer"));

export function SubjectGroupExams({ subject, draft, onDraftUsed }: { subject: Subject; draft?: SessionDraft | null; onDraftUsed?: () => void }) {
  const { ready, available, hasGroups, sessions } = useGroupExamStore(
    useShallow((state) => ({ ready: state.ready, available: state.available, hasGroups: state.groups.length > 0, sessions: state.sessions }))
  );
  const [target, setTarget] = useState<{ key: number; sessionId: string | null; draft?: SessionDraft } | null>(null);
  const today = localDay(new Date().toISOString()) ?? "";
  const list = useMemo(() => sessions.filter((item) => !item.deletedAt && item.date >= today && sessionMatchesSubject(item, subject)), [sessions, today, subject]);

  // «Aggiungi al gruppo» da un appello ufficiale: la bozza arriva da BarbExamSessions.
  useEffect(() => {
    if (!draft) return;
    setTarget({ key: Date.now(), sessionId: null, draft });
    onDraftUsed?.();
  }, [draft, onDraftUsed]);

  if (!available || !hasGroups) return null;
  return (
    <section className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.sectionTitle}</h4>
        <Button variant="soft" icon="Plus" onClick={() => setTarget({ key: Date.now(), sessionId: null, draft: { ...emptyDraft(), ...courseFromSubject(subject) } })}>
          {T.add}
        </Button>
      </div>
      {ready ? (
        <GroupExamList sessions={list} emptyText={T.emptySubject} onOpen={(id) => setTarget({ key: Date.now(), sessionId: id })} />
      ) : (
        <p className="text-sm font-bold text-[var(--muted)]">{T.loading}</p>
      )}
      {target ? (
        <Suspense fallback={null}>
          <GroupExamDrawer key={target.key} sessionId={target.sessionId} create={target.sessionId ? null : { draft: target.draft }} onClose={() => setTarget(null)} />
        </Suspense>
      ) : null}
    </section>
  );
}
