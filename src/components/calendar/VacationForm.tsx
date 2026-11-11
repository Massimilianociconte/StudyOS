import { useState } from "react";
import { Field, inputClass } from "../ui";
import { DateRangeField } from "../DatePicker";
import { ColorPreview } from "./ColorPalette";
import { ReminderList } from "./ReminderList";
import { SimpleFormDrawer } from "./OccasionForm";
import { eventTypeIcon, typeDefaultColor, type TypeColorOverrides } from "../../lib/eventColors";
import { vacationDays, vacationError, type VacationDraft } from "../../lib/occasionForms";
import { EVENT_EDITOR_TEXT, VACATION_FORM_TEXT } from "../../lib/labels";

/**
 * "Nuova vacanza" (e modifica): nome, dal… al… (giorni compresi), destinazione, note, promemoria.
 * Un solo evento di tutto il giorno, giallo con la valigia.
 */
export function VacationForm({
  initial,
  editing,
  overrides,
  onClose,
  onSave,
  onDelete,
  onFullForm
}: {
  initial: VacationDraft;
  editing: boolean;
  overrides?: TypeColorOverrides;
  onClose: () => void;
  /** Bozza già controllata. */
  onSave: (draft: VacationDraft) => Promise<string | void>;
  onDelete?: () => Promise<string | void>;
  onFullForm?: (draft: VacationDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (patch: Partial<VacationDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const key = JSON.stringify(draft);
  const days = vacationDays(draft);
  const title = draft.title.trim() || VACATION_FORM_TEXT.newTitle;

  return (
    <SimpleFormDrawer
      title={editing ? VACATION_FORM_TEXT.editTitle : VACATION_FORM_TEXT.newTitle}
      dirty={key !== JSON.stringify(initial)}
      changeKey={key}
      saveLabel={VACATION_FORM_TEXT.save}
      deleteLabel={VACATION_FORM_TEXT.delete}
      deleteConfirm={VACATION_FORM_TEXT.deleteConfirm(title)}
      onClose={onClose}
      onSave={async () => {
        const message = vacationError(draft);
        if (message) return message;
        return onSave(draft);
      }}
      onDelete={onDelete}
      onFullForm={onFullForm ? () => onFullForm(draft) : undefined}
    >
      <Field label={VACATION_FORM_TEXT.name}>
        <input
          className={inputClass}
          value={draft.title}
          maxLength={200}
          placeholder={VACATION_FORM_TEXT.namePlaceholder}
          onChange={(event) => update({ title: event.target.value })}
          data-autofocus
        />
      </Field>

      <div className="grid grid-cols-1 gap-1.5">
        <DateRangeField label={VACATION_FORM_TEXT.days} start={draft.first} end={draft.last} onChange={(first, last) => update({ first, last })} />
        <p className="text-xs font-bold text-[var(--muted)]">{VACATION_FORM_TEXT.daysHint}</p>
      </div>

      <ColorPreview color={typeDefaultColor("vacation", { overrides })} icon={eventTypeIcon("vacation")} title={title} meta={days ? EVENT_EDITOR_TEXT.daysLabel(days) : undefined} />

      <Field label={VACATION_FORM_TEXT.destination}>
        <input
          className={inputClass}
          value={draft.destination}
          maxLength={200}
          placeholder={VACATION_FORM_TEXT.destinationPlaceholder}
          onChange={(event) => update({ destination: event.target.value })}
        />
      </Field>

      <Field label={VACATION_FORM_TEXT.notes}>
        <textarea
          className={`${inputClass} min-h-24 py-3`}
          value={draft.notes}
          placeholder={VACATION_FORM_TEXT.notesPlaceholder}
          onChange={(event) => update({ notes: event.target.value })}
        />
      </Field>

      <ReminderList value={draft.reminders} allDay onChange={(reminders) => update({ reminders })} />
    </SimpleFormDrawer>
  );
}
