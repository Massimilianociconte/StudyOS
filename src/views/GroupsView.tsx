import { useCallback, useEffect, useMemo, useState } from "react";
import type { GroupMember, GroupResource, StudyGroup } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Drawer, EmptyState, Field, Panel, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { formatNotificationTime } from "../components/NotificationsPanel";
import { InviteLoginDrawer, InviteSheet, PendingInviteCard, useCloudSession } from "../components/GroupInvite";
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
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);
  const session = useCloudSession();
  const sessionUserId = session?.user.id;

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
      setNotice("Codice non valido: incolla il link ricevuto o un codice come GRP-AB12-CD34.");
      return;
    }
    if (cloudConfigured && !session) {
      // Senza accesso: l'invito resta in attesa e si entra appena si accede o ci si registra.
      savePendingInvite(code);
      confirmPendingInvite();
      setJoinCode("");
      setLoginOpen(true);
      return;
    }
    setJoinBusy(true);
    try {
      const groupId = await joinGroupWithCode(code, actor);
      setJoinCode("");
      setOpenId(groupId);
      setNotice("Ti sei unito al gruppo.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Unione non riuscita.");
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle
        title="Gruppi"
        subtitle="Studia insieme: bacheca condivisa, membri, inviti e attività. Funziona offline; la condivisione tra account richiede il cloud."
        action={
          <div className="flex flex-wrap gap-2">
            <Button icon="RotateCcw" variant="soft" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? "Aggiorno…" : "Aggiorna"}
            </Button>
            <Button icon="Plus" variant="primary" onClick={() => setCreateOpen(true)}>
              Nuovo gruppo
            </Button>
          </div>
        }
      />

      {notice ? (
        <p role="status" className="mb-4 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
          {notice}
        </p>
      ) : null}

      <PendingInviteCard
        onLogin={() => setLoginOpen(true)}
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
            <h3 className="text-2xl font-black">Nessun gruppo</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">Crea il tuo primo gruppo o unisciti con un codice di invito.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button icon="Plus" variant="primary" onClick={() => setCreateOpen(true)}>
                Nuovo gruppo
              </Button>
            </div>
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
        <h3 className="text-lg font-black">Unisciti con codice</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Incolla il codice (es. GRP-AB12-CD34) o il link ricevuto. Hai un link o un QR? Aprilo direttamente: StudyOS ti porta all'ingresso del gruppo.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void join();
            }}
            placeholder="Codice o link di invito"
            aria-label="Codice o link di invito"
            autoCapitalize="characters"
            autoComplete="off"
          />
          <Button icon="LogIn" variant="primary" onClick={() => void join()} disabled={joinBusy || !actor}>
            {joinBusy ? "Controllo…" : "Unisciti"}
          </Button>
        </div>
      </Panel>

      {createOpen && actor ? <CreateGroupModal actor={actor} onClose={() => setCreateOpen(false)} onCreated={setOpenId} /> : null}
      {open ? <GroupDetail group={open} actor={actor} onClose={() => setOpenId(null)} onNotice={setNotice} /> : null}
      {inviteGroupId && actor && studyGroups.some((group) => group.id === inviteGroupId) ? (
        <InviteSheet group={studyGroups.find((group) => group.id === inviteGroupId)!} actor={actor} onClose={() => setInviteGroupId(null)} onNotice={setNotice} />
      ) : null}
      <InviteLoginDrawer open={loginOpen} onClose={closeLogin} />
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
              {group.members.length} {group.members.length === 1 ? "membro" : "membri"} · {pinned} fissati
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
      onDone(cause instanceof Error ? cause.message : "Accettazione non riuscita.");
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
      onDone(cause instanceof Error ? cause.message : "Operazione non riuscita.");
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

