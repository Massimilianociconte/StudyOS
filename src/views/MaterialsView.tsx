import { useState } from "react";
import type { Attachment } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate, subjectName } from "../lib/selectors";
import { Button, Field, Panel, Pill, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";

const formatBytes = (bytes: number) => {
  if (!bytes) return "link";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value > 10 ? 0 : 1)} ${units[index]}`;
};

export function MaterialsView() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", externalUrl: "", tags: "" });
  const {
    attachments,
    subjects,
    tasks,
    events,
    sessions,
    exams,
    addAttachment,
    addExternalAttachment,
    updateAttachment,
    deleteAttachment
  } = useStudyStore();

  const linkedName = (type?: string, id?: string) => {
    if (!type || !id) return "Archivio";
    if (type === "subject") return subjectName(subjects, id);
    if (type === "task") return tasks.find((task) => task.id === id)?.title ?? "Task";
    if (type === "calendarEvent") return events.find((event) => event.id === id)?.title ?? "Evento";
    if (type === "studySession") return sessions.find((session) => session.id === id)?.title ?? "Sessione";
    if (type === "exam") return subjectName(subjects, exams.find((exam) => exam.id === id)?.subjectId);
    return "Elemento";
  };

  const addLink = async () => {
    if (!url.trim()) return;
    await addExternalAttachment(url.trim(), name.trim() || url.trim());
    setUrl("");
    setName("");
  };

  const openEditor = (attachment: Attachment) => {
    setEditingAttachment(attachment);
    setDraft({
      name: attachment.name,
      description: attachment.description,
      externalUrl: attachment.externalUrl ?? "",
      tags: attachment.tags.join(", ")
    });
  };

  const saveEditor = async () => {
    if (!editingAttachment || !draft.name.trim()) return;
    await updateAttachment(editingAttachment.id, {
      name: draft.name.trim(),
      description: draft.description.trim(),
      externalUrl: editingAttachment.externalUrl ? draft.externalUrl.trim() : editingAttachment.externalUrl,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    });
    setEditingAttachment(null);
  };

  const deleteWithConfirm = async (attachment: Attachment) => {
    const label = attachment.name.length > 80 ? `${attachment.name.slice(0, 77)}...` : attachment.name;
    if (!window.confirm(`Eliminare "${label}" dai materiali locali? L'azione rimuove anche i riferimenti collegati.`)) {
      return;
    }
    await deleteAttachment(attachment.id);
    if (editingAttachment?.id === attachment.id) setEditingAttachment(null);
  };

  return (
    <div>
      <SectionTitle
        title="Materiali"
        subtitle="PDF, immagini, documenti, screenshot, link e note salvati localmente in IndexedDB o nel vault cifrato."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {attachments.map((attachment) => (
              <article key={attachment.id} className="quiet-panel min-w-0 overflow-hidden p-3" data-testid="attachment-card">
                <div className="mb-3 grid h-36 place-items-center overflow-hidden rounded-[24px] bg-[var(--surface-soft)]">
                  {attachment.dataUrl?.startsWith("data:image") ? (
                    <img src={attachment.dataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name={attachment.externalUrl ? "LineChart" : "FileText"} className="h-10 w-10 text-[var(--accent)]" />
                  )}
                </div>
                <h3 className="two-line-safe min-h-[2.75rem] text-lg font-black">{attachment.name}</h3>
                <p className="safe-text mt-1 text-sm font-bold text-[var(--muted)]">
                  {formatBytes(attachment.size)} · {shortDate(attachment.addedAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill>{attachment.mimeType.split("/")[0]}</Pill>
                  <Pill>{linkedName(attachment.linkedEntityType, attachment.linkedEntityId)}</Pill>
                </div>
                {attachment.description ? (
                  <p className="two-line-safe mt-3 text-sm text-[var(--muted)]">{attachment.description}</p>
                ) : null}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {attachment.externalUrl ? (
                    <a
                      href={attachment.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--accent)] px-3 text-sm font-black text-[#10131d]"
                    >
                      Apri
                    </a>
                  ) : attachment.dataUrl ? (
                    <a
                      href={attachment.dataUrl}
                      download={attachment.name}
                      className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--surface-strong)] px-3 text-sm font-black"
                    >
                      Esporta
                    </a>
                  ) : null}
                  <Button variant="soft" icon="PenLine" onClick={() => openEditor(attachment)} data-testid="edit-attachment">
                    Modifica
                  </Button>
                  <Button
                    variant="danger"
                    icon="Trash2"
                    className="col-span-2"
                    onClick={() => deleteWithConfirm(attachment)}
                    data-testid="delete-attachment"
                  >
                    Elimina
                  </Button>
                </div>
              </article>
            ))}
            {attachments.length === 0 ? (
              <div className="quiet-panel p-8 text-center text-sm font-bold text-[var(--muted)] md:col-span-2 xl:col-span-3">
                Nessun materiale ancora salvato.
              </div>
            ) : null}
          </div>
        </Panel>

        <aside className="grid content-start gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Aggiungi file</h3>
            <Field label="File locale">
              <input
                className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-sm file:font-black file:text-[#10131d]`}
                type="file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  await addAttachment(file);
                  event.target.value = "";
                }}
              />
            </Field>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Aggiungi link</h3>
            <div className="grid gap-3">
              <Field label="Nome">
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="URL">
                <input className={inputClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
              </Field>
              <Button variant="primary" icon="Plus" onClick={addLink}>
                Salva link
              </Button>
            </div>
          </Panel>
        </aside>
      </div>

      {editingAttachment ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
          <section className="soft-panel w-full max-w-xl p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="safe-text text-2xl font-black">Modifica allegato</h3>
                <p className="two-line-safe text-sm text-[var(--muted)]">{editingAttachment.name}</p>
              </div>
              <Button variant="ghost" onClick={() => setEditingAttachment(null)}>
                Chiudi
              </Button>
            </div>

            <div className="grid gap-3">
              <Field label="Nome">
                <input
                  className={inputClass}
                  value={draft.name}
                  onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                />
              </Field>

              <Field label="Descrizione">
                <textarea
                  className={`${inputClass} min-h-24 py-3`}
                  value={draft.description}
                  onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))}
                />
              </Field>

              {editingAttachment.externalUrl ? (
                <Field label="URL">
                  <input
                    className={inputClass}
                    value={draft.externalUrl}
                    onChange={(event) => setDraft((value) => ({ ...value, externalUrl: event.target.value }))}
                  />
                </Field>
              ) : null}

              <Field label="Tag separati da virgola">
                <input
                  className={inputClass}
                  value={draft.tags}
                  onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))}
                  placeholder="esame, pdf, appunti"
                />
              </Field>

              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button variant="danger" icon="Trash2" onClick={() => deleteWithConfirm(editingAttachment)}>
                  Elimina
                </Button>
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
    </div>
  );
}
