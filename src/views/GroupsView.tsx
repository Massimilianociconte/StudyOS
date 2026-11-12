import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroupMember, GroupResource, StudyGroup } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Drawer, Field, Panel, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { formatNotificationTime } from "../components/NotificationsPanel";
import { InlineConfirm, InviteLoginDrawer, InviteSheet, PendingInviteCard, useCloudSession, usePendingInvite, type LoginReason } from "../components/GroupInvite";
import { cloudConfigured } from "../lib/cloudSyncState";
import { GROUP_JOINED_EVENT, confirmPendingInvite, inviteCodeFromText, savePendingInvite } from "../lib/groupInvite";
import {
  acceptInviteRemote,
  adoptServerStamp,
  declineInviteRemote,
  deleteSharedGroup,
  deleteSharedResource,
  ensureSharedMailbox,
  getActor,
  joinGroupWithCode,
  logSharedActivity,
  publishGroup,
  publishResource,
  pullSharedUpdates,
  pushSharedGroup,
  pushSharedMemberRole,
  pushSharedResourcePin,
  removeSharedMember,
  type Actor
} from "../lib/groupSync";
import { safeHref } from "../lib/safeUrl";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { useLinkedUiState } from "../hooks/useLinkedUiState";
import { GROUP_FORM_TEXT, GROUP_SYNC_TEXT } from "../lib/labels/groups";
import { UnsavedPrompt } from "../components/UnsavedPrompt";
import { peopleLabels } from "../lib/labels";
import { groupInviteRecipient, isExpiredEmailInvite } from "../lib/people";
import { isReceivedInvite } from "../lib/groups";

type DetailTab = "bacheca" | "membri" | "attivita";

const RESOURCE_ICON: Record<GroupResource["kind"], string> = {
  link: "Globe",
  note: "FileText",
  file: "Paperclip",
  task: "Check"
};

const RESOURCE_LABEL: Record<GroupResource["kind"], string> = {
  link: "Link",
  note: "Nota",
  file: "File",
  task: "Attività"
};

const ROLE_LABEL: Record<GroupMember["role"], string> = {
  owner: "Proprietario",
  admin: "Amministratore",
  member: "Membro"
};

