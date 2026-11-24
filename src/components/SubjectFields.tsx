// Campi di una materia, gli stessi in «Nuova materia» e nel dettaglio della materia (Dati della materia).
// In vista nome, CFU, semestre e docente; icona, colore, stato, voto obiettivo e note in «Altri dettagli»
// quando si crea (si aggiungono anche dopo), sempre aperti quando si modifica. Le regole sono quelle di
// src/lib/subjectFields.ts, le stesse degli strumenti degli agenti.
import type { ReactNode } from "react";
import { SUBJECT_STATUS_LABEL } from "../lib/labels";
import { SUBJECT_FORM_TEXT, SUBJECTS_HELP } from "../lib/labels/subjects";
import { SEMESTER_IDS, SEMESTER_LABEL } from "../lib/semesters";
import { SUBJECT_FORM_STATUSES, SUBJECT_ICONS, SUBJECT_SWATCHES, type SubjectDraft } from "../lib/subjectFields";
import { DARK_INK, inkOn } from "../lib/subjectInk";
import { safeCssColor } from "../lib/sharing";
import { HelpField } from "./HelpField";
import { Icon } from "./Icon";
import { Field, inputClass } from "./ui";

// Nomi leggibili dei colori per i lettori di schermo (i codici esadecimali non dicono nulla).
const SWATCH_NAMES: Record<string, string> = {
  "#7CF7C8": "verde acqua",
  "#9FB7FF": "blu",
  "#F7A8C4": "rosa",
  "#FFD37C": "giallo",
  "#C8A2FF": "lilla",
  "#7FE3F5": "azzurro",
  "#FFAE7C": "arancione",
  "#A6E3A1": "verde"
};
export const swatchLabel = (swatch: string) => `Colore ${SWATCH_NAMES[swatch] ?? swatch}`;

