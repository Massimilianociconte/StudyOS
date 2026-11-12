import { useState } from "react";
import { EXAM_STATUS_LABEL, GOAL_STATUS_LABEL, SESSION_STATUS_LABEL, TASK_STATUS_LABEL } from "../lib/labels";
import { SHARED_ITEM_TEXT } from "../lib/labels/sharing";
import {
  ShareUserError,
  actorInSentence,
  parseSharedField,
  shareActionErrorTextSafe,
  sharedEditResult,
  sharedFieldInput,
  type ShareAction,
  type SharedFieldRule,
  type SharedItem,
  type SharedOrigin
} from "../lib/sharing";
import { safeDataUrl, safeHref } from "../lib/safeUrl";
import { useSharedStore } from "../store/useSharedStore";
import { Button, DIMMED_DISABLED_FIELDS, Drawer, Field, Tag, inputClass } from "./ui";
import { InlineConfirm } from "./InlineConfirm";
import { SharedMark } from "./SharedMark";
import { UnsavedPrompt } from "./UnsavedPrompt";

interface FieldSpec extends SharedFieldRule {
  key: string;
  label: string;
  options?: Record<string, string>;
}

/** Campi modificabili per tipo: solo quelli che hanno senso per chi riceve (niente collegamenti interni). */
const FIELDS: Record<string, FieldSpec[]> = {
  task: [
    { key: "title", label: "Titolo", kind: "text", required: true },
    { key: "dueDate", label: "Scadenza", kind: "datetime" },
    { key: "status", label: "Stato", kind: "select", options: TASK_STATUS_LABEL },
    { key: "notes", label: "Note", kind: "textarea" }
  ],
  studySession: [
    { key: "title", label: "Titolo", kind: "text", required: true },
    { key: "start", label: "Inizio", kind: "datetime", required: true },
    { key: "plannedMinutes", label: "Minuti previsti", kind: "number", min: 0, max: 1440 },
    { key: "status", label: "Stato", kind: "select", options: SESSION_STATUS_LABEL },
    { key: "notes", label: "Note", kind: "textarea" }
  ],
  studyTopic: [
    { key: "title", label: "Argomento", kind: "text", required: true },
    { key: "nextReviewDate", label: "Prossimo ripasso", kind: "date", required: true },
    { key: "notes", label: "Note", kind: "textarea" }
  ],
  exam: [
    { key: "date", label: "Data dell'esame", kind: "date", required: true },
    { key: "status", label: "Stato", kind: "select", options: EXAM_STATUS_LABEL },
    { key: "preparation", label: "Preparazione (%)", kind: "number", min: 0, max: 100 }
  ],
  attachment: [
    { key: "name", label: "Nome", kind: "text", required: true },
    { key: "description", label: "Descrizione", kind: "textarea" }
  ],
  note: [
    { key: "title", label: "Titolo", kind: "text", required: true },
    { key: "body", label: "Testo", kind: "textarea" }
  ],
  goal: [
    { key: "title", label: "Titolo", kind: "text", required: true },
    { key: "deadline", label: "Scadenza", kind: "date" },
    { key: "progress", label: "Avanzamento (%)", kind: "number", min: 0, max: 100 },
    { key: "status", label: "Stato", kind: "select", options: GOAL_STATUS_LABEL },
    { key: "notes", label: "Note", kind: "textarea" }
  ]
};

const fieldsOf = (entityType: string) => (Object.hasOwn(FIELDS, entityType) ? FIELDS[entityType] : []);

/**
 * Valori che il menu offre. Chi riceve non avvia il cronometro del proprietario: "In corso" di
 * un'attività c'è solo se è già lo stato attuale (e si può lasciare, il che lo ferma).
 */
const offeredOptions = (entityType: string, field: FieldSpec, current: string) =>
  Object.entries(field.options ?? {}).filter(([value]) => !(entityType === "task" && field.key === "status" && value === "doing" && current !== "doing"));

const linkClass = "text-sm font-bold text-[var(--accent-ink)] underline";

/**
 * Dettaglio di un elemento di un'altra persona: modificabile con "Può modificare", altrimenti in sola
 * lettura. Tutto ciò che arriva da lì è testo non fidato: si mostra come testo, i link passano da safeHref.
 */
