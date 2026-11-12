// Scheda «Docenti e aule» del gruppo: docenti dei miei corsi (o cercati), aule delle lezioni e contatti,
// con il dato ufficiale e la correzione del gruppo. Caricata con lazy(): porta i dati BARB.
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button, inputClass } from "../ui";
import { CorrectionValue } from "./GroupCorrections";
import { OverrideDrawer } from "./OverrideDrawer";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { CATALOG_OVERRIDE_FIELDS, contactTargetId, newContactTargetId, overridesOf, scheduleRuleTargetId, withOverride } from "../../lib/catalogOverrides";
import type { CatalogTargetKind } from "../../lib/groupExams";
import { resolveBarbCourse } from "../../lib/university/examSessions";
import type { BarbCourse, BarbTeacher, ScheduleRule } from "../../lib/university/types";
import { BARB_META, useBarbStore } from "../../store/useBarbStore";
import { useGroupExamStore } from "../../store/useGroupExamStore";
import { useStudyStore } from "../../store/useStudyStore";

interface Target {
  kind: CatalogTargetKind;
  targetId: string;
  targetLabel: string;
  official: Record<string, string>;
}

const teacherOfficial = (teacher: BarbTeacher): Record<string, string> => ({
  officeHours: teacher.officeHours ?? "",
  officeHoursPlace: teacher.officeHoursPlace ?? "",
  office: teacher.office ?? "",
  phone: teacher.phone ?? "",
  email: teacher.email ?? "",
  website: teacher.website ?? ""
});

const ruleText = (rule: ScheduleRule) => `${T.weekdays[rule.weekday - 1]} ${rule.startTime}–${rule.endTime}`;
const ruleOfficial = (rule: ScheduleRule): Record<string, string> => ({ room: rule.room ?? "", building: rule.building ?? "", site: rule.site ?? "" });
const courseOfficial = (course: BarbCourse): Record<string, string> => ({ lessonTimes: course.schedule.map(ruleText).join("; ") });

