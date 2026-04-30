import { useState } from "react";
import type { Attachment, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate } from "../lib/selectors";
import { readImageFile } from "../lib/files";
import { Button, Field, Panel, Pill, ProgressBar, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";

export function SubjectsView() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7CF7C8");
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const [attachmentDraft, setAttachmentDraft] = useState({ name: "", description: "", tags: "" });
  const [message, setMessage] = useState("");
  const { subjects, tasks, sessions, exams, attachments, addSubject, updateSubject, addAttachment, updateAttachment, deleteAttachment } = useStudyStore();

  const createSubject = async () => {
    if (!name.trim()) return;
    await addSubject({ name: name.trim(), color, status: "active", icon: "BookOpen" });
    setName("");
  };

  const openAttachmentEditor = (attachment: Attachment) => {
    setEditingAttachment(attachment);
    setAttachmentDraft({
      name: attachment.name,
      description: attachment.description,
      tags: attachment.tags.join(", ")
    });
  };

  const saveAttachment = async () => {
    if (!editingAttachment || !attachmentDraft.name.trim()) return;
    await updateAttachment(editingAttachment.id, {
      name: attachmentDraft.name.trim(),
      description: attachmentDraft.description.trim(),
      tags: attachmentDraft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    });
    setEditingAttachment(null);
  };

  const removeAttachment = async (attachment: Attachment) => {
    const label = attachment.name.length > 80 ? `${attachment.name.slice(0, 77)}...` : attachment.name;
    if (!window.confirm(`Eliminare "${label}" dai materiali della materia?`)) return;
    await deleteAttachment(attachment.id);
    if (editingAttachment?.id === attachment.id) setEditingAttachment(null);
  };

  return (
    <div>
      <SectionTitle
        title="Materie"
        subtitle="Ogni corso ha colore, stato, materiali collegati, task, sessioni, obiettivi e preparazione."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {subjects.map((subject) => {
              const subjectTasks = tasks.filter((task) => task.subjectId === subject.id);
              const subjectAttachments = attachments.filter(
                (attachment) => attachment.linkedEntityType === "subject" && attachment.linkedEntityId === subject.id
              );
              const completed = subjectTasks.filter((task) => task.status === "done").length;
              const studyMinutes = sessions
                .filter((session) => session.subjectId === subject.id && session.status === "completed")
                .reduce((sum, session) => sum + session.actualMinutes, 0);
              const exam = exams.find((item) => item.subjectId === subject.id);
              const progress = subjectTasks.length ? Math.round((completed / subjectTasks.length) * 100) : exam?.preparation ?? 0;
              return (
                <article key={subject.id} className="quiet-panel min-w-0 overflow-hidden p-4">
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-super" style={{ background: subject.color }}>
                      {subject.cover ? (
                        <img src={subject.cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon name={subject.icon} className="h-7 w-7 text-[#10131d]" />
                      )}
                    </span>
                    <select
                      className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-2 text-xs font-black"
                      value={subject.status}
                      onChange={(event) => updateSubject(subject.id, { status: event.target.value as Subject["status"] })}
                      aria-label="Cambia stato materia"
                    >
                      <option value="not-started">non iniziata</option>
                      <option value="active">in corso</option>
                      <option value="review">da ripassare</option>
                      <option value="exam-ready">pronta</option>
                      <option value="completed">completata</option>
                      <option value="archived">archiviata</option>
                    </select>
                  </div>
                  <h3 className="two-line-safe text-2xl font-black">{subject.name}</h3>
                  <p className="two-line-safe mt-1 text-sm font-bold text-[var(--muted)]">
                    {subject.teacher || "Docente non impostato"}
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Mini label="CFU" value={subject.cfu} />
                    <Mini label="Task" value={subjectTasks.length} />
                    <Mini label="Ore" value={Math.round(studyMinutes / 60)} />
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs font-black">
                      <span>Preparazione</span>
                      <span>{progress}%</span>
                    </div>
                    <ProgressBar value={progress} color={subject.color} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill>{subject.semester}</Pill>
                    {subject.examDate ? <Pill>{shortDate(subject.examDate)}</Pill> : null}
                    {subject.targetGrade ? <Pill>{subject.targetGrade}/30</Pill> : null}
                  </div>
                  <div className="mt-4 grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase text-[var(--faint)]">Materiali</p>
                      <Pill>{subjectAttachments.length}</Pill>
                    </div>
                    {subjectAttachments.slice(0, 3).map((attachment) => (
                      <div key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-2">
                        <Icon name="Paperclip" className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                        <span className="one-line-safe min-w-0 flex-1 text-xs font-black">{attachment.name}</span>
                        <button
                          type="button"
                          aria-label={`Modifica ${attachment.name}`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-[var(--surface)]"
                          onClick={() => openAttachmentEditor(attachment)}
                        >
                          <Icon name="PenLine" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Elimina ${attachment.name}`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-red-200 hover:bg-red-500/14"
                          onClick={() => removeAttachment(attachment)}
                        >
                          <Icon name="Trash2" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {subjectAttachments.length > 3 ? (
                      <p className="text-xs font-bold text-[var(--faint)]">+{subjectAttachments.length - 3} altri nella sezione Materiali</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-2">
                      <label className="motion-safe inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                        <Icon name="Upload" className="h-3.5 w-3.5" />
                        Allegato
                        <input
                          type="file"
                          className="sr-only"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            await addAttachment(file, { type: "subject", id: subject.id });
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <label className="motion-safe inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]">
                        <Icon name="Image" className="h-3.5 w-3.5" />
                        Copertina
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
                        <Button variant="danger" icon="Trash2" className="min-h-10 px-3 text-xs" onClick={() => updateSubject(subject.id, { cover: undefined })}>
                          Rimuovi cover
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
            {subjects.length === 0 ? (
              <div className="quiet-panel p-8 text-center text-sm font-bold text-[var(--muted)] md:col-span-2 xl:col-span-3">
                Nessuna materia ancora. Aggiungine una per collegare task, esami e materiali.
              </div>
            ) : null}
          </div>
        </Panel>

        <aside className="grid content-start gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Nuova materia</h3>
            <div className="grid gap-3">
              <Field label="Nome">
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Colore">
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-1"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </Field>
              <Button icon="Plus" variant="primary" onClick={createSubject}>
                Aggiungi materia
              </Button>
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Visual board</h3>
            <div className="grid grid-cols-2 gap-3">
              {subjects.slice(0, 4).map((subject) => (
                <div key={subject.id} className="super-card grid place-items-center p-4 text-center" style={{ background: subject.color }}>
                  <div className="text-[#10131d]">
                    <Icon name={subject.icon} className="mx-auto mb-2 h-7 w-7" />
                    <p className="two-line-safe text-sm font-black">{subject.name}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>

      {message ? <p className="mt-4 rounded-[18px] border border-amber-400/30 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">{message}</p> : null}

      {editingAttachment ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
          <section className="soft-panel w-full max-w-xl p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="safe-text text-2xl font-black">Modifica allegato</h3>
                <p className="two-line-safe text-sm text-[var(--muted)]">{editingAttachment.name}</p>
              </div>
              <Button variant="ghost" icon="X" onClick={() => setEditingAttachment(null)}>
                Chiudi
              </Button>
            </div>

            <div className="grid gap-3">
              <Field label="Nome">
                <input className={inputClass} value={attachmentDraft.name} onChange={(event) => setAttachmentDraft((value) => ({ ...value, name: event.target.value }))} />
              </Field>
              <Field label="Descrizione">
                <textarea className={`${inputClass} min-h-24 py-3`} value={attachmentDraft.description} onChange={(event) => setAttachmentDraft((value) => ({ ...value, description: event.target.value }))} />
              </Field>
              <Field label="Tag separati da virgola">
                <input className={inputClass} value={attachmentDraft.tags} onChange={(event) => setAttachmentDraft((value) => ({ ...value, tags: event.target.value }))} />
              </Field>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button variant="danger" icon="Trash2" onClick={() => removeAttachment(editingAttachment)}>
                  Elimina
                </Button>
                <Button variant="soft" onClick={() => setEditingAttachment(null)}>
                  Annulla
                </Button>
                <Button variant="primary" icon="Check" onClick={saveAttachment} disabled={!attachmentDraft.name.trim()}>
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

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] bg-[var(--surface-soft)] p-2">
      <div className="text-lg font-black">{value}</div>
      <div className="text-[11px] font-bold text-[var(--muted)]">{label}</div>
    </div>
  );
}
