// Modulo per aggiungere o modificare un appello del gruppo. Doppioni, unione delle modifiche e conflitti
// vengono da lib/groupExamForm; la scrittura passa da lib/groupExamSync, caricato solo al salvataggio.
import { useMemo, useState } from "react";
import { Button, Field, inputClass } from "../ui";
import { FieldMessage, fieldAttrs, fieldDomId, useFieldIssue } from "./FieldError";
import { DateField } from "../DatePicker";
import { GROUP_EXAM_FIELD_LABEL, GROUP_EXAM_KIND_LABEL } from "../../lib/labels";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { GROUP_EXAM_KINDS, formatDay, newGroupRecordId, sessionTitle, type GroupExamSession, type GroupExamWriter, type SessionEditField } from "../../lib/groupExams";
import {
  courseFromSubject,
  draftFromSession,
  emptyDraft,
  fieldText,
  fieldsFromDraft,
  SESSION_INPUT_FIELDS,
  resolveConflict,
  saveSession,
  sessionInputField,
  type SaveOutcome,
  type SessionDraft
} from "../../lib/groupExamForm";
import { useGroupExamStore } from "../../store/useGroupExamStore";
import { useStudyStore } from "../../store/useStudyStore";
import type { GroupExamKind } from "../../types";

const TYPED = "__typed";