function Row({ title, lines, corrected, onCorrect }: { title: string; lines: Array<[string, string]>; corrected: string | null; onCorrect: () => void }) {
  return (
    <li className="quiet-panel grid grid-cols-1 gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="safe-text min-w-0 font-black">{title}</p>
        <Button variant="soft" icon="PenLine" onClick={onCorrect}>
          {T.correct}
        </Button>
      </div>
      {lines.length ? (
        <dl className="grid grid-cols-1 gap-0.5 text-xs">
          {lines.map(([field, value]) => (
            <div key={field} className="flex min-w-0 flex-wrap gap-x-1.5">
              <dt className="font-bold text-[var(--muted)]">{T.overrideField[field] ?? field}:</dt>
              <dd className="min-w-0">
                <CorrectionValue field={field} value={value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {corrected ? <p className="text-xs font-black text-[var(--accent-ink)]">{corrected}</p> : null}
    </li>
  );
}

export default function GroupCatalogTab({ groupId }: { groupId: string }) {
  const { ready: barbReady, courses, teachers, init } = useBarbStore(
    useShallow((state) => ({ ready: state.ready, courses: state.courses, teachers: state.teachers, init: state.init }))
  );
  const subjects = useStudyStore((state) => state.subjects);
  const overrides = useGroupExamStore((state) => state.overrides);
  const available = useGroupExamStore((state) => state.available);
  const groupName = useGroupExamStore((state) => state.groups.find((group) => group.id === groupId)?.name ?? "");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  const myCourses = useMemo(
    () =>
      subjects
        .filter((subject) => !subject.archived && subject.status !== "archived")
        .map((subject) => resolveBarbCourse(subject, courses))
        .filter((course): course is BarbCourse => Boolean(course)),
    [subjects, courses]
  );
  const shownTeachers = useMemo(() => {
    const mine = new Set(myCourses.map((course) => course.id));
    const corrected = new Set(overrides.filter((item) => item.groupId === groupId && item.targetKind === "teacher" && !item.deletedAt).map((item) => item.targetId));
    const q = query.trim().toLowerCase();
    return teachers
      .filter((teacher) => (q.length >= 2 ? teacher.displayName.toLowerCase().includes(q) : teacher.courseIds.some((id) => mine.has(id)) || corrected.has(teacher.id)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "it"))
      .slice(0, 60);
  }, [teachers, myCourses, overrides, groupId, query]);
  const addedContacts = overrides.filter((item) => item.groupId === groupId && item.targetKind === "contact" && item.targetId.startsWith("nuovo:") && !item.deletedAt);

  const effective = (kind: CatalogTargetKind, targetId: string, official: Record<string, string>) => {
    const override = overridesOf(overrides, kind, targetId, groupId).find((item) => item.groupId === groupId);
    const { value, changed } = withOverride(official, override);
    const lines = CATALOG_OVERRIDE_FIELDS[kind].filter((field) => value[field]).map((field) => [field, value[field]] as [string, string]);
    return { lines, corrected: changed.length || override?.fields.note ? T.correctedBy(groupName) : null };
  };

  if (!available) return <p className="text-sm font-bold text-[var(--muted)]">{T.notActive}</p>;
  if (!barbReady) return <p className="text-sm font-bold text-[var(--muted)]">{T.loading}</p>;

  return (
    <div className="grid grid-cols-1 gap-5">
      <p className="text-sm font-bold text-[var(--muted)]">{T.catalogIntro}</p>

      <section className="grid grid-cols-1 gap-2">
        <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.teachersTitle}</h4>
        <label className="block">
          <span className="sr-only">{T.searchTeacher}</span>
          <input className={inputClass} value={query} placeholder={T.searchTeacher} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <ul className="grid grid-cols-1 gap-2">
          {shownTeachers.map((teacher) => {
            const official = teacherOfficial(teacher);
            const { lines, corrected } = effective("teacher", teacher.id, official);
            return (
              <Row
                key={teacher.id}
                title={teacher.displayName}
                lines={lines}
                corrected={corrected}
                onCorrect={() => setTarget({ kind: "teacher", targetId: teacher.id, targetLabel: teacher.displayName, official })}
              />
            );
          })}
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-2">
        <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.roomsTitle}</h4>
        <ul className="grid grid-cols-1 gap-2">
          {myCourses.map((course) => {
            const official = courseOfficial(course);
            const { lines, corrected } = effective("course", course.id, official);
            return (
              <li key={course.id} className="grid grid-cols-1 gap-2">
                <ul className="grid grid-cols-1 gap-2">
                  <Row title={course.name} lines={lines} corrected={corrected} onCorrect={() => setTarget({ kind: "course", targetId: course.id, targetLabel: course.name, official })} />
                  {course.schedule.map((rule) => {
                    const id = scheduleRuleTargetId(course.id, rule.id);
                    const ruleValues = ruleOfficial(rule);
                    const shown = effective("schedule_rule", id, ruleValues);
                    return (
                      <Row
                        key={id}
                        title={`${course.name} · ${ruleText(rule)}`}
                        lines={shown.lines}
                        corrected={shown.corrected}
                        onCorrect={() => setTarget({ kind: "schedule_rule", targetId: id, targetLabel: `${course.name} · ${ruleText(rule)}`, official: ruleValues })}
                      />
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-black uppercase text-[var(--faint)]">{T.contactsTitle}</h4>
          <Button
            variant="soft"
            icon="Plus"
            onClick={() => setTarget({ kind: "contact", targetId: newContactTargetId(crypto.randomUUID().replaceAll("-", "")), targetLabel: "", official: {} })}
          >
            {T.addContact}
          </Button>
        </div>
        <ul className="grid grid-cols-1 gap-2">
          {BARB_META.contacts.map((contact) => {
            const id = contactTargetId(contact.label);
            const official = { label: contact.label, value: contact.value, url: contact.url ?? "" };
            const { lines, corrected } = effective("contact", id, official);
            return <Row key={id} title={contact.label} lines={lines} corrected={corrected} onCorrect={() => setTarget({ kind: "contact", targetId: id, targetLabel: contact.label, official })} />;
          })}
          {addedContacts.map((item) => (
            <Row
              key={item.id}
              title={item.fields.label || item.targetLabel}
              lines={Object.entries(item.fields).filter(([field]) => field !== "label")}
              corrected={`${T.addedContact} · ${item.createdByName}`}
              onCorrect={() => setTarget({ kind: "contact", targetId: item.targetId, targetLabel: item.targetLabel, official: {} })}
            />
          ))}
        </ul>
      </section>

      {target ? <OverrideDrawer key={`${target.kind}:${target.targetId}`} groupId={groupId} {...target} onClose={() => setTarget(null)} /> : null}
    </div>
  );
}
