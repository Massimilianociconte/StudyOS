// «Promemoria» in cima al pannello Notifiche: i prossimi promemoria autonomi, «Fatto», «Elimina» e
// «Aggiungi promemoria». Scattano come quelli degli eventi (lib/reminderSources).
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { Button, Field, inputClass } from "./ui";
import { DateField } from "./DatePicker";
import { STANDALONE_REMINDERS_TEXT as T } from "../lib/labels/standaloneReminders";
import { listedReminders, reminderInstant } from "../lib/standaloneReminders";
import { todayYmd } from "../lib/datePicker";
import { useStudyStore } from "../store/useStudyStore";

export function StandaloneReminders() {
  const reminders = useStudyStore((state) => state.reminders);
  const addReminder = useStudyStore((state) => state.addReminder);
  const updateReminder = useStudyStore((state) => state.updateReminder);
  const deleteReminder = useStudyStore((state) => state.deleteReminder);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(() => todayYmd());
  const [time, setTime] = useState("09:00");
  const [error, setError] = useState("");
  const list = listedReminders(reminders);

  const save = async () => {
    const text = title.trim();
    if (!text) {
      setError(T.missingTitle);
      return;
    }
    const remindAt = reminderInstant(day, time);
    if (!remindAt) {
      setError(T.badWhen);
      return;
    }
    await addReminder({ title: text.slice(0, 200), remindAt });
    setTitle("");
    setError("");
    setAdding(false);
  };

  return (
    <section className="mb-5 grid grid-cols-1 gap-2" aria-labelledby="standalone-reminders">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="standalone-reminders" className="text-xs font-black uppercase text-[var(--faint)]">
          {T.title}
        </h3>
        {adding ? null : (
          <Button variant="soft" icon="AlarmClock" onClick={() => setAdding(true)}>
            {T.add}
          </Button>
        )}
      </div>
      {adding ? (
        <form
          className="soft-panel grid grid-cols-1 gap-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={T.name}>
            <input className={inputClass} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField label={T.day} value={day} onChange={setDay} />
            <Field label={T.time}>
              <input type="time" className={inputClass} value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
          </div>
          <p role="status" aria-live="polite" className="text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {T.cancel}
            </Button>
            <Button type="submit" variant="primary" icon="Check">
              {T.save}
            </Button>
          </div>
        </form>
      ) : null}
      {list.length === 0 ? (
        <p className="text-sm font-bold text-[var(--muted)]">{T.empty}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {list.map((item) => (
            <li key={item.id} className="quiet-panel flex min-w-0 flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="safe-text text-sm font-extrabold">{item.title}</p>
                <p className="text-xs font-bold text-[var(--muted)]">{format(parseISO(item.remindAt), "EEEE d MMMM · HH:mm", { locale: it })}</p>
                {item.linkedEntityType ? <p className="text-xs text-[var(--muted)]">{T.linked(T.entity[item.linkedEntityType] ?? item.linkedEntityType)}</p> : null}
              </div>
              <Button variant="soft" icon="Check" aria-label={T.doneAria(item.title)} onClick={() => void updateReminder(item.id, { done: true })}>
                {T.done}
              </Button>
              <Button variant="ghost" icon="Trash2" aria-label={T.removeAria(item.title)} onClick={() => void deleteReminder(item.id)}>
                {T.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
