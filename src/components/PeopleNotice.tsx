import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { peopleLabels } from "../lib/labels";
import { useUiState } from "../lib/uiState";
import { Button } from "./ui";
import { Icon } from "./Icon";

/**
 * Avviso una tantum dopo l'arrivo della ricerca persone: gli account sono trovabili di default.
 * Montato in AppShell (bundle iniziale): solo stato UI e sessione, mai peopleSync o supabase-js.
 * "Visto" vale per questo dispositivo (chiave di useUiState `peopleNoticeSeen`).
 */
export function PeopleNotice({ onOpenProfile }: { onOpenProfile: () => void }) {
  const session = useCloudSession();
  const [seen, setSeen] = useUiState<boolean>("peopleNoticeSeen", false, { validate: (value) => typeof value === "boolean" });
  if (!cloudConfigured || !session || seen) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[22px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm font-bold">
      <Icon name="Search" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
      <span className="min-w-[12rem] flex-1">{peopleLabels.notice}</span>
      <span className="flex shrink-0 flex-wrap gap-2">
        <Button
          variant="soft"
          icon="User"
          onClick={() => {
            setSeen(true);
            onOpenProfile();
          }}
        >
          {peopleLabels.noticeOpenProfile}
        </Button>
        <Button variant="primary" onClick={() => setSeen(true)}>
          {peopleLabels.noticeOk}
        </Button>
      </span>
    </div>
  );
}
