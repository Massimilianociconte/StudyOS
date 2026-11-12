// Strumenti personali in più (spec §9.1): eliminare una materia, etichette, promemoria autonomi e il
// controllo di coerenza. Ci sono anche sul connettore remoto (dati personali).
import type { AgentTool } from "./catalog";
import { CONFIRM, DAY, ID, LIMIT, OFFSET, label, objectSchema, pageProps } from "./catalogParts";

const WHEN = "ISO 8601, es. 2026-11-10T14:30:00+01:00. Senza offset vale l'ora locale della persona (timeZone in studyos_status).";
const TAG = { type: "string", minLength: 1, maxLength: 40, pattern: "^[^,]{1,40}$", description: "Etichetta (senza virgole)." } as const;
const TAGS = { type: "array", minItems: 1, maxItems: 20, items: TAG } as const;
const REMINDER = { ...ID, description: "id del promemoria da studyos_list_reminders." };

export const EXTRA_TOOLS: readonly AgentTool[] = [
  {
    name: "studyos_delete_subject",
    title: "Elimina una materia",
    description:
      "Elimina una materia. Se ne vanno anche i suoi esami e argomenti; attività, eventi e sessioni restano senza materia; materiali, note, promemoria e piani d'esame perdono il collegamento. Prima leggi linkedCounts con studyos_get_subject e dillo alla persona.",
    risk: "destructive",
    idempotent: true,
    inputSchema: objectSchema({ id: { ...ID, description: "id della materia da studyos_list_subjects." }, confirm: CONFIRM }, ["id", "confirm"]),
    summary: (args) => `Eliminare la materia ${label(args.id, "")} con i suoi esami e argomenti`
  },
  {
    name: "studyos_list_tags",
    title: "Etichette",
    description: "Elenca le etichette usate su attività, materiali, note ed eventi, dalla più usata, con quanti elementi per tipo (byType).",
    risk: "read",
    idempotent: true,
    inputSchema: objectSchema({ ...pageProps }),
    summary: () => "Leggere le etichette"
  },
  {
    name: "studyos_tag_items",
    title: "Etichetta elementi",
    description:
      "Aggiunge (add) e toglie (remove) etichette su uno o più elementi dello stesso tipo: task, material, note o event. Le maiuscole non contano; le etichette già presenti restano una sola volta.",
    risk: "write",
    idempotent: true,
    inputSchema: objectSchema(
      {
        type: { type: "string", enum: ["task", "material", "note", "event"] },
        ids: { type: "array", minItems: 1, maxItems: 50, items: ID },
        add: TAGS,
        remove: TAGS
      },
      ["type", "ids"]
    ),
    summary: (args) => `Cambiare le etichette di ${Array.isArray(args.ids) ? args.ids.length : 0} elementi`
  },
  {
    name: "studyos_list_reminders",
    title: "Promemoria",
    description: "Elenca i promemoria autonomi (quelli del pannello Notifiche), dal più vicino. includeDone=true anche quelli fatti; from/to filtrano per giorno.",
    risk: "read",
    idempotent: true,
    inputSchema: objectSchema({ includeDone: { type: "boolean", default: false }, from: DAY, to: DAY, limit: LIMIT, offset: OFFSET }),
    summary: () => "Leggere i promemoria"
  },
  {
    name: "studyos_create_reminder",
    title: "Crea un promemoria",
    description:
      "Crea un promemoria autonomo: scatta all'ora indicata come quelli degli eventi e si vede nel pannello Notifiche. linkedType e linkedId (insieme) lo collegano a una materia, un esame, un evento, un'attività o una nota.",
    risk: "write",
    idempotent: false,
    additive: true,
    inputSchema: objectSchema(
      {
        title: { type: "string", minLength: 1, maxLength: 200 },
        remindAt: { type: "string", minLength: 10, maxLength: 40, description: WHEN },
        linkedType: { type: "string", enum: ["subject", "exam", "calendarEvent", "task", "note"] },
        linkedId: ID
      },
      ["title", "remindAt"]
    ),
    summary: (args) => `Creare il promemoria «${label(args.title, "senza titolo")}»`
  },
  {
    name: "studyos_update_reminder",
    title: "Modifica un promemoria",
    description: "Cambia titolo, ora (remindAt) o stato (done) di un promemoria autonomo.",
    risk: "write",
    idempotent: true,
    inputSchema: objectSchema(
      {
        id: REMINDER,
        title: { type: "string", minLength: 1, maxLength: 200 },
        remindAt: { type: "string", minLength: 10, maxLength: 40, description: WHEN },
        done: { type: "boolean" }
      },
      ["id"]
    ),
    summary: (args) => `Modificare il promemoria ${label(args.id, "")}`.trim()
  },
  {
    name: "studyos_delete_reminder",
    title: "Elimina un promemoria",
    description: "Elimina un promemoria autonomo.",
    risk: "destructive",
    idempotent: true,
    inputSchema: objectSchema({ id: REMINDER, confirm: CONFIRM }, ["id", "confirm"]),
    summary: (args) => `Eliminare il promemoria ${label(args.id, "")}`.trim()
  },
  {
    name: "studyos_check_consistency",
    title: "Controllo di coerenza",
    description:
      "Controlla piano d'esame, appelli dei gruppi, esami, eventi e collegamenti: doppioni, appelli scelti eliminati o cambiati, collegamenti rotti, iscrizioni in chiusura. Ogni problema ha id stabile, gravità (error, warning, info), refs e a volte fix (strumento e argomenti da proporre: con needsConfirmation chiedi prima alla persona). Solo lettura. groupExamsChecked=false: appelli dei gruppi non letti, controllati solo i dati personali.",
    risk: "read",
    idempotent: true,
    inputSchema: objectSchema({
      scope: { type: "string", enum: ["all", "personal", "groups"], default: "all" },
      minSeverity: { type: "string", enum: ["info", "warning", "error"], default: "info" },
      limit: LIMIT,
      offset: OFFSET
    }),
    summary: () => "Controllare la coerenza del piano d'esame"
  }
];

export const EXTRA_TOOL_NAMES = EXTRA_TOOLS.map((item) => item.name);
