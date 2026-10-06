import { formatMinutes } from "../lib/labels";
import { DURATION_UNITS, durationToMinutes, type DurationUnit } from "../lib/duration";
import { Field, inputClass } from "./ui";

export type { DurationUnit };
export { DURATION_UNITS, durationToMinutes };

export function DurationField({
  label,
  value,
  unit,
  onChange,
  hint = true
}: {
  label: string;
  value: string;
  unit: DurationUnit;
  onChange: (value: string, unit: DurationUnit) => void;
  hint?: boolean;
}) {
  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const minutes = valid ? durationToMinutes(parsed, unit) : 0;
  return (
    <Field label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <input
          className={inputClass}
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(event) => onChange(event.target.value, unit)}
          placeholder="Es. 2"
          aria-label={`${label}, valore`}
        />
        <select
          className={inputClass}
          value={unit}
          onChange={(event) => onChange(value, event.target.value as DurationUnit)}
          aria-label={`${label}, unità di tempo`}
        >
          {DURATION_UNITS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {hint ? (
        <p className="mt-1 text-xs font-bold text-[var(--faint)]">
          {valid ? `≈ ${formatMinutes(minutes)} di lavoro stimato` : "Valore non valido: usa 0 o più."}
        </p>
      ) : null}
    </Field>
  );
}
