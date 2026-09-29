import { useEffect, useState, type FormEvent } from "react";
import type { Attachment, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate, studyDaysUntil } from "../lib/selectors";
import { readImageFile } from "../lib/files";
import { ATTACHMENT_KIND_ICON, SUBJECT_STATUS_LABEL, attachmentKind, formatHours } from "../lib/labels";
import { Button, Drawer, Field, IconButton, ProgressBar, SectionTitle, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { TopicManager } from "../components/TopicManager";
import { isNullableString, useUiState } from "../lib/uiState";

const SWATCHES = ["#7CF7C8", "#9FB7FF", "#F7A8C4", "#FFD37C", "#C8A2FF", "#7FE3F5", "#FFAE7C", "#A6E3A1"];

type StoreState = ReturnType<typeof useStudyStore.getState>;

const subjectStats = (subject: Subject, state: Pick<StoreState, "tasks" | "sessions" | "exams" | "attachments">) => {
  const subjectTasks = state.tasks.filter((task) => task.subjectId === subject.id && task.status !== "archived");
  const openTasks = subjectTasks.filter((task) => task.status !== "done");
  const completed = subjectTasks.length - openTasks.length;
  const studyMinutes = state.sessions
    .filter((session) => session.subjectId === subject.id && session.status === "completed")
    .reduce((sum, session) => sum + session.actualMinutes, 0);
  const exam = state.exams
    .filter((item) => item.subjectId === subject.id && item.status !== "done")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const materials = state.attachments.filter((attachment) => attachment.linkedEntityType === "subject" && attachment.linkedEntityId === subject.id);
  // Preparazione: quella dell'esame se esiste, altrimenti avanzamento delle task della materia.
  const progress = exam ? exam.preparation : subjectTasks.length ? Math.round((completed / subjectTasks.length) * 100) : 0;
  return { subjectTasks, openTasks, studyMinutes, exam, materials, progress };
};

export function SubjectsView() {
  const [openId, setOpenId] = useUiState<string | null>("subjects.open", null, { scope: "tab", validate: isNullableString });
  const [showArchived, setShowArchived] = useUiState("subjects.showArchived", false);
  const [showCompleted, setShowCompleted] = useUiState("subjects.showCompleted", false);
  const { subjects, tasks, sessions, exams, attachments, addSubject, updateSubject } = useStudyStore();
  const state = { tasks, sessions, exams, attachments };

  const isArchived = (subject: Subject) => subject.status === "archived" || subject.archived;
  const active = subjects.filter((subject) => !isArchived(subject) && subject.status !== "completed");
  // Materie superate (anche quelle registrate dal libretto): fuori dalla griglia principale.
  const completed = subjects.filter((subject) => !isArchived(subject) && subject.status === "completed");
  const archived = subjects.filter(isArchived);
  const open = subjects.find((subject) => subject.id === openId) ?? null;
  const totalCfu = active.reduce((sum, subject) => sum + (subject.cfu || 0), 0);

  const group = (label: string, items: Subject[], expanded: boolean, toggle: () => void) =>
    items.length ? (
      <div className="mt-6">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="mb-2 flex min-h-8 items-center gap-2 text-xs font-black uppercase text-[var(--faint)] hover:text-[var(--text)]"
        >
          <Icon name="ChevronRight" className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          {label} · {items.length}
        </button>
        {expanded ? (
          <div className="grid gap-3 opacity-75 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
            {items.map((subject) => (
              <SubjectCard
                key={subject.id}
                subject={subject}
                stats={subjectStats(subject, state)}
                onOpen={() => setOpenId(subject.id)}
                onStatus={(status) => void updateSubject(subject.id, { status })}
              />
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div>
      <SectionTitle title="Materie" subtitle={`${active.length} ${active.length === 1 ? "materia in corso" : "materie in corso"} · ${totalCfu} CFU. Clicca una materia per modificarla, gestirne materiali e argomenti.`} />

      <NewSubjectBar onAdd={async (name, color) => void (await addSubject({ name, color, status: "active", icon: "BookOpen" }))} />

      {active.length === 0 ? (
        <div className="quiet-panel p-8 text-center text-sm font-bold text-[var(--muted)]">
          Nessuna materia ancora. Aggiungine una qui sopra, oppure importa i corsi dalla sezione BARB · UNIMI.
        </div>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
          {active.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              stats={subjectStats(subject, state)}
              onOpen={() => setOpenId(subject.id)}
              onStatus={(status) => void updateSubject(subject.id, { status })}
            />
          ))}
        </div>
      )}

      {group("Superate", completed, showCompleted, () => setShowCompleted((value) => !value))}
      {group("Archiviate", archived, showArchived, () => setShowArchived((value) => !value))}

      <SubjectDrawer subject={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

function NewSubjectBar({ onAdd }: { onAdd: (name: string, color: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onAdd(name.trim(), color);
    setName("");
    setColor(SWATCHES[(SWATCHES.indexOf(color) + 1) % SWATCHES.length]);
  };
  return (
    <form onSubmit={submit} className="soft-panel mb-4 flex flex-col gap-2 p-2.5 md:flex-row md:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Nome nuova materia</span>
        <Icon name="Plus" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent-ink)]" />
        <input className={`${inputClass} pl-10`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nuova materia (es. Biochimica)" />
      </label>
      <div className="flex items-center gap-1.5 px-1" role="radiogroup" aria-label="Colore">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            role="radio"
            aria-checked={color === swatch}
            aria-label={`Colore ${swatch}`}
            onClick={() => setColor(swatch)}
            className={`h-7 w-7 rounded-full border-2 ${color === swatch ? "border-[var(--text)]" : "border-transparent"}`}
            style={{ background: swatch }}
          />
        ))}
      </div>
      <button
        type="submit"
        disabled={!name.trim()}
        className="motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-extrabold text-[#10131d] disabled:opacity-50"
      >
        <Icon name="Plus" className="h-4 w-4" /> Aggiungi
      </button>
    </form>
  );
}

function SubjectCard({
  subject,
  stats,
  onOpen,
  onStatus
}: {
  subject: Subject;
  stats: ReturnType<typeof subjectStats>;
  onOpen: () => void;
  onStatus: (status: Subject["status"]) => void;
}) {
  return (
    <article className="quiet-panel motion-safe group flex min-w-0 flex-col p-3.5 hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border))]">
      <div className="flex items-start gap-3">
        <span className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-super" style={{ background: subject.color }}>
          {subject.cover ? <img src={subject.cover} alt="" className="h-full w-full object-cover" /> : <Icon name={subject.icon} className="h-5 w-5 text-[#10131d]" />}
        </span>
        <button type="button" onClick={onOpen} aria-haspopup="dialog" className="min-w-0 flex-1 text-left">
          <h3 className="two-line-safe text-base font-black leading-snug">{subject.name}</h3>
          <p className="one-line-safe text-xs font-bold text-[var(--muted)]">{subject.teacher || "Docente non impostato"}</p>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-[var(--muted)]">
        <span>{subject.cfu} CFU</span>
        <span>{stats.openTasks.length} task aperte</span>
        <span>{formatHours(stats.studyMinutes)} h studio</span>
        {stats.materials.length ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="Paperclip" className="h-3 w-3" />
            {stats.materials.length}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-black">
          <span className="text-[var(--faint)] uppercase">{stats.exam ? "Preparazione esame" : "Avanzamento task"}</span>
          <span>{stats.progress}%</span>
        </div>
        <ProgressBar value={stats.progress} color={subject.color} />
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
        <select
          className="min-h-8 min-w-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 text-xs font-black"
          value={subject.status}
          onChange={(event) => onStatus(event.target.value as Subject["status"])}
          aria-label={`Stato di ${subject.name}`}
        >
          {(Object.keys(SUBJECT_STATUS_LABEL) as Subject["status"][]).map((status) => (
            <option key={status} value={status}>
              {SUBJECT_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        {stats.exam ? (
          <Tag className="shrink-0">
            <Icon name="GraduationCap" className="mr-1 inline h-3 w-3 align-[-2px]" />
            {shortDate(stats.exam.date)} · {studyDaysUntil(stats.exam.date)} gg
          </Tag>
        ) : null}
        <button type="button" onClick={onOpen} className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
          Dettagli <Icon name="ChevronRight" className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

function SubjectDrawer({ subject, onClose }: { subject: Subject | null; onClose: () => void }) {
  const { tasks, sessions, exams, attachments, subjects, updateSubject, addAttachment, updateAttachment, deleteAttachment, setActiveView } = useStudyStore();
  const [draft, setDraft] = useState({ name: "", teacher: "", cfu: "6", semester: "", targetGrade: "", color: SWATCHES[0], notes: "" });
  const [message, setMessage] = useState("");
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);

  useEffect(() => {
    if (!subject) return;
    setDraft({
      name: subject.name,
      teacher: subject.teacher,
      cfu: String(subject.cfu ?? 6),
      semester: subject.semester,
      targetGrade: subject.targetGrade ? String(subject.targetGrade) : "",
      color: subject.color,
      notes: subject.notes
    });
    setMessage("");
    setEditingAttachment(null);
  }, [subject?.id]);

  const stats = subject ? subjectStats(subject, { tasks, sessions, exams, attachments }) : null;

  const save = async () => {
    if (!subject) return;
    if (!draft.name.trim()) {
      setMessage("Il nome non può essere vuoto.");
      return;
    }
    const cfu = Number(draft.cfu);
    const targetGrade = draft.targetGrade.trim() ? Number(draft.targetGrade) : undefined;
    if (!Number.isFinite(cfu) || cfu < 0 || cfu > 60) {
      setMessage("CFU non validi (0–60).");
      return;
    }
    if (targetGrade !== undefined && (!Number.isFinite(targetGrade) || targetGrade < 18 || targetGrade > 31)) {
      setMessage("Voto obiettivo tra 18 e 30 (31 = 30 e lode).");
      return;
    }
    await updateSubject(subject.id, {
      name: draft.name.trim(),
      teacher: draft.teacher.trim(),
      cfu,
      semester: draft.semester.trim(),
      targetGrade,
      color: draft.color,
      notes: draft.notes
    });
    setMessage("Salvato.");
  };

  const archived = subject?.status === "archived";

  return (
    <Drawer
      open={Boolean(subject)}
      onClose={onClose}
      title={subject?.name ?? ""}
      eyebrow={
        subject ? (
          <>
            <span className="h-3 w-3 rounded-full" style={{ background: subject.color }} />
            <Tag>{SUBJECT_STATUS_LABEL[subject.status]}</Tag>
            <Tag>{subject.cfu} CFU</Tag>
          </>
        ) : null
      }
      footer={
        subject ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={archived ? "soft" : "danger"}
              icon="Archive"
              onClick={() => {
                if (!archived && !window.confirm(`Archiviare "${subject.name}"? Task, esami e materiali restano collegati.`)) return;
                void updateSubject(subject.id, { status: archived ? "active" : "archived" });
              }}
            >
              {archived ? "Ripristina" : "Archivia"}
            </Button>
            <span className="flex-1" />
            {message ? <span className="text-xs font-bold text-[var(--muted)]">{message}</span> : null}
            <Button variant="primary" icon="Check" onClick={() => void save()}>
              Salva
            </Button>
          </div>
        ) : null
      }
    >
      {subject && stats ? (
        <div className="grid grid-cols-1 gap-5">
          <dl className="grid grid-cols-3 gap-2">
            <div className="rounded-[16px] bg-[var(--surface-soft)] p-3">
              <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Studio</dt>
              <dd className="text-lg font-black">{formatHours(stats.studyMinutes)} h</dd>
            </div>
            <div className="rounded-[16px] bg-[var(--surface-soft)] p-3">
              <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Task aperte</dt>
              <dd className="text-lg font-black">{stats.openTasks.length}</dd>
            </div>
            <div className="rounded-[16px] bg-[var(--surface-soft)] p-3">
              <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Esame</dt>
              <dd className="text-lg font-black">{stats.exam ? `${studyDaysUntil(stats.exam.date)} gg` : "—"}</dd>
            </div>
          </dl>

          <section className="grid grid-cols-1 gap-3">
            <h4 className="text-xs font-black uppercase text-[var(--faint)]">Dati della materia</h4>
            <Field label="Nome">
              <input className={inputClass} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Docente">
                <input className={inputClass} value={draft.teacher} onChange={(event) => setDraft((value) => ({ ...value, teacher: event.target.value }))} />
              </Field>
              <Field label="Semestre">
                <input className={inputClass} value={draft.semester} onChange={(event) => setDraft((value) => ({ ...value, semester: event.target.value }))} placeholder="es. 1° semestre 2026/2027" />
              </Field>
              <Field label="CFU">
                <input className={inputClass} type="number" min={0} max={60} value={draft.cfu} onChange={(event) => setDraft((value) => ({ ...value, cfu: event.target.value }))} />
              </Field>
              <Field label="Voto obiettivo">
                <input
                  className={inputClass}
                  type="number"
                  min={18}
                  max={31}
                  value={draft.targetGrade}
                  onChange={(event) => setDraft((value) => ({ ...value, targetGrade: event.target.value }))}
                  placeholder="es. 28"
                />
              </Field>
            </div>
            <Field label="Colore">
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Colore ${swatch}`}
                    aria-pressed={draft.color === swatch}
                    onClick={() => setDraft((value) => ({ ...value, color: swatch }))}
                    className={`h-8 w-8 rounded-full border-2 ${draft.color.toLowerCase() === swatch.toLowerCase() ? "border-[var(--text)]" : "border-transparent"}`}
                    style={{ background: swatch }}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Colore personalizzato"
                  value={draft.color.startsWith("#") ? draft.color : "#7CF7C8"}
                  onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))}
                  className="h-8 w-10 rounded-full border border-[var(--border)] bg-transparent p-0.5"
                />
              </div>
            </Field>
            <Field label="Note">
              <textarea className={`${inputClass} min-h-20 py-3`} value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} />
            </Field>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase text-[var(--faint)]">Materiali · {stats.materials.length}</h4>
              <div className="flex gap-1.5">
                <label className="motion-safe inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                  <Icon name="Upload" className="h-3.5 w-3.5" /> Allegato
                  <input
                    type="file"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setMessage("");
                      try {
                        await addAttachment(file, { type: "subject", id: subject.id });
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Allegato non importato.");
                      }
                    }}
                  />
                </label>
                <label className="motion-safe inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                  <Icon name="Image" className="h-3.5 w-3.5" /> Copertina
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (event) => {
                      try {
                        const cover = await readImageFile(event.target.files?.[0]);
                        if (cover) await updateSubject(subject.id, { cover });
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Immagine non valida.");
                      } finally {
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                {subject.cover ? (
                  <button
                    type="button"
                    onClick={() => void updateSubject(subject.id, { cover: undefined })}
                    className="min-h-8 rounded-full px-3 text-xs font-black text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                  >
                    Rimuovi copertina
                  </button>
                ) : null}
              </div>
            </div>
            {stats.materials.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {stats.materials.map((attachment) =>
                  editingAttachment?.id === attachment.id ? (
                    <li key={attachment.id}>
                      <AttachmentInlineEditor
                        attachment={attachment}
                        onCancel={() => setEditingAttachment(null)}
                        onSave={async (patch) => {
                          await updateAttachment(attachment.id, patch);
                          setEditingAttachment(null);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={attachment.id} className="group flex min-w-0 items-center gap-2 rounded-[14px] px-2 py-1.5 hover:bg-[var(--surface-soft)]">
                      <Icon name={ATTACHMENT_KIND_ICON[attachmentKind(attachment)]} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                      <span className="one-line-safe min-w-0 flex-1 text-sm font-bold">{attachment.name}</span>
                      <IconButton icon="PenLine" label={`Modifica ${attachment.name}`} className="h-8 w-8 bg-transparent" onClick={() => setEditingAttachment(attachment)} />
                      <IconButton
                        icon="Trash2"
                        label={`Elimina ${attachment.name}`}
                        className="h-8 w-8 bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                        onClick={() => {
                          const label = attachment.name.length > 80 ? `${attachment.name.slice(0, 77)}...` : attachment.name;
                          if (window.confirm(`Eliminare "${label}" dai materiali della materia?`)) void deleteAttachment(attachment.id);
                        }}
                      />
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">Nessun materiale collegato.</p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase text-[var(--faint)]">Task aperte · {stats.openTasks.length}</h4>
              <button type="button" onClick={() => setActiveView("tasks")} className="text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
                Vai alle task
              </button>
            </div>
            {stats.openTasks.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {stats.openTasks.slice(0, 8).map((task) => (
                  <li key={task.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: subject.color }} />
                    <span className="one-line-safe min-w-0 flex-1 font-bold">{task.title}</span>
                    {task.dueDate ? <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{shortDate(task.dueDate)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">Nessuna task aperta.</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Argomenti da ripassare</h4>
            <TopicManager subjects={subjects} subjectId={subject.id} />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function AttachmentInlineEditor({
  attachment,
  onCancel,
  onSave
}: {
  attachment: Attachment;
  onCancel: () => void;
  onSave: (patch: Partial<Attachment>) => Promise<void>;
}) {
  const [name, setName] = useState(attachment.name);
  const [description, setDescription] = useState(attachment.description);
  const [tags, setTags] = useState(attachment.tags.join(", "));
  return (
    <div className="grid grid-cols-1 gap-2 rounded-[16px] bg-[var(--surface-soft)] p-3">
      <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome allegato" />
      <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrizione" aria-label="Descrizione" />
      <input className={inputClass} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tag separati da virgola" aria-label="Tag" />
      <div className="flex justify-end gap-2">
        <Button variant="soft" onClick={onCancel} className="min-h-9">
          Annulla
        </Button>
        <Button
          variant="primary"
          icon="Check"
          className="min-h-9"
          disabled={!name.trim()}
          onClick={() =>
            void onSave({
              name: name.trim(),
              description: description.trim(),
              tags: tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }
        >
          Salva
        </Button>
      </div>
    </div>
  );
}
