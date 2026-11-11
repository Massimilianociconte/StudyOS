import { useEffect, useState, type ReactNode } from "react";
import { Button, Drawer, Field, inputClass } from "../ui";
import { Icon } from "../Icon";
import { ColorPreview } from "./ColorPalette";
import { ReminderList } from "./ReminderList";
import type { OccasionKind } from "../../types";
import { eventTypeIcon, eventTypeKey, typeDefaultColor, type TypeColorOverrides } from "../../lib/eventColors";
import { occurrenceDayText } from "../../lib/eventEditor";
import { nextOccasion, occasionError, OCCASION_KINDS, type OccasionDraft } from "../../lib/occasionForms";
import { MONTH_NAME, occasionAgeText } from "../../lib/labels";
import { EVENT_EDITOR_TEXT, OCCASION_FORM_TEXT, OCCASION_KIND_LABEL } from "../../lib/labels/calendar";

/**
 * Cornice dei percorsi semplici (ricorrenza, vacanza): Drawer con Salva e Annulla sempre visibili,
 * conferma prima di chiudere con modifiche e prima di eliminare, errori accanto ai pulsanti.
 * `onSave` / `onDelete` restituiscono un testo d'errore (il modulo resta aperto) o niente.
 */
export function SimpleFormDrawer({
  title,
  dirty,
  changeKey,
  saveLabel,
  deleteLabel,
  deleteConfirm,
  onClose,
  onSave,
  onDelete,
  onFullForm,
  children
}: {
  title: string;
  dirty: boolean;
  /** Cambia a ogni modifica dei campi: l'errore mostrato sparisce. */
  changeKey: string;
  saveLabel: string;
  deleteLabel: string;
  deleteConfirm: string;
  onClose: () => void;
  onSave: () => Promise<string | void>;
  onDelete?: () => Promise<string | void>;
  /** "Modulo completo": stessi dati nel modulo evento. */
  onFullForm?: () => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"unsaved" | "delete" | null>(null);
  useEffect(() => setError(""), [changeKey]);

  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirm("unsaved");
    else onClose();
  };
  const run = async (action: () => Promise<string | void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const failure = await action();
      if (failure) setError(failure);
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const footer = (
    <div className="grid grid-cols-1 gap-2">
      {error ? (
        <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {confirm === "unsaved" ? (
        <div role="group" aria-label={EVENT_EDITOR_TEXT.unsavedTitle} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="text-sm font-black">{EVENT_EDITOR_TEXT.unsavedTitle}</p>
          <p className="text-sm font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.unsavedText}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={() => setConfirm(null)} autoFocus>
              {EVENT_EDITOR_TEXT.unsavedKeep}
            </Button>
            <Button variant="danger" icon="X" onClick={onClose}>
              {EVENT_EDITOR_TEXT.unsavedDiscard}
            </Button>
          </div>
        </div>
      ) : confirm === "delete" && onDelete ? (
        <div role="group" aria-label={deleteLabel} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="safe-text text-sm font-bold">{deleteConfirm}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={() => setConfirm(null)} disabled={busy} autoFocus>
              {EVENT_EDITOR_TEXT.cancel}
            </Button>
            <Button variant="danger" icon="Trash2" onClick={() => void run(onDelete, EVENT_EDITOR_TEXT.deleteFailed)} disabled={busy}>
              {EVENT_EDITOR_TEXT.deleteAction}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {onDelete ? (
            <Button variant="danger" icon="Trash2" title={deleteLabel} className="px-3 sm:px-4" disabled={busy} onClick={() => setConfirm("delete")}>
              <span className="sr-only sm:not-sr-only">{deleteLabel}</span>
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="soft" onClick={requestClose} disabled={busy}>
            {EVENT_EDITOR_TEXT.cancel}
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void run(onSave, EVENT_EDITOR_TEXT.saveFailed)} disabled={busy}>
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Drawer open onClose={requestClose} title={title} footer={footer}>
      <div className="grid grid-cols-1 gap-5">
        {children}
        {onFullForm ? (
          <button
            type="button"
            onClick={onFullForm}
            disabled={busy}
            className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[18px] border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--surface-soft)]"
          >
            <Icon name="Settings" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">{EVENT_EDITOR_TEXT.simpleForm}</span>
              <span className="block text-xs font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.simpleFormHint}</span>
            </span>
            <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-extrabold ${
    active ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
  }`;

/** Icona della ricorrenza (compleanno, anniversario, festa; "altro ogni anno" come Personale). */
export const occasionIcon = (kind: OccasionKind) => eventTypeIcon(eventTypeKey({ category: "personal", occasionKind: kind }));

/**
 * "Nuova ricorrenza" (e modifica): tipo, nome, giorno e mese, anno facoltativo (con gli anni che
 * compie), note e promemoria. Ogni anno in automatico, tutto il giorno.
 */
export function OccasionForm({
  initial,
  editing,
  today,
  overrides,
  customColor,
  onClose,
  onSave,
  onDelete,
  onFullForm
}: {
  initial: OccasionDraft;
  editing: boolean;
  /** Oggi (YYYY-MM-DD). */
  today: string;
  overrides?: TypeColorOverrides;
  /** Colore scelto a mano per questo evento: l'anteprima usa quello, non il colore della tipologia. */
  customColor?: string;
  onClose: () => void;
  /** Bozza già controllata. */
  onSave: (draft: OccasionDraft) => Promise<string | void>;
  onDelete?: () => Promise<string | void>;
  onFullForm?: (draft: OccasionDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [yearTouched, setYearTouched] = useState(false);
  const update = (patch: Partial<OccasionDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const key = JSON.stringify(draft);
  const dirty = key !== JSON.stringify(initial);
  const liveError = occasionError({ ...draft, name: draft.name || "x" }, today);
  const next = nextOccasion(draft, today);
  const name = draft.name.trim();
  const previewTitle = name ? (draft.kind === "birthday" ? OCCASION_FORM_TEXT.birthdayTitle(name) : name) : OCCASION_KIND_LABEL[draft.kind];
  const color = customColor || typeDefaultColor(eventTypeKey({ category: "personal", occasionKind: draft.kind }), { overrides });
  const days = Array.from({ length: 31 }, (_, index) => index + 1);

  return (
    <SimpleFormDrawer
      title={editing ? OCCASION_FORM_TEXT.editTitle : OCCASION_FORM_TEXT.newTitle}
      dirty={dirty}
      changeKey={key}
      saveLabel={OCCASION_FORM_TEXT.save}
      deleteLabel={OCCASION_FORM_TEXT.delete}
      deleteConfirm={OCCASION_FORM_TEXT.deleteConfirm(previewTitle)}
      onClose={onClose}
      onSave={async () => {
        const message = occasionError(draft, today);
        if (message) return message;
        return onSave(draft);
      }}
      onDelete={onDelete}
      onFullForm={onFullForm ? () => onFullForm(draft) : undefined}
    >
      <div role="group" aria-label={OCCASION_FORM_TEXT.kind} className="min-w-0">
        <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{OCCASION_FORM_TEXT.kind}</span>
        <div className="flex flex-wrap gap-1.5">
          {OCCASION_KINDS.map((kind) => (
            <button key={kind} type="button" aria-pressed={draft.kind === kind} className={chip(draft.kind === kind)} onClick={() => update({ kind })}>
              <Icon name={occasionIcon(kind)} className="h-4 w-4 shrink-0" />
              {OCCASION_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      <Field label={OCCASION_FORM_TEXT.name(draft.kind)}>
        <input
          className={inputClass}
          value={draft.name}
          maxLength={120}
          placeholder={OCCASION_FORM_TEXT.namePlaceholder(draft.kind)}
          onChange={(event) => update({ name: event.target.value })}
          data-autofocus
        />
      </Field>

      <div className="grid grid-cols-1 gap-2">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[5rem_minmax(0,1fr)_10rem]">
          <Field label={OCCASION_FORM_TEXT.day}>
            <select className={inputClass} value={draft.day} onChange={(event) => update({ day: Number(event.target.value) })}>
              {days.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
          <Field label={OCCASION_FORM_TEXT.month}>
            <select className={inputClass} value={draft.month} onChange={(event) => update({ month: Number(event.target.value) })}>
              {MONTH_NAME.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </Field>
          <Field label={OCCASION_FORM_TEXT.year} className="col-span-2 sm:col-span-1">
            <input
              className={inputClass}
              inputMode="numeric"
              maxLength={4}
              placeholder={OCCASION_FORM_TEXT.yearPlaceholder}
              value={draft.year}
              onChange={(event) => update({ year: event.target.value.replace(/\D/g, "") })}
              onBlur={() => setYearTouched(true)}
            />
          </Field>
        </div>
        {liveError && (liveError !== OCCASION_FORM_TEXT.yearInvalid || yearTouched || draft.year.length >= 4) ? (
          <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
            {liveError}
          </p>
        ) : (
          <p className="text-xs font-bold text-[var(--muted)]">{OCCASION_FORM_TEXT.yearHint(draft.kind)}</p>
        )}
        {next ? (
          <p className="rounded-[14px] bg-[var(--surface-soft)] p-2.5 text-sm font-bold" aria-live="polite">
            {OCCASION_FORM_TEXT.next(occurrenceDayText(next.date), next.age !== null ? occasionAgeText(draft.kind, next.age) : "")}
          </p>
        ) : null}
        <p className="text-xs font-bold text-[var(--muted)]">{OCCASION_FORM_TEXT.automatic}</p>
      </div>

      <ColorPreview color={color} icon={occasionIcon(draft.kind)} title={previewTitle} meta={EVENT_EDITOR_TEXT.allDay} />

      <Field label={OCCASION_FORM_TEXT.notes}>
        <textarea
          className={`${inputClass} min-h-24 py-3`}
          value={draft.notes}
          placeholder={OCCASION_FORM_TEXT.notesPlaceholder}
          onChange={(event) => update({ notes: event.target.value })}
        />
      </Field>

      <ReminderList value={draft.reminders} allDay onChange={(reminders) => update({ reminders })} />
    </SimpleFormDrawer>
  );
}
