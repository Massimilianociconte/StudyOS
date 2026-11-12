import { useId, useState } from "react";
import { Icon } from "../Icon";
import type { RepeatRule } from "../../types";
import { REPEAT_PICKER_TEXT } from "../../lib/labels";
import { customFromRule, presetIdOf, repeatPresets, ruleFromCustom, ruleSentence } from "../../lib/repeatPicker";
import { RepeatCustom } from "./RepeatCustom";

/**
 * Riga "Non si ripete ▾": un tocco apre, sotto, le scelte pronte calcolate dalla data d'inizio.
 * La frase della regola si vede sempre.
 */
export function RepeatPicker({
  value,
  start,
  onChange,
  disabled = false,
  note,
  startCounts = true
}: {
  value: RepeatRule | null;
  /** Giorno d'inizio (YYYY-MM-DD). */
  start: string;
  onChange: (rule: RepeatRule | null) => void;
  disabled?: boolean;
  /** Avviso sotto la riga (es. la ripetizione si cambia solo per "successivi" o "tutti"). */
  note?: string;
  /** L'inizio conta come una volta anche fuori dai giorni scelti: false quando si modifica da un giorno della serie. */
  startCounts?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const listId = useId();
  const labelId = useId();
  const summaryId = useId();
  const presets = repeatPresets(start);
  const current = presetIdOf(value, start);
  const summary = ruleSentence(value, start);

  return (
    <div className="min-w-0">
      <span id={labelId} className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">
        {REPEAT_PICKER_TEXT.label}
      </span>
      {/* Nome accessibile: "Ripetizione" e la scelta attuale, come si vedono. */}
      <button
        type="button"
        aria-labelledby={`${labelId} ${summaryId}`}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-left text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="RefreshCw" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
        <span id={summaryId} className="safe-text min-w-0 flex-1">
          {summary}
        </span>
        <Icon name="ChevronDown" className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {note ? <p className="mt-1.5 text-xs font-bold text-[var(--muted)]">{note}</p> : null}
      {open ? (
        <div id={listId} role="group" aria-label={REPEAT_PICKER_TEXT.label} className="mt-2 grid grid-cols-1 gap-1 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-1.5">
          {presets.map((preset) => {
            const selected = preset.id === current;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => {
                  onChange(preset.rule);
                  setOpen(false);
                  setCustomOpen(false);
                }}
                className={`flex min-h-11 items-center gap-2 rounded-[14px] px-3 text-left text-sm font-bold ${
                  selected ? "bg-[var(--surface-soft)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                }`}
              >
                <span className="min-w-0 flex-1">{preset.label}</span>
                {selected ? <Icon name="Check" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" /> : null}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={current === "custom"}
            aria-expanded={customOpen}
            disabled={disabled}
            onClick={() => {
              // Da "Non si ripete": il modulo parte da "ogni settimana" e la regola vale da subito (la riga lo dice).
              if (!value) onChange(ruleFromCustom(customFromRule(null, start), start));
              setCustomOpen(true);
              setOpen(false);
            }}
            className={`flex min-h-11 items-center gap-2 rounded-[14px] px-3 text-left text-sm font-bold ${
              current === "custom" ? "bg-[var(--surface-soft)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            }`}
          >
            <span className="min-w-0 flex-1">{REPEAT_PICKER_TEXT.custom}</span>
            {current === "custom" ? <Icon name="Check" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" /> : null}
          </button>
        </div>
      ) : null}
      {customOpen && !open ? <RepeatCustom key={start} value={value} start={start} onChange={onChange} disabled={disabled} startCounts={startCounts} /> : null}
    </div>
  );
}
