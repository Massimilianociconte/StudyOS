import { useEffect, useRef, useState, type FormEvent } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Goal } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { GOAL_CATEGORY_LABEL, GOAL_STATUS_LABEL } from "../lib/labels";
import { GOALS_HELP, GOALS_TEXT } from "../lib/labels/goals";
import { Button, Drawer, EmptyState, Field, HelpTip, ProgressBar, SectionTitle, Tag, inputClass } from "../components/ui";
import { DateField } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { ShareButton } from "../components/ShareButton";
import { SharedSection } from "../components/SharedSection";
import { isNullableString, useUiState } from "../lib/uiState";
import { useLinkedUiState } from "../hooks/useLinkedUiState";
import { GOAL_STEP, goalDraftWith, goalMove, goalStep, statusForProgress } from "../lib/goalProgress";

const CATEGORY_ICON: Record<Goal["category"], string> = {
  study: "BookOpen",
  exam: "GraduationCap",
  notes: "PenLine",
  review: "Clock",
  streak: "Flame",
  fitness: "Activity",
  personal: "User",
  project: "Layers"
};

const categories = Object.keys(GOAL_CATEGORY_LABEL) as Goal["category"][];

const deadlineLabel = (deadline?: string) => {
  if (!deadline) return null;
  const date = parseISO(deadline);
  if (Number.isNaN(date.getTime())) return null;
  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) return { text: `Scaduto il ${format(date, "d MMM", { locale: it })}`, late: true };
  if (days === 0) return { text: "Scade oggi", late: false };
  if (days === 1) return { text: "Scade domani", late: false };
  return { text: `Scade tra ${days} giorni · ${format(date, "d MMM", { locale: it })}`, late: false };
};

/** Avviso sotto il campo: l'obiettivo ha cambiato gruppo o è stato eliminato, con «Annulla». */
type GoalNotice =
  | { kind: "reached" | "archived" | "reopened"; id: string; title: string; previous: Pick<Goal, "progress" | "status"> }
  | { kind: "deleted"; goal: Goal };

const noticeText = (notice: GoalNotice) =>
  notice.kind === "deleted" ? GOALS_TEXT.deleted(notice.goal.title) : GOALS_TEXT[notice.kind](notice.title);

const CLOSED_TOGGLE_ID = "goals-closed-toggle";
const cardButtonId = (id: string) => `goal-open-${id}`;

