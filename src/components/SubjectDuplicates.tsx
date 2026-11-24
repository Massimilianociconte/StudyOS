// «Possibili doppioni» in Materie: coppie di materie che sembrano la stessa (stesso nome, stesso
// insegnamento, oppure stesso docente e nome simile). La persona le unisce (tutto passa a una sola, niente
// si perde) o dice che sono diverse (la coppia non torna). La somiglianza da sola non unisce mai niente.
import { useMemo, useState } from "react";
import { pickCollections } from "../lib/collections";
import { SUBJECT_DUPLICATE_TEXT, movedList } from "../lib/labels/subjects";
import { dismissedSubjectPairs, duplicateSubjectPairs, type SubjectPair } from "../lib/subjectIdentity";
import { planSubjectMerge, type MovedCounts } from "../lib/subjectMerge";
import { useSharedStore } from "../store/useSharedStore";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import type { Subject } from "../types";
import { Icon } from "./Icon";
import { SubjectMark } from "./SubjectMark";
import { Button } from "./ui";

const VISIBLE = 3;

/** Quella che resta: la materia collegata al corso di laurea, altrimenti la più vecchia. */
const keeperOf = (pair: SubjectPair<Subject>): [Subject, Subject] => {
  const { a, b } = pair;
  if (a.universityCourseId && !b.universityCourseId) return [a, b];
  if (b.universityCourseId && !a.universityCourseId) return [b, a];
  return a.createdAt <= b.createdAt ? [a, b] : [b, a];
};

