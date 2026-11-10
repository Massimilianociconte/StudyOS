import { useEffect, useMemo, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import type { StudyGroup, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { useSharedStore } from "../store/useSharedStore";
import { useCloudSession } from "../hooks/useCloudSession";
import { usePendingShare } from "../hooks/useShareInviteLinks";
import { clearPendingShare } from "../lib/shareInvite";
import { cloudConfigured } from "../lib/cloudSyncState";
import { oneOf, useUiState } from "../lib/uiState";
import {
  SHARE_INVITE_BLOCKED,
  SHARE_INVITE_STATUS_LABEL,
  SHARE_PERMISSION_LABEL,
  SHARE_SCOPE_LABEL,
  SHARING_TAB_LABEL,
  scopesSummary
} from "../lib/labels";
import {
  SUBJECTLESS_SCOPES,
  VIEW_ONLY_SCOPES,
  initialsOf,
  inviteBlockedReason,
  knownPeople,
  ownerColor,
  shareActionErrorText,
  shareableGroups,
  type ShareAction,
  type ShareGrant,
  type ShareInviteSummary,
  type ShareOffer,
  type SharePermission,
  type ShareRequest,
  type SharedItem
} from "../lib/sharing";
import type { ShareInvitePreview } from "../lib/shareSync";
import { Button, Drawer, EmptyState, Panel, SectionTitle, Segmented, Tag } from "../components/ui";
import { Icon } from "../components/Icon";
import { ShareButton } from "../components/ShareButton";
import { InlineConfirm, InviteLoginDrawer, type LoginReason } from "../components/GroupInvite";

export const SHARING_TABS = ["mine", "received", "invites"] as const;
type SharingTab = (typeof SHARING_TABS)[number];

type ShareSync = typeof import("../lib/shareSync");

/** Esito di un'azione sul server: null se riuscita, altrimenti il testo dell'errore da mostrare accanto al pulsante. */
type Perform = (kind: ShareAction, action: (sync: ShareSync) => Promise<unknown>) => Promise<string | null>;
type Answer = (reciprocal: ShareOffer[]) => Promise<string | null>;

/** info: esito riuscito (sparisce da solo); warning: invito che non si può accettare; error: azione non riuscita. */
type Message = { tone: "info" | "warning" | "error"; text: string } | null;

const INFO_MESSAGE_MS = 10_000;

const shortDate = (iso: string) => {
  const date = parseISO(iso);
  return iso && isValid(date) ? format(date, "d MMM", { locale: it }) : "";
};

const infoClass = "flex items-start gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]";
const errorClass = "text-sm font-bold text-[var(--danger-text)]";
const alertClass = `flex items-start gap-2 rounded-[18px] bg-[var(--danger-bg)] p-3 ${errorClass}`;

function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <span aria-hidden className="grid h-10 w-10 shrink-0 grid-cols-1 place-items-center rounded-full text-sm font-black text-[#10131d]" style={{ background: ownerColor(id) }}>
      {initialsOf(name)}
    </span>
  );
}

const subjectSummary = (grant: ShareGrant, subjects: readonly Subject[]) => {
  if (SUBJECTLESS_SCOPES.has(grant.scope)) return "";
  if (!grant.subjectIds.length) return "Tutte le materie";
  const names = grant.subjectIds.map((id) => subjects.find((subject) => subject.id === id)?.name).filter(Boolean);
  if (names.length) return `Solo ${names.join(", ")}`;
  return grant.subjectIds.length === 1 ? "Solo 1 materia" : `Solo ${grant.subjectIds.length} materie`;
};