export function GroupExamForm({
  groupId: fixedGroupId,
  session,
  initial,
  onSaved,
  onCancel,
  onOpenSession
}: {
  /** Gruppo già deciso (scheda del gruppo, modifica); altrimenti si sceglie. */
  groupId?: string;
  /** Appello da modificare; assente = nuovo. */
  session?: GroupExamSession | null;
  /** Bozza di partenza (da BARB, da un mio evento, dalla pagina della materia). */
  initial?: Partial<SessionDraft>;
  onSaved: (session: GroupExamSession, message: string) => void;
  onCancel: () => void;
  onOpenSession: (id: string) => void;
}) {
  const subjects = useStudyStore((state) => state.subjects);
  const groups = useGroupExamStore((state) => state.groups);
  const mySubjects = useMemo(() => subjects.filter((subject) => !subject.archived && subject.status !== "archived"), [subjects]);
  // La riga con cui si è aperto il modulo: è la base del confronto. Mai quella viva dello store, che un
  // aggiornamento in tempo reale cambia sotto i piedi: la versione di partenza deve restare quella.
  const [base] = useState<GroupExamSession | null>(() => session ?? null);
  const [draft, setDraft] = useState<SessionDraft>(() => ({ ...(session ? draftFromSession(session, subjects) : emptyDraft()), ...initial }));
  const [groupId, setGroupId] = useState(fixedGroupId ?? session?.groupId ?? groups[0]?.id ?? "");
  // Un id per tutto il modulo: ripetere il salvataggio dopo un errore di rete non crea un secondo appello.
  const [newId] = useState(() => newGroupRecordId("gexam"));
  const [busy, setBusy] = useState(false);
  const { scope, issue, general: error, fail, clear } = useFieldIssue(SESSION_INPUT_FIELDS);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [choices, setChoices] = useState<Partial<Record<SessionEditField, "mine" | "theirs">>>({});
  const set = <K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const finish = (result: SaveOutcome) => {
    if (result.kind === "saved") {
      const message = result.mergedFrom
        ? T.merged(result.mergedFrom.name, result.mergedFrom.fields.map((field) => GROUP_EXAM_FIELD_LABEL[field].toLowerCase()).join(", "))
        : session
          ? T.saved
          : T.added;
      onSaved(result.session, message);
      return;
    }
    if (result.kind === "error") fail(result.message, sessionInputField(result.field));
    else setOutcome(result);
  };

  const run = async (save: (writer: GroupExamWriter) => Promise<SaveOutcome>) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      fail(T.offline);
      return;
    }
    setBusy(true);
    clear();
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      finish(await save(groupExamWriter));
    } catch {
      fail(T.offline);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const fields = fieldsFromDraft(draft);
    if (!fields.ok) {
      fail(fields.message, sessionInputField(fields.field));
      return;
    }
    if (!groupId) {
      fail(T.noGroups);
      return;
    }
    void run((writer) =>
      saveSession(writer, { groupId, id: session?.id ?? newId, base, mine: fields.value, sessions: useGroupExamStore.getState().sessions })
    );
  };

  const saveResolved = () => {
    if (outcome?.kind !== "conflict") return;
    const current = outcome.current;
    const resolved = resolveConflict(outcome, choices);
    setOutcome(null);
    setChoices({});
    void run((writer) => saveSession(writer, { groupId: current.groupId, id: current.id, base: current, mine: resolved, sessions: useGroupExamStore.getState().sessions }));
  };

  const chooseCourse = (value: string) => {
    if (value === TYPED) {
      setDraft((current) => ({ ...current, subjectId: "", courseId: "" }));
      return;
    }
    const subject = mySubjects.find((item) => item.id === value);
    if (subject) setDraft((current) => ({ ...current, ...courseFromSubject(subject) }));
  };

  if (outcome?.kind === "duplicate") {
    return (
      <section className="soft-panel grid grid-cols-1 gap-3 p-3" aria-live="polite">
        <p className="safe-text text-sm font-bold">{T.duplicate(sessionTitle(outcome.twin), formatDay(outcome.twin.date), outcome.twin.createdByName)}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="primary" icon="ExternalLink" onClick={() => onOpenSession(outcome.twin.id)}>
            {T.openThat}
          </Button>
          <Button variant="soft" onClick={() => setOutcome(null)}>
            {T.backToForm}
          </Button>
        </div>
      </section>
    );
  }

  if (outcome?.kind === "gone") {
    return (
      <section className="soft-panel grid grid-cols-1 gap-3 p-3" aria-live="polite">
        <p className="safe-text text-sm font-bold">{T.gone(outcome.current?.deletedByName || T.someone)}</p>
        <Button variant="soft" onClick={onCancel}>
          {T.close}
        </Button>
      </section>
    );
  }

  if (outcome?.kind === "conflict") {
    const name = outcome.current.updatedByName || T.someone;
    return (
      <section className="soft-panel grid grid-cols-1 gap-4 p-3" aria-live="polite">
        <p className="safe-text text-sm font-black">{T.conflictTitle(name)}</p>
        {outcome.conflicts.map((field) => {
          const pick = choices[field] ?? "mine";
          return (
            <fieldset key={field} className="grid grid-cols-1 gap-2">
              <legend className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{GROUP_EXAM_FIELD_LABEL[field]}</legend>
              <p className="safe-text text-sm font-bold">{T.conflictMine(fieldText(outcome.mine, field))}</p>
              <p className="safe-text text-sm font-bold">{T.conflictTheirs(name, fieldText(outcome.theirs, field))}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant={pick === "mine" ? "primary" : "soft"} aria-pressed={pick === "mine"} onClick={() => setChoices((current) => ({ ...current, [field]: "mine" }))}>
                  {T.keepMine}
                </Button>
                <Button variant={pick === "theirs" ? "primary" : "soft"} aria-pressed={pick === "theirs"} onClick={() => setChoices((current) => ({ ...current, [field]: "theirs" }))}>
                  {T.keepTheirs(name)}
                </Button>
              </div>
            </fieldset>
          );
        })}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="ghost" onClick={onCancel}>
            {T.cancel}
          </Button>
          <Button variant="primary" icon="Check" disabled={busy} onClick={saveResolved}>
            {T.save}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      </section>
    );
  }

  const courseValue = draft.subjectId && mySubjects.some((subject) => subject.id === draft.subjectId) ? draft.subjectId : TYPED;

  return (
    <form
      className="grid grid-cols-1 gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {!fixedGroupId && !session && groups.length > 1 ? (
        <Field label={T.groupLabel}>
          <select className={inputClass} value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-1">
      <Field label={T.form.course}>
        <select className={inputClass} {...fieldAttrs(scope, issue, courseValue === TYPED ? "course-select" : "course")} value={courseValue} onChange={(event) => chooseCourse(event.target.value)}>
          {mySubjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
          <option value={TYPED}>{T.form.typed}</option>
        </select>
      </Field>
      {courseValue === TYPED ? (
        <Field label={T.form.courseHint}>
          <input className={inputClass} {...fieldAttrs(scope, issue, "course")} value={draft.courseName} maxLength={160} onChange={(event) => set("courseName", event.target.value)} />
        </Field>
      ) : null}
      <FieldMessage scope={scope} issue={issue} field="course" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div id={fieldDomId(scope, "date")} className="grid min-w-0 grid-cols-1 gap-1">
          <DateField label={T.form.date} value={draft.date} onChange={(value) => set("date", value)} />
          <FieldMessage scope={scope} issue={issue} field="date" />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
        <Field label={T.form.kind}>
          <select className={inputClass} {...fieldAttrs(scope, issue, "kind")} value={draft.kind} onChange={(event) => set("kind", event.target.value as GroupExamKind)}>
            {GROUP_EXAM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {GROUP_EXAM_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
          <FieldMessage scope={scope} issue={issue} field="kind" />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Field label={T.form.time}>
            <input type="time" className={inputClass} {...fieldAttrs(scope, issue, "time")} value={draft.time} onChange={(event) => set("time", event.target.value)} />
          </Field>
          <FieldMessage scope={scope} issue={issue} field="time" />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1">
          <Field label={T.form.room}>
            <input className={inputClass} {...fieldAttrs(scope, issue, "room")} value={draft.room} maxLength={120} onChange={(event) => set("room", event.target.value)} />
          </Field>
          <FieldMessage scope={scope} issue={issue} field="room" />
        </div>
        <div id={fieldDomId(scope, "registrationOpens")} className="grid min-w-0 grid-cols-1 gap-1">
          <DateField label={T.form.opens} optional value={draft.registrationOpens} onChange={(value) => set("registrationOpens", value)} />
          <FieldMessage scope={scope} issue={issue} field="registrationOpens" />
        </div>
        <div id={fieldDomId(scope, "registrationCloses")} className="grid min-w-0 grid-cols-1 gap-1">
          <DateField label={T.form.closes} optional value={draft.registrationCloses} onChange={(value) => set("registrationCloses", value)} />
          <FieldMessage scope={scope} issue={issue} field="registrationCloses" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1">
        <Field label={T.form.label}>
          <input className={inputClass} {...fieldAttrs(scope, issue, "label")} value={draft.label} maxLength={80} onChange={(event) => set("label", event.target.value)} />
        </Field>
        <FieldMessage scope={scope} issue={issue} field="label" />
      </div>
      <div className="grid grid-cols-1 gap-1">
      <Field label={T.form.notes}>
        <textarea className={`${inputClass} min-h-24 py-2`} {...fieldAttrs(scope, issue, "notes")} value={draft.notes} maxLength={1000} onChange={(event) => set("notes", event.target.value)} />
      </Field>
      <FieldMessage scope={scope} issue={issue} field="notes" />
      </div>
      <p role="status" aria-live="polite" className="text-sm font-bold text-[var(--danger-text)]">
        {error}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="ghost" onClick={onCancel}>
          {T.cancel}
        </Button>
        <Button type="submit" variant="primary" icon="Check" disabled={busy}>
          {T.save}
        </Button>
      </div>
    </form>
  );
}