export function GroupsView() {
  const { studyGroups, groupInvites, groupResources, groupActivities } = useStudyStore();
  const [actor, setActor] = useState<Actor | null>(null);
  // Collegata: «Apri» di una notifica («Sei entrato in …») apre il gruppo anche con Gruppi già aperto.
  const [openId, setOpenId] = useLinkedUiState<string | null>("groups.open", null, { scope: "tab", validate: isNullableString });
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginReason, setLoginReason] = useState<LoginReason>("join");
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);
  const joinInputRef = useRef<HTMLInputElement>(null);
  const session = useCloudSession();
  const pendingInvite = usePendingInvite();
  const sessionUserId = session?.user.id;
  // Senza accesso i gruppi restano tuoi: per invitare o entrare in quelli degli altri serve l'account.
  const needsAccount = cloudConfigured && !session;

  // Identità e cassetta postale condivisa; si rileggono a ogni accesso o cambio di account.
  // I link/QR di invito li legge l'app all'avvio (useGroupInviteLinks), qualunque sia la sezione.
  useEffect(() => {
    void getActor().then(setActor).catch(() => undefined);
    void ensureSharedMailbox().catch(() => undefined);
  }, [sessionUserId]);

  // Ingresso completato dopo l'accesso (invito confermato prima del login): si apre il gruppo.
  useEffect(() => {
    const onJoined = (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId;
      if (!groupId) return;
      setOpenId(groupId);
      setNotice("Sei entrato nel gruppo.");
    };
    window.addEventListener(GROUP_JOINED_EVENT, onJoined);
    return () => window.removeEventListener(GROUP_JOINED_EVENT, onJoined);
  }, [setOpenId]);

  const closeLogin = useCallback(() => setLoginOpen(false), []);
  const openLogin = useCallback((reason: LoginReason) => {
    setLoginReason(reason);
    setLoginOpen(true);
  }, []);

  const myId = actor?.userId;
  // Ricevuti = indirizzati al mio account (recipient_user_id, supabase/people.sql). Con «diverso da me»
  // comparivano, da disconnessi (id del dispositivo), gli inviti che avevo MANDATO io, con «Accetta» e
  // «Rifiuta» funzionanti. Un vecchio invito per email mai legato a un account non si può accettare:
  // non si mostra (e il pull lo toglie).
  const myAccountId = session ? myId : undefined;
  const received = myAccountId
    ? groupInvites
        .filter((invite) => invite.status === "pending" && isReceivedInvite(invite, myAccountId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const open = openId ? studyGroups.find((group) => group.id === openId) ?? null : null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await pullSharedUpdates();
    } finally {
      setRefreshing(false);
    }
  };

  const join = async () => {
    if (!actor || joinBusy) return;
    setNotice("");
    // Vale il codice, il link o anche l'intero messaggio d'invito incollato.
    const code = inviteCodeFromText(joinCode);
    if (!code) {
      setNotice("Non riconosco questo codice. Incolla il link che hai ricevuto o un codice come GRP-AB12-CD34.");
      return;
    }
    if (cloudConfigured && !session) {
      // Senza accesso: l'invito resta in attesa e si entra appena si accede o ci si registra.
      savePendingInvite(code);
      confirmPendingInvite();
      setJoinCode("");
      openLogin("join");
      return;
    }
    setJoinBusy(true);
    try {
      const groupId = await joinGroupWithCode(code, actor);
      setJoinCode("");
      setOpenId(groupId);
      setNotice("Sei entrato nel gruppo.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Non è stato possibile entrare nel gruppo. Controlla il codice e riprova.");
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Gruppi"
        subtitle="Studia con i tuoi compagni: condividete appunti, link e file."
        action={
          session || studyGroups.length ? (
            <div className="flex flex-wrap gap-2">
              {/* Aggiornare serve solo con l'account (senza, non c'è niente da scaricare). */}
              {session ? (
                <Button icon="RotateCcw" variant="ghost" onClick={() => void refresh()} disabled={refreshing} title="Scarica le ultime novità dei tuoi gruppi">
                  {refreshing ? "Aggiorno…" : "Aggiorna"}
                </Button>
              ) : null}
              {/* Senza gruppi la scelta "crea o entra" è già al centro della pagina. */}
              {studyGroups.length ? (
                <Button icon="Plus" variant="primary" onClick={() => setCreateOpen(true)}>
                  Nuovo gruppo
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {notice ? (
        <p role="status" className="mb-4 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
          {notice}
        </p>
      ) : null}

      {needsAccount && !pendingInvite ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="min-w-0 flex-1 text-sm font-bold text-[var(--muted)]">Per invitare altre persone o entrare nei loro gruppi devi accedere al tuo account.</p>
          <Button variant="soft" icon="LogIn" onClick={() => openLogin("share")}>
            Accedi
          </Button>
        </div>
      ) : null}

      <PendingInviteCard
        onLogin={() => openLogin("join")}
        onJoined={(groupId, name) => {
          setOpenId(groupId);
          setNotice(`Benvenuto in "${name}".`);
        }}
      />

      {received.length ? (
        <section aria-label="Inviti ricevuti" className="mb-5">
          <h3 className="mb-2 px-1 text-xs font-black uppercase text-[var(--accent-ink)]">Inviti ricevuti · {received.length}</h3>
          <ul className="grid grid-cols-1 gap-2">
            {received.map((invite) => (
              <InviteCard key={invite.id} inviteId={invite.id} actor={actor} onDone={setNotice} />
            ))}
          </ul>
        </section>
      ) : null}

      {studyGroups.length === 0 ? (
        <Panel>
          <div className="mx-auto max-w-md py-6 text-center">
            <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-super bg-[var(--surface-strong)]">
              <Icon name="Users" className="h-7 w-7 text-[var(--accent-ink)]" />
            </span>
            <h3 className="text-2xl font-black">Ancora nessun gruppo</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">Crea un gruppo e invita i tuoi compagni, oppure entra nel gruppo di qualcun altro.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button icon="Plus" variant="primary" onClick={() => setCreateOpen(true)}>
                Crea un gruppo
              </Button>
              <Button icon="LogIn" variant="soft" onClick={() => joinInputRef.current?.focus()}>
                Entra con un codice
              </Button>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">Hai ricevuto un link o un QR? Aprilo e ti porteremo direttamente al gruppo.</p>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {studyGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              myId={myId}
              resources={groupResources.filter((r) => r.groupId === group.id)}
              onOpen={() => setOpenId(group.id)}
              onInvite={actor ? () => setInviteGroupId(group.id) : undefined}
            />
          ))}
        </div>
      )}

      <Panel className="mt-5">
        <h3 className="text-lg font-black">Entra con un codice</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">Incolla il codice o il link di invito che ti hanno mandato.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            ref={joinInputRef}
            className={inputClass}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void join();
            }}
            placeholder="Es. GRP-AB12-CD34"
            aria-label="Codice o link di invito"
            autoCapitalize="characters"
            autoComplete="off"
          />
          <Button icon="LogIn" variant="soft" onClick={() => void join()} disabled={joinBusy || !actor}>
            {joinBusy ? "Controllo…" : "Entra nel gruppo"}
          </Button>
        </div>
      </Panel>

      {createOpen && actor ? (
        <CreateGroupModal
          actor={actor}
          needsAccount={needsAccount}
          onLogin={() => {
            setCreateOpen(false);
            openLogin("share");
          }}
          onClose={() => setCreateOpen(false)}
          onCreated={setOpenId}
        />
      ) : null}
      {open ? <GroupDetail group={open} actor={actor} onClose={() => setOpenId(null)} onNotice={setNotice} onLogin={() => openLogin("share")} /> : null}
      {inviteGroupId && actor && studyGroups.some((group) => group.id === inviteGroupId) ? (
        <InviteSheet
          group={studyGroups.find((group) => group.id === inviteGroupId)!}
          actor={actor}
          onClose={() => setInviteGroupId(null)}
          onNotice={setNotice}
          onLogin={() => openLogin("share")}
        />
      ) : null}
      <InviteLoginDrawer open={loginOpen} onClose={closeLogin} reason={loginReason} />
    </div>
  );
}