export function GoalsView() {
  // Obiettivo aperto: scritto anche da altre schermate (ricerca, Home), pure con Obiettivi già aperta.
  const [openId, setOpenId] = useLinkedUiState<string | null>("goals.open", null, { validate: isNullableString });
  const [showClosed, setShowClosed] = useUiState("goals.showClosed", false);
  const { goals, loading, locked, addGoal, updateGoal, deleteGoal, restoreEntities } = useStudyStore();
  const active = goals.filter((goal) => goal.status === "active" || goal.status === "paused");
  const closed = goals.filter((goal) => goal.status === "done" || goal.status === "archived");
  const open = goals.find((goal) => goal.id === openId) ?? null;

  // Obiettivo da aprire che non c'è più (eliminato altrove): si dimentica, a dati caricati.
  useEffect(() => {
    if (openId && !open && !loading && !locked) setOpenId(null);
  }, [openId, open, loading, locked, setOpenId]);

  // La scheda che cambia gruppo (o sparisce) si porta via il focus: va su «Annulla» dell'avviso, che
  // resta finché il focus è lì e poi si chiude da solo.
  const [notice, setNotice] = useState<GoalNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [noticeFocused, setNoticeFocused] = useState(false);
  useEffect(() => {
    if (!notice || noticeFocused) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeFocused]);
  useEffect(() => {
    if (!notice) return;
    // Dopo il Drawer, che alla chiusura rimette il focus dove l'aveva preso.
    const frame = window.requestAnimationFrame(() => noticeRef.current?.querySelector("button")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [notice]);

  /** Salva; se l'obiettivo passa tra «in corso» e «Raggiunti e archiviati» lo dice, con «Annulla». */
  const change = (goal: Goal, patch: Partial<Goal>) => {
    const move = patch.status ? goalMove(goal.status, patch.status) : null;
    if (move) setNotice({ kind: move, id: goal.id, title: patch.title ?? goal.title, previous: { progress: goal.progress, status: goal.status } });
    return updateGoal(goal.id, patch);
  };
  const remove = (goal: Goal) => {
    setOpenId(null);
    setNotice({ kind: "deleted", goal });
    void deleteGoal(goal.id);
  };
  const undo = () => {
    if (!notice) return;
    const id = notice.kind === "deleted" ? notice.goal.id : notice.id;
    if (notice.kind === "deleted") void restoreEntities([{ entityType: "goal", entityId: id, payload: { ...notice.goal }, complete: true }]);
    else void updateGoal(id, notice.previous);
    setNotice(null);
    setNoticeFocused(false);
    // Il focus torna sulla scheda, di nuovo al suo posto (o sul gruppo chiuso che la contiene).
    window.requestAnimationFrame(() =>
      (document.getElementById(cardButtonId(id)) ?? document.getElementById(CLOSED_TOGGLE_ID))?.focus({ preventScroll: true })
    );
  };

  return (
    <div>
      <SectionTitle
        title="Obiettivi"
        subtitle={GOALS_TEXT.subtitle}
        action={<ShareButton scopes={["goals"]} />}
      />

      {/* Solo il titolo: la categoria parte da «Studio» e si cambia nel dettaglio. */}
      <NewGoalBar onAdd={(title) => addGoal({ title, category: "study", progress: 0, metric: "%" })} />

      {/* Sempre presente: il lettore di schermo annuncia l'avviso appena compare il testo. */}
      <div role="status" aria-live="polite">
        {notice ? (
          <div
            ref={noticeRef}
            className="soft-panel mb-4 flex flex-wrap items-center gap-2 p-2.5"
            onFocus={() => setNoticeFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setNoticeFocused(false);
            }}
          >
            <Icon name={notice.kind === "deleted" ? "Trash2" : notice.kind === "reached" ? "Check" : "Target"} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <p className="safe-text min-w-0 flex-1 text-sm font-bold">{noticeText(notice)}</p>
            <Button variant="soft" icon="RotateCcw" onClick={undo}>
              {GOALS_TEXT.undo}
            </Button>
          </div>
        ) : null}
      </div>

      {active.length ? (
        // La regola di + e − sta in un "?" vicino alle schede, non nel sottotitolo.
        <div className="mb-2 flex justify-end">
          {/* Con la scritta accanto al "?": da solo, in fondo a destra, non si capiva a cosa servisse. */}
          <HelpTip title={GOALS_HELP.progress.title} text={GOALS_HELP.progress.text} label={GOALS_HELP.progress.label} />
        </div>
      ) : null}

      {active.length ? (
        <div className="grid grid-cols-1 gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
          {active.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onOpen={() => setOpenId(goal.id)} onStep={(delta) => void change(goal, goalStep(goal, delta))} />
          ))}
        </div>
      ) : (
        // Si crea dal campo qui sopra: un secondo pulsante «Crea» diceva la stessa cosa due volte.
        <EmptyState
          icon="Target"
          title={closed.length ? GOALS_TEXT.noneActiveTitle : GOALS_TEXT.emptyTitle}
          body={closed.length ? GOALS_TEXT.noneActiveBody : GOALS_TEXT.emptyBody}
        />
      )}

      {closed.length ? (
        <div className="mt-6">
          <button
            id={CLOSED_TOGGLE_ID}
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            aria-expanded={showClosed}
            className="mb-2 flex min-h-11 items-center gap-2 text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
          >
            <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${showClosed ? "rotate-90" : ""}`} />
            Raggiunti e archiviati · {closed.length}
          </button>
          {showClosed ? (
            <div className="grid grid-cols-1 gap-3 opacity-75 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
              {closed.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onOpen={() => setOpenId(goal.id)} onStep={(delta) => void change(goal, goalStep(goal, delta))} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <GoalDrawer
        goal={open}
        onClose={() => setOpenId(null)}
        onSave={(patch) => (open ? change(open, patch) : Promise.resolve())}
        onDelete={() => {
          if (open) remove(open);
        }}
      />

      <SharedSection entityTypes={["goal"]} />
    </div>
  );
}

const NEW_GOAL_ID = "new-goal-title";

function NewGoalBar({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await onAdd(title.trim());
    setTitle("");
  };
  return (
    <form onSubmit={submit} className="soft-panel mb-4 flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">{GOALS_TEXT.newField}</span>
        <Icon name="Target" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
        <input id={NEW_GOAL_ID} className={`${inputClass} pl-10`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={GOALS_TEXT.newPlaceholder} />
      </label>
      <Button type="submit" variant="primary" icon="Plus" disabled={!title.trim()}>
        {GOALS_TEXT.create}
      </Button>
    </form>
  );
}

function GoalCard({ goal, onOpen, onStep }: { goal: Goal; onOpen: () => void; onStep: (delta: number) => void }) {
  const deadline = deadlineLabel(goal.deadline);
  return (
    <article className="quiet-panel flex min-w-0 flex-col p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid grid-cols-1 h-10 w-10 shrink-0 place-items-center rounded-super bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent-ink)]">
          <Icon name={CATEGORY_ICON[goal.category]} className="h-5 w-5" />
        </span>
        <button id={cardButtonId(goal.id)} type="button" onClick={onOpen} aria-haspopup="dialog" title="Apri per modificare" className="min-w-0 flex-1 text-left">
          <h3 className="two-line-safe text-base font-black leading-snug">{goal.title}</h3>
          <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
            {GOAL_CATEGORY_LABEL[goal.category]}
            {goal.description ? ` · ${goal.description}` : ""}
          </p>
        </button>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-black">
          <span className="flex flex-wrap items-center gap-1.5">
            {goal.status !== "active" ? <Tag>{GOAL_STATUS_LABEL[goal.status]}</Tag> : null}
            {deadline ? <span className={deadline.late ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}>{deadline.text}</span> : null}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Togli 5% al progresso di "${goal.title}"`}
              title="Togli 5%"
              onClick={() => onStep(-GOAL_STEP)}
              className="relative grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] hover:bg-[var(--surface)] after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
            >
              −
            </button>
            <span className="w-10 text-center tabular-nums">{goal.progress}%</span>
            <button
              type="button"
              aria-label={`Aggiungi 5% al progresso di "${goal.title}"`}
              title="Aggiungi 5%"
              onClick={() => onStep(GOAL_STEP)}
              className="relative grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] hover:bg-[var(--surface)] after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
            >
              +
            </button>
          </span>
        </div>
        <ProgressBar value={goal.progress} color={goal.status === "done" ? "var(--ok)" : undefined} label={`Progresso di "${goal.title}"`} />
      </div>
    </article>
  );
}