export function SubjectDuplicates({ onMerged }: { onMerged: (keepId: string, dropId: string) => void }) {
  const subjects = useStudyStore((state) => state.subjects);
  const dismissedRaw = useStudyStore((state) => selectPreferences(state).distinctSubjectPairs);
  const updatePreferences = useStudyStore((state) => state.updatePreferences);
  const mergeSubjects = useStudyStore((state) => state.mergeSubjects);
  const dismissed = useMemo(() => dismissedSubjectPairs(dismissedRaw), [dismissedRaw]);
  const pairs = useMemo(() => duplicateSubjectPairs(subjects, dismissed), [subjects, dismissed]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const markDistinct = (key: string) => {
    if (openKey === key) setOpenKey(null);
    void updatePreferences({ distinctSubjectPairs: [...dismissed, key] });
  };

  return (
    <div role="status" aria-live="polite">
      {notice ? (
        <div className="soft-panel mb-4 flex items-center gap-2 p-2.5">
          <Icon name="Check" className="h-4 w-4 shrink-0 text-[var(--success-text)]" />
          <p className="safe-text min-w-0 flex-1 text-sm font-bold">{notice}</p>
          <Button variant="ghost" onClick={() => setNotice("")}>
            Ok
          </Button>
        </div>
      ) : null}
      {pairs.length ? (
        <section aria-labelledby="subject-duplicates-title" className="soft-panel mb-4 p-3">
          <div className="flex items-start gap-2">
            <Icon name="Copy" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <div className="min-w-0 flex-1">
              <h3 id="subject-duplicates-title" className="text-sm font-black">
                {SUBJECT_DUPLICATE_TEXT.title(pairs.length)}
              </h3>
              <p className="text-sm font-bold text-[var(--muted)]">{SUBJECT_DUPLICATE_TEXT.intro}</p>
            </div>
          </div>
          <ul className="mt-2 grid gap-2">
            {pairs.slice(0, VISIBLE).map((pair) => (
              <DuplicateRow
                key={pair.key}
                pair={pair}
                open={openKey === pair.key}
                onOpen={() => setOpenKey(pair.key)}
                onCancel={() => setOpenKey(null)}
                onDistinct={() => markDistinct(pair.key)}
                onMerge={async (keep, drop, name) => {
                  const result = await mergeSubjects(keep.id, drop.id, { name });
                  setOpenKey(null);
                  setNotice(SUBJECT_DUPLICATE_TEXT.merged(name, movedList(result.moved)));
                  onMerged(keep.id, drop.id);
                }}
              />
            ))}
          </ul>
          {pairs.length > VISIBLE ? <p className="mt-2 text-xs font-bold text-[var(--muted)]">{SUBJECT_DUPLICATE_TEXT.more(pairs.length - VISIBLE)}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function DuplicateRow({
  pair,
  open,
  onOpen,
  onCancel,
  onDistinct,
  onMerge
}: {
  pair: SubjectPair<Subject>;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onDistinct: () => void;
  onMerge: (keep: Subject, drop: Subject, name: string) => Promise<void>;
}) {
  const [keep, drop] = keeperOf(pair);
  const label = SUBJECT_DUPLICATE_TEXT.pair(keep.name, drop.name);
  return (
    <li className="rounded-[16px] bg-[var(--surface)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
          <SubjectMark subjectId={keep.id} size="sm" />
          <SubjectMark subjectId={drop.id} size="sm" />
        </span>
        <p className="safe-text min-w-0 flex-1 text-sm font-bold">
          {label}
          <span className="text-[var(--muted)]"> · {SUBJECT_DUPLICATE_TEXT.reason[pair.reason] ?? ""}</span>
        </p>
        {open ? null : (
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" icon="Merge" onClick={onOpen} aria-label={SUBJECT_DUPLICATE_TEXT.mergeAria(keep.name, drop.name)}>
              {SUBJECT_DUPLICATE_TEXT.merge}
            </Button>
            <Button variant="ghost" onClick={onDistinct} aria-label={SUBJECT_DUPLICATE_TEXT.distinctAria(keep.name, drop.name)}>
              {SUBJECT_DUPLICATE_TEXT.distinct}
            </Button>
          </div>
        )}
      </div>
      {open ? <MergeConfirm keep={keep} drop={drop} onCancel={onCancel} onMerge={onMerge} /> : null}
    </li>
  );
}

function MergeConfirm({ keep, drop, onCancel, onMerge }: { keep: Subject; drop: Subject; onCancel: () => void; onMerge: (keep: Subject, drop: Subject, name: string) => Promise<void> }) {
  const given = useSharedStore((state) => state.given);
  const [name, setName] = useState(keep.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Prova a secco: cosa passa all'altra materia, o perché non si può unire.
  const preview = useMemo((): { moved: MovedCounts } | { blocked: string } => {
    try {
      const sharedSubjectIds = new Set(given.flatMap((grant) => grant.subjectIds));
      return planSubjectMerge(pickCollections(useStudyStore.getState()), keep.id, drop.id, { now: new Date().toISOString(), sharedSubjectIds });
    } catch (problem) {
      return { blocked: problem instanceof Error ? problem.message : String(problem) };
    }
  }, [keep.id, drop.id, given]);
  const names = keep.name === drop.name ? [keep.name] : [keep.name, drop.name];
  const groupName = `merge-name-${keep.id}`;

  if ("blocked" in preview) {
    return (
      <div className="mt-2 rounded-[14px] bg-[var(--surface-soft)] p-2.5">
        <p className="safe-text text-sm font-bold">{preview.blocked}</p>
        <div className="mt-2 flex justify-end">
          <Button variant="soft" onClick={onCancel} autoFocus>
            {SUBJECT_DUPLICATE_TEXT.cancel}
          </Button>
        </div>
      </div>
    );
  }
  const list = movedList(preview.moved);
  return (
    <div role="group" aria-label={SUBJECT_DUPLICATE_TEXT.confirm} className="mt-2 grid gap-2 rounded-[14px] bg-[var(--surface-soft)] p-2.5">
      {names.length > 1 ? (
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{SUBJECT_DUPLICATE_TEXT.nameLegend}</legend>
          {names.map((option) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[12px] px-2 text-sm font-bold hover:bg-[var(--surface)]">
              <input type="radio" name={groupName} value={option} checked={name === option} onChange={() => setName(option)} className="h-4 w-4 accent-[var(--accent)]" />
              <span className="safe-text">{option}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {keep.universityCourseId ? <p className="safe-text text-sm font-bold text-[var(--muted)]">{SUBJECT_DUPLICATE_TEXT.catalogNote(keep.name)}</p> : null}
      <p className="safe-text text-sm font-bold">{SUBJECT_DUPLICATE_TEXT.moves(name, list)}</p>
      <p className="text-xs font-bold text-[var(--muted)]">{SUBJECT_DUPLICATE_TEXT.fields}</p>
      {error ? (
        <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="soft" onClick={onCancel} disabled={busy} autoFocus>
          {SUBJECT_DUPLICATE_TEXT.cancel}
        </Button>
        <Button
          variant="primary"
          icon="Merge"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onMerge(keep, drop, name);
            } catch (problem) {
              setError(problem instanceof Error ? problem.message : String(problem));
              setBusy(false);
            }
          }}
        >
          {SUBJECT_DUPLICATE_TEXT.confirm}
        </Button>
      </div>
    </div>
  );
}
