import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import { sharedOfTypes, useSharedStore } from "../store/useSharedStore";
import { useStudyStore } from "../store/useStudyStore";
import { ownerColor, sharedBarbExams, type SharedBarbExam } from "../lib/sharing";
import { UNKNOWN_PERSON } from "../lib/labels";
import { safeHref } from "../lib/safeUrl";
import { EmptyState, Tag } from "./ui";
import { ShareButton } from "./ShareButton";

const dayLabel = (iso: string) => {
  const date = parseISO(iso);
  return Number.isNaN(date.getTime()) ? "" : format(date, "EEE d MMM yyyy", { locale: it });
};

/** Appelli ufficiali scelti dai compagni che condividono con me, con "Anche tu" su quelli in comune. */
export function SharedBarbExams() {
  const { items, received, hiddenOwners } = useSharedStore(
    useShallow((state) => ({ items: state.items, received: state.received, hiddenOwners: state.hiddenOwners }))
  );
  const events = useStudyStore((state) => state.events);
  // "Anche tu" nasce solo dai miei eventi personali, mai dai dati condivisi.
  const mine = useMemo(() => new Set(events.flatMap((event) => (event.sourceUid ? [event.sourceUid] : []))), [events]);
  const rows = useMemo(() => sharedBarbExams(sharedOfTypes({ items, hiddenOwners }, ["calendarEvent"]), mine), [items, hiddenOwners, mine]);
  // Il giorno è quello locale: con toISOString (UTC) un appello di oggi finirebbe tra i passati subito dopo la mezzanotte.
  const today = format(new Date(), "yyyy-MM-dd");
  const upcoming = rows.filter((row) => row.start.slice(0, 10) >= today);
  const past = rows.filter((row) => row.start.slice(0, 10) < today);
  const nameOf = (ownerId: string) => received.find((grant) => grant.ownerId === ownerId)?.ownerName || UNKNOWN_PERSON;

  const list = (entries: SharedBarbExam[]) => (
    <ul className="grid grid-cols-1 gap-2">
      {entries.map((row) => (
        <li key={row.sourceUid} className="quiet-panel grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[var(--muted)]">{dayLabel(row.start)}</p>
            <p className="safe-text text-sm font-extrabold">{row.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {row.ownerIds.map((ownerId) => (
                <span key={ownerId} className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-dashed px-2 text-[11px] font-extrabold" style={{ borderColor: ownerColor(ownerId) }}>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: ownerColor(ownerId) }} />
                  <span className="min-w-0 truncate">{nameOf(ownerId)}</span>
                </span>
              ))}
              {row.mine ? <Tag color="var(--accent)">Anche tu</Tag> : null}
            </div>
          </div>
          {safeHref(row.link) ? (
            <a href={safeHref(row.link)} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-[var(--accent-ink)] underline">
              Pagina ufficiale
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-[14rem] flex-1 text-sm font-bold text-[var(--muted)]">
          Gli appelli ufficiali scelti da chi condivide con te. «Anche tu» indica quelli che hai già nel tuo calendario.
        </p>
        <ShareButton scopes={["barb_exams"]} label="Condividi i tuoi appelli" />
      </div>
      {upcoming.length ? (
        list(upcoming)
      ) : (
        <EmptyState icon="CalendarDays" title="Nessun appello in arrivo" body="Quando un compagno condivide i suoi appelli o il calendario con te, trovi qui le date che ha scelto." />
      )}
      {past.length ? (
        <details className="rounded-[18px] bg-[var(--surface-soft)] p-3">
          <summary className="cursor-pointer text-sm font-black">Appelli passati ({past.length})</summary>
          <div className="mt-3">{list(past)}</div>
        </details>
      ) : null}
    </div>
  );
}
