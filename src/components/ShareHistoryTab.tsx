import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, isValid, parseISO, startOfDay, subDays } from "date-fns";
import { it } from "date-fns/locale";
import { REVERT_TEXT, REVISION_CHANGE_LABEL, revisionListIntro, sharedEntityLabel } from "../lib/labels";
import {
  REVISION_LIST_LIMIT,
  ShareUserError,
  actorInSentence,
  canRestoreRevision,
  revertCandidates,
  revisionActorName,
  revisionTitle,
  shareActionErrorTextSafe,
  type ItemRevision,
  type RevertSummary,
  type ShareGrant
} from "../lib/sharing";
import { Button, EmptyState, Field, Panel, Tag, inputClass } from "./ui";
import { ConfirmWithError } from "./ConfirmWithError";

const TITLE_MAX = 120;

type HistoryGroup = { id: string; members: { userId: string; displayName: string }[] };

/** Titolo scritto da un'altra persona: solo testo (React lo mostra com'è), accorciato perché non riempia la pagina. */
const shownTitle = (revision: ItemRevision) => {
  const title = revisionTitle(revision).trim();
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX).trimEnd()}…` : title;
};

const whenText = (iso: string) => {
  const date = parseISO(iso);
  return isValid(date) ? format(date, "d MMM · HH:mm", { locale: it }) : "";
};

const DAY_FORMAT = "yyyy-MM-dd";

/**
 * Scheda "Modifiche di altri": cosa hanno cambiato, aggiunto o eliminato le persone con "Può modificare"
 * sui miei dati (ultimi 90 giorni), con il ripristino della versione precedente. Quelle versioni le hanno
 * scritte altri: il contenuto si mostra solo come testo e si ripristina solo se è un elemento vero.
 */
export function ShareHistoryTab({
  me,
  given,
  groups,
  onDone
}: {
  me: string;
  given: ShareGrant[];
  groups: HistoryGroup[];
  onDone: (text: string) => void;
}) {
  const [revisions, setRevisions] = useState<ItemRevision[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [restored, setRestored] = useState<ReadonlySet<number>>(new Set());
  const [reverting, setReverting] = useState(false);
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
      // L'elenco ha solo i titoli: la versione intera (e copertine e file) la prende shareSync.
      const sync = await import("../lib/shareSync");
      await sync.restoreRevision(revision);
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
    <div className="grid grid-cols-1 gap-4">
      {reverting ? (
        <RevertPanel
          people={revertCandidates(revisions, given, groups, me)}
          onClose={() => setReverting(false)}
          onReverted={(text) => {
            setReverting(false);
            setConfirmId(null);
            onDone(text);
            void load();
          }}
        />
      ) : null}
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm font-bold text-[var(--muted)]">{revisionListIntro(revisions.length, REVISION_LIST_LIMIT)}</p>
          {reverting ? null : (
            <Button variant="soft" icon="RotateCcw" onClick={() => setReverting(true)}>
              {REVERT_TEXT.open}
            </Button>
          )}
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
    </div>
  );
}

/**
 * Annulla tutte le modifiche di una persona da un giorno: prima un controllo (cosa torna, cosa resta),
 * poi la conferma. Cambiare persona o giorno toglie il controllo: si conferma solo ciò che si è letto.
 */
function RevertPanel({
  people,
  onClose,
  onReverted
}: {
  people: { id: string; name: string; label: string }[];
  onClose: () => void;
  onReverted: (text: string) => void;
}) {
  const today = useMemo(() => format(new Date(), DAY_FORMAT), []);
  const oldest = useMemo(() => format(subDays(new Date(), 90), DAY_FORMAT), []);
  const [actor, setActor] = useState(people[0]?.id ?? "");
  const [day, setDay] = useState(today);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<{ actor: string; day: string; summary: RevertSummary } | null>(null);

  const person = people.find((candidate) => candidate.id === actor);
  const who = actorInSentence(person?.name ?? "");
  const date = parseISO(day);
  const validDay = isValid(date) && day >= oldest && day <= today;
  const since = validDay ? startOfDay(date).toISOString() : "";
  const dayText = validDay ? format(date, "d MMM", { locale: it }) : "";

  const check = async () => {
    if (!actor || !validDay) return;
    setChecking(true);
    setError("");
    setPlan(null);
    try {
      const sync = await import("../lib/shareSync");
      const summary = await sync.previewRevert(actor, since);
      setPlan({ actor, day, summary });
    } catch (cause) {
      setError(shareActionErrorTextSafe("revertCheck", cause));
    } finally {
      setChecking(false);
    }
  };

  const revert = async (): Promise<string | null> => {
    try {
      const sync = await import("../lib/shareSync");
      const result = await sync.revertPersonSince(actor, since);
      onReverted(REVERT_TEXT.done(who, result.restored));
      return null;
    } catch (cause) {
      return shareActionErrorTextSafe("revert", cause);
    }
  };

  const current = plan && plan.actor === actor && plan.day === day ? plan.summary : null;
  const nothing = current && !current.toRestore && !current.added && !current.gone;

  return (
    <Panel>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-base font-black">{REVERT_TEXT.open}</h3>
        <Button variant="ghost" icon="X" onClick={onClose}>
          {REVERT_TEXT.close}
        </Button>
      </div>
      {people.length ? (
        <>
          <p className="mb-3 text-sm font-bold text-[var(--muted)]">{REVERT_TEXT.intro}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={REVERT_TEXT.person}>
              <select
                className={inputClass}
                value={actor}
                onChange={(event) => {
                  setActor(event.target.value);
                  setPlan(null);
                }}
              >
                {people.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={REVERT_TEXT.since}>
              <input
                className={inputClass}
                type="date"
                value={day}
                min={oldest}
                max={today}
                onChange={(event) => {
                  setDay(event.target.value);
                  setPlan(null);
                }}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="soft" icon="Search" onClick={() => void check()} disabled={!actor || !validDay || checking}>
              {checking ? REVERT_TEXT.checking : REVERT_TEXT.check}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          {current ? (
            nothing ? (
              <p role="status" className="mt-3 text-sm font-bold">
                {REVERT_TEXT.nothing(who, dayText)}
              </p>
            ) : current.toRestore ? (
              <ConfirmWithError
                text={REVERT_TEXT.plan(who, dayText, current)}
                confirmLabel={REVERT_TEXT.confirm}
                icon="RotateCcw"
                onCancel={() => setPlan(null)}
                onConfirm={revert}
              />
            ) : (
              <p role="status" className="safe-text mt-3 text-sm font-bold">
                {REVERT_TEXT.plan(who, dayText, current)}
              </p>
            )
          ) : null}
        </>
      ) : (
        <p className="text-sm font-bold text-[var(--muted)]">{REVERT_TEXT.noPeople}</p>
      )}
    </Panel>
  );
}
