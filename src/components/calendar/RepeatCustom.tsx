import { useId, useState } from "react";
import { DateField } from "../DatePicker";
import { Field, inputClass } from "../ui";
import type { RepeatRule, Weekday } from "../../types";
import { REPEAT_PICKER_TEXT, WEEKDAY_NAME, WEEKDAY_SHORT } from "../../lib/labels";
import { WEEKDAYS } from "../../lib/repeat";
import {
  customError,
  customFromRule,
  monthlyChoiceId,
  monthlyChoices,
  repeatSummary,
  ruleFromCustom,
  type CustomRepeat,
  type RepeatUnit
} from "../../lib/repeatPicker";
import { parseCivil } from "../../lib/tz";

const UNITS: RepeatUnit[] = ["day", "week", "month", "year"];

const chip = (active: boolean) =>
  `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${
    active ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
  }`;

/**
 * "Personalizza": ogni N giorni/settimane/mesi/anni, giorni della settimana (anche più di uno), modo
 * mensile, scorciatoie "ogni 3 / 6 mesi", fine (mai, il giorno, dopo N volte). Ogni modifica valida
 * aggiorna subito la regola; la frase della regola si vede sempre.
 */
export function RepeatCustom({
  value,
  start,
  onChange,
  disabled = false,
  startCounts = true
}: {
  value: RepeatRule | null;
  start: string;
  onChange: (rule: RepeatRule) => void;
  disabled?: boolean;
  /** L'inizio conta come una volta anche fuori dai giorni scelti (nuovo evento, serie intera). */
  startCounts?: boolean;
}) {
  const [custom, setCustom] = useState<CustomRepeat>(() => customFromRule(value, start));
  const radioName = useId();
  const error = customError(custom, start);
  const startDay = parseCivil(start)?.day ?? 1;

  const change = (patch: Partial<CustomRepeat>) => {
    const next = { ...custom, ...patch };
    setCustom(next);
    if (!customError(next, start)) onChange(ruleFromCustom(next, start));
  };
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

  return (
    <fieldset disabled={disabled} className="m-0 mt-2 grid min-w-0 grid-cols-1 gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <legend className="sr-only">{REPEAT_PICKER_TEXT.customTitle}</legend>
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
        <Field label={REPEAT_PICKER_TEXT.every}>
          <input
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={Number.isNaN(custom.interval) ? "" : custom.interval}
            onChange={(event) => change({ interval: number(event.target.value) })}
          />
        </Field>
        <Field label={REPEAT_PICKER_TEXT.unit}>
          <select className={inputClass} value={custom.unit} onChange={(event) => change({ unit: event.target.value as RepeatUnit })}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {custom.interval === 1 ? REPEAT_PICKER_TEXT.unitsOne[unit] : REPEAT_PICKER_TEXT.units[unit]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(custom.unit === "month" && custom.interval === 3)} aria-pressed={custom.unit === "month" && custom.interval === 3} onClick={() => change({ unit: "month", interval: 3 })}>
          {REPEAT_PICKER_TEXT.quarterly}
        </button>
        <button type="button" className={chip(custom.unit === "month" && custom.interval === 6)} aria-pressed={custom.unit === "month" && custom.interval === 6} onClick={() => change({ unit: "month", interval: 6 })}>
          {REPEAT_PICKER_TEXT.halfYearly}
        </button>
      </div>

      {custom.unit === "week" ? (
        <div role="group" aria-label={REPEAT_PICKER_TEXT.weekdays} className="min-w-0">
          <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{REPEAT_PICKER_TEXT.weekdays}</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day: Weekday) => {
              const active = custom.weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  aria-label={WEEKDAY_NAME[day]}
                  className={chip(active)}
                  onClick={() => change({ weekdays: active ? custom.weekdays.filter((item) => item !== day) : [...custom.weekdays, day] })}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {custom.unit === "month" ? (
        <fieldset className="m-0 grid min-w-0 grid-cols-1 gap-1 border-0 p-0">
          <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{REPEAT_PICKER_TEXT.monthlyMode}</legend>
          {monthlyChoices(start, custom).map((choice) => (
            <label key={choice.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm font-bold hover:bg-[var(--surface-soft)]">
              <input
                type="radio"
                name={`${radioName}-monthly`}
                className="h-4 w-4 accent-[var(--accent)]"
                checked={monthlyChoiceId(custom) === choice.id}
                onChange={() => change({ monthly: choice.monthly, ...(choice.nth !== undefined ? { nth: choice.nth } : {}), ...(choice.weekday ? { weekday: choice.weekday } : {}) })}
              />
              {choice.label}
            </label>
          ))}
          {custom.monthly === "day" && startDay > 28 ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm font-bold">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={custom.clamp} onChange={(event) => change({ clamp: event.target.checked })} />
              {REPEAT_PICKER_TEXT.clamp}
            </label>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="m-0 grid min-w-0 grid-cols-1 gap-1 border-0 p-0">
        <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{REPEAT_PICKER_TEXT.end}</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm font-bold hover:bg-[var(--surface-soft)]">
          <input type="radio" name={`${radioName}-end`} className="h-4 w-4 accent-[var(--accent)]" checked={custom.end === "never"} onChange={() => change({ end: "never" })} />
          {REPEAT_PICKER_TEXT.endNever}
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm font-bold hover:bg-[var(--surface-soft)]">
          <input type="radio" name={`${radioName}-end`} className="h-4 w-4 accent-[var(--accent)]" checked={custom.end === "until"} onChange={() => change({ end: "until" })} />
          {REPEAT_PICKER_TEXT.endUntil}
        </label>
        {custom.end === "until" ? (
          <div className="pl-9">
            <DateField label={REPEAT_PICKER_TEXT.untilField} value={custom.until} min={start} onChange={(until) => until && change({ until })} />
          </div>
        ) : null}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm font-bold hover:bg-[var(--surface-soft)]">
          <input type="radio" name={`${radioName}-end`} className="h-4 w-4 accent-[var(--accent)]" checked={custom.end === "count"} onChange={() => change({ end: "count" })} />
          {REPEAT_PICKER_TEXT.endCount}
        </label>
        {custom.end === "count" ? (
          <div className="flex items-end gap-2 pl-9">
            <Field label={REPEAT_PICKER_TEXT.countField} className="w-28">
              <input
                className={inputClass}
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={Number.isNaN(custom.count) ? "" : custom.count}
                onChange={(event) => change({ count: number(event.target.value) })}
              />
            </Field>
            <span className="pb-3 text-sm font-bold text-[var(--muted)]">{REPEAT_PICKER_TEXT.countSuffix(custom.count)}</span>
          </div>
        ) : null}
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : (
        <p className="rounded-[14px] bg-[var(--surface-soft)] p-2.5 text-sm font-bold" aria-live="polite">
          <span className="text-[var(--muted)]">{REPEAT_PICKER_TEXT.summary}: </span>
          {/* Se l'inizio non è uno dei giorni scelti, lo dice: il motore lo conta come la prima volta. */}
          {repeatSummary(ruleFromCustom(custom, start), start, { startCounts })}
        </p>
      )}
    </fieldset>
  );
}
