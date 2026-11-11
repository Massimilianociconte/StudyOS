import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Attachment } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { ATTACHMENT_KIND_ICON, ATTACHMENT_KIND_LABEL, MATERIALS_HELP, MATERIALS_TEXT, attachmentKind, capitalizeFirst, hostOf, type AttachmentKind } from "../lib/labels";
import { Button, EmptyState, Field, HelpTip, IconButton, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { HelpField } from "../components/HelpField";
import { goToView } from "../hooks/useLinkedUiState";
import { Icon } from "../components/Icon";
import { ShareButton } from "../components/ShareButton";
import { SharedSection } from "../components/SharedSection";
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

const INVALID_LINK = "Link non valido: incolla l'indirizzo completo (Es. https://…).";

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
    if (type === "task") return tasks.find((task) => task.id === id)?.title ?? "Attività";
    if (type === "calendarEvent") return events.find((event) => event.id === id)?.title ?? "Evento";
    if (type === "studySession") return sessions.find((session) => session.id === id)?.title ?? "Sessione di studio";
    if (type === "exam") return `Esame · ${subjectName(subjects, exams.find((exam) => exam.id === id)?.subjectId)}`;
    return "Elemento";
  };

  // Pillola del collegamento sulla scheda: la materia filtra qui; attività, esame ed evento si aprono
  // nella loro sezione. Se l'elemento non c'è più resta un'etichetta.
  const linkedAction = (attachment: Attachment): { aria: string; run: () => void } | null => {
    const { linkedEntityType: type, linkedEntityId: id } = attachment;
    if (!type || !id) return null;
    if (type === "subject" && subjects.some((subject) => subject.id === id)) return { aria: MATERIALS_TEXT.filterBySubject, run: () => setSubjectFilter(id) };
    if (type === "task" && tasks.some((task) => task.id === id)) return { aria: MATERIALS_TEXT.openLinked, run: () => goToView("tasks", [["tasks.editing", id, "tab"]]) };
    if (type === "exam" && exams.some((exam) => exam.id === id)) return { aria: MATERIALS_TEXT.openLinked, run: () => goToView("exams", [["exams.editing", id, "tab"]]) };
    if (type === "calendarEvent" && events.some((event) => event.id === id)) return { aria: MATERIALS_TEXT.openLinked, run: () => goToView("calendar", [["calendar.editingEvent", id, "tab"]]) };
    return null;
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFile = async (file: File) => {
    setUploadError("");
    try {
      await addAttachment(file, subjectFilter ? { type: "subject", id: subjectFilter } : undefined);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "File non caricato: riprova o scegli un altro file.");
    }
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
      setUploadError(INVALID_LINK);
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
    const label = attachment.name.length > 80 ? `${attachment.name.slice(0, 79)}…` : attachment.name;
    if (!window.confirm(`Eliminare "${label}"? Sparisce dai materiali e da attività, eventi o esami a cui è collegato. Non si può annullare.`)) return;
    await deleteAttachment(attachment.id);
    if (editingAttachment?.id === attachment.id) setEditingAttachment(null);
  };

  const kindOptions = (["all", "pdf", "link", "image", "video", "doc", "file"] as KindFilter[])
    .filter((id) => id === "all" || counts[id] > 0)
    .map((id) => ({ id, label: id === "all" ? "Tutti" : ATTACHMENT_KIND_LABEL[id], count: counts[id] }));

  return (
    <div>
      <SectionTitle
        title="Materiali"
        subtitle="Dispense, appunti e link utili in un solo posto. Collegali a una materia per ritrovarli subito."
        action={<ShareButton scopes={["materials"]} />}
      />

      {/* Il campo file dell'invito nello stato vuoto: il pulsante lo apre. */}
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) await uploadFile(file);
        }}
      />
      <AddBar
        onFile={uploadFile}
        onLink={async (rawUrl, name) => {
          const safe = normalizeExternalUrl(rawUrl);
          if (!safe) {
            setUploadError(INVALID_LINK);
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
          <input className={`${inputClass} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per nome, etichetta o link" />
        </label>
        <Segmented label="Tipo di materiale" size="sm" value={kind} onChange={setKind} options={kindOptions} />
        <span className="flex min-w-0 items-center gap-1.5 lg:ml-auto">
          <select
            className="min-h-9 min-w-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-xs font-black"
            value={subjectFilter}
            onChange={(event) => setSubjectFilter(event.target.value)}
            aria-label={MATERIALS_TEXT.subjectFilter}
          >
            <option value="">{MATERIALS_TEXT.allSubjects}</option>
            {/* Archiviate solo se già scelte: il filtro non si perde, ma l'elenco resta corto. */}
            {selectableSubjects(subjects, subjectFilter).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
          <HelpTip {...MATERIALS_HELP.subjectFilter} />
        </span>
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {filtered.map((attachment) => {
            const attachmentType = attachmentKind(attachment);
            const href = attachment.externalUrl ? safeHref(attachment.externalUrl) : undefined;
            const download = !href ? safeDataUrl(attachment.dataUrl) : undefined;
            const linked = linkedName(attachment.linkedEntityType, attachment.linkedEntityId);
            const linkAction = linkedAction(attachment);
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
                      {linked ? (
                        linkAction ? (
                          <PillButton label={linked} color={color} aria={linkAction.aria} onClick={linkAction.run} />
                        ) : (
                          <Tag color={color}>{linked}</Tag>
                        )
                      ) : null}
                      {attachment.tags.slice(0, 3).map((tag) => (
                        <PillButton key={tag} label={`#${tag}`} aria={MATERIALS_TEXT.searchTag} onClick={() => setQuery(tag)} />
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
                      aria-label={`Apri il link ${attachment.name}`}
                      title="Apri il link"
                      className="relative grid grid-cols-1 h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-[#10131d] after:absolute after:-inset-1.5 after:rounded-full after:content-['']"
                    >
                      <Icon name="ExternalLink" className="h-4 w-4" />
                    </a>
                  ) : download ? (
                    <a
                      href={download}
                      download={attachment.name}
                      aria-label={`Scarica ${attachment.name}`}
                      title="Scarica il file"
                      className="relative grid grid-cols-1 h-8 w-8 place-items-center rounded-full bg-[var(--surface-strong)] after:absolute after:-inset-1.5 after:rounded-full after:content-['']"
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
        attachments.length ? (
          <EmptyState
            icon="Search"
            title={MATERIALS_TEXT.noneFoundTitle}
            body={MATERIALS_TEXT.noneFoundBody}
            action={
              <Button
                variant="soft"
                onClick={() => {
                  setQuery("");
                  setKind("all");
                  setSubjectFilter("");
                }}
              >
                {MATERIALS_TEXT.showAll}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="Paperclip"
            title={MATERIALS_TEXT.emptyTitle}
            body={MATERIALS_TEXT.emptyBody}
            action={
              <Button variant="primary" icon="Upload" onClick={() => fileInput.current?.click()}>
                {MATERIALS_TEXT.upload}
              </Button>
            }
          />
        )
      )}

      {editingAttachment ? (
        <div
          className="fixed inset-0 z-50 grid grid-cols-1 place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
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
                <Field label="Indirizzo del link (https://…)">
                  <input className={inputClass} value={draft.externalUrl} onChange={(event) => setDraft((value) => ({ ...value, externalUrl: event.target.value }))} />
                </Field>
              ) : null}
              {!editingAttachment.linkedEntityType || editingAttachment.linkedEntityType === "subject" ? (
                <HelpField label="Materia" help={MATERIALS_HELP.subject}>
                  {(id) => (
                    <select id={id} className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
                      <option value="">Nessuna materia</option>
                      {selectableSubjects(subjects, draft.subjectId).map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  )}
                </HelpField>
              ) : (
                <p className="rounded-[16px] bg-[var(--surface-soft)] p-3 text-sm">
                  Collegato a: <span className="font-black">{linkedName(editingAttachment.linkedEntityType, editingAttachment.linkedEntityId)}</span>
                </p>
              )}
              <Field label="Descrizione (facoltativa)">
                <textarea className={`${inputClass} min-h-20 py-3`} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
              </Field>
              <HelpField label="Etichette, separate da virgola (facoltative)" help={MATERIALS_HELP.tags}>
                {(id) => <input id={id} className={inputClass} value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="Es. appunti, esame" />}
              </HelpField>

              {uploadError ? (
                <p className="text-sm font-bold text-[var(--warning-text)]" role="alert">
                  {uploadError}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="danger" icon="Trash2" onClick={() => deleteWithConfirm(editingAttachment)}>
                  Elimina materiale
                </Button>
                <span className="flex-1" />
                <Button variant="soft" onClick={() => setEditingAttachment(null)}>
                  Annulla
                </Button>
                <Button variant="primary" icon="Check" onClick={saveEditor} disabled={!draft.name.trim()}>
                  Salva modifiche
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <SharedSection entityTypes={["attachment", "note"]} />
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
        Carica un file
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
          <span className="sr-only">Indirizzo del link (https://…)</span>
          <Icon name="Link" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input className={`${inputClass} pl-10`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Indirizzo del link (https://…)" inputMode="url" />
        </label>
        <input className={`${inputClass} min-w-0 flex-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome (facoltativo)" aria-label="Nome del link (facoltativo)" />
        <Button type="submit" variant="soft" icon="Plus" disabled={!url.trim()} className="shrink-0">
          {MATERIALS_TEXT.saveLink}
        </Button>
      </form>
    </div>
  );
}

/** Pillola che fa qualcosa (filtra, cerca, apre): stessa forma di `Tag`, ma con bordo e stato al passaggio. */
function PillButton({ label, color, aria, onClick }: { label: string; color?: string; aria: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={capitalizeFirst(aria)}
      className="motion-safe relative inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 text-[11px] font-extrabold text-[var(--muted)] after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] hover:border-[var(--accent-ink)] hover:text-[var(--text)]"
    >
      {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      <span className="min-w-0 truncate">{label}</span>
      {/* Il nome resta il testo della pillola; cosa fa si aggiunge solo a voce. */}
      <span className="sr-only">: {aria}</span>
    </button>
  );
}
