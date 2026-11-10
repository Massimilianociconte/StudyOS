import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { useSharedStore } from "../store/useSharedStore";
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { SHARE_PERMISSION_LABEL, SHARE_SCOPE_HINT, SHARE_SCOPE_LABEL, scopesSummary } from "../lib/labels";
import {
  SHARE_SCOPES,
  SUBJECTLESS_SCOPES,
  VIEW_ONLY_SCOPES,
  knownPeople,
  shareActionErrorText,
  shareableGroups,
  shareInviteLink,
  shareInviteMessage,
  type ShareOffer,
  type SharePermission,
  type ShareScope
} from "../lib/sharing";
import { Button, Drawer, Field, Segmented, inputClass } from "./ui";
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";
import { ShareLinkPanel } from "./ShareLinkPanel";

type Target = "invite" | `user:${string}` | `group:${string}`;

const toggle = <T,>(list: readonly T[], value: T) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

const infoClass = "flex items-start gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]";

/** Pannello Condividi: cosa (sezioni e materie), con chi (invito, persona collegata, gruppo), come (permesso). */
export function ShareDrawer({ open, onClose, initialScopes = ["calendar"] }: { open: boolean; onClose: () => void; initialScopes?: ShareScope[] }) {
  const session = useCloudSession();
  const me = session?.user.id ?? "";
  const { subjects, studyGroups, displayName } = useStudyStore(
    useShallow((state) => ({ subjects: state.subjects, studyGroups: state.studyGroups, displayName: selectPreferences(state).displayName }))
  );
  const { given, received, availability } = useSharedStore(
    useShallow((state) => ({ given: state.given, received: state.received, availability: state.availability }))
  );
  const [scopes, setScopes] = useState<ShareScope[]>(initialScopes);
  const [permission, setPermission] = useState<SharePermission>("view");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [target, setTarget] = useState<Target>("invite");
  const [email, setEmail] = useState("");
  const [askBack, setAskBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ link: string; offers: ShareOffer[] } | null>(null);
  const [done, setDone] = useState("");

  const activeSubjects = useMemo(
    () => subjects.filter((subject) => !subject.archived).sort((a, b) => a.name.localeCompare(b.name, "it")),
    [subjects]
  );
  // Gruppi online di cui si è membri: sono i destinatari possibili e le uniche persone "collegate"
  // per compagnia di gruppo (stessa regola del server, studyos_knows_user).
  const groups = useMemo(() => shareableGroups(studyGroups, me), [studyGroups, me]);
  const people = useMemo(() => knownPeople(me, given, received, groups), [me, given, received, groups]);
  const usesSubjects = scopes.some((scope) => !SUBJECTLESS_SCOPES.has(scope));
  const onlyViewOnly = scopes.length > 0 && scopes.every((scope) => VIEW_ONLY_SCOPES.has(scope));

  // Se mentre il pannello è aperto una persona o un gruppo smette di essere raggiungibile
  // (condivisione revocata, uscita dal gruppo), non si prova una condivisione diretta che il
  // server rifiuterebbe: si torna all'invito.
  const chosen: Target =
    target === "invite" || people.some((person) => `user:${person.userId}` === target) || groups.some((group) => `group:${group.id}` === target)
      ? target
      : "invite";

  const offers = (): ShareOffer[] =>
    scopes.map((scope) => ({
      scope,
      permission: VIEW_ONLY_SCOPES.has(scope) ? "view" : permission,
      subjectIds: SUBJECTLESS_SCOPES.has(scope) ? [] : subjectIds,
      subjectNames: SUBJECTLESS_SCOPES.has(scope) ? [] : subjectIds.map((id) => activeSubjects.find((subject) => subject.id === id)?.name ?? "")
    }));

  const targetName = () =>
    chosen.startsWith("user:")
      ? people.find((person) => `user:${person.userId}` === chosen)?.name ?? "Persona"
      : groups.find((group) => `group:${group.id}` === chosen)?.name ?? "Gruppo";

  const submit = async () => {
    if (busy) return;
    if (!scopes.length) return setError("Scegli almeno una cosa da condividere.");
    const recipient = email.trim().toLowerCase();
    if (chosen === "invite" && recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return setError("Controlla l'indirizzo email: sembra incompleto (es. nome@esempio.it).");
    }
    setError("");
    setBusy(true);
    try {
      const sync = await import("../lib/shareSync");
      const list = offers();
      if (chosen === "invite") {
        const requests = askBack ? list.map((offer) => ({ scope: offer.scope, permission: offer.permission })) : [];
        const { token } = await sync.createShareInvite({ offers: list, requests, recipientEmail: recipient || undefined });
        setCreated({ link: shareInviteLink(token), offers: list });
      } else {
        const name = targetName();
        await sync.shareWith(chosen.startsWith("user:") ? { userId: chosen.slice(5), name } : { groupId: chosen.slice(6), name }, list);
        setDone(`Fatto: ${name} ora vede ${scopesSummary(list)}.`);
      }
    } catch (cause) {
      setError(shareActionErrorText(chosen === "invite" ? "invite" : "share", cause));
    } finally {
      setBusy(false);
    }
  };

  const ready = cloudConfigured && Boolean(session) && availability !== "missing";
  const footer = !ready ? undefined : created || done ? (
    <div className="flex justify-end">
      <Button variant="primary" icon="Check" onClick={onClose}>
        Fine
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="soft" onClick={onClose} disabled={busy}>
        Annulla
      </Button>
      <Button variant="primary" icon={chosen === "invite" ? "UserPlus" : "Share2"} onClick={() => void submit()} disabled={busy || !scopes.length}>
        {busy ? "Un attimo…" : chosen === "invite" ? "Crea l'invito" : "Condividi"}
      </Button>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">Condivisione</span>}
      title="Condividi"
      width="max-w-[600px]"
      footer={footer}
    >
      {!cloudConfigured ? (
        <p className={infoClass}>Gli account non sono attivi in questa versione dell'app: la condivisione non è disponibile.</p>
      ) : !session ? (
        <div className="grid grid-cols-1 gap-4">
          <p className={infoClass}>
            <Icon name="Share2" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <span>Per condividere serve il tuo account: chi riceve vede i tuoi dati con il suo account, sempre aggiornati.</span>
          </p>
          <CloudPanel />
        </div>
      ) : availability === "missing" ? (
        <p className={infoClass}>
          La condivisione non è ancora attiva sul server. Chi gestisce StudyOS deve eseguire supabase/sharing.sql nel SQL Editor di Supabase.
        </p>
      ) : created ? (
        <div className="grid grid-cols-1 gap-4">
          <p className={infoClass}>
            <Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <span>
              Invito pronto: {scopesSummary(created.offers)}. Il link vale 14 giorni e si può usare una volta sola: mandalo solo alla
              persona giusta.
            </span>
          </p>
          <ShareLinkPanel
            link={created.link}
            subject="Invito a condividere su StudyOS"
            message={shareInviteMessage(displayName.trim() || "Un compagno", created.offers, created.link)}
          />
        </div>
      ) : done ? (
        <p role="status" className={infoClass}>
          <Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
          <span>{done}</span>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <fieldset className="grid grid-cols-1 gap-2">
            <legend className="mb-2 text-sm font-black">Cosa vuoi condividere</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SHARE_SCOPES.map((scope) => (
                <label key={scope} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={scopes.includes(scope)}
                    onChange={() => setScopes((list) => toggle(list, scope))}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-black">{SHARE_SCOPE_LABEL[scope]}</span>
                    <span className="block text-xs font-semibold text-[var(--muted)]">{SHARE_SCOPE_HINT[scope]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {usesSubjects && activeSubjects.length ? (
            <details className="rounded-[18px] bg-[var(--surface-soft)] p-3">
              <summary className="cursor-pointer text-sm font-black">
                {subjectIds.length ? `Solo ${subjectIds.length === 1 ? "1 materia" : `${subjectIds.length} materie`}` : "Tutte le materie"}{" "}
                <span className="font-semibold text-[var(--muted)]">(facoltativo)</span>
              </summary>
              <p className="mt-2 text-xs font-semibold text-[var(--muted)]">
                Se ne scegli alcune, l'altra persona vede solo ciò che è collegato a quelle materie.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {activeSubjects.map((subject) => (
                  <label key={subject.id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                      checked={subjectIds.includes(subject.id)}
                      onChange={() => setSubjectIds((list) => toggle(list, subject.id))}
                    />
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subject.color }} />
                    <span className="min-w-0 truncate">{subject.name}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}

          <Field label="Con chi">
            <select className={inputClass} value={chosen} onChange={(event) => setTarget(event.target.value as Target)}>
              <option value="invite">Una persona nuova (con un link di invito)</option>
              {people.length ? (
                <optgroup label="Persone collegate">
                  {people.map((person) => (
                    <option key={person.userId} value={`user:${person.userId}`}>
                      {person.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {groups.length ? (
                <optgroup label="Gruppi">
                  {groups.map((group) => (
                    <option key={group.id} value={`group:${group.id}`}>
                      {group.name} (tutto il gruppo)
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </Field>

          {chosen === "invite" ? (
            <div className="grid grid-cols-1 gap-3">
              <Field label="Email (facoltativa)">
                <input
                  className={inputClass}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nome@esempio.it"
                />
              </Field>
              <p className="text-xs font-semibold text-[var(--muted)]">
                Con l'email l'invito compare anche nella sua app quando accede con quell'indirizzo. StudyOS non manda email: il link lo
                mandi tu.
              </p>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  checked={askBack}
                  onChange={(event) => setAskBack(event.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-black">Chiedi in cambio le stesse cose</span>
                  <span className="block text-xs font-semibold text-[var(--muted)]">
                    Chi accetta può scegliere di condividere con te le stesse sezioni, ad esempio il calendario.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {onlyViewOnly ? (
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
              <p className="text-xs font-semibold text-[var(--muted)]">
                {permission === "edit"
                  ? "Può aggiungere, modificare ed eliminare. Ogni modifica resta nella cronologia e puoi ripristinarla."
                  : "Vede i tuoi dati ma non può cambiarli."}
              </p>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