export function SubjectFields({
  idPrefix,
  draft,
  onChange,
  officialSemesterLabel,
  nameHint,
  collapsed,
  courseIcon,
  showStatus,
  onSubmitName,
  autoFocus
}: {
  idPrefix: string;
  draft: SubjectDraft;
  onChange: (patch: Partial<SubjectDraft>) => void;
  /** Voce «ufficiale» del semestre: il piano del corso o il periodo letto dal testo salvato. */
  officialSemesterLabel: string;
  /** Sotto il nome: avviso di doppione («Esiste già…»), se c'è. */
  nameHint?: ReactNode;
  /** «Altri dettagli» chiusi (creazione veloce). */
  collapsed: boolean;
  /** Icona del corso del catalogo (`barb:<id>`), scelta finché la persona non ne prende un'altra. */
  courseIcon?: ReactNode;
  showStatus: boolean;
  /** Invio nel nome: crea subito (creazione veloce). */
  onSubmitName?: () => void;
  autoFocus?: boolean;
}) {
  const color = safeCssColor(draft.color) || "var(--accent)";
  const chosenInk = inkOn(draft.color, DARK_INK);

  const details = (
    <div className="grid grid-cols-1 gap-3">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{SUBJECT_FORM_TEXT.icon}</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1">
          {courseIcon && draft.icon.startsWith("barb:") ? (
            <button
              type="button"
              aria-pressed
              aria-label={SUBJECT_FORM_TEXT.courseIcon}
              title={SUBJECT_FORM_TEXT.courseIcon}
              className="grid h-11 w-11 grid-cols-1 place-items-center rounded-[12px] ring-2 ring-[var(--text)]"
              style={{ background: color, color: chosenInk }}
            >
              {courseIcon}
            </button>
          ) : null}
          {SUBJECT_ICONS.map((option) => {
            const chosen = draft.icon === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={chosen}
                aria-label={SUBJECT_FORM_TEXT.iconOption(option.label)}
                title={option.label}
                onClick={() => onChange({ icon: option.id })}
                className={`grid h-11 w-11 grid-cols-1 place-items-center rounded-[12px] ${chosen ? "ring-2 ring-[var(--text)]" : "bg-[var(--surface-soft)] hover:bg-[var(--surface-strong)]"}`}
                style={chosen ? { background: color, color: chosenInk } : undefined}
              >
                <Icon name={option.id} className="h-5 w-5" />
              </button>
            );
          })}
        </div>
      </fieldset>
      {/* fieldset e non label: dentro un label il primo colore diventerebbe "il" campo e un tocco sulla scritta lo sceglierebbe. */}
      <fieldset className="min-w-0">
        <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{SUBJECT_FORM_TEXT.color}</legend>
        {/* Pulsanti da 44 px con il cerchio colorato da 32 dentro: si toccano bene senza sembrare più grandi. */}
        <div className="flex flex-wrap items-center gap-0.5">
          {SUBJECT_SWATCHES.map((swatch) => {
            const chosen = draft.color.toLowerCase() === swatch.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={swatchLabel(swatch)}
                title={swatchLabel(swatch)}
                aria-pressed={chosen}
                onClick={() => onChange({ color: swatch })}
                className="grid h-11 w-11 grid-cols-1 place-items-center rounded-full"
              >
                <span className={`h-8 w-8 rounded-full border-2 ${chosen ? "border-[var(--text)]" : "border-transparent"}`} style={{ background: swatch }} />
              </button>
            );
          })}
          <input
            type="color"
            aria-label={SUBJECT_FORM_TEXT.customColor}
            value={draft.color.startsWith("#") && draft.color.length === 7 ? draft.color : "#7CF7C8"}
            onChange={(event) => onChange({ color: event.target.value })}
            className="h-11 w-11 rounded-full border border-[var(--border)] bg-transparent p-1"
          />
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {showStatus ? (
          <Field label={SUBJECT_FORM_TEXT.status}>
            <select className={inputClass} value={draft.status} onChange={(event) => onChange({ status: event.target.value as SubjectDraft["status"] })}>
              {SUBJECT_FORM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SUBJECT_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={SUBJECT_FORM_TEXT.targetGrade}>
          <input
            className={inputClass}
            type="number"
            inputMode="numeric"
            min={18}
            max={31}
            value={draft.targetGrade}
            onChange={(event) => onChange({ targetGrade: event.target.value })}
            placeholder="Es. 28"
          />
        </Field>
      </div>
      <Field label={SUBJECT_FORM_TEXT.notes}>
        <textarea className={`${inputClass} min-h-20 py-3`} value={draft.notes} onChange={(event) => onChange({ notes: event.target.value })} placeholder="Es. Ricevimento il martedì alle 14" />
      </Field>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid gap-1.5">
        <Field label={SUBJECT_FORM_TEXT.name}>
          <input
            id={`${idPrefix}-name`}
            className={inputClass}
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder={SUBJECT_FORM_TEXT.namePlaceholder}
            autoComplete="off"
            data-autofocus={autoFocus ? true : undefined}
            aria-describedby={nameHint ? `${idPrefix}-name-hint` : undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter" && onSubmitName) {
                event.preventDefault();
                onSubmitName();
              }
            }}
          />
        </Field>
        {nameHint ? <div id={`${idPrefix}-name-hint`}>{nameHint}</div> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <HelpField label="CFU" help={SUBJECTS_HELP.cfu}>
          {(id) => (
            <input id={id} className={inputClass} type="number" inputMode="numeric" min={0} max={60} value={draft.cfu} onChange={(event) => onChange({ cfu: event.target.value })} />
          )}
        </HelpField>
        <HelpField label="Semestre" help={SUBJECTS_HELP.semester}>
          {(id) => (
            <select id={id} className={inputClass} value={draft.semester} onChange={(event) => onChange({ semester: event.target.value })}>
              <option value="ufficiale">{officialSemesterLabel}</option>
              {SEMESTER_IDS.map((semesterId) => (
                <option key={semesterId} value={semesterId}>
                  {SEMESTER_LABEL[semesterId]}
                </option>
              ))}
            </select>
          )}
        </HelpField>
      </div>
      <Field label={SUBJECT_FORM_TEXT.teacher}>
        <input className={inputClass} value={draft.teacher} onChange={(event) => onChange({ teacher: event.target.value })} placeholder="Es. Mario Rossi" autoComplete="off" />
      </Field>
      {collapsed ? (
        <details className="quiet-panel p-4">
          <summary className="cursor-pointer text-sm font-extrabold">{SUBJECT_FORM_TEXT.moreDetails}</summary>
          <div className="mt-3">{details}</div>
        </details>
      ) : (
        details
      )}
    </div>
  );
}
