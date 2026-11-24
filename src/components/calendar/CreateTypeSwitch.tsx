// «Cosa vuoi aggiungere» in cima a ogni modulo di creazione del calendario: un solo ingresso
// («Nuovo evento») per eventi, attività, ricorrenze e vacanze. Gli altri tipi (lezione, studio, esame,
// tutto il giorno, ripetuto…) sono la tipologia e le opzioni del modulo evento.
// Sta sempre nello stesso punto (prima riga del pannello) e la nota sotto ha un'altezza fissa: cambiando
// tipo la scelta non si sposta e i campi non saltano.
import { EVENT_EDITOR_TEXT } from "../../lib/labels/calendar";
import { Segmented } from "../ui";

export type CreateType = "event" | "task" | "occasion" | "vacation";

const OPTIONS = [
  { id: "event", label: EVENT_EDITOR_TEXT.kindEvent, icon: "CalendarDays", title: EVENT_EDITOR_TEXT.kindEventTitle },
  { id: "task", label: EVENT_EDITOR_TEXT.kindTask, icon: "Check", title: EVENT_EDITOR_TEXT.kindTaskTitle },
  { id: "occasion", label: EVENT_EDITOR_TEXT.kindOccasion, icon: "Cake", title: EVENT_EDITOR_TEXT.kindOccasionTitle },
  { id: "vacation", label: EVENT_EDITOR_TEXT.kindVacation, icon: "Luggage", title: EVENT_EDITOR_TEXT.kindVacationTitle }
] as const;

const HINT: Record<CreateType, string> = {
  event: EVENT_EDITOR_TEXT.kindEventHint,
  task: EVENT_EDITOR_TEXT.taskHint,
  occasion: EVENT_EDITOR_TEXT.kindOccasionTitle,
  vacation: EVENT_EDITOR_TEXT.kindVacationTitle
};

export function CreateTypeSwitch({
  value,
  onChange,
  types,
  autoFocus = false
}: {
  value: CreateType;
  onChange: (type: CreateType) => void;
  types?: readonly CreateType[];
  /** Il pannello ha preso il posto di un altro (cambio di tipo): il focus resta sulla scelta. */
  autoFocus?: boolean;
}) {
  const options = types ? OPTIONS.filter((option) => types.includes(option.id)) : OPTIONS;
  return (
    <div className="grid min-w-0 gap-1.5">
      <Segmented label={EVENT_EDITOR_TEXT.kindLabel} value={value} onChange={onChange} options={options} className="justify-self-start" autoFocusActive={autoFocus} />
      {/* Tre righe sul telefono, due sul computer: la nota più lunga ci sta e i campi sotto restano fermi. */}
      <p className="min-h-12 text-xs font-bold text-[var(--muted)] sm:min-h-8">{HINT[value]}</p>
    </div>
  );
}
