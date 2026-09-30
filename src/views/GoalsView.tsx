import { useEffect, useState, type FormEvent } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Goal } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { GOAL_CATEGORY_LABEL, GOAL_STATUS_LABEL } from "../lib/labels";
import { Button, Drawer, Field, ProgressBar, SectionTitle, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { isNullableString, useUiState } from "../lib/uiState";

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
  return { text: `${days} ${days === 1 ? "giorno" : "giorni"} · ${format(date, "d MMM", { locale: it })}`, late: false };
};

export function GoalsView() {
  const [openId, setOpenId] = useUiState<string | null>("goals.open", null, { scope: "tab", validate: isNullableString });
  const [showClosed, setShowClosed] = useUiState("goals.showClosed", false);
  const { goals, addGoal, updateGoal } = useStudyStore();
  const active = goals.filter((goal) => goal.status === "active" || goal.status === "paused");
  const closed = goals.filter((goal) => goal.status === "done" || goal.status === "archived");
  const open = goals.find((goal) => goal.id === openId) ?? null;

  return (
    <div>
      <SectionTitle title="Obiettivi" subtitle="Traguardi di studio e personali. Aggiorna il progresso con + e −, clicca un obiettivo per modificarlo." />

      <NewGoalBar onAdd={(title, category) => addGoal({ title, category, progress: 0, metric: "%" })} />

      {active.length ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
          {active.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onOpen={() => setOpenId(goal.id)} onProgress={(progress) => void updateGoal(goal.id, { progress, status: progress >= 100 ? "done" : goal.status })} />
          ))}
        </div>
      ) : (
        <div className="quiet-panel p-8 text-center text-sm font-bold text-[var(--muted)]">Nessun obiettivo attivo. Creane uno qui sopra.</div>
      )}

      {closed.length ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            aria-expanded={showClosed}
            className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
          >
            <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${showClosed ? "rotate-90" : ""}`} />
            Raggiunti e archiviati · {closed.length}
          </button>
          {showClosed ? (
            <div className="grid gap-3 opacity-75 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
              {closed.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onOpen={() => setOpenId(goal.id)} onProgress={(progress) => void updateGoal(goal.id, { progress })} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <GoalDrawer goal={open} onClose={() => setOpenId(null)} onSave={(patch) => (open ? updateGoal(open.id, patch) : Promise.resolve())} />
    </div>
  );
}

function NewGoalBar({ onAdd }: { onAdd: (title: string, category: Goal["category"]) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Goal["category"]>("study");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await onAdd(title.trim(), category);
    setTitle("");
  };
  return (
    <form onSubmit={submit} className="soft-panel mb-4 flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Nuovo obiettivo</span>
        <Icon name="Target" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
        <input className={`${inputClass} pl-10`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nuovo obiettivo (es. Finire il programma di Patologia)" />
      </label>
      <select
        className="min-h-11 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-bold"
        value={category}
        onChange={(event) => setCategory(event.target.value as Goal["category"])}
        aria-label="Categoria"
      >
        {categories.map((id) => (
          <option key={id} value={id}>
            {GOAL_CATEGORY_LABEL[id]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!title.trim()}
        className="motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-extrabold text-[#10131d] disabled:opacity-50"
      >
        <Icon name="Plus" className="h-4 w-4" /> Crea
      </button>
    </form>
  );
}

function GoalCard({ goal, onOpen, onProgress }: { goal: Goal; onOpen: () => void; onProgress: (progress: number) => void }) {
  const deadline = deadlineLabel(goal.deadline);
  return (
    <article className="quiet-panel flex min-w-0 flex-col p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid grid-cols-1 h-10 w-10 shrink-0 place-items-center rounded-super bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent-ink)]">
          <Icon name={CATEGORY_ICON[goal.category]} className="h-5 w-5" />
        </span>
        <button type="button" onClick={onOpen} aria-haspopup="dialog" className="min-w-0 flex-1 text-left">
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
              aria-label="Riduci progresso del 5%"
              onClick={() => onProgress(Math.max(0, goal.progress - 5))}
              className="relative grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] hover:bg-[var(--surface)] after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
            >
              −
            </button>
            <span className="w-10 text-center tabular-nums">{goal.progress}%</span>
            <button
              type="button"
              aria-label="Aumenta progresso del 5%"
              onClick={() => onProgress(Math.min(100, goal.progress + 5))}
              className="relative grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] hover:bg-[var(--surface)] after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
            >
              +
            </button>
          </span>
        </div>
        <ProgressBar value={goal.progress} color={goal.status === "done" ? "var(--ok)" : undefined} />
      </div>
    </article>
  );
}

function GoalDrawer({ goal, onClose, onSave }: { goal: Goal | null; onClose: () => void; onSave: (patch: Partial<Goal>) => Promise<void> }) {
  const [draft, setDraft] = useState({ title: "", description: "", category: "study" as Goal["category"], deadline: "", metric: "", progress: 0, status: "active" as Goal["status"], notes: "" });

  useEffect(() => {
    if (!goal) return;
    setDraft({
      title: goal.title,
      description: goal.description,
      category: goal.category,
      deadline: goal.deadline?.slice(0, 10) ?? "",
      metric: goal.metric,
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
      metric: draft.metric.trim(),
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
      title={goal?.title ?? ""}
      width="max-w-[520px]"
      footer={
        <div className="flex items-center gap-2">
          <Button
            variant="soft"
            icon="Archive"
            onClick={() => {
              if (!goal) return;
              void onSave({ status: goal.status === "archived" ? "active" : "archived" }).then(onClose);
            }}
          >
            {goal?.status === "archived" ? "Ripristina" : "Archivia"}
          </Button>
          <span className="flex-1" />
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={!draft.title.trim()}>
            Salva
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <Field label="Titolo">
          <input className={inputClass} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} />
        </Field>
        <Field label="Descrizione">
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
            <select className={inputClass} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as Goal["status"] }))}>
              {(Object.keys(GOAL_STATUS_LABEL) as Goal["status"][]).map((id) => (
                <option key={id} value={id}>
                  {GOAL_STATUS_LABEL[id]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scadenza">
            <input className={inputClass} type="date" value={draft.deadline} onChange={(event) => setDraft((value) => ({ ...value, deadline: event.target.value }))} />
          </Field>
          <Field label="Metrica">
            <input className={inputClass} value={draft.metric} onChange={(event) => setDraft((value) => ({ ...value, metric: event.target.value }))} placeholder="Es. ore/settimana" />
          </Field>
        </div>
        <Field label={`Progresso · ${draft.progress}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.progress}
            onChange={(event) => setDraft((value) => ({ ...value, progress: Number(event.target.value) }))}
            className="w-full accent-[var(--accent)]"
          />
        </Field>
        <Field label="Note">
          <textarea className={`${inputClass} min-h-20 py-3`} value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} />
        </Field>
      </div>
    </Drawer>
  );
}
