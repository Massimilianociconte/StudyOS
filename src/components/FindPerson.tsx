import { useRef, useState } from "react";
import { m } from "framer-motion";
import { peopleLabels } from "../lib/labels";
import { classifyPersonQuery, peopleCauseText, personHandle, personTitle, type FoundPerson } from "../lib/people";
import { initialsOf, ownerColor } from "../lib/sharing";
import { Button, inputClass } from "./ui";
import { Icon } from "./Icon";

type Result = { status: "idle" } | { status: "found"; person: FoundPerson } | { status: "none" };

/**
 * "Trova una persona": un campo (email esatta o @nome) e al massimo una scheda con nome e @nome,
 * mai l'email. Persona inesistente e non trovabile danno la stessa risposta. La ricerca passa da
 * peopleSync con import(): supabase-js resta fuori dal bundle iniziale. Cosa fa "Invita" lo decide
 * chi usa il componente (gruppo o condivisione).
 */
export function FindPerson({
  onInvite,
  actionLabel = peopleLabels.invite,
  disabled = false,
  disabledHint
}: {
  /** null se l'invito è partito (il campo si svuota), altrimenti il testo dell'errore da mostrare. */
  onInvite: (person: FoundPerson) => Promise<string | null>;
  actionLabel?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result>({ status: "idle" });
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  // Conta le modifiche al testo e le ricerche: una risposta vale solo se nel frattempo non è cambiato nulla.
  const requestId = useRef(0);

  const search = async () => {
    if (inviting || disabled) return;
    const mine = ++requestId.current;
    setError("");
    setResult({ status: "idle" });
    // Niente richiesta per un testo che non è né un'email intera né un @nome: non consuma il limite.
    if (!classifyPersonQuery(query)) {
      setSearching(false);
      setError(peopleLabels.errors.badQuery);
      return;
    }
    setSearching(true);
    try {
      const people = await import("../lib/peopleSync");
      const person = await people.findPerson(query);
      if (mine !== requestId.current) return;
      setResult(person ? { status: "found", person } : { status: "none" });
    } catch (cause) {
      if (mine === requestId.current) setError(peopleCauseText(cause));
    } finally {
      if (mine === requestId.current) setSearching(false);
    }
  };

  const invite = async (person: FoundPerson) => {
    if (inviting || disabled) return;
    setError("");
    setInviting(true);
    try {
      const failure = await onInvite(person);
      if (failure) {
        setError(failure);
      } else {
        setQuery("");
        setResult({ status: "idle" });
      }
    } finally {
      setInviting(false);
    }
  };

  const found = result.status === "found" ? result.person : null;
  const handle = found ? personHandle(found) : null;

  return (
    <div className="grid grid-cols-1 gap-2">
      <p className="text-xs font-semibold text-[var(--muted)]">{peopleLabels.findHint}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          type="text"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            requestId.current += 1;
            setQuery(event.target.value);
            setSearching(false);
            setResult({ status: "idle" });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          placeholder={peopleLabels.findPlaceholder}
          aria-label={peopleLabels.findFieldLabel}
          disabled={disabled}
        />
        <Button variant="soft" icon="Search" onClick={() => void search()} disabled={disabled || searching || inviting || !query.trim()}>
          {searching ? peopleLabels.searching : peopleLabels.search}
        </Button>
      </div>
      {disabled && disabledHint ? <p className="text-xs font-bold text-[var(--muted)]">{disabledHint}</p> : null}

      {found ? (
        <m.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3"
          aria-live="polite"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 grid-cols-1 place-items-center rounded-super text-sm font-black text-[#10131d]"
              style={{ background: ownerColor(found.personId) }}
            >
              {initialsOf(found.displayName || found.handle || "")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="safe-text block text-sm font-black">{personTitle(found)}</span>
              <span className="safe-text block text-xs font-bold text-[var(--muted)]">{handle ?? peopleLabels.noHandle}</span>
            </span>
            <Button variant="primary" icon="UserPlus" onClick={() => void invite(found)} disabled={disabled || inviting}>
              {inviting ? peopleLabels.inviting : actionLabel}
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--muted)]">
            <Icon name="ShieldCheck" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]" />
            <span>{peopleLabels.checkHint}</span>
          </p>
        </m.div>
      ) : null}

      {result.status === "none" ? (
        <p role="status" className="flex items-start gap-2 rounded-[18px] bg-[var(--surface)] p-3 text-sm font-bold text-[var(--muted)]">
          <Icon name="Search" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[var(--text)]">{peopleLabels.notFound}</span>
            <span className="block text-xs font-semibold">{peopleLabels.notFoundHint}</span>
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
