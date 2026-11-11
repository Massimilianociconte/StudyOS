import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, DIMMED_DISABLED_FIELDS, Drawer, Field, Panel, Segmented, inputClass } from "../ui";
import { Icon } from "../Icon";
import { DateField, DateTimeField } from "../DatePicker";
import { SharedMark } from "../SharedMark";
import { ColorPalette, ColorPreview } from "./ColorPalette";
import { ReminderList } from "./ReminderList";
import { RepeatPicker } from "./RepeatPicker";
import type { CalendarEvent, EventCategory, Subject, Task } from "../../types";
import {
  changeStart,
  draftColor,
  draftDuration,
  draftPatch,
  draftRuleDay,
  DURATION_CHOICES,
  editorChanges,
  occurrenceDayText,
  setDraftAllDay,
  setDraftDuration,
  validateDraft,
  type ColorContext,
  type EventDraft
} from "../../lib/eventEditor";
import { eventTypeIcon, eventTypeKey, eventTypeLabel, type TypeColorOverrides } from "../../lib/eventColors";
import { describeRule, isOccurrenceRow } from "../../lib/repeat";
import { normalizeExternalUrl, safeHref } from "../../lib/safeUrl";
import { safeCssColor, type SharedOrigin } from "../../lib/sharing";
import { selectableSubjects } from "../../lib/selectors";
import { isValidTimeZone } from "../../lib/tz";
import {
  EVENT_CATEGORY_LABEL,
  EVENT_EDITOR_TEXT,
  EVENT_STATUS_LABEL,
  NO_SUBJECT_LABEL,
  PRIORITY_LABEL,
  eventLinkLabel,
  formatMinutes
} from "../../lib/labels";

/** Calendario di un'altra persona in cui posso aggiungere eventi, con le sue materie condivise. */
export interface EditorCalendar {
  ownerId: string;
  name: string;
  subjects: { id: string; name: string; color: string }[];
  subjectRequired: boolean;
}

/** Ciò che il modulo consegna a chi salva. */
export interface EditorSubmit {
  kind: "event" | "task";
  /** "" = il mio calendario, altrimenti l'id del proprietario. */
  ownerId: string;
  draft: EventDraft;
  /** Tutti i campi del modulo. */
  patch: Partial<CalendarEvent>;
  /** Solo i campi cambiati da quando il modulo è aperto (orari e ripetizione insieme). */
  changes: Partial<CalendarEvent>;
}

