import { useCallback, useEffect, useRef, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import { REVISION_CHANGE_LABEL, revisionListIntro, sharedEntityLabel } from "../lib/labels";
import {
  REVISION_LIST_LIMIT,
  ShareUserError,
  actorInSentence,
  canRestoreRevision,
  revisionActorName,
  revisionTitle,
  shareActionErrorTextSafe,
  type ItemRevision,
  type ShareGrant
} from "../lib/sharing";
import { Button, EmptyState, Panel, Tag } from "./ui";
import { ConfirmWithError } from "./ConfirmWithError";

const TITLE_MAX = 120;

/** Titolo scritto da un'altra persona: solo testo (React lo mostra com'è), accorciato perché non riempia la pagina. */
const shownTitle = (revision: ItemRevision) => {
  const title = revisionTitle(revision).trim();
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX).trimEnd()}…` : title;
};

const whenText = (iso: string) => {
  const date = parseISO(iso);
  return isValid(date) ? format(date, "d MMM · HH:mm", { locale: it }) : "";
};

/**
 * Scheda "Modifiche di altri": cosa hanno cambiato, aggiunto o eliminato le persone con "Può modificare"
 * sui miei dati (ultimi 90 giorni), con il ripristino della versione precedente. Quelle versioni le hanno
 * scritte altri: il contenuto si mostra solo come testo e si ripristina solo se è un elemento vero.
 */
export function ShareHistoryTab({
  given,
  groups,
  onDone
}: {
  given: ShareGrant[];
  groups: { members: { userId: string; displayName: string }[] }[];
  onDone: (text: string) => void;
}) {
  const [revisions, setRevisions] = useState<ItemRevision[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [restored, setRestored] = useState<ReadonlySet<number>>(new Set());
  // Solo l'ultimo caricamento conta: uno più vecchio, o arrivato dopo aver lasciato la scheda, non sovrascrive.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const sync = await import("../lib/shareSync");
      const rows = await sync.listRevisions(REVISION_LIST_LIMIT);
      if (mine === latest.current) setRevisions(rows);
    } catch (cause) {
      if (mine !== latest.current) return;
      // Un aggiornamento fallito lascia la cronologia che c'era: si vede l'errore, non una pagina vuota.
      setRevisions((current) => current ?? []);
      setError(shareActionErrorTextSafe("history", cause));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  /** Esito del ripristino per ConfirmWithError: null se riuscito, altrimenti il testo dell'errore. `who` va in mezzo a una frase. */
  const restore = async (revision: ItemRevision, who: string): Promise<string | null> => {
    try {
      // Il controllo sull'elemento sta nel negozio (che riceve l'id della cronologia); qui si evita di arrivarci.
      if (!canRestoreRevision(revision)) throw new ShareUserError("Questo elemento non si può ripristinare.");
      await useStudyStore.getState().restoreEntity(revision.entityType, revision.payload, revision.entityId);
    } catch (cause) {
      return shareActionErrorTextSafe("restore", cause);
    }
    setConfirmId(null);
    setRestored((current) => new Set(current).add(revision.id));
    onDone(
      revision.change === "delete"
        ? `Ripristinato: «${shownTitle(revision)}» è tornato tra i tuoi dati, com'era prima che ${who} lo eliminasse.`
        : `Ripristinato: «${shownTitle(revision)}» è tornato com'era prima della modifica.`
    );
    return null;
  };

  if (revisions === null) return <p className="text-sm font-bold text-[var(--muted)]">Carico la cronologia…</p>;

  if (!revisions.length) {
    return (
      <EmptyState
        icon="History"
        title={error ? "Cronologia non disponibile" : "Nessuna modifica di altri"}
        body={error || "Quando qualcuno con «Può modificare» cambia i tuoi dati, trovi qui cosa ha fatto e puoi tornare indietro (ultimi 90 giorni)."}
        action={
          error ? (
            <Button variant="soft" icon="RotateCcw" onClick={() => void load()} disabled={loading}>
              Riprova
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-bold text-[var(--muted)]">{revisionListIntro(revisions.length, REVISION_LIST_LIMIT)}</p>
        <Button variant="ghost" icon="RotateCcw" onClick={() => void load()} disabled={loading}>
          {loading ? "Aggiorno…" : "Aggiorna"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-2">
        {revisions.map((revision) => {
          const who = revisionActorName(revision.changedBy, given, groups);
          // "Un'altra persona" apre la riga; dopo "che" o "di" si legge in minuscolo.
          const whoMid = actorInSentence(who);
          const title = shownTitle(revision);
          const when = whenText(revision.changedAt);
          const done = restored.has(revision.id);
          return (
            <li key={revision.id} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="safe-text min-w-0 flex-1 text-sm font-bold">
                  <span className="font-black">{who}</span> {REVISION_CHANGE_LABEL[revision.change]} {sharedEntityLabel(revision.entityType)} «{title}»
                  {when ? <span className="block text-xs text-[var(--muted)]">{when}</span> : null}
                </span>
                {done ? (
                  <Tag>Ripristinato</Tag>
                ) : canRestoreRevision(revision) ? (
                  <Button
                    variant="soft"
                    icon="RotateCcw"
                    aria-label={`Ripristina «${title}» com'era prima della modifica di ${whoMid}`}
                    onClick={() => setConfirmId(revision.id)}
                  >
                    Ripristina
                  </Button>
                ) : null}
              </div>
              {confirmId === revision.id && !done ? (
                <ConfirmWithError
                  text={`«${title}» torna com'era prima che ${whoMid} lo ${revision.change === "delete" ? "eliminasse" : "modificasse"}. Le modifiche successive vengono sostituite.`}
                  confirmLabel="Ripristina"
                  icon="RotateCcw"
                  onCancel={() => setConfirmId(null)}
                  onConfirm={() => restore(revision, whoMid)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
