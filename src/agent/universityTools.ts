// Docenti, insegnamenti e contatti del catalogo BARB per gli agenti, con le correzioni dei gruppi (spec §9.3,
// §11). Email: solo gli indirizzi esattamente @unimi.it di docenti e contatti (agentTeacherEmail,
// agentCatalogText); le note dei membri passano da agentMemberText. Caricato da execute.ts con import().
import {
  cleanOverrideFields,
  contactTargetId,
  newContactTargetId,
  overridesOf,
  scheduleRuleTargetId,
  withOverride
} from "../lib/catalogOverrides";
import { newGroupRecordId, type CatalogOverride, type CatalogTargetKind } from "../lib/groupExams";
import { GROUP_EXAM_TEXT } from "../lib/labels/groupExams";
import { normalizeExternalUrl } from "../lib/safeUrl";
import type { BarbTeacher, ScheduleRule } from "../lib/university/types";
import { groupNamesOf, useGroupExamStore } from "../store/useGroupExamStore";
import { failWith, groupExamsReady, groupWrite } from "./groupExamTools";
import { agentCatalogText, agentMemberText, agentTeacherEmail } from "./project";
import { fail, ok, optional, page, text, type Args } from "./toolkit";
import type { AgentCallResult } from "./types";

const NO_GROUP = "Gruppo non trovato tra quelli online: usa un groupId di studyos_list_group_exam_sessions.";
const NO_TARGET = "Elemento del catalogo non trovato: usa un id o un targetId di studyos_list_barb_teachers, studyos_get_barb_course o studyos_list_barb_contacts.";
const NO_OVERRIDE = "Correzione non trovata: usa un overrideId di corrections.";
const CONFLICT = "Qualcuno ha cambiato la correzione nel frattempo: leggi data.current e riprova con la sua version.";
const NEEDS_VERSION = "Il gruppo ha già una correzione per questo elemento: passa expectedVersion (la version in corrections).";

const catalog = async () => (await import("../data/university/barb.dataset")).BARB_DATASET;
const groups = () => useGroupExamStore.getState();
const groupNameOf = (groupId: string) => groupNamesOf(groups().groups).get(groupId) ?? "";

/** Link per gli agenti: http(s) sicuro; mailto solo verso un indirizzo istituzionale. */
const agentLink = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^mailto:/i.test(value)) {
    const email = agentTeacherEmail(value.slice(7).split("?")[0]);
    return email ? `mailto:${email}` : null;
  }
  return normalizeExternalUrl(value);
};

/** Un campo del catalogo o di una correzione come lo vede l'agente. */
const shown = (key: string, value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  if (key === "email") return agentTeacherEmail(value);
  if (key === "website" || key === "url") return agentLink(value);
  if (key === "note") return agentMemberText(value);
  return agentCatalogText(value);
};

const shownFields = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, shown(key, value)]));

export const publicCorrection = (row: CatalogOverride) => ({
  overrideId: row.id,
  groupId: row.groupId,
  groupName: agentMemberText(groupNameOf(row.groupId)),
  targetKind: row.targetKind,
  targetId: row.targetId,
  targetLabel: agentMemberText(row.targetLabel),
  fields: shownFields(row.fields),
  by: agentMemberText(row.updatedByName),
  updatedAt: row.updatedAt,
  version: row.version,
  ...(row.deletedAt ? { deleted: true } : {})
});

const correctionsOf = (kind: CatalogTargetKind, targetId: string, read: boolean) =>
  read ? overridesOf(groups().overrides, kind, targetId).map(publicCorrection) : [];

const groupOverride = (kind: CatalogTargetKind, targetId: string, groupId: string | undefined) =>
  groupId ? overridesOf(groups().overrides, kind, targetId, groupId).find((item) => item.groupId === groupId) : undefined;

/** Senza groupId basta il catalogo ufficiale; con groupId servono gli appelli dei gruppi letti. */
const groupScope = (args: Args): { read: boolean; groupId?: string; blocked?: AgentCallResult } => {
  const blocked = groupExamsReady();
  const groupId = optional(args.groupId);
  if (!groupId) return { read: blocked === null };
  if (blocked) return { read: false, blocked };
  if (!groups().groups.some((group) => group.id === groupId)) return { read: true, blocked: fail("not_found", NO_GROUP) };
  return { read: true, groupId };
};

