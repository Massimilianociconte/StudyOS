import { useId, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import { sharedOfTypes, useSharedStore } from "../store/useSharedStore";
import { originOf, type SharedItem, type SharedOrigin } from "../lib/sharing";
import { EXAM_STATUS_LABEL, GOAL_STATUS_LABEL, SESSION_STATUS_LABEL, TASK_STATUS_LABEL, capitalizeFirst, sharedEntityLabel } from "../lib/labels";
import { SharedMark, sharedCardStyle } from "./SharedMark";
import { SharedItemDrawer } from "./SharedItemDrawer";

// Tutto ciò che arriva da un'altra persona è testo non fidato: si legge solo se ha il tipo atteso.
const text = (value: unknown) => (typeof value === "string" ? value : "");
const label = (labels: Record<string, string>, value: unknown) =>
  typeof value === "string" && Object.hasOwn(labels, value) ? labels[value] : "";
const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
const fallbackTitle = (type: string) => capitalizeFirst(sharedEntityLabel(type));

/** Data nel fuso locale ("" se manca o non si legge). */
const dateOf = (value: unknown, pattern = "d MMM") => {
  if (typeof value !== "string" || !value) return "";
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, pattern, { locale: it });
};

const phrase = (prefix: string, value: string) => (value ? `${prefix} ${value}` : "");

/** Titolo e riga di dettaglio di un elemento altrui, per tipo. */
export const sharedSummary = (entry: SharedItem, origin: SharedOrigin) => {
  const entity = entry.entity;
  switch (entry.entityType) {
    case "task":
      return {
        title: text(entity.title) || fallbackTitle("task"),
        detail: join(phrase("Scade il", dateOf(entity.dueDate)), label(TASK_STATUS_LABEL, entity.status)),
        done: entity.status === "done"
      };
    case "studySession":
      return {
        title: text(entity.title) || fallbackTitle("studySession"),
        detail: join(dateOf(entity.start, "d MMM · HH:mm"), typeof entity.plannedMinutes === "number" ? `${entity.plannedMinutes} min` : "", label(SESSION_STATUS_LABEL, entity.status)),
        done: entity.status === "completed"
      };
    case "studyTopic":
      return { title: text(entity.title) || fallbackTitle("studyTopic"), detail: phrase("Ripasso il", dateOf(entity.nextReviewDate)), done: false };
    case "exam":
      return {
        title: origin.subjectName || fallbackTitle("exam"),
        detail: join(dateOf(entity.date, "d MMM yyyy"), label(EXAM_STATUS_LABEL, entity.status), typeof entity.preparation === "number" ? `Preparazione ${entity.preparation}%` : ""),
        done: false
      };
    case "attachment":
      return { title: text(entity.name) || fallbackTitle("attachment"), detail: text(entity.description).slice(0, 90), done: false };
    case "note":
      return { title: text(entity.title) || fallbackTitle("note"), detail: text(entity.body).slice(0, 90), done: false };
    case "goal":
      return {
        title: text(entity.title) || fallbackTitle("goal"),
        detail: join(typeof entity.progress === "number" ? `${entity.progress}%` : "", label(GOAL_STATUS_LABEL, entity.status)),
        done: entity.status === "done"
      };
    default:
      return { title: text(entity.title) || fallbackTitle(entry.entityType), detail: "", done: false };
  }
};

interface OpenItem {
  key: string;
  entry: SharedItem;
  origin: SharedOrigin;
  title: string;
}

/** Gruppo "Condivisi con te" in fondo a una lista: elementi di altre persone, separati dai propri. */
export function SharedSection({ entityTypes, title = "Condivisi con te" }: { entityTypes: readonly string[]; title?: string }) {
  const headingId = useId();
  const { items, received, labels, hiddenOwners } = useSharedStore(
    useShallow((state) => ({ items: state.items, received: state.received, labels: state.labels, hiddenOwners: state.hiddenOwners }))
  );
  const [opened, setOpened] = useState<OpenItem | null>(null);
  const typesKey = entityTypes.join(",");
  const entries = useMemo(
    () =>
      sharedOfTypes({ items, hiddenOwners }, typesKey.split(","))
        .map((entry) => {
          const origin = originOf(received, entry, labels);
          return { entry, origin, summary: sharedSummary(entry, origin) };
        })
        .sort((a, b) => a.origin.ownerName.localeCompare(b.origin.ownerName, "it") || a.summary.title.localeCompare(b.summary.title, "it")),
    [items, hiddenOwners, typesKey, received, labels]
  );

  // Finché l'elemento c'è, il dettaglio mostra la sua versione più recente. Se sparisce mentre è aperto
  // (condivisione tolta, eliminato dal proprietario) resta ciò che c'era: chi scrive non perde il testo,
  // e "Salva" spiega perché non si può più (il salvataggio rilegge sempre l'ultima versione).
  const live = opened ? entries.find((candidate) => candidate.entry.key === opened.key) : undefined;
  const shown = opened && live ? { key: opened.key, entry: live.entry, origin: live.origin, title: live.summary.title } : opened;
  const drawer = shown ? <SharedItemDrawer key={shown.key} entry={shown.entry} origin={shown.origin} title={shown.title} onClose={() => setOpened(null)} /> : null;
  if (!entries.length) return drawer;

  return (
    <section className="mt-6" aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-3 text-lg font-black">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {entries.map(({ entry, origin, summary }) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setOpened({ key: entry.key, entry, origin, title: summary.title })}
            className="quiet-panel flex min-w-0 items-start gap-3 p-3 text-left hover:brightness-105"
            style={sharedCardStyle(origin)}
          >
            <span className="min-w-0 flex-1">
              <span className={`one-line-safe block text-sm font-extrabold ${summary.done ? "line-through opacity-70" : ""}`}>{summary.title}</span>
              {summary.detail ? <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{summary.detail}</span> : null}
            </span>
            <SharedMark origin={origin} />
          </button>
        ))}
      </div>
      {drawer}
    </section>
  );
}
