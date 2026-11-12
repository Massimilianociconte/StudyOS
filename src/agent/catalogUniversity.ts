// Strumenti MCP del catalogo BARB con le correzioni dei gruppi (spec §9, §11). Email: solo gli indirizzi
// esattamente @unimi.it di docenti e contatti (AGENT_INSTITUTIONAL_EMAILS in project.ts).
import type { AgentTool } from "./catalog";
import { CONFIRM, ID, LIMIT, OFFSET, QUERY, VERSION, label, objectSchema } from "./catalogParts";

const GROUP = { ...ID, description: "groupId (studyos_list_group_exam_sessions): con questo arrivano anche i valori effettivi con le correzioni di quel gruppo." };
const TARGET_ID = {
  type: "string",
  pattern: "^[A-Za-z0-9_.:-]{1,160}$",
  description: "id del docente o dell'insegnamento, targetId di una regola d'orario o di un contatto (dalle letture). Per un contatto nuovo: «nuovo»."
} as const;
const FIELD = { type: "string", maxLength: 500 } as const;
const FIELDS = {
  type: "object",
  additionalProperties: false,
  description:
    "Campi da correggere; stringa vuota = togli la correzione di quel campo, quelli non indicati restano. Docente: officeHours, officeHoursPlace, office, phone, email (solo @unimi.it), website, note. Insegnamento: room, building, site, lessonTimes, note. Regola d'orario: room, building, site, note. Contatto: label, value, url, note.",
  properties: {
    officeHours: FIELD,
    officeHoursPlace: FIELD,
    office: FIELD,
    phone: FIELD,
    email: FIELD,
    website: FIELD,
    note: FIELD,
    room: FIELD,
    building: FIELD,
    site: FIELD,
    lessonTimes: FIELD,
    label: FIELD,
    value: FIELD,
    url: FIELD
  }
} as const;
const EMAILS = " Email: solo gli indirizzi esattamente @unimi.it.";
const CORRECTIONS = " corrections = correzioni dei gruppi (overrideId, version, fields, chi e quando).";

export const UNIVERSITY_TOOLS: readonly AgentTool[] = [
  {
    name: "studyos_list_barb_teachers",
    title: "Docenti BARB",
    description:
      "Elenca i docenti del catalogo BARB: ruolo, dipartimento, insegnamenti (courseIds), email, telefono, studio, ricevimento, sito." +
      CORRECTIONS +
      EMAILS +
      " Filtri query (nome) e courseId.",
    risk: "read",
    idempotent: true,
    inputSchema: objectSchema({ query: QUERY, courseId: ID, groupId: GROUP, limit: LIMIT, offset: OFFSET }),
    summary: () => "Leggere i docenti BARB"
  },
  {
    name: "studyos_get_barb_course",
    title: "Insegnamento BARB",
    description:
      "Dettaglio di un insegnamento BARB (id da studyos_list_barb_courses): docenti con email, regole d'orario (targetId, giorno, ore, aula, edificio, sede)." + CORRECTIONS + EMAILS,
    risk: "read",
    idempotent: true,
    inputSchema: objectSchema({ id: ID, groupId: GROUP }, ["id"]),
    summary: (args) => `Leggere l'insegnamento ${label(args.id, "")}`.trim()
  },
  {
    name: "studyos_list_barb_contacts",
    title: "Contatti del corso",
    description:
      "Contatti ufficiali del corso BARB (segreterie, uffici) e quelli aggiunti dai gruppi (official=false)." + CORRECTIONS + EMAILS,
    risk: "read",
    idempotent: true,
    inputSchema: objectSchema({ groupId: GROUP }),
    summary: () => "Leggere i contatti del corso"
  },
  {
    name: "studyos_save_catalog_override",
    title: "Correggi il catalogo per il gruppo",
    description:
      "Salva la correzione del gruppo a un docente, insegnamento, regola d'orario o contatto (ricevimento, aula, sito…). Lo vedono tutti i membri del gruppo; il catalogo ufficiale non cambia. Se il gruppo ha già una correzione per quell'elemento serve expectedVersion (la version in corrections): se qualcuno l'ha cambiata nel frattempo risponde code=conflict con data.current.",
    risk: "write",
    idempotent: true,
    openWorld: true,
    inputSchema: objectSchema(
      {
        groupId: { ...ID, description: "groupId del gruppo." },
        targetKind: { type: "string", enum: ["teacher", "course", "schedule_rule", "contact"] },
        targetId: TARGET_ID,
        targetLabel: { type: "string", maxLength: 160, description: "Nome da mostrare (facoltativo: di solito quello del catalogo)." },
        fields: FIELDS,
        expectedVersion: VERSION
      },
      ["groupId", "targetKind", "targetId", "fields"]
    ),
    summary: (args) => `Correggere per il gruppo ${label(args.targetLabel, label(args.targetId, "un elemento del catalogo"))}`
  },
  {
    name: "studyos_delete_catalog_override",
    title: "Togli una correzione del gruppo",
    description:
      "Toglie una correzione del gruppo (overrideId da corrections): torna il dato ufficiale per tutti i membri. Si può ripristinare dalla cronologia del gruppo. expectedVersion facoltativa: senza, vale la version letta ora.",
    risk: "destructive",
    idempotent: true,
    openWorld: true,
    inputSchema: objectSchema({ id: { ...ID, description: "overrideId da corrections." }, expectedVersion: VERSION, confirm: CONFIRM }, ["id", "confirm"]),
    summary: (args) => `Togliere la correzione ${label(args.id, "")} per tutto il gruppo`
  }
];

export const UNIVERSITY_TOOL_NAMES = UNIVERSITY_TOOLS.map((item) => item.name);