const teacherValues = (teacher: BarbTeacher): Record<string, string> => ({
  email: teacher.email ?? "",
  phone: teacher.phone ?? "",
  office: teacher.office ?? "",
  officeHours: teacher.officeHours ?? "",
  officeHoursPlace: teacher.officeHoursPlace ?? "",
  website: teacher.website ?? ""
});

const publicTeacher = (teacher: BarbTeacher, read: boolean, groupId: string | undefined) => {
  const effective = withOverride(teacherValues(teacher), groupOverride("teacher", teacher.id, groupId));
  return {
    id: teacher.id,
    name: teacher.displayName,
    role: teacher.role ?? null,
    department: teacher.department ?? null,
    courseIds: teacher.courseIds,
    ...shownFields(teacherValues(teacher)),
    profileUrl: agentLink(teacher.unimiProfileUrl),
    corrections: correctionsOf("teacher", teacher.id, read),
    ...(groupId ? { effective: shownFields(effective.value), correctedFields: effective.changed } : {})
  };
};

export const listBarbTeachers = async (args: Args): Promise<AgentCallResult> => {
  const scope = groupScope(args);
  if (scope.blocked) return scope.blocked;
  const data = await catalog();
  const query = text(args.query).trim().toLocaleLowerCase("it");
  const courseId = optional(args.courseId);
  const items = data.teachers.filter(
    (teacher) => (!courseId || teacher.courseIds.includes(courseId)) && (!query || teacher.displayName.toLocaleLowerCase("it").includes(query))
  );
  const listed = page(items, args);
  return ok({ correctionsRead: scope.read, ...listed, items: listed.items.map((teacher) => publicTeacher(teacher, scope.read, scope.groupId)) });
};

const ruleValues = (rule: ScheduleRule): Record<string, string> => ({ room: rule.room ?? "", building: rule.building ?? "", site: rule.site ?? "" });

export const getBarbCourse = async (args: Args): Promise<AgentCallResult> => {
  const scope = groupScope(args);
  if (scope.blocked) return scope.blocked;
  const data = await catalog();
  const course = data.courses.find((item) => item.id === text(args.id));
  if (!course) return fail("not_found", "Insegnamento non trovato: usa un id di studyos_list_barb_courses.");
  const teachers = new Map(data.teachers.map((teacher) => [teacher.id, teacher]));
  const courseOverride = groupOverride("course", course.id, scope.groupId);
  return ok({
    correctionsRead: scope.read,
    item: {
      id: course.id,
      name: course.name,
      englishName: course.englishName,
      cfu: course.cfu,
      year: course.year,
      semester: course.semester,
      language: course.language,
      examMode: course.examMode,
      teachers: course.teacherIds.flatMap((id) => {
        const teacher = teachers.get(id);
        return teacher ? [{ id: teacher.id, name: teacher.displayName, email: agentTeacherEmail(teacher.email), responsible: teacher.id === course.responsibleTeacherId }] : [];
      }),
      schedule: course.schedule.map((rule) => {
        const targetId = scheduleRuleTargetId(course.id, rule.id);
        const effective = withOverride(ruleValues(rule), groupOverride("schedule_rule", targetId, scope.groupId));
        return {
          targetId,
          weekday: rule.weekday,
          weekdayLabel: GROUP_EXAM_TEXT.weekdays[rule.weekday - 1],
          startTime: rule.startTime,
          endTime: rule.endTime,
          ...shownFields(ruleValues(rule)),
          corrections: correctionsOf("schedule_rule", targetId, scope.read),
          ...(scope.groupId ? { effective: shownFields(effective.value), correctedFields: effective.changed } : {})
        };
      }),
      corrections: correctionsOf("course", course.id, scope.read),
      ...(courseOverride ? { groupCorrection: publicCorrection(courseOverride) } : {})
    }
  });
};