function GoalDrawer({
  goal,
  onClose,
  onSave,
  onDelete
}: {
  goal: Goal | null;
  onClose: () => void;
  onSave: (patch: Partial<Goal>) => Promise<void>;
  /** Subito: l'avviso nella pagina offre «Annulla». */
  onDelete: () => void;
}) {
  // «Come lo misuri» non compare da nessuna parte: il campo non si mostra più, il valore salvato resta.
  const [draft, setDraft] = useState({ title: "", description: "", category: "study" as Goal["category"], deadline: "", progress: 0, status: "active" as Goal["status"], notes: "" });

  useEffect(() => {
    if (!goal) return;
    setDraft({
      title: goal.title,
      description: goal.description,
      category: goal.category,
      deadline: goal.deadline?.slice(0, 10) ?? "",
      progress: goal.progress,
      status: goal.status,
      notes: goal.notes
    });
  }, [goal?.id]);

  const save = async () => {
    if (!draft.title.trim()) return;
    await onSave({
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      deadline: draft.deadline || undefined,
      progress: Math.max(0, Math.min(100, draft.progress)),
      status: draft.status,
      notes: draft.notes
    });
    onClose();
  };

  return (
    <Drawer
      open={Boolean(goal)}
      onClose={onClose}
      eyebrow="Obiettivo"
      title={goal?.title ?? ""}
      width="max-w-[520px]"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="soft"
            icon="Archive"
            onClick={() => {
              if (!goal) return;
              // Ripristinato al 100% è raggiunto, non «in corso».
              void onSave({ status: goal.status === "archived" ? statusForProgress("active", goal.progress) : "archived" }).then(onClose);
            }}
          >
            {goal?.status === "archived" ? "Ripristina obiettivo" : "Archivia obiettivo"}
          </Button>
          <Button variant="danger" icon="Trash2" onClick={onDelete} aria-label={goal ? GOALS_TEXT.removeAria(goal.title) : undefined}>
            {GOALS_TEXT.remove}
          </Button>
          {/* A destra anche quando, sui telefoni, va a capo. */}
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={!draft.title.trim()} className="ml-auto">
            Salva modifiche
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <Field label="Titolo">
          <input className={inputClass} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} />
        </Field>
        <Field label="Descrizione (facoltativa)">
          <input className={inputClass} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Categoria">
            <select className={inputClass} value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as Goal["category"] }))}>
              {categories.map((id) => (
                <option key={id} value={id}>
                  {GOAL_CATEGORY_LABEL[id]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stato">
            <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => goalDraftWith(value, { status: event.target.value as Goal["status"] }))}>
              {(Object.keys(GOAL_STATUS_LABEL) as Goal["status"][]).map((id) => (
                <option key={id} value={id}>
                  {GOAL_STATUS_LABEL[id]}
                </option>
              ))}
            </select>
          </Field>
          <DateField label="Scadenza (facoltativa)" value={draft.deadline} onChange={(deadline) => setDraft((value) => ({ ...value, deadline }))} optional />
        </div>
        <Field label={`A che punto sei · ${draft.progress}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={GOAL_STEP}
            value={draft.progress}
            onChange={(event) => setDraft((value) => goalDraftWith(value, { progress: Number(event.target.value) }))}
            className="w-full accent-[var(--accent)]"
          />
        </Field>
        <Field label="Note (facoltative)">
          <textarea className={`${inputClass} min-h-20 py-3`} value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} />
        </Field>
      </div>
    </Drawer>
  );
}