export function SharedItemDrawer({ entry, origin, title, onClose }: { entry: SharedItem; origin: SharedOrigin; title: string; onClose: () => void }) {
  const fields = fieldsOf(entry.entityType);
  // Com'era quando si è aperto: il confronto per sapere cosa ha cambiato chi scrive qui, e non altri nel frattempo.
  const [opened] = useState(() => ({
    entity: entry.entity,
    draft: Object.fromEntries(fields.map((field) => [field.key, sharedFieldInput(field.kind, entry.entity[field.key])]))
  }));
  const [draft, setDraft] = useState<Record<string, string>>(opened.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Chiusura in attesa della risposta a «Scartare le modifiche?».
  const [asking, setAsking] = useState(false);
  const readOnly = !origin.canEdit;
  // Come negli editor dei propri dati: Esc, tocco fuori, Indietro, ✕ o «Annulla» con campi cambiati chiedono prima.
  const dirty = !readOnly && fields.some((field) => (draft[field.key] ?? "") !== opened.draft[field.key]);
  const requestClose = () => {
    if (busy) return;
    if (dirty) setAsking(true);
    else onClose();
  };
  const who = actorInSentence(origin.ownerName);
  const entity = entry.entity;
  const externalUrl = safeHref(typeof entity.externalUrl === "string" ? entity.externalUrl : null);
  const dataUrl = safeDataUrl(typeof entity.dataUrl === "string" ? entity.dataUrl : null);

  const run = async (action: ShareAction, operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      onClose();
    } catch (cause) {
      // Mai il testo grezzo dell'errore: passano solo i messaggi pensati per l'utente.
      setError(shareActionErrorTextSafe(action, cause));
    } finally {
      setBusy(false);
    }
  };

  /** L'ultima versione nello store, non quella di quando si è aperto; se non c'è più (condivisione tolta, eliminato, persona nascosta) si ferma qui. */
  const latestOrThrow = () => {
    const state = useSharedStore.getState();
    const latest = state.hiddenOwners.includes(entry.ownerId) ? undefined : state.items.find((item) => item.key === entry.key)?.entity;
    if (!latest) throw new ShareUserError(SHARED_ITEM_TEXT.gone);
    return latest;
  };

  const save = () =>
    run("save", async () => {
      const edits: Record<string, unknown> = {};
      for (const field of fields) {
        const input = draft[field.key] ?? "";
        if (input === opened.draft[field.key]) continue;
        const parsed = parseSharedField(field, input, opened.entity[field.key]);
        if (!parsed) throw new ShareUserError(SHARED_ITEM_TEXT.invalidField(field.label));
        edits[field.key] = parsed.value;
      }
      // Ciò che il proprietario ha cambiato nel frattempo resta: si scrive solo il cambiato, sopra l'ultima versione.
      const next = sharedEditResult(entry.entityType, opened.entity, edits, latestOrThrow());
      // Solo nello store dei dati altrui: mai tra i miei.
      if (next) await useSharedStore.getState().saveSharedItem(entry.ownerId, entry.entityType, next);
    });

  const remove = () =>
    run("delete", async () => {
      latestOrThrow();
      await useSharedStore.getState().deleteSharedItem(entry.ownerId, entry.entityType, entry.entityId);
    });

  const change = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  // Errore e conferma stanno nel piede: restano in vista anche con un modulo lungo.
  const footer = (
    <div className="grid grid-cols-1 gap-2">
      {error ? (
        <p role="alert" className="safe-text text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {readOnly ? (
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      ) : asking ? (
        <UnsavedPrompt
          title={SHARED_ITEM_TEXT.unsavedTitle}
          text={SHARED_ITEM_TEXT.unsavedText(who)}
          keep={SHARED_ITEM_TEXT.unsavedKeep}
          discard={SHARED_ITEM_TEXT.unsavedDiscard}
          onKeep={() => setAsking(false)}
          onDiscard={() => {
            setAsking(false);
            onClose();
          }}
        />
      ) : confirmDelete ? (
        <InlineConfirm
          text={SHARED_ITEM_TEXT.deleteConfirm(title, who)}
          confirmLabel="Elimina"
          icon="Trash2"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" icon="Trash2" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Elimina
          </Button>
          <span className="flex-1" />
          <Button variant="soft" onClick={requestClose} disabled={busy}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>
            Salva
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Drawer
      open
      onClose={requestClose}
      eyebrow={<SharedMark origin={origin} />}
      title={title}
      width="max-w-[560px]"
      footer={footer}
    >
      <div className="grid grid-cols-1 gap-4">
        <p className="safe-text rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
          {readOnly ? SHARED_ITEM_TEXT.readOnlyIntro(who) : SHARED_ITEM_TEXT.editIntro(who)}
        </p>
        {/* Per un esame il titolo è già la materia. */}
        {origin.subjectName && origin.subjectName !== title ? <Tag color={origin.subjectColor}>{origin.subjectName}</Tag> : null}
        <fieldset disabled={readOnly || busy} className={`m-0 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 ${DIMMED_DISABLED_FIELDS}`}>
          {fields.map((field) => {
            const value = draft[field.key] ?? "";
            const options = field.kind === "select" ? offeredOptions(entry.entityType, field, opened.draft[field.key] ?? "") : [];
            return (
              <Field key={field.key} label={field.label}>
                {field.kind === "textarea" ? (
                  <textarea className={`${inputClass} min-h-28 py-2`} value={value} onChange={(event) => change(field.key, event.target.value)} />
                ) : field.kind === "select" ? (
                  <select className={inputClass} value={value} onChange={(event) => change(field.key, event.target.value)}>
                    {/* Un valore che questa versione non conosce non si mostra come codice: resta com'è finché non lo si cambia. */}
                    {options.some(([optionValue]) => optionValue === value) ? null : (
                      <option value={value} disabled>
                        —
                      </option>
                    )}
                    {options.map(([optionValue, label]) => (
                      <option key={optionValue} value={optionValue}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={inputClass}
                    type={field.kind === "datetime" ? "datetime-local" : field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
                    min={field.min}
                    max={field.max}
                    value={value}
                    onChange={(event) => change(field.key, event.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </fieldset>
        {externalUrl || dataUrl ? (
          <div className="flex flex-wrap gap-3">
            {externalUrl ? (
              <a className={linkClass} href={externalUrl} target="_blank" rel="noopener noreferrer">
                Apri il link
              </a>
            ) : null}
            {dataUrl ? (
              // Solo da scaricare (attributo `download`): mai aperto nella pagina.
              <a className={linkClass} href={dataUrl} download={typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : "file"}>
                Scarica il file
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
