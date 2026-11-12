// Filtri di Materiali (tipo, materia, testo cercato): la regola dell'elenco, usata anche per dire se un
// materiale appena aggiunto resta nascosto dai filtri. Puro, testato in tests/materialFilters.test.mjs.
import type { Attachment } from "../types";
import { attachmentKind, type AttachmentKind } from "./labels";

export type MaterialKindFilter = "all" | AttachmentKind;

export const MATERIAL_KIND_FILTERS = ["all", "pdf", "image", "video", "doc", "link", "file"] as const satisfies readonly MaterialKindFilter[];

export interface MaterialFilters {
  kind: MaterialKindFilter;
  /** "" = tutte le materie. */
  subjectId: string;
  query: string;
}

type MaterialFields = Pick<Attachment, "name" | "description" | "tags" | "externalUrl" | "mimeType" | "linkedEntityType" | "linkedEntityId">;

/** Il materiale compare con questi filtri. Il testo si cerca in nome, descrizione, etichette e link. */
export const materialMatches = (attachment: MaterialFields, { kind, subjectId, query }: MaterialFilters) => {
  if (kind !== "all" && attachmentKind(attachment) !== kind) return false;
  if (subjectId && !(attachment.linkedEntityType === "subject" && attachment.linkedEntityId === subjectId)) return false;
  const q = query.trim().toLowerCase();
  return !q || `${attachment.name} ${attachment.description} ${attachment.tags.join(" ")} ${attachment.externalUrl ?? ""}`.toLowerCase().includes(q);
};