function CreateGroupModal({ actor, onClose, onCreated }: { actor: Actor; onClose: () => void; onCreated: (id: string) => void }) {
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
      setError(cause instanceof Error ? cause.message : "Creazione non riuscita.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true" aria-label="Nuovo gruppo"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <section className="soft-panel w-full max-w-lg p-4 sm:p-5">
        <p className="text-xs font-black uppercase text-[var(--faint)]">Nuovo gruppo</p>
        <h3 className="text-2xl font-black">Con chi studi?</h3>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <Field label="Nome del gruppo">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Fisiologia — sessione estiva" autoFocus />
          </Field>
          <Field label="Descrizione">
            <textarea className={`${inputClass} min-h-20 py-3`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Corso, obiettivi, regole (opzionale)" />
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

function GroupDetail({ group, actor, onClose, onNotice }: { group: StudyGroup; actor: Actor | null; onClose: () => void; onNotice: (text: string) => void }) {
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
            Invita compagni di corso
            <span className="block text-xs font-bold text-[var(--muted)]">Link per WhatsApp e altre app, QR code o codice del gruppo.</span>
          </p>
          <Button variant="primary" icon="UserPlus" onClick={() => setInviteOpen(true)}>
            Invita
          </Button>
        </div>
      ) : null}
      <Segmented label="Sezioni del gruppo" size="sm" className="justify-self-start" value={tab} onChange={setTab}
        options={[{ id: "bacheca", label: "Bacheca" }, { id: "membri", label: "Membri" }, { id: "attivita", label: "Attività" }]} />

      {tab === "bacheca" ? (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-black">Fissati in alto, resto sotto</h4>
            <Button variant="soft" icon="Plus" onClick={() => setResourceOpen(true)} disabled={!actor}>Aggiungi</Button>
          </div>
          {resources.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]">Bacheca vuota: link, appunti, file e attività condivise.</p>
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
          {sentInvites.length ? (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Inviti in attesa · {sentInvites.length}</h4>
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
            <li className="rounded-[14px] border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]">Ancora nessuna attività.</li>
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
      {inviteOpen && actor ? <InviteSheet group={group} actor={actor} onClose={() => setInviteOpen(false)} onNotice={onNotice} /> : null}
    </Drawer>
  );
}

function ResourceRow({ resource, canManage }: { resource: GroupResource; canManage: boolean }) {
  const store = useStudyStore();
  return (
    <li className={`quiet-panel flex min-w-0 items-start gap-3 p-3 ${resource.pinned ? "ring-1 ring-[var(--accent)]" : ""}`}>
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
        <p className="mt-1 text-[11px] font-bold text-[var(--faint)]">{RESOURCE_LABEL[resource.kind]} · {resource.addedByDisplayName}</p>
      </div>
      {canManage ? (
        <span className="flex shrink-0 gap-1">
          <button type="button" onClick={() => void store.toggleResourcePin(resource.id).then(() => pushSharedResourcePin({ ...resource, pinned: !resource.pinned, updatedAt: new Date().toISOString() }))} aria-label={resource.pinned ? "Togli dai fissati" : "Fissa in alto"} title={resource.pinned ? "Togli dai fissati" : "Fissa in alto"}
            className={`grid h-8 w-8 place-items-center rounded-full ${resource.pinned ? "bg-[var(--accent)] text-[#10131d]" : "hover:bg-[var(--surface-strong)]"}`}>
            <Icon name="Pin" className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => { if (window.confirm(`Eliminare "${resource.title}" dalla bacheca?`)) void store.deleteGroupResource(resource.id).then(() => deleteSharedResource(resource.id)); }} aria-label="Elimina risorsa" className="grid h-8 w-8 place-items-center rounded-full text-[var(--danger-text)] hover:bg-[var(--danger-bg)]">
            <Icon name="Trash2" className="h-4 w-4" />
          </button>
        </span>
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

  const remove = async () => {
    if (!window.confirm(`Rimuovere ${member.displayName} dal gruppo?`)) return;
    await store.updateStudyGroup(group.id, { members: group.members.filter((m) => m.userId !== member.userId) });
    await removeSharedMember(group.id, member.userId);
    onNotice(`${member.displayName} rimosso dal gruppo.`);
  };

  const leave = async () => {
    if (member.role === "owner") {
      if (group.members.length > 1) {
        onNotice("Sei il proprietario: elimina il gruppo oppure trasferisci la proprietà prima di uscire.");
        return;
      }
    }
    if (!window.confirm("Uscire dal gruppo?")) return;
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
    onNotice("Hai lasciato il gruppo.");
    onClose();
  };

  return (
    <li className="quiet-panel flex min-w-0 items-center gap-3 p-3">
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
        >
          <option value="member">Membro</option>
          <option value="admin">Amministratore</option>
        </select>
      ) : null}
      {canRemove ? (
        <button type="button" onClick={() => void remove()} aria-label={`Rimuovi ${member.displayName}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--danger-text)] hover:bg-[var(--danger-bg)]">
          <Icon name="X" className="h-4 w-4" />
        </button>
      ) : null}
      {isSelf && !isOwner ? (
        <button type="button" onClick={() => void leave()} className="shrink-0 rounded-full px-3 text-xs font-black text-[var(--muted)] hover:text-[var(--danger-text)]">
          Esci
        </button>
      ) : null}
    </li>
  );
}

function GroupDetailFooter({ group, actor, isOwner, onClose, onNotice }: { group: StudyGroup; actor: Actor | null; isOwner: boolean; onClose: () => void; onNotice: (text: string) => void }) {
  const leave = async () => {
    if (!actor) return;
    const store = useStudyStore.getState();
    if (isOwner && group.members.length > 1) {
      onNotice("Sei il proprietario: elimina il gruppo per chiuderlo.");
      return;
    }
    if (!window.confirm(isOwner ? "Eliminare definitivamente il gruppo?" : "Uscire dal gruppo?")) return;
    if (isOwner) {
      await store.deleteStudyGroup(group.id);
      await deleteSharedGroup(group.id);
    } else {
      await logSharedActivity(group.id, actor.displayName, "ha lasciato il gruppo").catch(() => undefined);
      await removeSharedMember(group.id, actor.userId);
      // Chi esce non tiene una copia del gruppo (bacheca e cronologia comprese).
      await store.deleteStudyGroup(group.id);
    }
    onClose();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={isOwner ? "danger" : "soft"} icon={isOwner ? "Trash2" : "LogOut"} onClick={() => void leave()} disabled={!actor}>
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
      setError("Dai un titolo alla risorsa.");
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
      setError(cause instanceof Error ? cause.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true" aria-label="Nuova risorsa"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <section className="soft-panel w-full max-w-lg p-4 sm:p-5">
        <p className="text-xs font-black uppercase text-[var(--faint)]">Bacheca · {group.name}</p>
        <h3 className="text-2xl font-black">Nuova risorsa</h3>
        <div className="mt-3">
          <Segmented label="Tipo di risorsa" size="sm" value={kind} onChange={setKind}
            options={[{ id: "link", label: "Link", icon: "Globe" }, { id: "note", label: "Nota", icon: "FileText" }, { id: "file", label: "File", icon: "Paperclip" }, { id: "task", label: "Attività", icon: "Check" }]} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <Field label="Titolo">
            <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Appunti capitolo 4" autoFocus />
          </Field>
          {kind === "link" ? (
            <Field label="URL">
              <input className={inputClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" />
            </Field>
          ) : null}
          {kind === "file" ? (
            <Field label="File di riferimento">
              <input className={inputClass} type="file" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} />
              <p className="mt-1 text-xs text-[var(--faint)]">Viene condiviso il nome come riferimento: il file resta sul tuo dispositivo.</p>
            </Field>
          ) : null}
          {kind !== "link" ? (
            <Field label={kind === "task" ? "Dettagli" : "Testo"}>
              <textarea className={`${inputClass} min-h-20 py-3`} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Contenuto condiviso con il gruppo" />
            </Field>
          ) : null}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3 text-sm font-bold">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
            <span className="min-w-0 flex-1">Fissa in alto nella bacheca</span>
          </label>
          {error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>{busy ? "Salvataggio…" : "Condividi"}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
