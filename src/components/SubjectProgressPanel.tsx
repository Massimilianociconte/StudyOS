// Progressi di una materia, uguali nella scheda di Materie, nel suo dettaglio e nella scheda d'esame:
// tre indicatori distinti (avanzamento delle attività, automatico; livello di preparazione, a mano;
// stato del ripasso) e l'azione «Aggiungi al ripasso» del programma, con quanti argomenti aggiunge.
// I numeri vengono da src/lib/subjectProgress.ts. Ogni controllo sta sopra il pulsante che copre la
// scheda di Materie (`relative z-10`), così su telefono il tocco arriva al controllo e non apre la scheda.
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { HelpTip, ProgressBar } from "./ui";
import type { ActivityProgress, ReviewStatus } from "../lib/subjectProgress";
import { PROGRESS_HELP, PROGRESS_TEXT } from "../lib/labels/progress";

export interface SubjectProgressPanelProps {
  name: string;
  color: string;
  activity: ActivityProgress;
  /** Preparazione dell'esame da sostenere; `null` = nessun esame (si offre «Aggiungi l'esame»). */
  preparation: { value: number; onChange: (delta: number) => void } | null;
  onAddExam?: () => void;
  review: ReviewStatus;
  /** Programma dell'esame: quanti argomenti «Aggiungi al ripasso» aggiungerebbe e quante voci ha. */
  program?: { toAdd: number; total: number; onAdd: () => void } | null;
  onOpenTasks: () => void;
  onOpenReview: () => void;
}

const raised = "relative z-10";

/** Riga: etichetta in maiuscoletto con il «?» a sinistra, valore o controlli a destra. */
function Row({ label, help, right }: { label: string; help: { title: string; text: string; example?: string }; right: ReactNode }) {
  return (
    <div className="mb-1 flex min-h-8 items-center justify-between gap-2 text-xs font-black">
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 uppercase leading-tight text-[var(--faint)]">{label}</span>
        <span className={raised}>
          <HelpTip title={help.title} text={help.text} example={help.example} />
        </span>
      </span>
      {right}
    </div>
  );
}

/** Collegamento discreto a un'altra sezione, area di tocco di 44 px. */
function LinkButton({ label, aria, onClick }: { label: string; aria: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className={`${raised} inline-flex min-h-11 shrink-0 items-center gap-0.5 text-xs font-black text-[var(--accent-ink)] hover:underline`}
    >
      {label}
      <Icon name="ChevronRight" className="h-3.5 w-3.5" />
    </button>
  );
}

function Stepper({ name, value, onChange }: { name: string; value: number; onChange: (delta: number) => void }) {
  const step = "grid h-9 w-9 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-base font-black hover:bg-[var(--surface)] disabled:opacity-40";
  return (
    <span className={`${raised} flex shrink-0 items-center gap-1`} role="group" aria-label={PROGRESS_TEXT.preparationAria(name)}>
      <button type="button" className={step} aria-label={PROGRESS_TEXT.preparationDown(name)} disabled={value <= 0} onClick={() => onChange(-5)}>
        −
      </button>
      <span className="w-11 text-center text-sm tabular-nums" aria-live="polite">
        {value}%
      </span>
      <button type="button" className={step} aria-label={PROGRESS_TEXT.preparationUp(name)} disabled={value >= 100} onClick={() => onChange(5)}>
        +
      </button>
    </span>
  );
}

