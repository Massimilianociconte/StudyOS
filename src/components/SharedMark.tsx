import type { CSSProperties } from "react";
import type { SharedOrigin } from "../lib/sharing";
import { Icon } from "./Icon";

/** Etichetta "di Giulia": iniziali su un colore stabile per persona, lucchetto se in sola lettura. */
export function SharedMark({ origin, compact = false }: { origin: SharedOrigin; compact?: boolean }) {
  const firstName = origin.ownerName.trim().split(/\s+/)[0] || origin.ownerName;
  const access = origin.canEdit ? "puoi modificare" : "puoi solo vedere";
  return (
    <span
      className="inline-flex min-h-6 max-w-full shrink-0 items-center gap-1 rounded-full border border-dashed px-1 text-[11px] font-extrabold text-[var(--muted)]"
      style={{ borderColor: origin.color }}
      title={`Di ${origin.ownerName}: ${access}`}
    >
      <span
        aria-hidden
        className="grid h-4 w-4 shrink-0 grid-cols-1 place-items-center rounded-full text-[9px] font-black text-[#10131d]"
        style={{ background: origin.color }}
      >
        {origin.initials}
      </span>
      {compact ? null : <span className="min-w-0 truncate pr-0.5">di {firstName}</span>}
      {origin.canEdit ? null : <Icon name="Lock" className="h-3 w-3 shrink-0" />}
      <span className="sr-only">{`${compact ? `di ${origin.ownerName}, ` : ""}${access}`}</span>
    </span>
  );
}

/** Bordo tratteggiato nel colore della persona: distingue le schede di altri dalle proprie. */
export const sharedCardStyle = (origin: SharedOrigin): CSSProperties => ({
  borderStyle: "dashed",
  borderWidth: 1,
  borderColor: origin.color
});