function GroupCard({ group, myId, resources, onOpen, onInvite }: { group: StudyGroup; myId?: string; resources: GroupResource[]; onOpen: () => void; onInvite?: () => void }) {
  const pinned = resources.filter((r) => r.pinned).length;
  const role = myId ? group.members.find((m) => m.userId === myId)?.role : undefined;
  return (
    <div className="quiet-panel motion-safe flex min-w-0 flex-col hover:-translate-y-0.5 hover:bg-[var(--surface)]">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded-[inherit] p-4 pb-2 text-left">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
            <Icon name="Users" className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="two-line-safe block text-base font-black leading-snug">{group.name}</span>
            <span className="mt-0.5 block text-xs font-bold text-[var(--muted)]">
              {group.members.length} {group.members.length === 1 ? "membro" : "membri"}
              {pinned ? ` · ${pinned} ${pinned === 1 ? "fissato" : "fissati"} in bacheca` : ""}
            </span>
          </span>
          {role ? <Tag>{ROLE_LABEL[role]}</Tag> : null}
        </div>
        {group.description ? <p className="two-line-safe mt-2 text-xs text-[var(--muted)]">{group.description}</p> : null}
      </button>
      {onInvite ? (
        <div className="flex justify-end px-3 pb-3">
          <Button variant="soft" icon="UserPlus" onClick={onInvite} aria-label={`Invita nel gruppo ${group.name}`}>
            Invita
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function InviteCard({ inviteId, actor, onDone }: { inviteId: string; actor: Actor | null; onDone: (text: string) => void }) {
  const groupInvites = useStudyStore((state) => state.groupInvites);
  const invite = groupInvites.find((item) => item.id === inviteId);
  const [busy, setBusy] = useState(false);
  if (!invite) return null;
  // Rispondere vale solo sul server: senza account non c'è niente da accettare.
  const canAnswer = Boolean(actor?.email);

  /**
   * Il server decide; qui si segue la sua risposta. Rete assente = l'invito resta in attesa (prima
   * diventava «accettato» solo su questo dispositivo, senza entrare davvero nel gruppo).
   */
  const answer = async (choice: "accept" | "decline") => {
    if (!actor?.email || busy) return;
    setBusy(true);
    try {
      // Senza nome: profileName() vuoto, il server usa il nome del profilo online o «Studente», mai l'email.
      const outcome = choice === "accept" ? await acceptInviteRemote(invite.id) : await declineInviteRemote(invite.id);
      const store = useStudyStore.getState();
      if (outcome === "unavailable") {
        onDone(GROUP_SYNC_TEXT.offlineAnswer);
        return;
      }
      if (outcome === "other-account") {
        onDone(GROUP_SYNC_TEXT.otherAccount);
        return;
      }
      if (outcome === "not-found") {
        await store.settleGroupInvite(invite.id, "withdrawn");
        onDone(GROUP_SYNC_TEXT.inviteGone);
        return;
      }
      // Accettato qui o già risposto altrove: il pull porta gruppo, membri e stato vero dell'invito.
      await pullSharedUpdates();
      if (outcome === "handled") {
        const joined = useStudyStore.getState().studyGroups.find((group) => group.id === invite.groupId && group.members.some((member) => member.userId === actor.userId));
        await store.settleGroupInvite(invite.id, joined ? "accepted" : "declined");
        onDone(joined ? GROUP_SYNC_TEXT.alreadyMember(invite.groupName) : GROUP_SYNC_TEXT.alreadyAnswered);
        return;
      }
      await store.settleGroupInvite(invite.id, choice === "accept" ? "accepted" : "declined");
      onDone(choice === "accept" ? GROUP_SYNC_TEXT.welcome(invite.groupName) : GROUP_SYNC_TEXT.declined);
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : GROUP_SYNC_TEXT.offlineAnswer);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="soft-panel flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-super bg-[var(--surface-strong)]">
        <Icon name="Mail" className="h-5 w-5 text-[var(--accent-ink)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="safe-text block text-sm font-extrabold">{invite.groupName}</span>
        <span className="safe-text mt-0.5 block text-xs text-[var(--muted)]">
          Invito di {invite.fromDisplayName}
          {invite.groupDescription ? ` · ${invite.groupDescription}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 gap-2">
        <Button variant="primary" icon="Check" onClick={() => void answer("accept")} disabled={busy || !canAnswer} title={canAnswer ? undefined : GROUP_SYNC_TEXT.needsAccount}>
          Accetta
        </Button>
        <Button variant="soft" onClick={() => void answer("decline")} disabled={busy || !canAnswer} title={canAnswer ? undefined : GROUP_SYNC_TEXT.needsAccount}>
          Rifiuta
        </Button>
      </span>
    </li>
  );
}

function CreateGroupModal({ actor, needsAccount, onLogin, onClose, onCreated }: { actor: Actor; needsAccount: boolean; onLogin: () => void; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Chiusura in attesa della risposta a «Scartare le modifiche?».
  const [asking, setAsking] = useState(false);
  const dirty = Boolean(name.trim() || description.trim());
  const requestClose = () => {
    if (busy) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  const save = async () => {
    if (busy) return;
    setAsking(false);
    if (!name.trim()) {
      setError("Dai un nome al gruppo per continuare.");
      return;
    }
    setBusy(true);
    try {
      const store = useStudyStore.getState();
      const id = await store.createStudyGroup({ name, description }, actor);
      const group = useStudyStore.getState().studyGroups.find((g) => g.id === id);
      if (group) {
        // Gruppo e riga del proprietario insieme; se il server non risponde si riprova da soli dopo.
        if (await publishGroup(group)) await logSharedActivity(id, actor.displayName, "ha creato il gruppo").catch(() => undefined);
        else await useStudyStore.getState().logGroupActivity(id, actor.displayName, "ha creato il gruppo").catch(() => undefined);
      }
      onCreated(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile creare il gruppo. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  // Drawer (portal, pila, focus trap, Indietro) come Invita: niente finestra fatta a mano.
  return (
    <Drawer
      open
      onClose={requestClose}
      eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">{GROUP_FORM_TEXT.createEyebrow}</span>}
      title={GROUP_FORM_TEXT.createTitle}
      width="max-w-[560px]"
      footer={
        asking ? (
          <UnsavedPrompt
            title={GROUP_FORM_TEXT.unsavedTitle}
            text={GROUP_FORM_TEXT.unsavedCreateText}
            keep={GROUP_FORM_TEXT.unsavedKeep}
            discard={GROUP_FORM_TEXT.unsavedDiscard}
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              onClose();
            }}
          />
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>{busy ? "Creazione…" : "Crea gruppo"}</Button>
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3">
        {/* Un gruppo creato senza account non si potrà mai condividere: lo si dice prima. */}
        {needsAccount ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
            <p className="min-w-0 flex-1 text-sm font-bold text-[var(--muted)]">
              Non hai fatto l'accesso: potrai usare il gruppo solo tu e non potrai invitare nessuno, nemmeno accedendo dopo.
            </p>
            <Button variant="soft" icon="LogIn" onClick={onLogin} disabled={busy}>
              Accedi prima
            </Button>
          </div>
        ) : null}
        <Field label="Nome del gruppo">
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Fisiologia — sessione estiva" data-autofocus />
        </Field>
        <Field label="Descrizione (facoltativa)">
          <textarea className={`${inputClass} min-h-20 py-3`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Es. Corso, obiettivi, regole del gruppo" />
        </Field>
        {error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
      </div>
    </Drawer>
  );
}

function GroupDetail({ group, actor, onClose, onNotice, onLogin }: { group: StudyGroup; actor: Actor | null; onClose: () => void; onNotice: (text: string) => void; onLogin: () => void }) {
  const { groupResources, groupActivities, groupInvites } = useStudyStore();
  const [tab, setTab] = useUiState<DetailTab>("groups.detailTab", "bacheca", { scope: "tab", validate: oneOf("bacheca", "membri", "attivita") });
  const [resourceOpen, setResourceOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const resources = useMemo(
    () => groupResources.filter((r) => r.groupId === group.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)),
    [groupResources, group.id]
  );
  const activities = useMemo(
    () => groupActivities.filter((a) => a.groupId === group.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
    [groupActivities, group.id]
  );
  const sentInvites = groupInvites.filter((i) => i.groupId === group.id && i.status === "pending");
  const myRole = actor ? group.members.find((m) => m.userId === actor.userId)?.role : undefined;
  const isOwner = myRole === "owner";
  // Esiti delle azioni sui membri: qui dentro, non nel messaggio della pagina coperto dal pannello.
  const [memberNotice, setMemberNotice] = useState("");

  return (
    <Drawer
      open
      onClose={onClose}
      title={group.name}
      eyebrow={
        <>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)] text-[#10131d]">
            <Icon name="Users" className="h-5 w-5" />
          </span>
          <Tag>{group.members.length} {group.members.length === 1 ? "membro" : "membri"}</Tag>
          {myRole ? <Tag>{ROLE_LABEL[myRole]}</Tag> : null}
        </>
      }
      footer={<GroupDetailFooter group={group} actor={actor} isOwner={isOwner} onClose={onClose} onNotice={onNotice} />}
    >
      {group.description ? <p className="safe-text mb-4 text-sm text-[var(--muted)]">{group.description}</p> : null}
      {actor ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] p-3">
          <p className="min-w-0 text-sm font-bold">
            Invita i tuoi compagni
            <span className="block text-xs font-bold text-[var(--muted)]">Manda un link su WhatsApp, mostra un QR o comunica il codice.</span>
          </p>
          <Button variant="primary" icon="UserPlus" onClick={() => setInviteOpen(true)}>
            Invita
          </Button>
        </div>
      ) : null}
      {/* L'id "attivita" resta per lo stato salvato; l'etichetta è "Cronologia" per non confonderla con le attività da fare. */}
      <Segmented label="Sezioni del gruppo" size="sm" className="justify-self-start" value={tab} onChange={setTab}
        options={[{ id: "bacheca", label: "Bacheca" }, { id: "membri", label: "Membri" }, { id: "attivita", label: "Cronologia" }]} />

      {tab === "bacheca" ? (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-black">Visibile a tutti i membri</h4>
            <Button variant="soft" icon="Plus" onClick={() => setResourceOpen(true)} disabled={!actor} aria-label="Aggiungi alla bacheca">Aggiungi</Button>
          </div>
          {resources.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]">La bacheca è vuota. Aggiungi un link, una nota o un file da condividere con il gruppo.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {resources.map((resource) => (
                <ResourceRow key={resource.id} resource={resource} canManage={isOwner || resource.addedByUserId === actor?.userId} shared={Boolean(group.sharedAt)} />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "membri" ? (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-black">Chi studia qui</h4>
            <Button variant="soft" icon="UserPlus" onClick={() => setInviteOpen(true)} disabled={!actor}>Invita</Button>
          </div>
          {memberNotice ? (
            <p role="status" className="mb-3 rounded-[14px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
              {memberNotice}
            </p>
          ) : null}
          <ul className="grid grid-cols-1 gap-2">
            {group.members.map((member) => (
              <MemberRow key={member.userId} group={group} member={member} isOwner={isOwner} actor={actor} onClose={onClose} onNotice={setMemberNotice} onLeft={onNotice} />
            ))}
          </ul>
          <details className="quiet-panel mt-3 p-3">
            <summary className="cursor-pointer text-sm font-extrabold">Cosa può fare ogni ruolo?</summary>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-[var(--muted)]">
              <li><strong>Proprietario</strong>: ha creato il gruppo. Sceglie i ruoli, può togliere persone e contenuti dalla bacheca ed eliminare il gruppo.</li>
              <li><strong>Amministratore</strong>: {peopleLabels.adminRoleHint}</li>
              <li><strong>Membro</strong>: aggiunge link, note e file in bacheca e invita altri con link, QR o codice.</li>
            </ul>
          </details>
          {sentInvites.length ? (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">{peopleLabels.sentInvitesTitle(sentInvites.length)}</h4>
              <ul className="grid grid-cols-1 gap-1.5">
                {sentInvites.map((invite) => {
                  // Invito per email di prima, non legato a nessun account: non si può più accettare.
                  const expired = isExpiredEmailInvite(invite);
                  return (
                    <li key={invite.id} className="flex min-w-0 items-start gap-2 rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-xs">
                      <Icon name={expired ? "AlertTriangle" : "Mail"} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block font-bold">{groupInviteRecipient(invite)}</span>
                        {expired ? <span className="block text-[var(--muted)]">{peopleLabels.expiredEmailInvite}</span> : null}
                      </span>
                      <span className="shrink-0 font-black text-[var(--muted)]">{expired ? peopleLabels.expired : peopleLabels.waiting}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "attivita" ? (
        <ul className="mt-4 grid grid-cols-1 gap-1.5">
          {activities.length === 0 ? (
            <li className="rounded-[14px] border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]">Cronologia vuota: qui vedrai chi entra nel gruppo e cosa viene aggiunto in bacheca.</li>
          ) : activities.map((activity) => (
            <li key={activity.id} className="flex min-w-0 items-start gap-2 rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-xs">
              <Icon name="History" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
              <span className="min-w-0"><strong>{activity.actorDisplayName}</strong> {activity.text}
                <span className="block text-[var(--faint)]">{formatNotificationTime(activity.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {resourceOpen && actor ? <ResourceModal group={group} actor={actor} onClose={() => setResourceOpen(false)} /> : null}
      {inviteOpen && actor ? <InviteSheet group={group} actor={actor} onClose={() => setInviteOpen(false)} onNotice={onNotice} onLogin={onLogin} /> : null}
    </Drawer>
  );
}

function ResourceRow({ resource, canManage, shared }: { resource: GroupResource; canManage: boolean; shared: boolean }) {
  const store = useStudyStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // In un gruppo condiviso decide il server: prima la scrittura lì, poi qui. Un errore lasciava una
  // copia diversa su questo dispositivo (fissata solo qui, eliminata solo qui e poi ricomparsa).
  const published = shared && Boolean(resource.sharedAt);

  const togglePin = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const pinned = published ? await pushSharedResourcePin({ ...resource, pinned: !resource.pinned, updatedAt: new Date().toISOString() }) : null;
      if (published && !pinned) {
        setError(GROUP_SYNC_TEXT.pinFailed);
        return;
      }
      await store.toggleResourcePin(resource.id);
      // Il timbro del server, non quello di questo dispositivo (vedi adoptServerStamp).
      if (pinned) await adoptServerStamp("groupResources", resource.id, pinned.stamp);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (published && !(await deleteSharedResource(resource.id))) {
        setError(GROUP_SYNC_TEXT.deleteResourceFailed);
        return;
      }
      await store.deleteGroupResource(resource.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`quiet-panel min-w-0 p-3 ${resource.pinned ? "ring-1 ring-[var(--accent)]" : ""}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-strong)]">
          <Icon name={RESOURCE_ICON[resource.kind]} className="h-4 w-4 text-[var(--accent-ink)]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="safe-text text-sm font-extrabold">
            {resource.pinned ? <Icon name="Pin" className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-[var(--accent-ink)]" /> : null}
            {resource.title}
          </p>
          {resource.url ? (
            <a href={safeHref(resource.url)} target="_blank" rel="noreferrer" className="block truncate text-xs font-bold text-[var(--accent-ink)] underline">
              {resource.url}
            </a>
          ) : null}
          {resource.body ? <p className="safe-text mt-0.5 whitespace-pre-line text-xs text-[var(--muted)]">{resource.body}</p> : null}
          <p className="mt-1 text-[11px] font-bold text-[var(--faint)]">{RESOURCE_LABEL[resource.kind]} · aggiunto da {resource.addedByDisplayName}</p>
          {shared && !resource.sharedAt ? <p className="mt-1 text-[11px] font-bold text-[var(--muted)]">{GROUP_SYNC_TEXT.notPublished}</p> : null}
          {error ? <p role="alert" className="mt-1 text-xs font-bold text-[var(--danger-text)]">{error}</p> : null}
        </div>
        {canManage ? (
          // Cerchi da 32 px con area di tocco da 44 (after:-inset-1.5); gap-3 = le due aree non si sovrappongono.
          <span className="flex shrink-0 gap-3">
            <button type="button" onClick={() => void togglePin()} disabled={busy} aria-label={resource.pinned ? "Togli dai fissati" : "Fissa in alto"} title={resource.pinned ? "Togli dai fissati" : "Fissa in alto"}
              className={`relative grid h-8 w-8 grid-cols-1 place-items-center rounded-full after:absolute after:-inset-1.5 after:content-[''] ${resource.pinned ? "bg-[var(--accent)] text-[#10131d]" : "hover:bg-[var(--surface-strong)]"}`}>
              <Icon name="Pin" className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Elimina "${resource.title}" dalla bacheca`} title="Elimina dalla bacheca" className="relative grid h-8 w-8 grid-cols-1 place-items-center rounded-full text-[var(--danger-text)] after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--danger-bg)]">
              <Icon name="Trash2" className="h-4 w-4" />
            </button>
          </span>
        ) : null}
      </div>
      {confirmDelete ? (
        <div className="mt-3">
          <InlineConfirm
            text={`Eliminare "${resource.title}" dalla bacheca? Sparirà per tutti i membri e non si può annullare.`}
            confirmLabel="Elimina dalla bacheca"
            icon="Trash2"
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => void remove()}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Uscire o eliminare un gruppo: per un gruppo condiviso prima il server, poi la copia qui. Se il server
 * non risponde non si tocca nulla e lo si dice (prima il gruppo spariva solo qui e poi ricompariva).
 */
const leaveGroup = async (group: StudyGroup, me: Pick<GroupMember, "userId" | "displayName">): Promise<{ ok: boolean; text: string }> => {
  const store = useStudyStore.getState();
  const owner = group.ownerId === me.userId;
  if (group.sharedAt) {
    if (owner) {
      if (!(await deleteSharedGroup(group.id))) return { ok: false, text: GROUP_SYNC_TEXT.deleteGroupFailed };
    } else {
      // «ha lasciato il gruppo» lo scrive il server (trigger studyos_group_member_left di groups.sql), solo
      // se l'uscita riesce: scritta da qui prima di uscire restava anche quando l'uscita falliva.
      if (!(await removeSharedMember(group.id, me.userId))) return { ok: false, text: GROUP_SYNC_TEXT.leaveFailed };
    }
  } else if (owner) {
    // Mai confermato come pubblicato: se il server l'ha comunque, si prova a toglierlo anche lì.
    void deleteSharedGroup(group.id).catch(() => undefined);
  }
  // Chi esce non tiene una copia del gruppo (bacheca e cronologia comprese).
  await store.deleteStudyGroup(group.id);
  return { ok: true, text: owner ? `Gruppo "${group.name}" eliminato.` : `Hai lasciato il gruppo "${group.name}".` };
};

function MemberRow({ group, member, isOwner, actor, onClose, onNotice, onLeft }: { group: StudyGroup; member: GroupMember; isOwner: boolean; actor: Actor | null; onClose: () => void; onNotice: (text: string) => void; onLeft: (text: string) => void }) {
  const store = useStudyStore();
  const myId = actor?.userId;
  const isSelf = member.userId === myId;
  const canRemove = isOwner && !isSelf;
  const [busy, setBusy] = useState(false);

  const changeRole = async (role: GroupMember["role"]) => {
    if (busy) return;
    setBusy(true);
    try {
      // Prima il ruolo sul server, poi il gruppo (il cui aggiornamento avvisa gli altri): al contrario un
      // pull arrivato in mezzo rimetteva il ruolo vecchio ovunque.
      if (group.sharedAt && !(await pushSharedMemberRole(group.id, member.userId, role))) {
        onNotice(GROUP_SYNC_TEXT.roleFailed(member.displayName));
        return;
      }
      await store.updateStudyGroup(group.id, { members: group.members.map((m) => (m.userId === member.userId ? { ...m, role } : m)) });
      const updated = useStudyStore.getState().studyGroups.find((g) => g.id === group.id);
      if (updated && group.sharedAt) await pushSharedGroup(updated);
    } finally {
      setBusy(false);
    }
  };

  const [confirm, setConfirm] = useState<"remove" | "leave" | null>(null);

  const remove = async () => {
    setConfirm(null);
    if (busy) return;
    setBusy(true);
    try {
      if (group.sharedAt && !(await removeSharedMember(group.id, member.userId))) {
        onNotice(GROUP_SYNC_TEXT.removeFailed(member.displayName));
        return;
      }
      // In un gruppo condiviso «ha tolto … dal gruppo» lo scrive il server (trigger studyos_group_member_left):
      // la tabella dei membri non manda eventi, la voce in cronologia avvisa subito gli altri membri.
      await store.updateStudyGroup(group.id, { members: group.members.filter((m) => m.userId !== member.userId) });
      onNotice(GROUP_SYNC_TEXT.removedMember(member.displayName));
    } finally {
      setBusy(false);
    }
  };

  const askLeave = () => {
    if (member.role === "owner") {
      if (group.members.length > 1) {
        onNotice("Sei il proprietario: puoi eliminare il gruppo quando sei l'unico membro rimasto.");
        return;
      }
    }
    setConfirm("leave");
  };

  const leave = async () => {
    setConfirm(null);
    if (busy) return;
    setBusy(true);
    try {
      const result = await leaveGroup(group, member);
      if (!result.ok) {
        onNotice(result.text);
        return;
      }
      const lastOwner = group.members.length === 1 && group.ownerId === member.userId;
      onLeft(lastOwner ? "Gruppo eliminato: eri l'unico membro." : result.text);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="quiet-panel min-w-0 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-black">
          {member.displayName.split(" ").slice(0, 2).map((part) => part[0]).join("") || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="one-line-safe block text-sm font-extrabold">{member.displayName}{isSelf ? " (tu)" : ""}</span>
          <span className="one-line-safe block text-xs text-[var(--muted)]">{ROLE_LABEL[member.role]}</span>
        </span>
        {isOwner && !isSelf ? (
          <select
            className="min-h-11 shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 text-xs font-black"
            value={member.role}
            onChange={(event) => void changeRole(event.target.value as GroupMember["role"])}
            disabled={busy}
            aria-label={`Ruolo di ${member.displayName}`}
            title="Cambia ruolo"
          >
            <option value="member">Membro</option>
            <option value="admin">Amministratore</option>
          </select>
        ) : null}
        {canRemove ? (
          <button type="button" onClick={() => setConfirm("remove")} aria-label={`Togli ${member.displayName} dal gruppo`} title="Togli dal gruppo" className="relative grid h-8 w-8 shrink-0 grid-cols-1 place-items-center rounded-full text-[var(--danger-text)] after:absolute after:-inset-1.5 after:content-[''] hover:bg-[var(--danger-bg)]">
            <Icon name="X" className="h-4 w-4" />
          </button>
        ) : null}
        {isSelf && !isOwner ? (
          <button type="button" onClick={askLeave} className="min-h-11 shrink-0 rounded-full px-3 text-xs font-black text-[var(--muted)] hover:text-[var(--danger-text)]">
            Esci
          </button>
        ) : null}
      </div>
      {confirm === "remove" ? (
        <div className="mt-3">
          <InlineConfirm
            text={`Togliere ${member.displayName} dal gruppo? Non vedrà più bacheca e cronologia. Con un vecchio link potrebbe rientrare: per impedirlo, in Invita usa "Disattiva i vecchi inviti".`}
            confirmLabel="Togli dal gruppo"
            icon="X"
            onCancel={() => setConfirm(null)}
            onConfirm={() => void remove()}
          />
        </div>
      ) : null}
      {confirm === "leave" ? (
        <div className="mt-3">
          <InlineConfirm
            text={leaveConfirmText(group)}
            confirmLabel={group.members.length === 1 ? "Esci ed elimina il gruppo" : "Esci dal gruppo"}
            icon="LogOut"
            onCancel={() => setConfirm(null)}
            onConfirm={() => void leave()}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Cosa succede uscendo: chi esce perde bacheca e cronologia; l'ultimo membro elimina il gruppo. */
const leaveConfirmText = (group: StudyGroup) =>
  group.members.length === 1
    ? `Sei l'ultimo membro: uscendo, "${group.name}" verrà eliminato con bacheca e cronologia. Non si può annullare.`
    : `Uscire da "${group.name}"? Non vedrai più bacheca e cronologia del gruppo. Per rientrare ti servirà di nuovo un invito.`;

function GroupDetailFooter({ group, actor, isOwner, onClose, onNotice }: { group: StudyGroup; actor: Actor | null; isOwner: boolean; onClose: () => void; onNotice: (text: string) => void }) {
  // "blocked": il proprietario non può eliminare un gruppo con altri membri (la regola resta,
  // ma la si spiega qui invece che in un avviso nascosto sotto il pannello).
  const [step, setStep] = useState<"idle" | "confirm" | "blocked">("idle");
  const [busy, setBusy] = useState(false);

  const ask = () => {
    if (!actor) return;
    setStep(isOwner && group.members.length > 1 ? "blocked" : "confirm");
  };

  const [error, setError] = useState("");

  const leave = async () => {
    if (!actor || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await leaveGroup(group, actor);
      if (!result.ok) {
        // Resta aperto con il motivo: il messaggio della pagina sarebbe nascosto dietro il pannello.
        setError(result.text);
        setStep("idle");
        return;
      }
      onNotice(result.text);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (step === "confirm") {
    return (
      <InlineConfirm
        text={
          isOwner
            ? `Eliminare "${group.name}"? Verranno cancellati anche bacheca e cronologia. Non si può annullare.`
            : `Uscire da "${group.name}"? Non vedrai più bacheca e cronologia del gruppo. Per rientrare ti servirà di nuovo un invito.`
        }
        confirmLabel={isOwner ? "Elimina gruppo" : "Esci dal gruppo"}
        icon={isOwner ? "Trash2" : "LogOut"}
        busy={busy}
        onCancel={() => setStep("idle")}
        onConfirm={() => void leave()}
      />
    );
  }

  if (step === "blocked") {
    return (
      <div className="rounded-[18px] bg-[var(--surface-soft)] p-3">
        <p className="text-sm font-bold">Puoi eliminare il gruppo solo quando sei l'unico membro rimasto. Prima togli gli altri dalla scheda Membri.</p>
        <div className="mt-2 flex justify-end">
          <Button variant="soft" onClick={() => setStep("idle")} autoFocus>
            Ho capito
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={isOwner ? "danger" : "soft"} icon={isOwner ? "Trash2" : "LogOut"} onClick={ask} disabled={!actor}>
        {isOwner ? "Elimina gruppo" : "Esci dal gruppo"}
      </Button>
      {error ? <p role="alert" className="min-w-0 flex-1 text-xs font-bold text-[var(--danger-text)]">{error}</p> : null}
    </div>
  );
}

function ResourceModal({ group, actor, onClose }: { group: StudyGroup; actor: Actor; onClose: () => void }) {
  const [kind, setKind] = useState<GroupResource["kind"]>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Chiusura in attesa della risposta a «Scartare le modifiche?».
  const [asking, setAsking] = useState(false);
  const dirty = Boolean(title.trim() || url.trim() || body.trim() || fileName);
  const requestClose = () => {
    if (busy) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  const save = async () => {
    if (busy) return;
    setAsking(false);
    if (!title.trim()) {
      setError("Scrivi un titolo per continuare.");
      return;
    }
    if (kind === "link" && !url.trim()) {
      setError("Incolla il link da condividere.");
      return;
    }
    setBusy(true);
    try {
      const store = useStudyStore.getState();
      const id = await store.addGroupResource({
        groupId: group.id,
        kind,
        title,
        url: kind === "link" ? url : undefined,
        body: kind === "file" ? `${fileName ? `File: ${fileName}\n` : ""}${body}` : body || undefined,
        pinned,
        addedByUserId: actor.userId,
        addedByDisplayName: actor.displayName
      });
      const created = useStudyStore.getState().groupResources.find((r) => r.id === id);
      // Se il server non risponde la risorsa resta «non ancora condivisa» e si riprova da sola.
      if (created && (group.sharedAt || group.ownerId === actor.userId)) await publishResource(created);
      await logSharedActivity(group.id, actor.displayName, `ha aggiunto "${title.trim()}"`).catch(() => undefined);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile aggiungere alla bacheca. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  const bodyField: Record<Exclude<GroupResource["kind"], "link">, { label: string; placeholder: string }> = {
    note: { label: "Testo", placeholder: "Es. Domande uscite all'ultimo appello" },
    file: { label: "Nota (facoltativa)", placeholder: "Es. Slide della lezione 3, aggiornate" },
    task: { label: "Dettagli (facoltativi)", placeholder: "Es. Ripassare il capitolo 4 entro venerdì" }
  };

  // Drawer sopra il dettaglio del gruppo (pila): Esc e Indietro chiudono solo questo, non tutto il gruppo,
  // e il portal su body evita che il pannello sotto (backdrop-filter, overflow) lo ritagli.
  return (
    <Drawer
      open
      onClose={requestClose}
      eyebrow={<span className="safe-text text-xs font-black uppercase text-[var(--faint)]">{GROUP_FORM_TEXT.resourceEyebrow(group.name)}</span>}
      title={GROUP_FORM_TEXT.resourceTitle}
      width="max-w-[560px]"
      footer={
        asking ? (
          <UnsavedPrompt
            title={GROUP_FORM_TEXT.unsavedTitle}
            text={GROUP_FORM_TEXT.unsavedResourceText}
            keep={GROUP_FORM_TEXT.unsavedKeep}
            discard={GROUP_FORM_TEXT.unsavedDiscard}
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              onClose();
            }}
          />
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>{busy ? "Aggiungo…" : "Aggiungi alla bacheca"}</Button>
          </div>
        )
      }
    >
      <div>
        <Segmented label="Cosa aggiungi" size="sm" value={kind} onChange={setKind}
          options={[{ id: "link", label: "Link", icon: "Globe" }, { id: "note", label: "Nota", icon: "FileText" }, { id: "file", label: "File", icon: "Paperclip" }, { id: "task", label: "Attività", icon: "Check" }]} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <Field label="Titolo">
          <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Appunti capitolo 4" data-autofocus />
        </Field>
        {kind === "link" ? (
          <Field label="Link">
            <input className={inputClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Es. https://drive.google.com/…" inputMode="url" />
          </Field>
        ) : null}
        {kind === "file" ? (
          <Field label="File">
            <input className={inputClass} type="file" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} />
            <p className="mt-1 text-xs text-[var(--faint)]">Gli altri vedranno solo il nome del file, che resta sul tuo dispositivo. Per farlo scaricare, aggiungi invece un link (es. Google Drive).</p>
          </Field>
        ) : null}
        {kind !== "link" ? (
          <Field label={bodyField[kind].label}>
            <textarea className={`${inputClass} min-h-20 py-3`} value={body} onChange={(event) => setBody(event.target.value)} placeholder={bodyField[kind].placeholder} />
          </Field>
        ) : null}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3 text-sm font-bold">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
          <span className="min-w-0 flex-1">Fissa in alto nella bacheca</span>
        </label>
        {error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
      </div>
    </Drawer>
  );
}
