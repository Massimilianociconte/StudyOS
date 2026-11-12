// Correzioni dei miei gruppi sotto un docente o un contatto ufficiale: «Corretto dal gruppo X» con i
// valori. Sono testi di altre persone: i link passano sempre da safeHref.
import { useMemo } from "react";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { overridesOf } from "../../lib/catalogOverrides";
import type { CatalogTargetKind } from "../../lib/groupExams";
import { safeHref } from "../../lib/safeUrl";
import { groupNamesOf, useGroupExamStore } from "../../store/useGroupExamStore";

/** Un valore corretto: link e email cliccabili solo se sicuri, altrimenti testo. */
export function CorrectionValue({ field, value }: { field: string; value: string }) {
  const href = field === "email" ? safeHref(`mailto:${value}`) : field === "website" || field === "url" ? safeHref(value) : undefined;
  if (!href) return <span className="safe-text">{value}</span>;
  return (
    <a className="safe-text underline decoration-[var(--accent)] underline-offset-2" href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

export function GroupCorrections({ kind, targetId }: { kind: CatalogTargetKind; targetId: string }) {
  const overrides = useGroupExamStore((state) => state.overrides);
  const groups = useGroupExamStore((state) => state.groups);
  const names = useMemo(() => groupNamesOf(groups), [groups]);
  const list = overridesOf(overrides, kind, targetId);
  if (!list.length) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-1.5">
      {list.map((item) => (
        <div key={item.id} className="rounded-[14px] bg-[var(--surface-soft)] p-2 text-xs">
          <p className="font-black text-[var(--accent-ink)]">{T.correctedBy(names.get(item.groupId) ?? "")}</p>
          <dl className="mt-1 grid grid-cols-1 gap-0.5">
            {Object.entries(item.fields).map(([field, value]) => (
              <div key={field} className="flex min-w-0 flex-wrap gap-x-1.5">
                <dt className="font-bold text-[var(--muted)]">{T.overrideField[field] ?? field}:</dt>
                <dd className="min-w-0">
                  <CorrectionValue field={field} value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
