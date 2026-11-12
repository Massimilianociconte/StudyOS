import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Attachment, Note } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { selectableSubjects, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { ATTACHMENT_KIND_ICON, ATTACHMENT_KIND_LABEL, attachmentKind, capitalizeFirst, hostOf } from "../lib/labels";
import { MATERIALS_HELP, MATERIALS_TEXT } from "../lib/labels/materials";
import { NOTES_TEXT } from "../lib/labels/notes";
import { Button, Drawer, EmptyState, Field, HelpTip, IconButton, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { HelpField } from "../components/HelpField";
import { goToView, useLinkedUiState } from "../hooks/useLinkedUiState";
import { Icon } from "../components/Icon";
import { InlineConfirm } from "../components/InlineConfirm";
import { UnsavedPrompt } from "../components/UnsavedPrompt";
import { LinkedNotes, NoteDrawer } from "../components/NoteDrawer";
import { ShareButton } from "../components/ShareButton";
import { SharedSection } from "../components/SharedSection";
import { normalizeExternalUrl, safeDataUrl, safeHref } from "../lib/safeUrl";
import { oneOf } from "../lib/uiState";
import { MATERIAL_KIND_FILTERS, materialMatches, type MaterialKindFilter } from "../lib/materialFilters";

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

type KindFilter = MaterialKindFilter;

const INVALID_LINK = "Link non valido: incolla l'indirizzo completo (Es. https://…).";

/** Note visibili prima di «Mostra tutte». */
const FIRST_NOTES = 6;

// Stessa regola di prima per `materials.query` e `materials.subject` (useUiState accettava solo stringhe).
const isString = (value: unknown): value is string => typeof value === "string";
const isKindFilter = oneOf(...MATERIAL_KIND_FILTERS);

/** Etichette mostrate: senza «link», che l'app aggiungeva da sola ai link salvati (quelle scritte da chi studia restano). */
const visibleTags = (attachment: Attachment) => attachment.tags.filter((tag) => !(attachment.externalUrl && tag === "link"));

/** Nome lungo accorciato nelle frasi (conferme, avvisi). */
const shortName = (name: string) => (name.length > 80 ? `${name.slice(0, 79)}…` : name);

type EditorDraft = { name: string; description: string; externalUrl: string; tags: string; subjectId: string };

const noteTitle = (note: Pick<Note, "title">) => note.title.trim() || NOTES_TEXT.untitled;
const firstLine = (body: string) => body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";

export function MaterialsView() {
  // Scritte anche da Home, dalla ricerca e dal dettaglio della materia: si applicano pure se Materiali è già aperta.
  const [query, setQuery] = useLinkedUiState("materials.query", "", { scope: "tab", validate: isString });
  const [kind, setKind] = useLinkedUiState<KindFilter>("materials.kind", "all", { scope: "device", validate: isKindFilter });
  const [savedSubjectFilter, setSubjectFilter] = useLinkedUiState("materials.subject", "", { scope: "device", validate: isString });
  const [uploadError, setUploadError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const emptyDraft: EditorDraft = { name: "", description: "", externalUrl: "", tags: "", subjectId: "" };
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft);
  // Il modulo com'era all'apertura: il confronto dice se chiudere perderebbe qualcosa.
  const [pristine, setPristine] = useState<EditorDraft>(emptyDraft);
  const [asking, setAsking] = useState(false);
  // Materiale di cui si sta confermando l'eliminazione (dalla scheda o dalla modifica).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Materiale appena aggiunto che i filtri nascondono: si dice, con «Mostra tutti».
  const [savedHidden, setSavedHidden] = useState<{ id: string; name: string } | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const notesHeadingRef = useRef<HTMLHeadingElement>(null);
  const { attachments, notes, subjects, tasks, events, sessions, exams, addAttachment, addExternalAttachment, updateAttachment, deleteAttachment } = useStudyStore();
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

  const filters = { kind, subjectId: subjectFilter, query };
  // Dopo un'aggiunta: se tipo o ricerca nascondono il nuovo materiale, lo si dice invece di farlo sparire.
  const addThen = async (add: () => Promise<void>) => {
    const before = new Set(useStudyStore.getState().attachments.map((attachment) => attachment.id));
    await add();
    const added = useStudyStore.getState().attachments.find((attachment) => !before.has(attachment.id));
    setSavedHidden(added && !materialMatches(added, filters) ? { id: added.id, name: added.name } : null);
  };

  const uploadFile = async (file: File) => {
    setUploadError("");
    try {
      await addThen(() => addAttachment(file, subjectFilter ? { type: "subject", id: subjectFilter } : undefined));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "File non caricato: riprova o scegli un altro file.");
    }
  };

  // Numeri dei chip: gli stessi materiali dell'elenco (materia e testo cercato), di ogni tipo.
  const counts = useMemo(() => {
    const result: Record<KindFilter, number> = { all: 0, pdf: 0, image: 0, video: 0, doc: 0, link: 0, file: 0 };
    for (const attachment of attachments) {
      if (!materialMatches(attachment, { kind: "all", subjectId: subjectFilter, query })) continue;
      result.all += 1;
      result[attachmentKind(attachment)] += 1;
    }
    return result;
  }, [attachments, subjectFilter, query]);

  const filtered = useMemo(
    () => attachments.filter((attachment) => materialMatches(attachment, { kind, subjectId: subjectFilter, query })).sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    [attachments, kind, subjectFilter, query]
  );
  const hiddenNotice = savedHidden && attachments.some((item) => item.id === savedHidden.id) && !filtered.some((item) => item.id === savedHidden.id) ? savedHidden : null;

  const showEverything = () => {
    setQuery("");
    setKind("all");
    setSubjectFilter("");
    setSavedHidden(null);
  };

  const openEditor = (attachment: Attachment) => {
    setEditorError("");
    setAsking(false);
    setConfirmDeleteId(null);
    setEditingAttachment(attachment);
    const next: EditorDraft = {
      name: attachment.name,
      description: attachment.description,
      externalUrl: attachment.externalUrl ?? "",
      tags: attachment.tags.join(", "),
      subjectId: attachment.linkedEntityType === "subject" ? attachment.linkedEntityId ?? "" : ""
    };
    setDraft(next);
    setPristine(next);
  };

  const closeEditor = () => {
    setAsking(false);
    setConfirmDeleteId(null);
    setEditingAttachment(null);
  };
  const editorDirty = editingAttachment !== null && JSON.stringify(draft) !== JSON.stringify(pristine);
  // ✕, Esc, tocco fuori, Indietro e «Annulla»: con modifiche non salvate prima si chiede.
  const requestCloseEditor = () => (editorDirty ? setAsking(true) : closeEditor());

  const saveEditor = async () => {
    if (!editingAttachment || !draft.name.trim()) return;
    const externalUrl = editingAttachment.externalUrl ? normalizeExternalUrl(draft.externalUrl) : editingAttachment.externalUrl;
    if (editingAttachment.externalUrl && !externalUrl) {
      setEditorError(INVALID_LINK);
      return;
    }
    setEditorError("");
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
    closeEditor();
  };

  const deleteMaterial = async (attachment: Attachment) => {
    setConfirmDeleteId(null);
    if (editingAttachment?.id === attachment.id) closeEditor();
    await deleteAttachment(attachment.id);
  };
  const deleteButtonId = (id: string) => `material-delete-${id}`;

  const kindOptions = (["all", "pdf", "link", "image", "video", "doc", "file"] as KindFilter[])
    // Il tipo scelto resta tra i chip anche a zero, così si vede ed è possibile tornare a «Tutti».
    .filter((id) => id === "all" || id === kind || counts[id] > 0)
    .map((id) => ({ id, label: id === "all" ? "Tutti" : ATTACHMENT_KIND_LABEL[id], count: counts[id] }));

  const myNotes = useMemo(() => notes.filter((note) => !note.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [notes]);
  const shownNotes = showAllNotes ? myNotes : myNotes.slice(0, FIRST_NOTES);
  const noteButtonId = (id: string) => `material-note-${id}`;
  const closeNote = () => {
    const closed = openNoteId;
    setOpenNoteId(null);
    // Dopo Elimina la nota non c'è più nell'elenco: il focus va al titolo della sezione.
    window.requestAnimationFrame(() => ((closed ? document.getElementById(noteButtonId(closed)) : null) ?? notesHeadingRef.current)?.focus({ preventScroll: true }));
  };

  const editorFooter = !editingAttachment ? undefined : asking && editorDirty ? (
    <UnsavedPrompt
      title={MATERIALS_TEXT.unsavedTitle}
      text={MATERIALS_TEXT.unsavedText}
      keep={MATERIALS_TEXT.unsavedKeep}
      discard={MATERIALS_TEXT.unsavedDiscard}
      onKeep={() => setAsking(false)}
      onDiscard={closeEditor}
    />
  ) : confirmDeleteId === editingAttachment.id ? (
    <InlineConfirm
      text={MATERIALS_TEXT.removeConfirm(shortName(editingAttachment.name))}
      confirmLabel={MATERIALS_TEXT.removeYes}
      icon="Trash2"
      onCancel={() => setConfirmDeleteId(null)}
      onConfirm={() => void deleteMaterial(editingAttachment)}
    />
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="danger" icon="Trash2" onClick={() => setConfirmDeleteId(editingAttachment.id)}>
        {MATERIALS_TEXT.removeYes}
      </Button>
      <span className="flex-1" />
      <Button variant="soft" onClick={requestCloseEditor}>
        {MATERIALS_TEXT.cancel}
      </Button>
      <Button variant="primary" icon="Check" onClick={() => void saveEditor()} disabled={!draft.name.trim()}>
        {MATERIALS_TEXT.save}
      </Button>
    </div>
  );

  return (
    <div>
      <SectionTitle
        title="Materiali"
        subtitle="Dispense, appunti e link utili in un solo posto. Collegali a una materia per ritrovarli subito."
        action={<ShareButton scopes={["materials"]} />}
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
          // Come i file: con il filtro di una materia il link resta collegato a quella materia (e si vede).
          await addThen(() => addExternalAttachment(safe, name || hostOf(safe) || safe, undefined, subjectFilter ? { type: "subject", id: subjectFilter } : undefined));
          return true;
        }}
      />
      {uploadError ? (
        <p className="mb-4 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]" role="alert">
          {uploadError}
        </p>
      ) : null}
      {/* Sempre presente: il lettore di schermo annuncia l'avviso appena compare il testo. */}
      <div role="status" aria-live="polite">
        {hiddenNotice ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-2.5 pl-3">
            <Icon name="EyeOff" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <p className="safe-text min-w-0 flex-1 text-sm font-bold">{MATERIALS_TEXT.savedHidden(shortName(hiddenNotice.name))}</p>
            <Button variant="soft" onClick={showEverything}>
              {MATERIALS_TEXT.showAllShort}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 lg:w-72">
          <span className="sr-only">Cerca nei materiali</span>
          <Icon name="Search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input className={`${inputClass} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per nome, etichetta o link" />
        </label>
        <Segmented label="Tipo di materiale" size="sm" value={kind} onChange={setKind} options={kindOptions} />
        <span className="flex min-w-0 items-center gap-1.5 lg:ml-auto">
          <select
            className="min-h-11 min-w-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-xs font-black"
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
            const thumb =
              attachmentType === "image" && attachment.dataUrl?.startsWith("data:image") ? (
                <img src={safeDataUrl(attachment.dataUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon name={ATTACHMENT_KIND_ICON[attachmentType]} className="h-5 w-5 text-[var(--accent-ink)]" />
              );
            const thumbClass = "grid h-12 w-12 grid-cols-1 place-items-center overflow-hidden rounded-[14px] bg-[var(--surface-strong)]";
            return (
              <article key={attachment.id} className="quiet-panel group grid min-w-0 grid-cols-1 gap-2 p-3" data-testid="attachment-card">
                <div className="flex min-w-0 items-start gap-3">
                  {/* L'anteprima apre il link o scarica il file (48 px, si tocca bene); il segno nell'angolo dice quale dei due. */}
                  {href || download ? (
                    <a
                      href={href ?? download}
                      {...(href ? { target: "_blank", rel: "noreferrer" } : { download: attachment.name })}
                      aria-label={href ? MATERIALS_TEXT.open(attachment.name) : MATERIALS_TEXT.download(attachment.name)}
                      title={href ? MATERIALS_TEXT.openTitle : MATERIALS_TEXT.downloadTitle}
                      className="relative shrink-0 rounded-[14px] hover:ring-2 hover:ring-[var(--accent-ink)]"
                    >
                      <span className={thumbClass}>{thumb}</span>
                      <span
                        className={`absolute -bottom-1 -right-1 grid h-5 w-5 grid-cols-1 place-items-center rounded-full border-2 border-[var(--bg-2)] ${
                          href ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface)] text-[var(--text)]"
                        }`}
                      >
                        <Icon name={href ? "ExternalLink" : "Download"} className="h-3 w-3" />
                      </span>
                    </a>
                  ) : (
                    <div className={`${thumbClass} shrink-0`}>{thumb}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => openEditor(attachment)} className="block w-full text-left">
                      <h3 className="two-line-safe text-sm font-black leading-snug">{attachment.name}</h3>
                    </button>
                    <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
                      {ATTACHMENT_KIND_LABEL[attachmentType]}
                      {attachment.externalUrl ? ` · ${hostOf(attachment.externalUrl)}` : attachment.size ? ` · ${formatBytes(attachment.size)}` : ""} · {shortDate(attachment.addedAt)}
                    </p>
                    {linked || visibleTags(attachment).length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {linked ? (
                          linkAction ? (
                            <PillButton label={linked} color={color} aria={linkAction.aria} onClick={linkAction.run} />
                          ) : (
                            <Tag color={color}>{linked}</Tag>
                          )
                        ) : null}
                        {visibleTags(attachment).slice(0, 3).map((tag) => (
                          <PillButton key={tag} label={`#${tag}`} aria={MATERIALS_TEXT.searchTag} onClick={() => setQuery(tag)} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="-my-1.5 -mr-1.5 flex shrink-0 flex-col items-center">
                    <IconButton icon="PenLine" label={MATERIALS_TEXT.edit(attachment.name)} className="bg-transparent" onClick={() => openEditor(attachment)} data-testid="edit-attachment" />
                    <IconButton
                      id={deleteButtonId(attachment.id)}
                      icon="Trash2"
                      label={MATERIALS_TEXT.remove(attachment.name)}
                      aria-expanded={confirmDeleteId === attachment.id && !editingAttachment}
                      className="bg-transparent text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                      onClick={() => setConfirmDeleteId(attachment.id)}
                      data-testid="delete-attachment"
                    />
                  </div>
                </div>
                {confirmDeleteId === attachment.id && !editingAttachment ? (
                  <InlineConfirm
                    text={MATERIALS_TEXT.removeConfirm(shortName(attachment.name))}
                    confirmLabel={MATERIALS_TEXT.removeYes}
                    icon="Trash2"
                    onCancel={() => {
                      setConfirmDeleteId(null);
                      // La conferma sparisce: il focus torna sul cestino da cui era partita.
                      window.requestAnimationFrame(() => document.getElementById(deleteButtonId(attachment.id))?.focus());
                    }}
                    onConfirm={() => void deleteMaterial(attachment)}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      ) : attachments.length ? (
        <EmptyState
          icon="Search"
          title={MATERIALS_TEXT.noneFoundTitle}
          body={MATERIALS_TEXT.noneFoundBody}
          action={
            <Button variant="soft" onClick={showEverything}>
              {MATERIALS_TEXT.showAll}
            </Button>
          }
        />
      ) : (
        // Un'azione sola: «Carica un file» e «Salva un link» sono già nella barra qui sopra.
        <EmptyState icon="Paperclip" title={MATERIALS_TEXT.emptyTitle} body={MATERIALS_TEXT.emptyBody} />
      )}

      {/* Le note della persona (scritte da un assistente o arrivate da un altro dispositivo): si aprono qui. */}
      {myNotes.length ? (
        <section aria-labelledby="materials-notes-title" className="mt-6">
          <h3 id="materials-notes-title" ref={notesHeadingRef} tabIndex={-1} className="mb-2 text-xs font-black uppercase text-[var(--faint)] outline-none">
            {MATERIALS_TEXT.notesTitle(myNotes.length)}
          </h3>
          <ul className="grid grid-cols-1 gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {shownNotes.map((note) => (
              <li key={note.id} className="min-w-0">
                <button
                  id={noteButtonId(note.id)}
                  type="button"
                  onClick={() => setOpenNoteId(note.id)}
                  aria-haspopup="dialog"
                  aria-label={NOTES_TEXT.openNote(noteTitle(note))}
                  className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 py-2 text-left hover:bg-[var(--surface)]"
                >
                  <Icon name="PenLine" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                  <span className="min-w-0 flex-1">
                    <span className="one-line-safe block text-sm font-extrabold">{noteTitle(note)}</span>
                    {firstLine(note.body) ? <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{firstLine(note.body)}</span> : null}
                  </span>
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
                </button>
              </li>
            ))}
          </ul>
          {myNotes.length > FIRST_NOTES ? (
            <button
              type="button"
              onClick={() => setShowAllNotes((value) => !value)}
              className="mt-1 inline-flex min-h-11 items-center px-1 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
            >
              {showAllNotes ? MATERIALS_TEXT.notesShowLess : MATERIALS_TEXT.notesShowAll(myNotes.length)}
            </button>
          ) : null}
        </section>
      ) : null}
      <NoteDrawer noteId={openNoteId} onClose={closeNote} />

      <Drawer
        open={editingAttachment !== null}
        onClose={requestCloseEditor}
        eyebrow={MATERIALS_TEXT.editEyebrow}
        title={MATERIALS_TEXT.editTitle}
        width="max-w-[560px]"
        footer={editorFooter}
      >
        {editingAttachment ? (
          <div className="grid grid-cols-1 gap-3">
            <p className="two-line-safe text-sm text-[var(--muted)]">
              {ATTACHMENT_KIND_LABEL[attachmentKind(editingAttachment)]} · aggiunto il {shortDate(editingAttachment.addedAt)}
            </p>
            <Field label="Nome">
              <input className={inputClass} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} data-autofocus />
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

            {editorError ? (
              <p className="text-sm font-bold text-[var(--warning-text)]" role="alert">
                {editorError}
              </p>
            ) : null}

            <LinkedNotes entityType="attachment" id={editingAttachment.id} />
          </div>
        ) : null}
      </Drawer>

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
