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
  declineInviteRemote,
  deleteSharedGroup,
  deleteSharedResource,
  ensureSharedMailbox,
  getActor,
  joinGroupWithCode,
  logSharedActivity,
  pullSharedUpdates,
  pushSharedGroup,
  pushSharedMemberRole,
  pushSharedMembership,
  pushSharedResource,
  pushSharedResourcePin,
  removeSharedMember,
  type Actor
} from "../lib/groupSync";
import { safeHref } from "../lib/safeUrl";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";

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
  const [openId, setOpenId] = useUiState<string | null>("groups.open", null, { scope: "tab", validate: isNullableString });
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
  const received = groupInvites
    .filter((invite) => invite.status === "pending" && invite.fromUserId !== myId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  const { groupInvites, acceptGroupInvite, declineGroupInvite } = useStudyStore();
  const invite = groupInvites.find((item) => item.id === inviteId);
  const [busy, setBusy] = useState(false);
  if (!invite) return null;

  const accept = async () => {
    if (!actor || busy) return;
    setBusy(true);
    try {
      const remote = await acceptInviteRemote(invite.id, actor.displayName);
      const store = useStudyStore.getState();
      if (remote) await pullSharedUpdates();
      await store.acceptGroupInvite(invite.id, actor);
      // Con il backend condiviso l'ingresso è già registrato dal server (niente voce doppia).
      if (!remote) await useStudyStore.getState().logGroupActivity(invite.groupId, actor.displayName, "è entrato nel gruppo").catch(() => undefined);
      onDone(`Benvenuto in "${invite.groupName}".`);
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : "Non è stato possibile accettare l'invito. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await declineInviteRemote(invite.id);
      await declineGroupInvite(invite.id);
      onDone("Invito rifiutato.");
    } catch (cause) {
      onDone(cause instanceof Error ? cause.message : "Non è stato possibile rifiutare l'invito. Riprova.");
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
        <Button variant="primary" icon="Check" onClick={() => void accept()} disabled={busy || !actor}>
          Accetta
        </Button>
        <Button variant="soft" onClick={() => void decline()} disabled={busy}>
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

  const save = async () => {
    if (busy) return;
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
        await pushSharedGroup(group);
        await pushSharedMembership(id, group.members[0]);
        await logSharedActivity(id, actor.displayName, "ha creato il gruppo").catch(() => undefined);
      }
      onCreated(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile creare il gruppo. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true" aria-label="Crea un gruppo"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <section className="soft-panel w-full max-w-lg p-4 sm:p-5">
        <p className="text-xs font-black uppercase text-[var(--faint)]">Nuovo gruppo</p>
        <h3 className="text-2xl font-black">Con chi studi?</h3>
        <div className="mt-4 grid grid-cols-1 gap-3">
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
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Fisiologia — sessione estiva" autoFocus />
          </Field>
          <Field label="Descrizione (facoltativa)">
            <textarea className={`${inputClass} min-h-20 py-3`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Es. Corso, obiettivi, regole del gruppo" />
          </Field>
          {error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>{busy ? "Creazione…" : "Crea gruppo"}</Button>
          </div>
        </div>
      </section>
    </div>
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
                <ResourceRow key={resource.id} resource={resource} canManage={isOwner || resource.addedByUserId === actor?.userId} />
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
          <ul className="grid grid-cols-1 gap-2">
            {group.members.map((member) => (
              <MemberRow key={member.userId} group={group} member={member} isOwner={isOwner} myId={actor?.userId} onClose={onClose} onNotice={onNotice} />
            ))}
          </ul>
          <details className="quiet-panel mt-3 p-3">
            <summary className="cursor-pointer text-sm font-extrabold">Cosa può fare ogni ruolo?</summary>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-[var(--muted)]">
              <li><strong>Proprietario</strong>: ha creato il gruppo. Sceglie i ruoli, può togliere persone e contenuti dalla bacheca ed eliminare il gruppo.</li>
              <li><strong>Amministratore</strong>: come un membro, ma può anche invitare persone per email.</li>
              <li><strong>Membro</strong>: aggiunge link, note e file in bacheca e invita altri con link, QR o codice.</li>
            </ul>
          </details>
          {sentInvites.length ? (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Inviti in attesa di risposta · {sentInvites.length}</h4>
              <ul className="grid grid-cols-1 gap-1.5">
                {sentInvites.map((invite) => (
                  <li key={invite.id} className="flex min-w-0 items-center gap-2 rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-xs">
                    <Icon name="Mail" className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                    <span className="one-line-safe min-w-0 flex-1 font-bold">{invite.recipientEmail ?? `Codice ${invite.code}`}</span>
                    <span className="shrink-0 font-black text-[var(--muted)]">in attesa</span>
                  </li>
                ))}
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

function ResourceRow({ resource, canManage }: { resource: GroupResource; canManage: boolean }) {
  const store = useStudyStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        </div>
        {canManage ? (
          <span className="flex shrink-0 gap-1">
            <button type="button" onClick={() => void store.toggleResourcePin(resource.id).then(() => pushSharedResourcePin({ ...resource, pinned: !resource.pinned, updatedAt: new Date().toISOString() }))} aria-label={resource.pinned ? "Togli dai fissati" : "Fissa in alto"} title={resource.pinned ? "Togli dai fissati" : "Fissa in alto"}
              className={`grid h-8 w-8 place-items-center rounded-full ${resource.pinned ? "bg-[var(--accent)] text-[#10131d]" : "hover:bg-[var(--surface-strong)]"}`}>
              <Icon name="Pin" className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Elimina "${resource.title}" dalla bacheca`} title="Elimina dalla bacheca" className="grid h-8 w-8 place-items-center rounded-full text-[var(--danger-text)] hover:bg-[var(--danger-bg)]">
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
            onConfirm={() => {
              setConfirmDelete(false);
              void store.deleteGroupResource(resource.id).then(() => deleteSharedResource(resource.id));
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

function MemberRow({ group, member, isOwner, myId, onClose, onNotice }: { group: StudyGroup; member: GroupMember; isOwner: boolean; myId?: string; onClose: () => void; onNotice: (text: string) => void }) {
  const store = useStudyStore();
  const isSelf = member.userId === myId;
  const canRemove = isOwner && !isSelf;

  const changeRole = async (role: GroupMember["role"]) => {
    await store.updateStudyGroup(group.id, { members: group.members.map((m) => (m.userId === member.userId ? { ...m, role } : m)) });
    const updated = useStudyStore.getState().studyGroups.find((g) => g.id === group.id);
    if (updated) {
      await pushSharedGroup(updated);
      await pushSharedMemberRole(group.id, member.userId, role);
    }
  };

  const [confirm, setConfirm] = useState<"remove" | "leave" | null>(null);

  const remove = async () => {
    setConfirm(null);
    await store.updateStudyGroup(group.id, { members: group.members.filter((m) => m.userId !== member.userId) });
    await removeSharedMember(group.id, member.userId);
    onNotice(`${member.displayName} non fa più parte del gruppo.`);
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
    const storeState = useStudyStore.getState();
    if (group.members.length === 1) {
      await storeState.deleteStudyGroup(group.id);
      await deleteSharedGroup(group.id);
      onNotice("Gruppo eliminato: eri l'unico membro.");
      onClose();
      return;
    }
    // Prima la voce in cronologia (serve ancora essere membri per pubblicarla), poi l'uscita.
    await logSharedActivity(group.id, member.displayName, "ha lasciato il gruppo").catch(() => undefined);
    await removeSharedMember(group.id, member.userId);
    // Chi esce non tiene una copia del gruppo (bacheca e cronologia comprese).
    await storeState.deleteStudyGroup(group.id);
    onNotice(`Hai lasciato il gruppo "${group.name}".`);
    onClose();
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
            className="min-h-8 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 text-xs font-black"
            value={member.role}
            onChange={(event) => void changeRole(event.target.value as GroupMember["role"])}
            aria-label={`Ruolo di ${member.displayName}`}
            title="Cambia ruolo"
          >
            <option value="member">Membro</option>
            <option value="admin">Amministratore</option>
          </select>
        ) : null}
        {canRemove ? (
          <button type="button" onClick={() => setConfirm("remove")} aria-label={`Togli ${member.displayName} dal gruppo`} title="Togli dal gruppo" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--danger-text)] hover:bg-[var(--danger-bg)]">
            <Icon name="X" className="h-4 w-4" />
          </button>
        ) : null}
        {isSelf && !isOwner ? (
          <button type="button" onClick={askLeave} className="shrink-0 rounded-full px-3 text-xs font-black text-[var(--muted)] hover:text-[var(--danger-text)]">
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

  const leave = async () => {
    if (!actor || busy) return;
    setBusy(true);
    const store = useStudyStore.getState();
    try {
      if (isOwner) {
        await store.deleteStudyGroup(group.id);
        await deleteSharedGroup(group.id);
        onNotice(`Gruppo "${group.name}" eliminato.`);
      } else {
        await logSharedActivity(group.id, actor.displayName, "ha lasciato il gruppo").catch(() => undefined);
        await removeSharedMember(group.id, actor.userId);
        // Chi esce non tiene una copia del gruppo (bacheca e cronologia comprese).
        await store.deleteStudyGroup(group.id);
        onNotice(`Hai lasciato il gruppo "${group.name}".`);
      }
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

  const save = async () => {
    if (busy) return;
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
      if (created) await pushSharedResource(created);
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true" aria-label="Aggiungi alla bacheca"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <section className="soft-panel w-full max-w-lg p-4 sm:p-5">
        <p className="text-xs font-black uppercase text-[var(--faint)]">Bacheca · {group.name}</p>
        <h3 className="text-2xl font-black">Cosa vuoi condividere?</h3>
        <div className="mt-3">
          <Segmented label="Cosa aggiungi" size="sm" value={kind} onChange={setKind}
            options={[{ id: "link", label: "Link", icon: "Globe" }, { id: "note", label: "Nota", icon: "FileText" }, { id: "file", label: "File", icon: "Paperclip" }, { id: "task", label: "Attività", icon: "Check" }]} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <Field label="Titolo">
            <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Appunti capitolo 4" autoFocus />
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>{busy ? "Aggiungo…" : "Aggiungi alla bacheca"}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