const CATEGORY_OPTIONS = (Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((id) => ({ id, label: EVENT_CATEGORY_LABEL[id] }));

/** Pulsante in attesa del salvataggio: sembra spento ma tiene il fuoco (vedi Salva ed Elimina). */
const WAITING_CLASS = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:scale-100";

/**
 * Un solo modulo (Drawer) per creare e modificare un evento: Principali · Aspetto e collocazione ·
 * Altre opzioni (chiuse all'inizio). Salva e Annulla sempre visibili; chiudere con modifiche non
 * salvate chiede conferma. Chi lo usa decide come salvare (serie, singolo giorno, calendario altrui).
 */
export function EventEditor({
  heading,
  initial,
  base: baseDraft,
  event,
  occurrenceDate,
  subjects,
  overrides,
  occasionKind: occasionKindProp,
  sharedFrom,
  calendars = [],
  createKind,
  repeatNote,
  typeExtra,
  deleteConfirmText,
  onClose,
  onSubmit,
  onDelete,
  onDirtyChange
}: {
  heading: string;
  initial: EventDraft;
  /** Bozza dell'evento salvato, se il modulo parte già con modifiche (es. dal modulo semplice). */
  base?: EventDraft;
  /** Evento modificato (assente in creazione): per l'appello importato e l'id. */
  event?: CalendarEvent;
  /** Giorno dell'occorrenza aperta di una serie (YYYY-MM-DD). */
  occurrenceDate?: string;
  subjects: Subject[];
  overrides?: TypeColorOverrides;
  /** Tipo della ricorrenza in creazione (dal modulo semplice): il colore automatico è il suo. */
  occasionKind?: string;
  /** Evento di un'altra persona: sola lettura senza `canEdit`, materia del proprietario non modificabile. */
  sharedFrom?: SharedOrigin;
  /** Creazione: calendari altrui in cui posso aggiungere eventi ("Nel calendario di"). */
  calendars?: EditorCalendar[];
  /** Presente = creazione: "event" o "task" all'apertura. */
  createKind?: "event" | "task";
  /** Avviso sotto la ripetizione. */
  repeatNote?: string;
  /** Scelte in più accanto alla tipologia (es. ricorrenze), con la bozza attuale (titolo già scritto). */
  typeExtra?: (draft: EventDraft) => ReactNode;
  /** Testo della conferma prima di `onDelete`; assente = `onDelete` chiede da sé (es. scelta della portata). */
  deleteConfirmText?: string;
  onClose: () => void;
  /** Un testo restituito è un errore da mostrare accanto ai pulsanti (il modulo resta aperto). */
  onSubmit: (submit: EditorSubmit) => Promise<string | void>;
  onDelete?: () => Promise<string | void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const creating = createKind !== undefined;
  const readOnly = Boolean(sharedFrom && !sharedFrom.canEdit);
  // Bozza all'apertura: il confronto con questa dice cosa è stato cambiato qui (anche se l'evento
  // cambia nello store mentre il modulo è aperto).
  const [base] = useState(baseDraft ?? initial);
  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState<"event" | "task">(createKind ?? "event");
  const [ownerId, setOwnerId] = useState("");
  const [ownerNotice, setOwnerNotice] = useState("");
  const [taskPriority, setTaskPriority] = useState<Task["priority"]>("medium");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"unsaved" | "delete" | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");

  // Calendario scelto non più modificabile (permesso tolto a modulo aperto): si torna al mio, senza la
  // materia dell'altra persona, e lo si dice.
  const target = ownerId ? calendars.find((calendar) => calendar.ownerId === ownerId) : undefined;
  useEffect(() => {
    if (!ownerId || target) return;
    setOwnerId("");
    setDraft((value) => ({ ...value, subjectId: "" }));
    setOwnerNotice(EVENT_EDITOR_TEXT.calendarGone);
  }, [ownerId, target]);
  const inOtherCalendar = kind === "event" && Boolean(target);
  const subjectRequired = inOtherCalendar && Boolean(target?.subjectRequired);

  const occasionKind = event?.occasion?.kind ?? occasionKindProp;
  const colorContext = (subjectId: string): ColorContext => {
    if (sharedFrom) return { subjectColor: sharedFrom.subjectColor, overrides, occasionKind };
    if (target) return { subjectColor: target.subjects.find((subject) => subject.id === subjectId)?.color, overrides, occasionKind };
    return { subjectColor: subjects.find((subject) => subject.id === subjectId)?.color, overrides, occasionKind };
  };
  const subjectOptions = inOtherCalendar && target ? target.subjects : selectableSubjects(subjects, draft.subjectId);

  const initialPatch = useMemo(() => draftPatch(base), [base]);
  const patch = draftPatch(draft);
  const changes = editorChanges(initialPatch, patch);
  const dirty = !readOnly && (Object.keys(changes).length > 0 || kind !== (createKind ?? "event") || ownerId !== "" || (kind === "task" && taskPriority !== "medium"));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const startDate = draft.start.slice(0, 10);
  // La ripetizione vale nel fuso dell'evento: il suo giorno può non essere quello mostrato (altro fuso).
  const eventZone = event?.timeZone;
  const zone = isValidTimeZone(eventZone) ? eventZone : undefined;
  const ruleDay = draftRuleDay(draft, zone);
  const liveError = (() => {
    const message = validateDraft({ ...draft, title: draft.title || "x" });
    return message === EVENT_EDITOR_TEXT.endBeforeStart || message === EVENT_EDITOR_TEXT.lastDayBeforeFirst || message === EVENT_EDITOR_TEXT.repeatEndsEarly ? message : "";
  })();

  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirm("unsaved");
    else onClose();
  };

  const update = (change: (value: EventDraft) => EventDraft) => {
    setError("");
    setDraft(change);
  };
  // Spostare un giorno di una serie non ne cambia la regola (la cambia solo chi la sceglie).
  const moveStart = (current: EventDraft, value: string) => (occurrenceDate ? { ...changeStart(current, value, zone), repeat: current.repeat } : changeStart(current, value, zone));
  const setCategory = (category: EventCategory) => update((value) => ({ ...value, category, color: draftColor({ ...value, category }, colorContext(value.subjectId)) }));
  const setSubject = (subjectId: string) => update((value) => ({ ...value, subjectId, color: draftColor(value, colorContext(subjectId)) }));

  const submit = async () => {
    if (busy || readOnly) return;
    const message = kind === "task" ? (draft.title.trim() ? (Number.isNaN(new Date(draft.start).getTime()) ? EVENT_EDITOR_TEXT.dateMissing : "") : EVENT_EDITOR_TEXT.titleMissing) : validateDraft(draft, { subjectRequired });
    if (message) {
      setError(message);
      return;
    }
    if (!creating && !Object.keys(changes).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const failure = await onSubmit({
        kind,
        ownerId: inOtherCalendar ? ownerId : "",
        draft: kind === "task" ? { ...draft, priority: taskPriority } : draft,
        patch,
        changes
      });
      if (failure) setError(failure);
    } catch {
      setError(creating ? EVENT_EDITOR_TEXT.addFailed : EVENT_EDITOR_TEXT.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete || busy) return;
    setBusy(true);
    setError("");
    try {
      const failure = await onDelete();
      if (failure) setError(failure);
    } catch {
      setError(EVENT_EDITOR_TEXT.deleteFailed);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const addLink = () => {
    const url = normalizeExternalUrl(linkText.trim());
    if (!url) {
      setLinkError(EVENT_EDITOR_TEXT.linkInvalid);
      return;
    }
    setLinkError("");
    setLinkText("");
    if (!draft.links.includes(url)) update((value) => ({ ...value, links: [...value.links, url] }));
  };

  const typeKey = eventTypeKey({ category: draft.category, occasionKind });
  const autoColor = draftColor({ ...draft, colorCustom: false }, colorContext(draft.subjectId));
  const duration = draftDuration(draft);
  const imported = event?.tags?.includes("appello-importato");
  // Evento di un'altra persona (aperto o in creazione nel suo calendario): i promemoria sono personali,
  // suonerebbero sui suoi dispositivi, quindi qui non ci sono. Un suo giorno cambiato da solo non prende una regola.
  const othersEvent = Boolean(sharedFrom) || inOtherCalendar;
  const sharedRow = Boolean(sharedFrom && event && isOccurrenceRow(event));
  const moreHint = draft.repeat
    ? describeRule(draft.repeat, ruleDay)
    : othersEvent
      ? imported || inOtherCalendar
        ? EVENT_EDITOR_TEXT.sectionMoreHintOtherNoLinks
        : EVENT_EDITOR_TEXT.sectionMoreHintOther
      : imported
        ? EVENT_EDITOR_TEXT.sectionMoreHintNoLinks
        : EVENT_EDITOR_TEXT.sectionMoreHint;

  const footer = (
    <div className="grid grid-cols-1 gap-2">
      {error ? (
        <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {confirm === "unsaved" ? (
        <div role="group" aria-label={EVENT_EDITOR_TEXT.unsavedTitle} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="text-sm font-black">{EVENT_EDITOR_TEXT.unsavedTitle}</p>
          <p className="text-sm font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.unsavedText}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={() => setConfirm(null)} autoFocus>
              {EVENT_EDITOR_TEXT.unsavedKeep}
            </Button>
            <Button variant="danger" icon="X" onClick={onClose}>
              {EVENT_EDITOR_TEXT.unsavedDiscard}
            </Button>
          </div>
        </div>
      ) : confirm === "delete" && deleteConfirmText ? (
        <div role="group" aria-label={EVENT_EDITOR_TEXT.delete} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="safe-text text-sm font-bold">{deleteConfirmText}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={() => setConfirm(null)} disabled={busy} autoFocus>
              {EVENT_EDITOR_TEXT.cancel}
            </Button>
            <Button variant="danger" icon="Trash2" onClick={() => void remove()} disabled={busy}>
              {EVENT_EDITOR_TEXT.deleteAction}
            </Button>
          </div>
        </div>
      ) : readOnly ? (
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {EVENT_EDITOR_TEXT.close}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {onDelete ? (
            // Sul telefono solo l'icona (il nome resta per i lettori di schermo): Annulla e Salva stanno in riga.
            // In attesa resta raggiungibile (aria-disabled, non disabled): chiusa la scelta "solo questo /
            // tutti", il fuoco torna qui e non sulla pagina dietro.
            <Button
              variant="danger"
              icon="Trash2"
              title={EVENT_EDITOR_TEXT.delete}
              className={`px-3 sm:px-4 ${WAITING_CLASS}`}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                if (deleteConfirmText) setConfirm("delete");
                else void remove();
              }}
            >
              <span className="sr-only sm:not-sr-only">{EVENT_EDITOR_TEXT.delete}</span>
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="soft" onClick={requestClose} disabled={busy}>
            {EVENT_EDITOR_TEXT.cancel}
          </Button>
          <Button variant="primary" icon={creating ? "Plus" : "Check"} className={WAITING_CLASS} onClick={() => void submit()} aria-disabled={busy || undefined}>
            {creating ? (kind === "task" ? EVENT_EDITOR_TEXT.saveTask : EVENT_EDITOR_TEXT.saveCreate) : EVENT_EDITOR_TEXT.save}
          </Button>
        </div>
      )}
    </div>
  );

  const subjectField = sharedFrom ? (
    <Field label={EVENT_EDITOR_TEXT.subject}>
      {/* La materia è del proprietario e decide cosa è condiviso: si mostra, non si cambia. */}
      <span className={`${inputClass} flex items-center text-[var(--muted)] opacity-60`} title={EVENT_EDITOR_TEXT.subjectOwner}>
        {sharedFrom.subjectName ?? NO_SUBJECT_LABEL}
      </span>
    </Field>
  ) : (
    <Field label={subjectRequired ? EVENT_EDITOR_TEXT.subject : EVENT_EDITOR_TEXT.subjectOptional}>
      <select className={inputClass} value={draft.subjectId} onChange={(e) => setSubject(e.target.value)}>
        {subjectRequired ? (
          <option value="" disabled>
            {subjectOptions.length ? EVENT_EDITOR_TEXT.subjectChoose : EVENT_EDITOR_TEXT.subjectNoneShared}
          </option>
        ) : (
          <option value="">{EVENT_EDITOR_TEXT.subjectNone}</option>
        )}
        {subjectOptions.map((subject) => (
          <option key={subject.id} value={subject.id}>
            {subject.name}
          </option>
        ))}
      </select>
    </Field>
  );

  const sectionTitle = (text: string) => <h3 className="text-xs font-black uppercase tracking-wide text-[var(--faint)]">{text}</h3>;

  return (
    <Drawer
      open
      onClose={requestClose}
      title={creating ? (kind === "task" ? EVENT_EDITOR_TEXT.newTask : EVENT_EDITOR_TEXT.newEvent) : heading}
      headerExtra={
        occurrenceDate ? (
          <p className="text-sm font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.occurrenceOf(occurrenceDayText(occurrenceDate))}</p>
        ) : sharedFrom && draft.repeat ? (
          <p className="text-sm font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.sharedSeries}</p>
        ) : creating && kind === "task" ? (
          <p className="text-sm font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.taskHint}</p>
        ) : undefined
      }
      footer={footer}
    >
      <div className="grid grid-cols-1 gap-5">
        {sharedFrom ? (
          <p className="flex flex-wrap items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
            <SharedMark origin={sharedFrom} />
            <span className="min-w-0 flex-1">{readOnly ? EVENT_EDITOR_TEXT.sharedReadOnly : EVENT_EDITOR_TEXT.sharedEditable(sharedFrom.ownerName.trim().split(/\s+/)[0] || sharedFrom.ownerName)}</span>
          </p>
        ) : null}
        {imported && event ? (
          <Panel className="p-3">
            <h4 className="font-black">{sharedFrom ? EVENT_EDITOR_TEXT.importedTitleShared : EVENT_EDITOR_TEXT.importedTitle}</h4>
            <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{event.description}</p>
            <p className="mt-2 whitespace-pre-line text-xs text-[var(--muted)]">{event.notes}</p>
            {event.links.map((url) => {
              const href = safeHref(url);
              // «Ufficiale UniMi» solo se il link porta davvero a unimi.it.
              return (
                <a key={url} href={href} target="_blank" rel="noreferrer" className="safe-text mt-2 inline-block text-sm font-bold text-[var(--accent-ink)] underline">
                  {eventLinkLabel(href)}
                </a>
              );
            })}
            {sharedFrom ? null : <p className="mt-2 text-xs text-[var(--muted)]">{EVENT_EDITOR_TEXT.importedHint}</p>}
          </Panel>
        ) : null}

        <fieldset disabled={readOnly} className={`m-0 grid min-w-0 grid-cols-1 gap-5 border-0 p-0 ${DIMMED_DISABLED_FIELDS}`}>
          <section className="grid grid-cols-1 gap-3" aria-label={EVENT_EDITOR_TEXT.sectionMain}>
            {sectionTitle(EVENT_EDITOR_TEXT.sectionMain)}
            {creating ? (
              <Segmented
                label={EVENT_EDITOR_TEXT.kindLabel}
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setError("");
                  // Una materia di un'altra persona non resta su un'attività mia (né viceversa).
                  if (ownerId) setDraft((value) => ({ ...value, subjectId: "" }));
                }}
                className="justify-self-start"
                options={[
                  { id: "event", label: EVENT_EDITOR_TEXT.kindEvent, icon: "CalendarDays", title: EVENT_EDITOR_TEXT.kindEventTitle },
                  { id: "task", label: EVENT_EDITOR_TEXT.kindTask, icon: "Check", title: EVENT_EDITOR_TEXT.kindTaskTitle }
                ]}
              />
            ) : null}
            {creating && kind === "event" && calendars.length ? (
              <Field label={EVENT_EDITOR_TEXT.calendarOf}>
                <select
                  className={inputClass}
                  value={ownerId}
                  onChange={(e) => {
                    setOwnerId(e.target.value);
                    setOwnerNotice("");
                    setError("");
                    setDraft((value) => ({ ...value, subjectId: "" }));
                  }}
                >
                  <option value="">{EVENT_EDITOR_TEXT.myCalendar}</option>
                  {calendars.map((calendar) => (
                    <option key={calendar.ownerId} value={calendar.ownerId}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {ownerNotice && kind === "event" ? (
              <p role="status" className="text-xs font-bold text-[var(--muted)]">
                {ownerNotice}
              </p>
            ) : null}
            <Field label={EVENT_EDITOR_TEXT.title}>
              <input
                className={inputClass}
                value={draft.title}
                data-autofocus={creating ? true : undefined}
                placeholder={kind === "task" ? EVENT_EDITOR_TEXT.taskTitlePlaceholder : EVENT_EDITOR_TEXT.titlePlaceholder}
                onChange={(e) => update((value) => ({ ...value, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </Field>
            {kind === "task" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DateTimeField label={EVENT_EDITOR_TEXT.due} value={draft.start} onChange={(value) => update((current) => changeStart(current, value))} />
                {subjectField}
                <Field label={EVENT_EDITOR_TEXT.priority}>
                  <select className={inputClass} value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as Task["priority"])}>
                    {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
                      <option key={key} value={key}>
                        {PRIORITY_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : (
              <>
                <label className={`flex min-h-11 items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3 py-2 text-sm font-bold ${readOnly ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" checked={draft.allDay} onChange={(e) => update((value) => setDraftAllDay(value, e.target.checked))} />
                  <span className="min-w-0 flex-1">
                    {EVENT_EDITOR_TEXT.allDay}
                    <span className="block text-xs font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.allDayHint}</span>
                  </span>
                </label>
                {draft.allDay ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DateField label={EVENT_EDITOR_TEXT.firstDay} value={startDate} onChange={(value) => value && update((current) => moveStart(current, `${value}T${current.start.slice(11, 16) || "00:00"}`))} />
                    <DateField
                      label={EVENT_EDITOR_TEXT.lastDay}
                      value={draft.end.slice(0, 10)}
                      min={startDate}
                      onChange={(value) => value && update((current) => ({ ...current, end: `${value}T${current.end.slice(11, 16) || "00:00"}` }))}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DateTimeField label={EVENT_EDITOR_TEXT.start} value={draft.start} onChange={(value) => update((current) => moveStart(current, value))} />
                    <DateTimeField label={EVENT_EDITOR_TEXT.end} value={draft.end} min={draft.start} onChange={(value) => update((current) => ({ ...current, end: value }))} />
                    <Field label={EVENT_EDITOR_TEXT.duration} className="sm:col-span-2">
                      <select
                        className={inputClass}
                        value={DURATION_CHOICES.includes(duration as (typeof DURATION_CHOICES)[number]) ? String(duration) : "custom"}
                        onChange={(e) => {
                          const minutes = Number(e.target.value);
                          if (Number.isFinite(minutes) && minutes > 0) update((value) => setDraftDuration(value, minutes));
                        }}
                      >
                        {DURATION_CHOICES.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {formatMinutes(minutes)}
                          </option>
                        ))}
                        <option value="custom" disabled>
                          {duration ? `${EVENT_EDITOR_TEXT.durationCustom}: ${formatMinutes(duration)}` : EVENT_EDITOR_TEXT.durationCustom}
                        </option>
                      </select>
                    </Field>
                    <p className="-mt-1 text-xs font-bold text-[var(--muted)] sm:col-span-2">{EVENT_EDITOR_TEXT.endFollows}</p>
                  </div>
                )}
                {liveError ? (
                  <p role="status" className="text-sm font-bold text-[var(--danger-text)]">
                    {liveError}
                  </p>
                ) : null}
              </>
            )}
          </section>

          {kind === "event" ? (
            <>
              <section className="grid grid-cols-1 gap-3" aria-label={EVENT_EDITOR_TEXT.sectionLook}>
                {sectionTitle(EVENT_EDITOR_TEXT.sectionLook)}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={EVENT_EDITOR_TEXT.type}>
                    <select className={inputClass} value={draft.category} onChange={(e) => setCategory(e.target.value as EventCategory)}>
                      {CATEGORY_OPTIONS.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {subjectField}
                </div>
                {typeExtra?.(draft)}
                <ColorPalette
                  label={EVENT_EDITOR_TEXT.color}
                  value={draft.color}
                  custom={draft.colorCustom}
                  autoColor={autoColor}
                  autoLabel={EVENT_EDITOR_TEXT.colorAuto(eventTypeLabel(typeKey))}
                  onAuto={() => update((value) => ({ ...value, colorCustom: false, color: draftColor({ ...value, colorCustom: false }, colorContext(value.subjectId)) }))}
                  onPick={(hex) => update((value) => ({ ...value, colorCustom: true, color: safeCssColor(hex) || value.color }))}
                  disabled={readOnly}
                />
                {draft.colorCustom ? null : <p className="-mt-1 text-xs font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.colorAutoHint}</p>}
                <ColorPreview color={draft.color} icon={eventTypeIcon(typeKey)} title={draft.title.trim() || eventTypeLabel(typeKey)} meta={draft.allDay ? EVENT_EDITOR_TEXT.allDay : draft.start.slice(11, 16)} />
              </section>

              <details className="quiet-panel p-4">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-extrabold">
                  <span>{EVENT_EDITOR_TEXT.sectionMore}</span>
                  <span className="min-w-0 flex-1 truncate font-bold text-[var(--muted)]">· {moreHint}</span>
                  <Icon name="ChevronDown" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-4">
                  <RepeatPicker
                    value={draft.repeat}
                    start={ruleDay}
                    onChange={(rule) => update((value) => ({ ...value, repeat: rule }))}
                    disabled={readOnly || sharedRow}
                    note={sharedRow ? EVENT_EDITOR_TEXT.repeatSharedRow : repeatNote}
                  />
                  {othersEvent ? (
                    <p className="text-xs font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.remindersPersonal}</p>
                  ) : (
                    <ReminderList value={draft.reminders} allDay={draft.allDay} onChange={(reminders) => update((value) => ({ ...value, reminders }))} disabled={readOnly} />
                  )}
                  <Field label={EVENT_EDITOR_TEXT.description}>
                    <textarea
                      className={`${inputClass} min-h-20 py-3`}
                      value={draft.description}
                      placeholder={EVENT_EDITOR_TEXT.descriptionPlaceholder}
                      onChange={(e) => update((value) => ({ ...value, description: e.target.value }))}
                    />
                  </Field>
                  <Field label={EVENT_EDITOR_TEXT.location}>
                    <input className={inputClass} value={draft.location} placeholder={EVENT_EDITOR_TEXT.locationPlaceholder} onChange={(e) => update((value) => ({ ...value, location: e.target.value }))} />
                  </Field>
                  {imported ? null : inOtherCalendar ? (
                    <p className="text-xs font-bold text-[var(--muted)]">{EVENT_EDITOR_TEXT.linksOtherCalendar}</p>
                  ) : (
                    <fieldset className="m-0 min-w-0 border-0 p-0">
                      <legend className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{EVENT_EDITOR_TEXT.links}</legend>
                      {draft.links.length ? (
                        <ul className="mb-2 grid grid-cols-1 gap-1">
                          {draft.links.map((url) => {
                            const href = safeHref(url);
                            const label = eventLinkLabel(href);
                            return (
                              <li key={url} className="flex min-h-11 min-w-0 items-center gap-2 rounded-[14px] bg-[var(--surface-soft)] pl-3">
                                <Icon name="Link" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                                {href ? (
                                  <a href={href} target="_blank" rel="noreferrer" className="safe-text min-w-0 flex-1 truncate text-sm font-bold text-[var(--accent-ink)] underline">
                                    {label}
                                  </a>
                                ) : (
                                  <span className="safe-text min-w-0 flex-1 truncate text-sm font-bold text-[var(--muted)]">{url}</span>
                                )}
                                <button
                                  type="button"
                                  aria-label={EVENT_EDITOR_TEXT.linkRemove(label)}
                                  onClick={() => update((value) => ({ ...value, links: value.links.filter((item) => item !== url) }))}
                                  className="grid h-11 w-11 shrink-0 grid-cols-1 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--text)]"
                                >
                                  <Icon name="X" className="h-4 w-4" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      <div className="flex min-w-0 gap-2">
                        <input
                          className={`${inputClass} min-w-0 flex-1`}
                          value={linkText}
                          inputMode="url"
                          aria-label={EVENT_EDITOR_TEXT.linkAdd}
                          placeholder={EVENT_EDITOR_TEXT.linkPlaceholder}
                          onChange={(e) => {
                            setLinkText(e.target.value);
                            setLinkError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addLink();
                            }
                          }}
                        />
                        <Button variant="soft" icon="Plus" onClick={addLink} disabled={!linkText.trim()}>
                          <span className="sr-only sm:not-sr-only">{EVENT_EDITOR_TEXT.linkAdd}</span>
                        </Button>
                      </div>
                      {linkError ? (
                        <p role="alert" className="mt-1.5 text-xs font-bold text-[var(--danger-text)]">
                          {linkError}
                        </p>
                      ) : null}
                    </fieldset>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={EVENT_EDITOR_TEXT.priority}>
                      <select className={inputClass} value={draft.priority} onChange={(e) => update((value) => ({ ...value, priority: e.target.value as CalendarEvent["priority"] }))}>
                        {(Object.keys(PRIORITY_LABEL) as CalendarEvent["priority"][]).map((key) => (
                          <option key={key} value={key}>
                            {PRIORITY_LABEL[key]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={EVENT_EDITOR_TEXT.status}>
                      <select className={inputClass} value={draft.status} onChange={(e) => update((value) => ({ ...value, status: e.target.value as CalendarEvent["status"] }))}>
                        {(Object.keys(EVENT_STATUS_LABEL) as CalendarEvent["status"][]).map((key) => (
                          <option key={key} value={key}>
                            {EVENT_STATUS_LABEL[key]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              </details>
            </>
          ) : null}
        </fieldset>
      </div>
    </Drawer>
  );
}