export const listBarbContacts = async (args: Args): Promise<AgentCallResult> => {
  const scope = groupScope(args);
  if (scope.blocked) return scope.blocked;
  const data = await catalog();
  const official = data.contacts.map((contact) => {
    const targetId = contactTargetId(contact.label);
    const values = { label: contact.label, value: contact.value, url: contact.url ?? "" };
    const effective = withOverride(values, groupOverride("contact", targetId, scope.groupId));
    return {
      targetId,
      official: true,
      ...shownFields(values),
      corrections: correctionsOf("contact", targetId, scope.read),
      ...(scope.groupId ? { effective: shownFields(effective.value), correctedFields: effective.changed } : {})
    };
  });
  const added = scope.read
    ? groups()
        .overrides.filter((item) => !item.deletedAt && item.targetKind === "contact" && item.targetId.startsWith("nuovo:") && (!scope.groupId || item.groupId === scope.groupId))
        .map((item) => ({
          targetId: item.targetId,
          official: false,
          ...shownFields({ label: item.fields.label ?? item.targetLabel, value: item.fields.value ?? "", url: item.fields.url ?? "" }),
          corrections: [publicCorrection(item)]
        }))
    : [];
  return ok({ correctionsRead: scope.read, items: [...official, ...added] });
};

/** Nome ufficiale dell'elemento da correggere; "" per un contatto nuovo; null se non c'è nel catalogo. */
const officialLabel = async (kind: CatalogTargetKind, targetId: string): Promise<string | null> => {
  const data = await catalog();
  if (kind === "teacher") return data.teachers.find((item) => item.id === targetId)?.displayName ?? null;
  if (kind === "course") return data.courses.find((item) => item.id === targetId)?.name ?? null;
  if (kind === "schedule_rule") {
    for (const course of data.courses) {
      const rule = course.schedule.find((item) => scheduleRuleTargetId(course.id, item.id) === targetId);
      if (rule) return `${course.name} · ${GROUP_EXAM_TEXT.weekdays[rule.weekday - 1]} ${rule.startTime}`;
    }
    return null;
  }
  if (targetId.startsWith("nuovo:")) return "";
  return data.contacts.find((item) => contactTargetId(item.label) === targetId)?.label ?? null;
};

export const saveCatalogOverride = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const groupId = text(args.groupId);
  if (!groups().groups.some((group) => group.id === groupId)) return fail("not_found", NO_GROUP);
  const kind = text(args.targetKind) as CatalogTargetKind;
  const raw = text(args.targetId);
  const targetId = kind === "contact" && raw === "nuovo" ? newContactTargetId(crypto.randomUUID().replaceAll("-", "")) : raw;
  const official = await officialLabel(kind, targetId);
  if (official === null) return fail("not_found", NO_TARGET);
  const existing = groups().overrides.find((item) => item.groupId === groupId && item.targetKind === kind && item.targetId === targetId && !item.deletedAt);
  if (existing && args.expectedVersion === undefined) return failWith("conflict", NEEDS_VERSION, { current: publicCorrection(existing) });
  if (existing && Number(args.expectedVersion) !== existing.version) return failWith("conflict", CONFLICT, { current: publicCorrection(existing) });
  const merged: Record<string, unknown> = { ...(existing?.fields ?? {}) };
  const input = args.fields && typeof args.fields === "object" ? (args.fields as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(input)) merged[key] = value === "" ? null : value;
  const cleaned = cleanOverrideFields(kind, merged);
  if (!cleaned.ok) return failWith("invalid", cleaned.message, { field: cleaned.field });
  const targetLabel = (optional(args.targetLabel) ?? (existing?.targetLabel || official || cleaned.value.label || "")).slice(0, 160);
  return groupWrite(
    (writer) => writer.saveOverride(groupId, existing?.id ?? newGroupRecordId("gover"), existing ? existing.version : null, kind, targetId, targetLabel, cleaned.value),
    publicCorrection,
    (row) => {
      useGroupExamStore.getState().applyOverride(row);
      return { saved: true, override: publicCorrection(row) };
    }
  );
};

export const deleteCatalogOverride = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const current = groups().overrides.find((item) => item.id === text(args.id));
  if (!current) return fail("not_found", NO_OVERRIDE);
  if (current.deletedAt) return ok({ deleted: true, alreadyDeleted: true, override: publicCorrection(current) });
  if (args.expectedVersion !== undefined && Number(args.expectedVersion) !== current.version) {
    return failWith("conflict", CONFLICT, { current: publicCorrection(current) });
  }
  return groupWrite(
    (writer) => writer.deleteOverride(current.id, current.version),
    publicCorrection,
    (row) => {
      useGroupExamStore.getState().applyOverride(row);
      return { deleted: true, override: publicCorrection(row) };
    }
  );
};