export function SubjectProgressPanel({ name, color, activity, preparation, onAddExam, review, program, onOpenTasks, onOpenReview }: SubjectProgressPanelProps) {
  const details = [
    activity.partial ? PROGRESS_TEXT.activityPartial(activity.partial) : "",
    activity.excluded ? PROGRESS_TEXT.activityExcluded(activity.excluded) : ""
  ].filter(Boolean);
  const nudge = activity.percent === 100 && preparation && preparation.value < 100;
  return (
    <div className="grid grid-cols-1 gap-3">
      <section aria-label={PROGRESS_TEXT.activity}>
        <Row
          label={PROGRESS_TEXT.activity}
          help={PROGRESS_HELP.activity}
          right={activity.percent === null ? null : <span className="shrink-0 tabular-nums">{activity.percent}%</span>}
        />
        {activity.percent === null ? (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-xs font-bold text-[var(--muted)]">
              {PROGRESS_TEXT.activityNone}
              {activity.excluded ? ` · ${PROGRESS_TEXT.activityExcluded(activity.excluded)}` : ""}
            </p>
            <LinkButton label={PROGRESS_TEXT.activityLink} aria={PROGRESS_TEXT.activityLinkAria(name)} onClick={onOpenTasks} />
          </div>
        ) : (
          <>
            <ProgressBar value={activity.percent} color={color} label={PROGRESS_TEXT.activityAria(name)} />
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-xs font-bold text-[var(--muted)]">
                {activity.percent === 100 ? PROGRESS_TEXT.activityAll : PROGRESS_TEXT.activityDone(activity.done, activity.counted)}
                {details.length ? ` · ${details.join(" · ")}` : ""}
              </p>
              <LinkButton label={PROGRESS_TEXT.activityLink} aria={PROGRESS_TEXT.activityLinkAria(name)} onClick={onOpenTasks} />
            </div>
          </>
        )}
      </section>

      <section aria-label={PROGRESS_TEXT.preparation}>
        <Row label={PROGRESS_TEXT.preparation} help={PROGRESS_HELP.preparation} right={null} />
        {preparation ? (
          // Barra e − / + sulla stessa riga: il numero si cambia accanto a ciò che mostra.
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ProgressBar value={preparation.value} color={color} label={PROGRESS_TEXT.preparationAria(name)} />
            </div>
            <Stepper name={name} value={preparation.value} onChange={preparation.onChange} />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-xs font-bold text-[var(--muted)]">{PROGRESS_TEXT.preparationNone}</p>
            {onAddExam ? (
              <button
                type="button"
                onClick={onAddExam}
                aria-label={PROGRESS_TEXT.addExamAria(name)}
                className={`${raised} inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-black text-[var(--accent-ink)] hover:underline`}
              >
                <Icon name="Plus" className="h-3.5 w-3.5" />
                {PROGRESS_TEXT.addExam}
              </button>
            ) : null}
          </div>
        )}
        {nudge ? <p className="mt-1.5 text-xs font-bold text-[var(--accent-ink)]">{PROGRESS_TEXT.preparationNudge}</p> : null}
      </section>

      <section aria-label={PROGRESS_TEXT.review}>
        <Row label={PROGRESS_TEXT.review} help={PROGRESS_HELP.review} right={null} />
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-xs font-bold text-[var(--muted)]">
            {review.total ? (
              <>
                <span className={review.due ? "text-[var(--text)]" : undefined}>{PROGRESS_TEXT.reviewDue(review.due)}</span>
                {` · ${PROGRESS_TEXT.reviewTotal(review.total)}`}
              </>
            ) : (
              PROGRESS_TEXT.reviewNone
            )}
          </p>
          {review.total ? <LinkButton label={PROGRESS_TEXT.reviewLink} aria={PROGRESS_TEXT.reviewLinkAria(name)} onClick={onOpenReview} /> : null}
        </div>
        {program && program.total ? (
          program.toAdd ? (
            // Cosa fa, quanti e dove: «Aggiungi 4 argomenti al ripasso», sotto da dove vengono e cosa succede.
            <button
              type="button"
              onClick={program.onAdd}
              aria-label={PROGRESS_TEXT.programAddAria(program.toAdd, name)}
              className={`${raised} motion-safe mt-2 flex w-full items-start gap-2.5 rounded-[18px] bg-[var(--surface-strong)] px-3.5 py-2.5 text-left hover:bg-[var(--surface)]`}
            >
              <Icon name="Brain" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span className="min-w-0">
                <span className="block text-sm font-extrabold">{PROGRESS_TEXT.programAdd(program.toAdd)}</span>
                <span className="block text-xs font-bold text-[var(--muted)]">{PROGRESS_TEXT.programAddHint}</span>
              </span>
            </button>
          ) : (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--success-text)]">
              <Icon name="CheckCheck" className="h-3.5 w-3.5" />
              {PROGRESS_TEXT.programInReview(program.total)}
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}
