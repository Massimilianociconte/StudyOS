import { useState } from "react";
import { Icon } from "../Icon";
import { Button, Field, inputClass } from "../ui";
import type { EventReminder } from "../../types";
import { addReminder, customReminder, hasReminder, reminderChoices, removeReminder } from "../../lib/eventEditor";
import { REMINDER_PICKER_TEXT } from "../../lib/labels";
import { describeReminder } from "../../lib/repeat";

type Unit = "minutes" | "hours" | "days";

/**
 * Promemoria dell'evento: quelli scelti (con "togli"), le scelte pronte da aggiungere con un tocco
 * e un promemoria personalizzato. Dice dove suonano (app aperta, calendari esportati).
 */
export function ReminderList({
  value,
  allDay,
  onChange,
  disabled = false
}: {
  value: EventReminder[];
  allDay: boolean;
  onChange: (next: EventReminder[]) => void;
  disabled?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<Unit>(allDay ? "days" : "minutes");
  const [at, setAt] = useState(allDay ? "09:00" : "");
  const [error, setError] = useState("");
  const choices = reminderChoices(allDay).filter((choice) => !hasReminder(value, choice.reminder));

  const addCustom = () => {
    const reminder = customReminder(Number(amount), unit, unit === "days" && at ? at : undefined);
    if (!reminder) {
      setError(REMINDER_PICKER_TEXT.invalid);
      return;
    }
    setError("");
    onChange(addReminder(value, reminder));
    setCustomOpen(false);
  };

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{REMINDER_PICKER_TEXT.label}</legend>
      {value.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((reminder, index) => {
            const text = describeReminder(reminder);
            return (
              <li key={`${index}-${text}`} className="flex min-h-11 items-center gap-1 rounded-full bg-[var(--surface-soft)] pl-3 text-sm font-bold">
                <Icon name="Bell" className="h-3.5 w-3.5 text-[var(--muted)]" />
                <span>{text}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={REMINDER_PICKER_TEXT.remove(text)}
                  onClick={() => onChange(removeReminder(value, index))}
                  className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--text)] disabled:cursor-not-allowed"
                >
                  <Icon name="X" className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-2 text-sm font-bold text-[var(--muted)]">{REMINDER_PICKER_TEXT.none}</p>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={REMINDER_PICKER_TEXT.add}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(addReminder(value, choice.reminder))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-sm font-bold text-[var(--muted)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="Plus" className="h-3.5 w-3.5" />
            {choice.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-3 text-sm font-bold text-[var(--muted)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="Plus" className="h-3.5 w-3.5" />
          {REMINDER_PICKER_TEXT.custom}
        </button>
      </div>
      {customOpen ? (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 sm:grid-cols-[6rem_minmax(0,1fr)_7rem_auto] sm:items-end">
          <Field label={REMINDER_PICKER_TEXT.amount}>
            <input className={inputClass} type="number" inputMode="numeric" min={0} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label={REMINDER_PICKER_TEXT.unit}>
            <select className={inputClass} value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>
              {(Object.keys(REMINDER_PICKER_TEXT.units) as Unit[]).map((key) => (
                <option key={key} value={key}>
                  {REMINDER_PICKER_TEXT.units[key]}
                </option>
              ))}
            </select>
          </Field>
          {unit === "days" ? (
            <Field label={REMINDER_PICKER_TEXT.at}>
              <input className={inputClass} type="time" value={at} onChange={(event) => setAt(event.target.value)} />
            </Field>
          ) : (
            <span className="hidden sm:block" />
          )}
          <Button variant="soft" icon="Plus" onClick={addCustom} disabled={disabled}>
            {REMINDER_PICKER_TEXT.addCustom}
          </Button>
          {error ? (
            <p role="alert" className="text-xs font-bold text-[var(--danger-text)] sm:col-span-4">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-xs font-bold text-[var(--muted)]">{REMINDER_PICKER_TEXT.where}</p>
    </fieldset>
  );
}
