// Etichette per riconoscere a colpo d'occhio sessioni e quiz interrotti e ripresi:
// «Da riprendere», dove è stata interrotta («Questo dispositivo» o «Da iPhone · Safari», con un
// colore diverso quando è un altro dispositivo) e «Ripresa» quando è già stata ripresa. Il testo
// completo («Interrotta ieri alle 18:30 su iPhone · Safari») è nel suggerimento e per lo screen reader.
import type { ReactNode } from "react";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { thisDevice } from "../../lib/learnDevice";
import { DEVICE_ICON, pauseText, pauseWhen, pauseWhere, resumedLabel } from "../../lib/learnResumeTag";
import type { StudyRun } from "../../types";
import { Icon } from "../Icon";

const TONE = {
  paused: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  here: "bg-[var(--surface-strong)] text-[var(--muted)]",
  away: "bg-[color-mix(in_srgb,var(--accent-2)_22%,transparent)] text-[var(--text)]",
  resumed: "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent-ink)]"
} as const;

export function Tag({ icon, tone, title, children }: { icon: string; tone: keyof typeof TONE; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-black ${TONE[tone]}`}>
      <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />
      <span className="one-line-safe">{children}</span>
    </span>
  );
}

/**
 * Una sessione o un tentativo in pausa: dove è stato interrotto e, se era già stato ripreso, quante
 * volte. `status` aggiunge «Da riprendere» (dove l'elenco non lo dice già), `when` la riga con l'ora.
 */
export function PausedTags({ run, status = false, when = false, className = "" }: { run: StudyRun; status?: boolean; when?: boolean; className?: string }) {
  const here = thisDevice();
  const where = pauseWhere(run, here);
  const full = pauseText(run, here);
  // Visibile solo il quando («Interrotta ieri alle 18:30»): il dove lo dice già l'etichetta accanto.
  const at = pauseWhen(run.progress?.at);
  const short = at ? LEARN_TEXT.pausedWhen(at, run.kind === "quiz") : "";
  const resumed = run.resumed?.count ?? 0;
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {status ? (
        <Tag icon="Pause" tone="paused" title={full || undefined}>
          {LEARN_TEXT.tagPaused}
        </Tag>
      ) : null}
      {where ? (
        <Tag icon={DEVICE_ICON[where.kind]} tone={where.here ? "here" : "away"} title={where.here ? LEARN_TEXT.tagHereHint : LEARN_TEXT.tagFromHint(where.name)}>
          {where.here ? LEARN_TEXT.tagHere : LEARN_TEXT.tagFrom(where.name)}
        </Tag>
      ) : null}
      {resumed ? (
        <Tag icon="History" tone="resumed" title={LEARN_TEXT.tagResumedTimes(resumed)}>
          {LEARN_TEXT.tagResumed}
        </Tag>
      ) : null}
      {when && short ? (
        <span title={full} className="min-w-0 text-xs font-bold text-[var(--muted)]">
          <span aria-hidden="true">{short}</span>
          <span className="sr-only">{full}</span>
        </span>
      ) : full ? (
        <span className="sr-only">{full}</span>
      ) : null}
    </span>
  );
}

/** Una sessione ripresa (in corso o già chiusa): «Ripresa» o «Ripresa da iPhone · Safari». */
export function ResumedTag({ run, detail }: { run: StudyRun; detail?: string }) {
  const label = resumedLabel(run);
  if (!label) return null;
  return (
    <Tag icon={run.resumed?.elsewhere ? "MonitorSmartphone" : "History"} tone="resumed" title={detail || label}>
      {label}
      {detail ? <span className="sr-only">{`: ${detail}`}</span> : null}
    </Tag>
  );
}
