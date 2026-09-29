import { useMemo, useState, type FormEvent } from "react";
import type { Attachment } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { ATTACHMENT_KIND_ICON, ATTACHMENT_KIND_LABEL, attachmentKind, hostOf, type AttachmentKind } from "../lib/labels";
import { Button, Field, IconButton, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { normalizeExternalUrl, safeDataUrl, safeHref } from "../lib/safeUrl";
import { oneOf, useUiState } from "../lib/uiState";

const formatBytes = (bytes: number) => {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value > 10 ? 0 : 1).replace(".", ",")} ${units[index]}`;
};

type KindFilter = "all" | AttachmentKind;

export function MaterialsView() {
  const [query, setQuery] = useUiState("materials.query", "", { scope: "tab" });
  const [kind, setKind] = useUiState<KindFilter>("materials.kind", "all", { validate: oneOf("all", "pdf", "image", "video", "doc", "link", "file") });
  const [savedSubjectFilter, setSubjectFilter] = useUiState("materials.subject", "");
  const [uploadError, setUploadError] = useState("");
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", externalUrl: "", tags: "", subjectId: "" });
  const { attachments, subjects, tasks, events, sessions, exams, addAttachment, addExternalAttachment, updateAttachment, deleteAttachment } = useStudyStore();
  // Un filtro salvato su una materia poi eliminata non deve nascondere tutto.
  const subjectFilter = subjects.some((subject) => subject.id === savedSubjectFilter) ? savedSubjectFilter : "";

  const linkedName = (type?: string, id?: string) => {
    if (!type || !id) return null;
    if (type === "subject") return subjectName(subjects, id);
    if (type === "task") return tasks.find((task) => task.id === id)?.title ?? "Task";
    if (type === "calendarEvent") return events.find((event) => event.id === id)?.title ?? "Evento";
    if (type === "studySession") return sessions.find((session) => session.id === id)?.title ?? "Sessione";
    if (type === "exam") return `Esame · ${subjectName(subjects, exams.find((exam) => exam.id === id)?.subjectId)}`;
    return "Elemento";
  };

  const counts = useMemo(() => {
    const result: Record<KindFilter, number> = { all: attachments.length, pdf: 0, image: 0, video: 0, doc: 0, link: 0, file: 0 };
    for (const attachment of attachments) result[attachmentKind(attachment)] += 1;
    return result;
  }, [attachments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...attachments]
      .filter((attachment) => kind === "all" || attachmentKind(attachment) === kind)
      .filter((attachment) => !subjectFilter || (attachment.linkedEntityType === "subject" && attachment.linkedEntityId === subjectFilter))
      .filter((attachment) => !q || `${attachment.name} ${attachment.description} ${attachment.tags.join(" ")} ${attachment.externalUrl ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }, [attachments, kind, subjectFilter, query]);

  const openEditor = (attachment: Attachment) => {
    setUploadError("");
    setEditingAttachment(attachment);
    setDraft({
      name: attachment.name,
      description: attachment.description,
      externalUrl: attachment.externalUrl ?? "",
      tags: attachment.tags.join(", "),
      subjectId: attachment.linkedEntityType === "subject" ? attachment.linkedEntityId ?? "" : ""
    });
  };

  const saveEditor = async () => {
    if (!editingAttachment || !draft.name.trim()) return;
    const externalUrl = editingAttachment.externalUrl ? normalizeExternalUrl(draft.externalUrl) : editingAttachment.externalUrl;
    if (editingAttachment.externalUrl && !externalUrl) {
      setUploadError("Link non valido: usa un indirizzo http(s) completo.");
      return;
    }
    setUploadError("");
    // La materia si cambia solo se l'allegato non è già collegato a task/eventi/esami.
    const linkable = !editingAttachment.linkedEntityType || editingAttachment.linkedEntityType === "subject";
    await updateAttachment(editingAttachment.id, {
      name: draft.name.trim(),
      description: draft.description.trim(),
      externalUrl: externalUrl ?? undefined,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(linkable
        ? draft.subjectId
          ? { linkedEntityType: "subject" as const, linkedEntityId: draft.subjectId }
          : { linkedEntityType: undefined, linkedEntityId: undefined }
        : {})
    });
    setEditingAttachment(null);
  };

  const deleteWithConfirm = async (attachment: Attachment) => {
    const label = attachment.name.length > 80 ? `${attachment.name.slice(0, 77)}...` : attachment.name;
    if (!window.confirm(`Eliminare "${label}" dai materiali locali? L'azione rimuove anche i riferimenti collegati.`)) return;
    await deleteAttachment(attachment.id);
    if (editingAttachment?.id === attachment.id) setEditingAttachment(null);
  };

  const kindOptions = (["all", "pdf", "link", "image", "video", "doc", "file"] as KindFilter[])
    .filter((id) => id === "all" || counts[id] > 0)
    .map((id) => ({ id, label: id === "all" ? "Tutti" : ATTACHMENT_KIND_LABEL[id], count: counts[id] }));

  return (
    <div>
      <SectionTitle title="Materiali" subtitle="PDF, immagini, documenti e link salvati sul dispositivo (o nel vault cifrato). Collegali a una materia per ritrovarli subito." />

      <AddBar
        onFile={async (file) => {
          setUploadError("");
          try {
            await addAttachment(file, subjectFilter ? { type: "subject", id: subjectFilter } : undefined);
          } catch (error) {
            setUploadError(error instanceof Error ? error.message : "File non importato.");
          }
        }}
        onLink={async (rawUrl, name) => {
          const safe = normalizeExternalUrl(rawUrl);
          if (!safe) {
            setUploadError("Link non valido: usa un indirizzo http(s) completo.");
            return false;
          }
          setUploadError("");
          await addExternalAttachment(safe, name || hostOf(safe) || safe);
          return true;
        }}
      />
      {uploadError && !editingAttachment ? (
        <p className="mb-4 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]" role="alert">
          {uploadError}
        </p>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 lg:w-72">
          <span className="sr-only">Cerca nei materiali</span>
          <Icon name="Search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input className={`${inputClass} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nome, tag o link" />
        </label>
        <Segmented label="Tipo" size="sm" value={kind} onChange={setKind} options={kindOptions} />
        <select
          className="min-h-9 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-xs font-black lg:ml-auto"
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
          aria-label="Filtra per materia"
        >
          <option value="">Tutte le materie</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length ? (
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {filtered.map((attachment) => {
            const attachmentType = attachmentKind(attachment);
            const href = attachment.externalUrl ? safeHref(attachment.externalUrl) : undefined;
            const download = !href ? safeDataUrl(attachment.dataUrl) : undefined;
            const linked = linkedName(attachment.linkedEntityType, attachment.linkedEntityId);
            const color = attachment.linkedEntityType === "subject" ? subjectColor(subjects, attachment.linkedEntityId) : undefined;
            return (
              <article key={attachment.id} className="quiet-panel group flex min-w-0 items-start gap-3 p-3" data-testid="attachment-card">
                <div className="grid grid-cols-1 h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[var(--surface-strong)]">
                  {attachmentType === "image" && attachment.dataUrl?.startsWith("data:image") ? (
                    <img src={safeDataUrl(attachment.dataUrl)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name={ATTACHMENT_KIND_ICON[attachmentType]} className="h-5 w-5 text-[var(--accent-ink)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => openEditor(attachment)} className="block w-full text-left">
                    <h3 className="two-line-safe text-sm font-black leading-snug">{attachment.name}</h3>
                  </button>
                  <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
                    {ATTACHMENT_KIND_LABEL[attachmentType]}
                    {attachment.externalUrl ? ` · ${hostOf(attachment.externalUrl)}` : attachment.size ? ` · ${formatBytes(attachment.size)}` : ""} · {shortDate(attachment.addedAt)}
                  </p>
                  {linked || attachment.tags.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {linked ? <Tag color={color}>{linked}</Tag> : null}
                      {attachment.tags.slice(0, 3).map((tag) => (
                        <Tag key={tag}>#{tag}</Tag>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Apri ${attachment.name}`}
                      title="Apri"
                      className="grid grid-cols-1 h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-[#10131d]"
                    >
                      <Icon name="ExternalLink" className="h-4 w-4" />
                    </a>
                  ) : download ? (
                    <a
                      href={download}
                      download={attachment.name}
                      aria-label={`Scarica ${attachment.name}`}
                      title="Scarica"
                      className="grid grid-cols-1 h-8 w-8 place-items-center rounded-full bg-[var(--surface-strong)]"
                    >
                      <Icon name="Download" className="h-4 w-4" />
                    </a>
                  ) : null}
                  <IconButton
                    icon="PenLine"
                    label={`Modifica ${attachment.name}`}
                    className="h-8 w-8 bg-transparent"
                    onClick={() => openEditor(attachment)}
                    data-testid="edit-attachment"
                  />
                  <IconButton
                    icon="Trash2"
                    label={`Elimina ${attachment.name}`}
                    className="h-8 w-8 bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                    onClick={() => deleteWithConfirm(attachment)}
                    data-testid="delete-attachment"
                  />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="quiet-panel p-8 text-center text-sm font-bold text-[var(--muted)]">
          {attachments.length ? "Nessun materiale con questi filtri." : "Nessun materiale ancora salvato. Carica un file o incolla un link qui sopra."}
        </div>
      )}

      {editingAttachment ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Modifica materiale"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingAttachment(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditingAttachment(null);
          }}
        >
          <section className="soft-panel w-full max-w-xl p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="safe-text text-2xl font-black">Modifica materiale</h3>
                <p className="two-line-safe text-sm text-[var(--muted)]">{ATTACHMENT_KIND_LABEL[attachmentKind(editingAttachment)]} · aggiunto il {shortDate(editingAttachment.addedAt)}</p>
              </div>
              <IconButton icon="X" label="Chiudi" className="h-10 w-10" onClick={() => setEditingAttachment(null)} />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Field label="Nome">
                <input className={inputClass} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} autoFocus />
              </Field>
              {editingAttachment.externalUrl ? (
                <Field label="URL">
                  <input className={inputClass} value={draft.externalUrl} onChange={(event) => setDraft((value) => ({ ...value, externalUrl: event.target.value }))} />
                </Field>
              ) : null}
              {!editingAttachment.linkedEntityType || editingAttachment.linkedEntityType === "subject" ? (
                <Field label="Materia">
                  <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                    <option value="">Nessuna (archivio generale)</option>
                    {selectableSubjects(subjects, draft.subjectId).map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="rounded-[16px] bg-[var(--surface-soft)] p-3 text-sm">
                  Collegato a: <span className="font-black">{linkedName(editingAttachment.linkedEntityType, editingAttachment.linkedEntityId)}</span>
                </p>
              )}
              <Field label="Descrizione">
                <textarea className={`${inputClass} min-h-20 py-3`} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
              </Field>
              <Field label="Tag separati da virgola">
                <input className={inputClass} value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="esame, pdf, appunti" />
              </Field>

              {uploadError ? (
                <p className="text-sm font-bold text-[var(--warning-text)]" role="alert">
                  {uploadError}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="danger" icon="Trash2" onClick={() => deleteWithConfirm(editingAttachment)}>
                  Elimina
                </Button>
                <span className="flex-1" />
                <Button variant="soft" onClick={() => setEditingAttachment(null)}>
                  Annulla
                </Button>
                <Button variant="primary" icon="Check" onClick={saveEditor} disabled={!draft.name.trim()}>
                  Salva
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function AddBar({ onFile, onLink }: { onFile: (file: File) => Promise<void>; onLink: (url: string, name: string) => Promise<boolean> }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    if (await onLink(url, name.trim())) {
      setUrl("");
      setName("");
    }
  };
  return (
    <div className="soft-panel mb-4 flex flex-col gap-2 p-2.5 xl:flex-row xl:items-center">
      <label className="motion-safe inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-extrabold text-[#10131d] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)] sm:self-start xl:self-auto">
        <Icon name="Upload" className="h-4 w-4" />
        Carica file
        <input
          type="file"
          className="sr-only"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) await onFile(file);
          }}
        />
      </label>
      <span className="hidden text-xs font-black uppercase text-[var(--faint)] xl:inline">oppure</span>
      <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
        <label className="relative block min-w-0 flex-[2]">
          <span className="sr-only">URL del link</span>
          <Icon name="Link" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input className={`${inputClass} pl-10`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Incolla un link (https://…)" inputMode="url" />
        </label>
        <input className={`${inputClass} min-w-0 flex-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome (opzionale)" aria-label="Nome del link" />
        <button
          type="submit"
          disabled={!url.trim()}
          className="motion-safe inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold hover:bg-[var(--surface)] disabled:opacity-50"
        >
          <Icon name="Plus" className="h-4 w-4" /> Salva link
        </button>
      </form>
    </div>
  );
}
