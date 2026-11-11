// Anteprima di un evento o di un'attività al passaggio del mouse (solo con puntatore fine).
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { SharedMark } from "../SharedMark";
import { Tag } from "../ui";
import { RECURRENCE_LABEL } from "../../lib/recurrence";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../../lib/taskTimer";
import { eventMinutes, isAllDayEvent, shortDate, studyDaysLabel, subjectColor, subjectName, timeLabel } from "../../lib/selectors";
import {
  ENERGY_LABEL,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  NO_SUBJECT_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
  capitalizeFirst,
  formatMinutes
} from "../../lib/labels";
import { spanText } from "../../lib/calendarRender";
import { allDayEventLabel, eventColor } from "./shared";
import type { CalendarPreviewState, Subjects } from "./types";

export function CalendarHoverPreview({ preview, subjects }: { preview: CalendarPreviewState; subjects: Subjects }) {
  const width = 320;
  const height = preview.kind === "event" ? 200 : 240;
  const left = Math.min(Math.max(12, preview.x + 16), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(Math.max(12, preview.y + 16), Math.max(12, window.innerHeight - height - 12));
  const accent = preview.kind === "event" ? eventColor(preview.event, subjects) : subjectColor(subjects, preview.task.subjectId);
  const taskTimerRunning = preview.kind === "task" && isTaskTimerRunning(preview.task);
  const taskElapsed = preview.kind === "task" ? taskElapsedSeconds(preview.task) : 0;
  const taskCompletedLate = preview.kind === "task" && isTaskCompletedLate(preview.task);
  const range = preview.kind === "event" ? spanText(preview.event) : null;

  return (
    <aside
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] w-[min(320px,calc(100vw-24px))] rounded-[24px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] p-4 text-left shadow-soft backdrop-blur-2xl"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-start gap-3">
        <span className="mt-1 h-9 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase text-[var(--faint)]">
            {preview.kind === "event" ? EVENT_CATEGORY_LABEL[preview.event.category] : "Attività"}
          </p>
          <h4 className="two-line-safe text-base font-black">{preview.kind === "event" ? preview.event.title : preview.task.title}</h4>
        </div>
      </div>

      {preview.kind === "event" ? (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-bold text-[var(--muted)]">
            {range ? (
              // Su più giorni: il periodo, poi "Tutto il giorno" o l'orario di inizio e fine.
              <>
                {capitalizeFirst(range)} ·{" "}
                {isAllDayEvent(preview.event) ? allDayEventLabel(preview.event) : `${timeLabel(preview.event.start)}–${timeLabel(preview.event.end)}`}
              </>
            ) : (
              <>
                {capitalizeFirst(format(parseISO(preview.event.start), "EEEE d MMM", { locale: it }))} ·{" "}
                {isAllDayEvent(preview.event) ? allDayEventLabel(preview.event) : `${timeLabel(preview.event.start)}–${timeLabel(preview.event.end)} · ${formatMinutes(eventMinutes(preview.event))}`}
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {preview.event.sharedFrom ? <SharedMark origin={preview.event.sharedFrom} /> : null}
            <Tag color={accent}>{preview.event.sharedFrom ? preview.event.sharedFrom.subjectName ?? NO_SUBJECT_LABEL : subjectName(subjects, preview.event.subjectId)}</Tag>
            <Tag>{EVENT_STATUS_LABEL[preview.event.status]}</Tag>
            {preview.event.recurrence && preview.event.recurrence !== "none" ? <Tag>{RECURRENCE_LABEL[preview.event.recurrence]}</Tag> : null}
            {preview.event.category === "deadline" || preview.event.category === "exam" ? <Tag>{studyDaysLabel(preview.event.start)}</Tag> : null}
          </div>
          {preview.event.description || preview.event.notes ? (
            <p className="three-line-safe text-[var(--muted)]">{preview.event.description || preview.event.notes}</p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-bold text-[var(--muted)]">
            {preview.task.dueDate ? `${shortDate(preview.task.dueDate)} · ${timeLabel(preview.task.dueDate)}` : "Nessuna data"} ·{" "}
            {subjectName(subjects, preview.task.subjectId)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Tag color={PRIORITY_TONE[preview.task.priority]}>{PRIORITY_LABEL[preview.task.priority]}</Tag>
            <Tag>{TASK_STATUS_LABEL[preview.task.status]}</Tag>
            <Tag>{ENERGY_LABEL[preview.task.energy]}</Tag>
            <Tag>
              {formatMinutes(preview.task.estimatedMinutes)} stimati
              {taskTimerRunning ? ` · ⏱ ${formatElapsedSeconds(taskElapsed)}` : preview.task.actualMinutes !== undefined ? ` · ${preview.task.actualMinutes} min reali` : ""}
            </Tag>
            {taskCompletedLate ? <Tag className="text-[var(--warning-text)]">Completata in ritardo</Tag> : null}
          </div>
          {preview.task.description || preview.task.notes ? (
            <p className="three-line-safe text-[var(--muted)]">{preview.task.description || preview.task.notes}</p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
