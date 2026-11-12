// «Correggi»: i campi permessi per il tipo (lib/catalogOverrides), con sotto ognuno il dato ufficiale.
// Si salva con le funzioni del server (versione, doppioni, cronologia); il catalogo ufficiale non cambia.
import { useState } from "react";
import { Button, Drawer, Field, inputClass } from "../ui";
import { InlineConfirm } from "../InlineConfirm";
import { HistoryList } from "./HistoryList";
import { FieldMessage, fieldAttrs, useFieldIssue } from "./FieldError";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { CATALOG_OVERRIDE_FIELDS, cleanOverrideFields, describeOverrideEntry, overrideInputField, overridesOf } from "../../lib/catalogOverrides";
import { newGroupRecordId, type CatalogTargetKind } from "../../lib/groupExams";
import { useGroupExamStore } from "../../store/useGroupExamStore";

const LONG = new Set(["note", "officeHours", "lessonTimes"]);

export function OverrideDrawer({
  groupId,
  kind,
  targetId,
  targetLabel,
  official,
  onClose
}: {
  groupId: string;
  kind: CatalogTargetKind;
  targetId: string;
  /** Nome leggibile (docente, corso, contatto); per un contatto nuovo si usa il campo «Nome». */
  targetLabel: string;
  /** Valori ufficiali dei campi permessi ("" = non pubblicato). */
  official: Record<string, string>;
  onClose: () => void;
}) {
  const existing = useGroupExamStore((state) => overridesOf(state.overrides, kind, targetId, groupId).find((item) => item.groupId === groupId));
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...(existing?.fields ?? {}) }));
  const [newId] = useState(() => newGroupRecordId("gover"));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fields = CATALOG_OVERRIDE_FIELDS[kind];
  const { scope, issue, fail, clear } = useFieldIssue(fields);
  const showFailure = (text: string, field?: string) => {
    const input = overrideInputField(kind, field);
    if (input) {
      setMessage("");
      fail(text, input);
    } else {
      clear();
      setMessage(text);
    }
  };
  const label = targetLabel || draft.label || T.addContact;

  const save = async () => {
    clear();
    // Un contatto nuovo si riconosce dal nome: senza, l'elenco mostrerebbe «Aggiungi un contatto».
    if (kind === "contact" && !targetLabel && !(draft.label ?? "").trim()) {
      showFailure(T.contactNameMissing, "label");
      return;
    }
    const clean = cleanOverrideFields(kind, draft);
    if (!clean.ok) {
      showFailure(clean.message, clean.field);
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showFailure(T.offline);
      return;
    }
    setBusy(true);
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      const result = await groupExamWriter.saveOverride(groupId, existing?.id ?? newId, existing?.version ?? null, kind, targetId, label.slice(0, 160), clean.value);
      if (result.status === "ok") setMessage(T.correctionSaved);
      else if ((result.status === "conflict" || result.status === "duplicate") && result.row) {
        // Qualcuno l'ha cambiata nel frattempo: si riparte dalla sua versione.
        setDraft({ ...result.row.fields });
        setMessage(T.overrideConflict(result.row.updatedByName || T.someone));
      } else showFailure(result.message ?? T.actionFailed, result.field);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : T.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      const { groupExamWriter } = await import("../../lib/groupExamSync");
      const result = await groupExamWriter.deleteOverride(existing.id, existing.version);
      setMessage(result.status === "ok" ? T.correctionRemoved : (result.message ?? T.actionFailed));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : T.actionFailed);
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={label}
      eyebrow={T.correct}
      footer={
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="ghost" onClick={onClose}>
            {T.close}
          </Button>
          <Button variant="primary" icon="Check" disabled={busy} onClick={() => void save()}>
            {T.save}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <p className="text-sm font-bold text-[var(--muted)]">{T.catalogIntro}</p>
        <div role="status" aria-live="polite">
          {message ? <p className="soft-panel p-2.5 text-sm font-bold">{message}</p> : null}
        </div>
        {fields.map((field) => (
          <div key={field} className="grid grid-cols-1 gap-1">
            <Field label={T.overrideField[field] ?? field}>
              {LONG.has(field) ? (
                <textarea className={`${inputClass} min-h-20 py-2`} {...fieldAttrs(scope, issue, field)} value={draft[field] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
              ) : (
                <input
                  className={inputClass}
                  {...fieldAttrs(scope, issue, field)}
                  type={field === "email" ? "email" : field === "website" || field === "url" ? "url" : "text"}
                  value={draft[field] ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                />
              )}
            </Field>
            <FieldMessage scope={scope} issue={issue} field={field} />
            {field === "email" ? <p className="text-xs font-bold text-[var(--muted)]">{T.emailRule}</p> : null}
            {field in official ? <p className="safe-text text-xs font-bold text-[var(--muted)]">{T.official(official[field])}</p> : null}
          </div>
        ))}
        {existing ? (
          confirmRemove ? (
            <InlineConfirm text={T.removeCorrectionConfirm} confirmLabel={T.removeCorrection} icon="Trash2" busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirmRemove(false)} />
          ) : (
            <Button variant="danger" icon="Trash2" className="justify-self-start" onClick={() => setConfirmRemove(true)}>
              {T.removeCorrection}
            </Button>
          )
        ) : null}
        {existing ? (
          <section className="grid grid-cols-1 gap-2">
            <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.historyTitle}</h4>
            <HistoryList
              groupId={groupId}
              recordKind="catalog_override"
              recordId={existing.id}
              version={existing.version}
              describe={describeOverrideEntry}
              confirmText={T.restoreOverrideConfirm}
              onMessage={setMessage}
            />
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
