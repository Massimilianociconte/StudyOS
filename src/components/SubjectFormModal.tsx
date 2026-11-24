// «Nuova materia»: un solo modulo per Materie e per l'aggiunta rapida. Creazione veloce (nome e Invio),
// gli altri campi in «Altri dettagli». Mentre si scrive il nome dice se la materia c'è già (stessa regola
// dello store e degli strumenti degli agenti): un doppione certo non si crea, uno probabile si crea solo
// dopo averlo visto («Crea comunque»).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SUBJECT_FORM_TEXT } from "../lib/labels/subjects";
import { TASK_EDITOR_TEXT } from "../lib/labels/tasks";
import { nextSubjectColor } from "../lib/subjectCards";
import { SUBJECT_SWATCHES, newSubjectDraft, subjectDraftProblem, subjectFieldsFromDraft, type SubjectDraft } from "../lib/subjectFields";
import { SubjectDuplicateError, subjectMatches } from "../lib/subjectIdentity";
import { draftChanged, editorCloseRequest } from "../lib/tasksUi";
import { useStudyStore } from "../store/useStudyStore";
import type { Subject } from "../types";
import { Icon } from "./Icon";
import { SubjectFields } from "./SubjectFields";
import { Button, useBackCloses, useDialogLayer } from "./ui";

export function SubjectFormModal({
  initialName = "",
  onClose,
  onCreated,
  onOpenExisting
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (subject: { id: string; name: string }) => void;
  /** «Apri «X»» accanto all'avviso: porta alla materia che c'è già. */
  onOpenExisting?: (id: string) => void;
}) {
  const subjects = useStudyStore((state) => state.subjects);
  const addSubject = useStudyStore((state) => state.addSubject);
  const [initial] = useState<SubjectDraft>(() => ({ ...newSubjectDraft(nextSubjectColor(subjects, [...SUBJECT_SWATCHES])), name: initialName }));
  const [draft, setDraft] = useState<SubjectDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const changed = draftChanged(initial, draft);

  // Avviso sotto il nome: prima il doppione certo, poi i probabili (le semplici somiglianze non disturbano).
  const matches = useMemo(() => {
    const name = draft.name.trim();
    if (name.length < 3) return [];
    return subjectMatches({ name, teacher: draft.teacher }, subjects, { minLevel: "likely" });
  }, [draft.name, draft.teacher, subjects]);
  const same = matches.find((match) => match.level === "same")?.subject;
  const likely = same ? [] : matches.map((match) => match.subject);

  const keepEditing = () => {
    setAsking(false);
    requestAnimationFrame(() => footerRef.current?.querySelector<HTMLElement>("[data-save]")?.focus());
  };
  const requestClose = () => {
    if (busy) return;
    const next = editorCloseRequest(changed, asking);
    if (next === "close") onClose();
    else if (next === "ask") setAsking(true);
    else keepEditing();
  };
  useDialogLayer(true, { panelRef, areaRef, onEscape: requestClose });
  useBackCloses(true, () => {
    requestClose();
    return true;
  });
  useEffect(() => {
    if (!asking) return;
    const frame = requestAnimationFrame(() => footerRef.current?.querySelector<HTMLElement>("[data-keep]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [asking]);

  const save = async () => {
    if (busy) return;
    setError("");
    const problem = subjectDraftProblem(draft);
    if (problem) return setError(problem);
    if (same) return setError(SUBJECT_FORM_TEXT.exists(same.name));
    setBusy(true);
    try {
      const fields: Partial<Subject> = subjectFieldsFromDraft(draft);
      const id = await addSubject({ ...fields, name: draft.name.trim() });
      onCreated({ id, name: draft.name.trim() });
      onClose();
    } catch (problem) {
      setError(problem instanceof SubjectDuplicateError ? problem.message : SUBJECT_FORM_TEXT.saveError);
    } finally {
      setBusy(false);
    }
  };

  const openExisting = (subject: Subject) =>
    onOpenExisting ? (
      <button type="button" className="font-extrabold text-[var(--accent-ink)] underline underline-offset-2" onClick={() => { onClose(); onOpenExisting(subject.id); }}>
        {SUBJECT_FORM_TEXT.open(subject.name)}
      </button>
    ) : null;

  const nameHint = same ? (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-[var(--danger-text)]" role="status">
      <Icon name="AlertTriangle" className="h-4 w-4 shrink-0" />
      <span className="safe-text">{SUBJECT_FORM_TEXT.exists(same.name)}</span>
      {openExisting(same)}
    </p>
  ) : likely.length ? (
    <div className="grid gap-1 text-sm font-bold" role="status">
      <p className="flex items-start gap-2">
        <Icon name="Copy" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <span className="safe-text">
          {SUBJECT_FORM_TEXT.similar(likely.map((subject) => subject.name))} <span className="text-[var(--muted)]">{SUBJECT_FORM_TEXT.similarHint}</span>
        </span>
      </p>
      {onOpenExisting ? <div className="flex flex-wrap gap-x-3 pl-6">{likely.slice(0, 3).map((subject) => <span key={subject.id}>{openExisting(subject)}</span>)}</div> : null}
    </div>
  ) : null;

  return createPortal(
    <div
      ref={areaRef}
      className="fixed inset-0 z-50 grid grid-cols-1 place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label={SUBJECT_FORM_TEXT.eyebrow}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        requestClose();
      }}
    >
      <section ref={panelRef} tabIndex={-1} className="soft-panel scrollbar-soft max-h-[88dvh] w-full max-w-2xl overflow-y-auto p-4 outline-none sm:p-5">
        <div className="mb-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">{SUBJECT_FORM_TEXT.eyebrow}</p>
          <h3 className="min-w-0 text-balance text-2xl font-black leading-tight [overflow-wrap:break-word]">{SUBJECT_FORM_TEXT.title}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{SUBJECT_FORM_TEXT.intro}</p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <SubjectFields
            idPrefix="subject-new"
            draft={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            officialSemesterLabel={SUBJECT_FORM_TEXT.officialNew}
            nameHint={nameHint}
            collapsed
            showStatus
            onSubmitName={() => void save()}
            autoFocus
          />
          {error ? (
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          {asking ? (
            <div key="ask" ref={footerRef} role="group" aria-label={TASK_EDITOR_TEXT.discardTitle} className="mt-2 grid grid-cols-1 gap-2">
              <div>
                <p className="text-sm font-black">{TASK_EDITOR_TEXT.discardTitle}</p>
                <p className="text-xs font-bold text-[var(--muted)]">{TASK_EDITOR_TEXT.discardNewText}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button data-keep variant="soft" onClick={keepEditing}>
                  {TASK_EDITOR_TEXT.keepEditing}
                </Button>
                <Button variant="danger" icon="X" onClick={onClose}>
                  {TASK_EDITOR_TEXT.discard}
                </Button>
              </div>
            </div>
          ) : (
            <div key="edit" ref={footerRef} className="mt-2 flex flex-wrap justify-end gap-2">
              <Button variant="soft" onClick={requestClose} disabled={busy}>
                {SUBJECT_FORM_TEXT.cancel}
              </Button>
              <Button data-save variant="primary" icon="Check" onClick={() => void save()} disabled={busy || Boolean(same)}>
                {busy ? SUBJECT_FORM_TEXT.creating : likely.length ? SUBJECT_FORM_TEXT.createAnyway : SUBJECT_FORM_TEXT.create}
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
