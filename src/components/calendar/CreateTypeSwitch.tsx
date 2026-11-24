// «Cosa vuoi aggiungere» in cima a ogni modulo di creazione del calendario: un solo ingresso
// («Nuovo evento») per eventi, attività, ricorrenze e vacanze. Gli altri tipi (lezione, studio, esame,
// tutto il giorno, ripetuto…) sono la tipologia e le opzioni del modulo evento.
import { EVENT_EDITOR_TEXT } from "../../lib/labels/calendar";
import { Segmented } from "../ui";

export type CreateType = "event" | "task" | "occasion" | "vacation";

const OPTIONS = [
  { id: "event", label: EVENT_EDITOR_TEXT.kindEvent, icon: "CalendarDays", title: EVENT_EDITOR_TEXT.kindEventTitle },
  { id: "task", label: EVENT_EDITOR_TEXT.kindTask, icon: "Check", title: EVENT_EDITOR_TEXT.kindTaskTitle },
  { id: "occasion", label: EVENT_EDITOR_TEXT.kindOccasion, icon: "Cake", title: EVENT_EDITOR_TEXT.kindOccasionTitle },
  { id: "vacation", label: EVENT_EDITOR_TEXT.kindVacation, icon: "Luggage", title: EVENT_EDITOR_TEXT.kindVacationTitle }
] as const satisfies readonly { id: CreateType; label: string; icon: string; title: string }[];

/** `types`: quelli che si possono scegliere qui (per esempio niente attività nel calendario di un'altra persona). */
export function CreateTypeSwitch({ value, onChange, types }: { value: CreateType; onChange: (type: CreateType) => void; types?: readonly CreateType[] }) {
  const options = types ? OPTIONS.filter((option) => types.includes(option.id)) : OPTIONS;
  return (
    <div className="grid min-w-0 gap-1.5">
      <Segmented label={EVENT_EDITOR_TEXT.kindLabel} value={value} onChange={onChange} options={options} className="justify-self-start" />
      {value === "event" ? <p className="text-xs font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.kindEventHint}</p> : null}
    </div>
  );
}