export function SharingView() {
  const session = useCloudSession();
  const me = session?.user.id ?? "";
  const pending = usePendingShare();
  const { given, received, invites, items, hiddenOwners, availability, notice, syncError } = useSharedStore(
    useShallow((state) => ({
      given: state.given,
      received: state.received,
      invites: state.invites,
      items: state.items,
      hiddenOwners: state.hiddenOwners,
      availability: state.availability,
      notice: state.notice,
      syncError: state.syncError
    }))
  );
  const { subjects, studyGroups } = useStudyStore(useShallow((state) => ({ subjects: state.subjects, studyGroups: state.studyGroups })));
  const [tab, setTab] = useUiState<SharingTab>("sharing.tab", pending ? "invites" : "mine", { scope: "tab", validate: oneOf(...SHARING_TABS) });
  const [login, setLogin] = useState<LoginReason | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // Invito aperto da link: id dell'invito (null se non si è aperto). Serve a non ripeterlo tra gli inviti
  // arrivati per email; è legato al token, quindi un invito vecchio non conta per uno nuovo.
  const [opened, setOpened] = useState<{ token: string; id: string | null } | null>(null);

  // Un invito nuovo da link (anche con la sezione già aperta) porta alla scheda Inviti.
  const pendingToken = pending?.token;
  useEffect(() => {
    if (!pendingToken) return;
    setMessage(null);
    setTab("invites");
  }, [pendingToken, setTab]);

  // L'esito di un'azione riuscita non resta a lungo: i permessi possono cambiare (anche da un'altra persona).
  // Avvisi ed errori restano finché non si fa altro. Dipende dall'oggetto, non dal testo: lo stesso
  // testo detto di nuovo riparte da capo.
  useEffect(() => {
    if (message?.tone !== "info") return;
    const timer = setTimeout(() => setMessage(null), INFO_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  // Dopo l'accesso il pannello di login non resta "aperto" nello stato: al logout non deve riaprirsi da solo.
  useEffect(() => {
    if (session) setLogin(null);
  }, [session]);

  const openedId = pending && opened?.token === pending.token ? opened.id : undefined;
  // Finché l'anteprima si carica non si sa quale invito per email sia lo stesso: compaiono dopo, senza doppioni.
  const waitingForLink = Boolean(pending) && openedId === undefined;
  const incoming = waitingForLink
    ? []
    : invites.filter((invite) => invite.ownerId !== me && invite.status === "pending" && !(pending && invite.id === openedId));
  const sent = invites.filter((invite) => invite.ownerId === me);
  const connecting = availability !== "ready" && availability !== "missing";

  /** Azione sul server (supabase-js arriva solo qui): niente messaggi di pagina, l'esito lo mostra chi l'ha chiesta. */
  const perform: Perform = async (kind, action) => {
    try {
      await action(await import("../lib/shareSync"));
      return null;
    } catch (cause) {
      return shareActionErrorText(kind, cause);
    }
  };

  const say = (text: string) => setMessage({ tone: "info", text });
  const warn = (text: string) => setMessage({ tone: "warning", text });

  const changeTab = (next: SharingTab) => {
    setMessage(null);
    setTab(next);
  };

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const sync = await import("../lib/shareSync");
      await sync.syncSharedNow();
    } catch {
      setMessage({ tone: "error", text: "Non riesco ad aggiornare: controlla la connessione e riprova." });
    } finally {
      setRefreshing(false);
    }
  };

  const answerInvite = async (invite: ShareInviteSummary, accept: boolean, reciprocal: ShareOffer[]) => {
    const failure = await perform(accept ? "accept" : "decline", (sync) =>
      accept ? sync.acceptShareInvite(invite.id, null, reciprocal) : sync.declineShareInvite(invite.id, null)
    );
    if (!failure) say(accept ? `Fatto: ora vedi ${scopesSummary(invite.offers)} di ${invite.ownerName || "questa persona"}.` : "Invito rifiutato.");
    return failure;
  };

  const header = (
    <SectionTitle
      title="Condivisione"
      subtitle="Scegli cosa mostrare ad altre persone e guarda ciò che condividono con te. Puoi cambiare o togliere i permessi quando vuoi: i tuoi dati restano tuoi."
      action={
        session && availability !== "missing" ? (
          <div className="flex flex-wrap gap-2">
            <Button icon="RotateCcw" variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? "Aggiorno…" : "Aggiorna"}
            </Button>
            <ShareButton scopes={["calendar"]} />
          </div>
        ) : null
      }
    />
  );

  if (!cloudConfigured) {
    return (
      <div>
        {header}
        <EmptyState icon="Share2" title="Condivisione non disponibile" body="Gli account non sono attivi in questa versione dell'app." />
      </div>
    );
  }

  // Senza account non c'è nulla da attendere: lo stato di disponibilità (anche "unknown") non conta.
  if (!session) {
    return (
      <div>
        {header}
        <EmptyState
          icon="Share2"
          title={pending ? "Hai un invito a condividere" : "Accedi per condividere"}
          body={
            pending
              ? "Accedi o registrati per vedere cosa ti viene condiviso e scegliere se accettare. L'invito resta salvato."
              : "Con l'account puoi mostrare calendario, appelli, attività e altro a chi vuoi, e vedere ciò che gli altri condividono con te."
          }
          action={
            <Button variant="primary" icon="UserPlus" onClick={() => setLogin(pending ? "share-invite" : "sharing")}>
              Accedi o registrati
            </Button>
          }
        />
        <InviteLoginDrawer open={login !== null} onClose={() => setLogin(null)} reason={login ?? "sharing"} />
      </div>
    );
  }

  if (availability === "missing") {
    return (
      <div>
        {header}
        <EmptyState
          icon="AlertTriangle"
          title="Condivisione non ancora attiva"
          body="Il server non ha ancora le tabelle della condivisione. Chi gestisce StudyOS deve eseguire supabase/sharing.sql nel SQL Editor di Supabase (istruzioni in supabase/README.md)."
        />
      </div>
    );
  }

  return (
    <div>
      {header}
      {notice ? (
        <div role="alert" className={`mb-4 ${alertClass}`}>
          <Icon name="AlertTriangle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" className="font-black underline" onClick={() => useSharedStore.getState().setNotice(null)}>
            Ok
          </button>
        </div>
      ) : null}
      {message ? (
        <p role={message.tone === "info" ? "status" : "alert"} className={`mb-4 ${message.tone === "info" ? infoClass : alertClass}`}>
          <Icon name={message.tone === "info" ? "Info" : "AlertTriangle"} className={`mt-0.5 h-4 w-4 shrink-0 ${message.tone === "info" ? "text-[var(--accent-ink)]" : ""}`} />
          <span className="min-w-0 flex-1">{message.text}</span>
        </p>
      ) : null}
      {connecting ? (
        <p className={`mb-4 ${infoClass}`}>
          <Icon name="Info" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
          <span>Sto collegando la condivisione al server. Se resta così, controlla la connessione: ciò che vedi potrebbe non essere aggiornato.</span>
        </p>
      ) : null}
      {syncError && !message ? <p className="mb-4 text-xs font-bold text-[var(--muted)]">Ultimo aggiornamento non riuscito: {syncError}</p> : null}

      <Segmented
        label="Schede della condivisione"
        value={tab}
        onChange={changeTab}
        className="mb-5"
        options={SHARING_TABS.map((id) => ({
          id,
          label: SHARING_TAB_LABEL[id],
          count: id === "invites" ? incoming.length + (pending ? 1 : 0) || undefined : undefined
        }))}
      />

      {tab === "mine" ? (
        <MineTab me={me} given={given} received={received} subjects={subjects} groups={studyGroups} perform={perform} onDone={say} />
      ) : tab === "received" ? (
        <ReceivedTab me={me} received={received} items={items} hiddenOwners={hiddenOwners} groups={studyGroups} perform={perform} onDone={say} />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {pending ? (
            <PendingShareCard
              key={`${me}:${pending.token}`}
              token={pending.token}
              perform={perform}
              onOpened={(id) => setOpened(id === undefined ? null : { token: pending.token, id })}
              onBlocked={warn}
              onDone={(text, accepted) => {
                say(text);
                // Dopo aver accettato si va a vedere cosa si riceve; dopo un rifiuto si resta tra gli inviti.
                if (accepted) setTab("received");
              }}
            />
          ) : null}
          {incoming.map((invite) => (
            <InviteAnswer
              key={invite.id}
              ownerId={invite.ownerId}
              ownerName={invite.ownerName}
              offers={invite.offers}
              requests={invite.requests}
              onAccept={(reciprocal) => answerInvite(invite, true, reciprocal)}
              onDecline={() => answerInvite(invite, false, [])}
            />
          ))}
          <SentInvites
            invites={sent}
            onCancel={async (id) => {
              const failure = await perform("cancel", (sync) => sync.cancelShareInvite(id));
              if (!failure) say("Invito annullato: il link non funziona più.");
              return failure;
            }}
          />
          {!pending && !incoming.length && !sent.length ? (
            <EmptyState icon="Mail" title="Nessun invito" body="Gli inviti che ricevi o che crei compariranno qui." action={<ShareButton scopes={["calendar"]} label="Crea un invito" />} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Conferma sul posto che resta aperta se l'azione fallisce, con l'errore accanto al pulsante. */
function ConfirmWithError({
  text,
  confirmLabel,
  icon,
  onCancel,
  onConfirm
}: {
  text: string;
  confirmLabel: string;
  icon: string;
  onCancel: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    const failure = await onConfirm();
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <div className="mt-2 grid grid-cols-1 gap-2">
      <InlineConfirm text={text} confirmLabel={confirmLabel} icon={icon} busy={busy} onCancel={onCancel} onConfirm={() => void confirm()} />
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MineTab({
  me,
  given,
  received,
  subjects,
  groups,
  perform,
  onDone
}: {
  me: string;
  given: ShareGrant[];
  received: ShareGrant[];
  subjects: Subject[];
  groups: StudyGroup[];
  perform: Perform;
  onDone: (text: string) => void;
}) {
  const [editing, setEditing] = useState<ShareGrant | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const byGrantee = useMemo(() => {
    const entries = new Map<string, ShareGrant[]>();
    for (const grant of given) {
      const key = grant.granteeUserId ?? `group:${grant.granteeGroupId}`;
      entries.set(key, [...(entries.get(key) ?? []), grant]);
    }
    return [...entries.entries()];
  }, [given]);
  const shareable = useMemo(() => shareableGroups(groups, me), [groups, me]);

  /**
   * Una condivisione diretta si crea solo con persone "collegate" (regola del server): se togliendo
   * questa la persona non lo è più, per condividere di nuovo serve un nuovo invito.
   */
  const needsNewInvite = (grant: ShareGrant) =>
    Boolean(grant.granteeUserId) &&
    !knownPeople(me, given.filter((entry) => entry.id !== grant.id), received, shareable).some((person) => person.userId === grant.granteeUserId);

  if (!given.length) {
    return (
      <EmptyState
        icon="Share2"
        title="Non stai condividendo nulla"
        body="Scegli cosa mostrare (ad esempio il calendario o gli appelli) e con chi: una persona o un gruppo."
        action={<ShareButton scopes={["calendar"]} />}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {byGrantee.map(([key, grants]) => {
        const first = grants[0];
        const isGroup = Boolean(first.granteeGroupId);
        const name = first.granteeName || (isGroup ? "Gruppo" : "Persona");
        return (
          <Panel key={key}>
            <div className="mb-3 flex min-w-0 items-center gap-3">
              <Avatar id={key} name={name} />
              <div className="min-w-0">
                <h3 className="safe-text text-lg font-black">{name}</h3>
                <p className="safe-text text-xs font-bold text-[var(--muted)]">{isGroup ? "Tutto il gruppo" : first.granteeEmail ?? "Persona collegata"}</p>
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-2">
              {grants.map((grant) => (
                <li key={grant.id} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black">{SHARE_SCOPE_LABEL[grant.scope]}</span>
                    <Tag>{SHARE_PERMISSION_LABEL[grant.permission]}</Tag>
                    {subjectSummary(grant, subjects) ? <Tag>{subjectSummary(grant, subjects)}</Tag> : null}
                    <span className="ml-auto flex flex-wrap gap-2">
                      <Button variant="ghost" aria-label={`Modifica ${SHARE_SCOPE_LABEL[grant.scope]} condiviso con ${name}`} onClick={() => setEditing(grant)}>
                        Modifica
                      </Button>
                      <Button
                        variant="ghost"
                        icon="X"
                        aria-label={`Smetti di condividere ${SHARE_SCOPE_LABEL[grant.scope]} con ${name}`}
                        onClick={() => setConfirmId(grant.id)}
                      >
                        Smetti
                      </Button>
                    </span>
                  </div>
                  {confirmId === grant.id ? (
                    <ConfirmWithError
                      text={`${isGroup ? `Il gruppo ${name}` : name} non vedrà più «${SHARE_SCOPE_LABEL[grant.scope]}». I tuoi dati restano dove sono.${
                        needsNewInvite(grant) ? ` Per condividere di nuovo con ${name} ti servirà un nuovo invito.` : ""
                      }`}
                      confirmLabel="Smetti di condividere"
                      icon="X"
                      onCancel={() => setConfirmId(null)}
                      onConfirm={async () => {
                        const failure = await perform("revoke", (sync) => sync.revokeShare(grant.id));
                        if (!failure) {
                          setConfirmId(null);
                          onDone(`Fatto: ${name} non vede più «${SHARE_SCOPE_LABEL[grant.scope]}».`);
                        }
                        return failure;
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
      {editing ? (
        <EditShareDrawer
          grant={editing}
          subjects={subjects}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const failure = await perform("update", (sync) => sync.updateShare(editing.id, patch));
            if (!failure) onDone("Permessi aggiornati.");
            return failure;
          }}
        />
      ) : null}
    </div>
  );
}

function EditShareDrawer({
  grant,
  subjects,
  onClose,
  onSave
}: {
  grant: ShareGrant;
  subjects: Subject[];
  onClose: () => void;
  onSave: (patch: { permission: SharePermission; subjectIds: string[] }) => Promise<string | null>;
}) {
  const [permission, setPermission] = useState<SharePermission>(grant.permission);
  const [subjectIds, setSubjectIds] = useState<string[]>(grant.subjectIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useMemo(
    () => subjects.filter((subject) => !subject.archived || grant.subjectIds.includes(subject.id)).sort((a, b) => a.name.localeCompare(b.name, "it")),
    [subjects, grant.subjectIds]
  );

  const save = async () => {
    setBusy(true);
    setError("");
    const failure = await onSave({ permission, subjectIds });
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">{grant.granteeName || "Condivisione"}</span>}
      title={SHARE_SCOPE_LABEL[grant.scope]}
      width="max-w-[560px]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="soft" onClick={onClose} disabled={busy}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>
            Salva
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5">
        {VIEW_ONLY_SCOPES.has(grant.scope) ? (
          <p className={infoClass}>Gli appelli ufficiali si condividono solo in lettura.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <span className="text-sm font-black">Cosa può fare</span>
            <Segmented
              label="Permesso"
              value={permission}
              onChange={setPermission}
              options={[
                { id: "view", label: SHARE_PERMISSION_LABEL.view, icon: "Eye" },
                { id: "edit", label: SHARE_PERMISSION_LABEL.edit }
              ]}
            />
          </div>
        )}
        {SUBJECTLESS_SCOPES.has(grant.scope) ? null : (
          <fieldset className="grid grid-cols-1 gap-1">
            <legend className="mb-1 text-sm font-black">Materie</legend>
            <p className="mb-2 text-xs font-semibold text-[var(--muted)]">Nessuna scelta = tutte le materie.</p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {active.map((subject) => (
                <label key={subject.id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={subjectIds.includes(subject.id)}
                    onChange={() =>
                      setSubjectIds((list) => (list.includes(subject.id) ? list.filter((id) => id !== subject.id) : [...list, subject.id]))
                    }
                  />
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subject.color }} />
                  <span className="min-w-0 truncate">{subject.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error ? (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

function ReceivedTab({
  me,
  received,
  items,
  hiddenOwners,
  groups,
  perform,
  onDone
}: {
  me: string;
  received: ShareGrant[];
  items: SharedItem[];
  hiddenOwners: string[];
  groups: { id: string; name: string }[];
  perform: Perform;
  onDone: (text: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const byOwner = useMemo(() => {
    const owners = new Map<string, ShareGrant[]>();
    for (const grant of received) owners.set(grant.ownerId, [...(owners.get(grant.ownerId) ?? []), grant]);
    return [...owners.entries()];
  }, [received]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const entry of items) result.set(entry.ownerId, (result.get(entry.ownerId) ?? 0) + 1);
    return result;
  }, [items]);

  if (!byOwner.length) {
    return (
      <EmptyState
        icon="Users"
        title="Nessuno condivide con te, per ora"
        body="Quando qualcuno ti manda un invito o condivide con un tuo gruppo, trovi qui i suoi dati, separati dai tuoi."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {byOwner.map(([ownerId, grants]) => {
        const name = grants[0].ownerName || "Un'altra persona";
        const hidden = hiddenOwners.includes(ownerId);
        const count = counts.get(ownerId) ?? 0;
        return (
          <Panel key={ownerId}>
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-3">
              <Avatar id={ownerId} name={name} />
              <div className="min-w-0 flex-1">
                <h3 className="safe-text text-lg font-black">{name}</h3>
                <p className="text-xs font-bold text-[var(--muted)]">{count === 1 ? "1 elemento" : `${count} elementi`}</p>
              </div>
              {/* Il testo dice lo stato attuale: niente aria-pressed (si annuncerebbe due volte), il nome dice cosa succede al tocco. */}
              <Button
                variant="soft"
                icon={hidden ? "EyeOff" : "Eye"}
                aria-label={`${hidden ? "Nascosto" : "Visibile"}: ${hidden ? "mostra" : "nascondi"} i dati di ${name} nelle tue viste`}
                onClick={() => useSharedStore.getState().toggleOwner(ownerId)}
                title="Mostra o nascondi i suoi dati nelle tue viste (solo su questo dispositivo)"
              >
                {hidden ? "Nascosto" : "Visibile"}
              </Button>
            </div>
            <ul className="grid grid-cols-1 gap-2">
              {grants.map((grant) => {
                const viaGroup = grant.granteeGroupId ? groups.find((group) => group.id === grant.granteeGroupId)?.name ?? "un tuo gruppo" : null;
                return (
                  <li key={grant.id} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black">{SHARE_SCOPE_LABEL[grant.scope]}</span>
                      <Tag>{SHARE_PERMISSION_LABEL[grant.permission]}</Tag>
                      {viaGroup ? <Tag>Con il gruppo {viaGroup}</Tag> : null}
                      {grant.granteeUserId === me ? (
                        <Button
                          variant="ghost"
                          icon="LogOut"
                          className="ml-auto"
                          aria-label={`Esci da ${SHARE_SCOPE_LABEL[grant.scope]} di ${name}`}
                          onClick={() => setConfirmId(grant.id)}
                        >
                          Esci
                        </Button>
                      ) : null}
                    </div>
                    {confirmId === grant.id ? (
                      <ConfirmWithError
                        text={`Non vedrai più «${SHARE_SCOPE_LABEL[grant.scope]}» di ${name}. Potrà invitarti di nuovo.`}
                        confirmLabel="Esci dalla condivisione"
                        icon="LogOut"
                        onCancel={() => setConfirmId(null)}
                        onConfirm={async () => {
                          const failure = await perform("leave", (sync) => sync.revokeShare(grant.id));
                          if (!failure) {
                            setConfirmId(null);
                            onDone(`Fatto: non vedi più «${SHARE_SCOPE_LABEL[grant.scope]}» di ${name}.`);
                          }
                          return failure;
                        }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function InviteAnswer({
  ownerId,
  ownerName,
  offers,
  requests,
  onAccept,
  onDecline,
  onDismiss
}: {
  ownerId: string;
  ownerName: string;
  offers: ShareOffer[];
  requests: ShareRequest[];
  onAccept: Answer;
  onDecline: () => Promise<string | null>;
  /** Solo per l'invito da link: se rispondere non riesce, si può chiudere senza rispondere. */
  onDismiss?: () => void;
}) {
  const [back, setBack] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Rifiutare è definitivo (il link non si usa più): prima una conferma, come per smettere di condividere.
  const [declining, setDeclining] = useState(false);
  const name = ownerName || "Qualcuno";

  const answer = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError("");
    const failure = await action();
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <Panel>
      <div className="flex min-w-0 items-start gap-3">
        <Avatar id={ownerId || name} name={name} />
        <div className="min-w-0 flex-1">
          <h3 className="safe-text text-lg font-black">{name} vuole condividere con te</h3>
          <ul className="mt-2 grid grid-cols-1 gap-1">
            {offers.map((offer) => (
              <li key={offer.scope} className="text-sm font-bold">
                {SHARE_SCOPE_LABEL[offer.scope]}{" "}
                <span className="text-[var(--muted)]">
                  · {SHARE_PERMISSION_LABEL[offer.permission]}
                  {offer.subjectNames.filter(Boolean).length ? ` · solo ${offer.subjectNames.filter(Boolean).join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {requests.length ? (
        <fieldset className="mt-4 grid grid-cols-1 gap-2">
          <legend className="mb-1 text-sm font-black">In cambio ti chiede (scegli tu)</legend>
          {requests.map((request) => (
            <label key={request.scope} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={back.includes(request.scope)}
                onChange={() => setBack((list) => (list.includes(request.scope) ? list.filter((scope) => scope !== request.scope) : [...list, request.scope]))}
              />
              <span className="text-sm font-bold">
                Condividi il tuo «{SHARE_SCOPE_LABEL[request.scope]}» ({SHARE_PERMISSION_LABEL[request.permission]})
              </span>
            </label>
          ))}
          <p className="text-xs font-semibold text-[var(--muted)]">Condividi tutte le materie; puoi restringere o togliere dopo, da «Condivisi da me».</p>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className={`mt-3 ${errorClass}`}>
          {error}
        </p>
      ) : null}
      {declining ? (
        <ConfirmWithError
          text={`Rifiuti l'invito di ${name}? Il link non si potrà più usare: se cambi idea, ${name} dovrà invitarti di nuovo.`}
          confirmLabel="Rifiuta l'invito"
          icon="X"
          onCancel={() => setDeclining(false)}
          onConfirm={async () => {
            const failure = await onDecline();
            if (!failure) setDeclining(false);
            return failure;
          }}
        />
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {error && onDismiss ? (
            <Button variant="ghost" disabled={busy} onClick={onDismiss}>
              Chiudi l'invito
            </Button>
          ) : null}
          <Button variant="soft" disabled={busy} aria-label={`Rifiuta l'invito di ${name}`} onClick={() => setDeclining(true)}>
            Rifiuta
          </Button>
          <Button
            variant="primary"
            icon="Check"
            disabled={busy}
            aria-label={`Accetta l'invito di ${name}`}
            onClick={() =>
              void answer(() =>
                onAccept(
                  requests
                    .filter((request) => back.includes(request.scope))
                    .map((request) => ({ scope: request.scope, permission: request.permission, subjectIds: [], subjectNames: [] }))
                )
              )
            }
          >
            Accetta
          </Button>
        </div>
      )}
    </Panel>
  );
}

type PreviewState = { kind: "loading" } | { kind: "failed"; text: string } | { kind: "ready"; preview: ShareInvitePreview };

/**
 * Invito arrivato da link o QR. Il link salvato si toglie quando si risponde e quando l'invito non
 * si può accettare (già usato, scaduto, proprio, per un altro indirizzo, link sbagliato): il motivo
 * si mostra una volta. Se l'invito non si riesce ad aprire (rete assente) resta salvato e si riprova.
 */
function PendingShareCard({
  token,
  perform,
  onOpened,
  onBlocked,
  onDone
}: {
  token: string;
  perform: Perform;
  onOpened: (inviteId: string | null | undefined) => void;
  onBlocked: (text: string) => void;
  onDone: (text: string, accepted: boolean) => void;
}) {
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    onOpened(undefined);
    void import("../lib/shareSync")
      .then((sync) => sync.previewShareInvite(token))
      .then((preview) => {
        if (!alive) return;
        const reason = inviteBlockedReason(preview);
        if (!preview || reason) {
          clearPendingShare();
          onBlocked(SHARE_INVITE_BLOCKED[reason ?? "invalid"]);
          return;
        }
        onOpened(preview.inviteId);
        setState({ kind: "ready", preview });
      })
      .catch((cause) => {
        if (!alive) return;
        onOpened(null);
        setState({ kind: "failed", text: shareActionErrorText("open", cause) });
      });
    return () => {
      alive = false;
    };
    // onOpened e onBlocked non cambiano il risultato: l'invito si rilegge solo per token o nuovo tentativo.
  }, [token, attempt]);

  if (state.kind === "loading") {
    return (
      <Panel>
        <p className="text-sm font-bold text-[var(--muted)]">Apro l'invito…</p>
      </Panel>
    );
  }

  if (state.kind === "failed") {
    return (
      <Panel>
        <p role="alert" className={errorClass}>
          {state.text}
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={clearPendingShare}>
            Chiudi l'invito
          </Button>
          <Button variant="soft" icon="RotateCcw" onClick={() => setAttempt((value) => value + 1)}>
            Riprova
          </Button>
        </div>
      </Panel>
    );
  }

  const { preview } = state;
  const answer = async (accept: boolean, reciprocal: ShareOffer[]) => {
    const failure = await perform(accept ? "accept" : "decline", (sync) =>
      accept ? sync.acceptShareInvite(preview.inviteId, token, reciprocal) : sync.declineShareInvite(preview.inviteId, token)
    );
    if (failure) return failure;
    clearPendingShare();
    onDone(accept ? `Fatto: ora vedi ${scopesSummary(preview.offers)} di ${preview.ownerName || "questa persona"}.` : "Invito rifiutato.", accept);
    return null;
  };

  return (
    <InviteAnswer
      ownerId={preview.inviteId}
      ownerName={preview.ownerName}
      offers={preview.offers}
      requests={preview.requests}
      onAccept={(reciprocal) => answer(true, reciprocal)}
      onDecline={() => answer(false, [])}
      onDismiss={clearPendingShare}
    />
  );
}

function SentInvites({ invites, onCancel }: { invites: ShareInviteSummary[]; onCancel: (id: string) => Promise<string | null> }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!invites.length) return null;

  return (
    <Panel>
      <h3 className="mb-1 text-lg font-black">Inviti che hai creato</h3>
      <p className="mb-3 text-xs font-semibold text-[var(--muted)]">
        Il link si vede solo quando lo crei: se l'hai perso, annulla l'invito e creane uno nuovo.
      </p>
      <ul className="grid grid-cols-1 gap-2">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
            <span className="min-w-0 flex-1 text-sm font-bold">
              {scopesSummary(invite.offers)}
              <span className="block text-xs text-[var(--muted)]">
                {invite.recipientEmail ?? "Con link"} · {SHARE_INVITE_STATUS_LABEL[invite.status]}
                {invite.status === "pending" && shortDate(invite.expiresAt) ? ` fino al ${shortDate(invite.expiresAt)}` : ""}
              </span>
            </span>
            {invite.status === "pending" ? (
              <Button
                variant="ghost"
                icon="X"
                aria-label={`Annulla l'invito: ${scopesSummary(invite.offers)}, ${invite.recipientEmail ?? "con link"}`}
                onClick={() => setConfirmId(invite.id)}
              >
                Annulla l'invito
              </Button>
            ) : null}
            {confirmId === invite.id ? (
              <div className="basis-full">
                <ConfirmWithError
                  text="Il link di questo invito smette di funzionare e non si può rivedere: per condividere con quella persona dovrai crearne uno nuovo."
                  confirmLabel="Sì, annulla l'invito"
                  icon="X"
                  onCancel={() => setConfirmId(null)}
                  onConfirm={async () => {
                    const failure = await onCancel(invite.id);
                    if (!failure) setConfirmId(null);
                    return failure;
                  }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
