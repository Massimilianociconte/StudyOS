// Vista BARB — Biologia Applicata alla Ricerca Biomedica (UNIMI), A.A. 2026/2027.
// Legge SOLO il dataset verificato (seed + overlay sincronizzato). Nessun fetch live verso
// UNIMI/Firecrawl: il flusso è UNIMI -> Firecrawl locale -> validazione -> overlay -> frontend.
//
// Layout: panoramica compatta, insegnamenti raggruppati come il piano di studi (card dense
// su più colonne) e dettaglio del corso in un pannello laterale, così la pagina resta corta
// e il contesto (elenco) non si perde mai.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { BARB_META, useBarbStore } from "../store/useBarbStore";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Drawer, EmptyState, Panel, Pill, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { weekdayLabel } from "../lib/university/normalize";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import type { BarbCourse, BarbSemesterInfo, BarbTeacher } from "../lib/university/types";

type Tab = "corsi" | "calendario" | "docenti" | "aule" | "fonti";
type SemesterFilter = "tutti" | "primo" | "secondo" | "altro";
type DetailTab = "panoramica" | "programma" | "esame";

const ORARI_URL = "https://orari.unimi.it/PortaleStudenti/";

const CHARACTER_LABEL: Record<BarbCourse["character"], string> = {
  obbligatorio: "Obbligatorio",
  "opzionale-scelta-guidata": "Scelta guidata",
  "scelta-libera": "Scelta libera",
  lingua: "Lingua",
  "altre-conoscenze": "Altre conoscenze",
  "tirocinio-tesi": "Tirocinio / Tesi"
};

const SEMESTER_LABEL: Record<BarbCourse["semester"], string> = {
  primo: "1° semestre",
  secondo: "2° semestre",
  annuale: "Annuale",
  "non-definito": "Periodo da definire"
};

const SEMESTER_SHORT: Record<BarbCourse["semester"], string> = {
  primo: "1° sem",
  secondo: "2° sem",
  annuale: "Annuale",
  "non-definito": "Da definire"
};

const SEMESTER_TONE: Record<BarbCourse["semester"], string> = {
  primo: "var(--accent)",
  secondo: "var(--accent-2)",
  annuale: "var(--warning)",
  "non-definito": "var(--faint)"
};

/** Struttura del piano di studi: ogni gruppo porta con sé la propria regola di scelta. */
const PLAN_GROUPS: { id: string; title: string; rule: string; match: (course: BarbCourse) => boolean }[] = [
  { id: "obbligatori", title: "Obbligatori", rule: "tutti · 36 CFU", match: (c) => c.character === "obbligatorio" },
  { id: "gruppo-1", title: "Gruppo 1", rule: "scegli 1 · 6 CFU", match: (c) => c.choiceGroup === "gruppo-1" },
  { id: "gruppo-2", title: "Gruppo 2", rule: "scegli 2 · 12 CFU", match: (c) => c.choiceGroup === "gruppo-2" },
  { id: "gruppo-3", title: "Gruppo 3", rule: "scegli 2 · 12 CFU", match: (c) => c.choiceGroup === "gruppo-3" },
  {
    id: "altre",
    title: "Lingua, scelta libera e altre attività",
    rule: "12 CFU liberi · 3 CFU inglese B2 · 3 CFU altre conoscenze",
    match: (c) =>
      !c.choiceGroup && (c.character === "lingua" || c.character === "altre-conoscenze" || c.character === "scelta-libera" || c.character === "opzionale-scelta-guidata")
  },
  { id: "tirocinio", title: "Tirocinio e prova finale", rule: "2° anno · 36 CFU", match: (c) => c.character === "tirocinio-tesi" }
];

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const formatShortDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "mai";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
};

function Missing({ label }: { label?: string }) {
  return <span className="font-bold text-[var(--faint)]">{label ?? "Non disponibile"}</span>;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="break-words underline decoration-[var(--accent)] underline-offset-2" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function LinkButton({ href, icon, children }: { href: string; icon: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="motion-safe inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--surface-strong)] px-3.5 text-sm font-extrabold hover:bg-[var(--surface)]"
    >
      <Icon name={icon} className="h-4 w-4" />
      {children}
    </a>
  );
}

export function BarbView() {
  const [tab, setTab] = useUiState<Tab>("barb.tab", "corsi", { validate: oneOf("corsi", "calendario", "docenti", "aule", "fonti") });
  const { ready, courses, teachers, semesters, syncLogs, init } = useBarbStore(
    useShallow((state) => ({
      ready: state.ready,
      courses: state.courses,
      teachers: state.teachers,
      semesters: state.semesters,
      syncLogs: state.syncLogs,
      init: state.init
    }))
  );

  useEffect(() => {
    void init();
  }, [init]);

  const teachersById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);

  if (!ready) {
    return <div className="soft-panel min-h-[240px] p-8 text-lg font-black">Caricamento dati BARB verificati...</div>;
  }

  const verified = BARB_META.syncedAt ?? BARB_META.exportedAt;
  const offered = courses.filter((course) => course.offered !== false).length;

  const tabs = [
    { id: "corsi" as const, label: "Insegnamenti", count: courses.length },
    { id: "calendario" as const, label: "Calendario" },
    { id: "docenti" as const, label: "Docenti e contatti", count: teachers.length },
    { id: "aule" as const, label: "Aule e sedi" },
    { id: "fonti" as const, label: "Fonti e sync" }
  ];

  return (
    <div>
      <SectionTitle
        title={BARB_META.degreeName}
        subtitle={`${BARB_META.degreeClass} · ${BARB_META.degreeCode} · A.A. ${BARB_META.academicYear} · solo fonti ufficiali UNIMI, verificate il ${formatDate(verified)}`}
        action={
          <a href="https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico" target="_blank" rel="noreferrer">
            <Button icon="GraduationCap" variant="primary">Piano ufficiale</Button>
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {semesters.map((semester) => (
          <SemesterTile key={semester.id} semester={semester} count={courses.filter((course) => course.semester === semester.id).length} />
        ))}
        <StatTile icon="BookOpen" label="Insegnamenti" value={String(courses.length)} detail={`${offered} erogati quest'anno`} />
        <StatTile icon="Users" label="Docenti" value={String(teachers.length)} detail={`${BARB_META.contacts.length} contatti ufficiali`} />
      </div>

      <div className="mb-4">
        <Segmented label="Sezioni BARB" value={tab} options={tabs} onChange={setTab} />
      </div>

      {tab === "corsi" ? <CoursesTab courses={courses} teachersById={teachersById} /> : null}
      {tab === "calendario" ? <WeeklySchedule courses={courses} semesters={semesters} /> : null}
      {tab === "docenti" ? <TeachersTab teachers={teachers} courses={courses} /> : null}
      {tab === "aule" ? <RoomsTab courses={courses} /> : null}
      {tab === "fonti" ? <SourcesTab syncLogs={syncLogs} /> : null}
    </div>
  );
}

function SemesterTile({ semester, count }: { semester: BarbSemesterInfo; count: number }) {
  const published = semester.scheduleStatus === "pubblicato";
  return (
    <div className="quiet-panel min-w-0 p-3.5" title={semester.scheduleNote}>
      <div className="flex items-center gap-2 text-xs font-black uppercase text-[var(--faint)]">
        <Icon name="CalendarDays" className="h-3.5 w-3.5 text-[var(--accent-ink)]" />
        <span className="truncate">{semester.label}</span>
      </div>
      <p className="mt-1 text-lg font-black leading-tight">
        {semester.startDate && semester.endDate ? `${formatShortDate(semester.startDate)} → ${formatShortDate(semester.endDate)}` : "Date da definire"}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--muted)]">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: published ? "var(--accent)" : "var(--warning)" }} />
        <span className="truncate">{published ? "Orario pubblicato" : "Orario in attesa"} · {count} attività</span>
      </p>
    </div>
  );
}

function StatTile({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="quiet-panel min-w-0 p-3.5">
      <div className="flex items-center gap-2 text-xs font-black uppercase text-[var(--faint)]">
        <Icon name={icon} className="h-3.5 w-3.5 text-[var(--accent-ink)]" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-lg font-black leading-tight">{value}</p>
      <p className="mt-1 truncate text-xs font-bold text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function useSubjectNames() {
  const subjects = useStudyStore((state) => state.subjects);
  return useMemo(() => new Set(subjects.map((subject) => subject.name.trim().toLowerCase())), [subjects]);
}

function CoursesTab({ courses, teachersById }: { courses: BarbCourse[]; teachersById: Map<string, BarbTeacher> }) {
  const [query, setQuery] = useUiState("barb.courseQuery", "", { scope: "tab" });
  const [semester, setSemester] = useUiState<SemesterFilter>("barb.semester", "tutti", { validate: oneOf("tutti", "primo", "secondo", "altro") });
  const [hideNotOffered, setHideNotOffered] = useUiState("barb.hideNotOffered", false);
  const [openId, setOpenId] = useUiState<string | null>("barb.openCourse", null, { scope: "tab", validate: isNullableString });
  const inSubjects = useSubjectNames();

  const notOffered = courses.filter((course) => course.offered === false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((course) => {
      if (semester === "altro" ? course.semester === "primo" || course.semester === "secondo" : semester !== "tutti" && course.semester !== semester) return false;
      if (hideNotOffered && course.offered === false) return false;
      if (!q) return true;
      const teacherNames = course.teacherIds.map((id) => teachersById.get(id)?.displayName ?? "").join(" ");
      return `${course.name} ${course.englishName ?? ""} ${course.ssd.join(" ")} ${course.cfu} ${teacherNames}`.toLowerCase().includes(q);
    });
  }, [courses, query, semester, hideNotOffered, teachersById]);

  const groups = useMemo(() => {
    const assigned = new Set<string>();
    const result = PLAN_GROUPS.map((group) => {
      const items = filtered.filter((course) => !assigned.has(course.id) && group.match(course));
      items.forEach((course) => assigned.add(course.id));
      return { ...group, items };
    });
    const rest = filtered.filter((course) => !assigned.has(course.id));
    if (rest.length) result.push({ id: "altro", title: "Altre attività", rule: "", match: () => true, items: rest });
    return result.filter((group) => group.items.length);
  }, [filtered]);

  // Ordine di navigazione del pannello dettagli = ordine visivo dei gruppi.
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const openIndex = ordered.findIndex((course) => course.id === openId);
  const openCourse = openIndex >= 0 ? ordered[openIndex] : courses.find((course) => course.id === openId) ?? null;

  const semesterOptions = [
    { id: "tutti" as const, label: "Tutti", count: courses.length },
    { id: "primo" as const, label: "1° semestre", count: courses.filter((c) => c.semester === "primo").length },
    { id: "secondo" as const, label: "2° semestre", count: courses.filter((c) => c.semester === "secondo").length },
    { id: "altro" as const, label: "Annuali / da definire", count: courses.filter((c) => c.semester === "non-definito" || c.semester === "annuale").length }
  ];

  return (
    <div>
      <div className="soft-panel mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Cerca corso, SSD o docente</span>
          <Icon name="Search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input
            className={`${inputClass} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca corso, SSD o docente"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Semestre"
            size="sm"
            value={semester}
            onChange={setSemester}
            options={semesterOptions}
          />
          {notOffered.length ? (
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-2 text-xs font-black text-[var(--muted)]">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={hideNotOffered} onChange={(e) => setHideNotOffered(e.target.checked)} />
              Nascondi non erogati ({notOffered.length})
            </label>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? <EmptyState icon="Search" title="Nessun corso" body="Prova a cambiare filtri o ricerca." /> : null}

      <div className="grid grid-cols-1 gap-6">
        {groups.map((group) => {
          const cfu = group.items.reduce((sum, course) => sum + course.cfu, 0);
          return (
            <section key={group.id} aria-labelledby={`barb-group-${group.id}`}>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                <h3 id={`barb-group-${group.id}`} className="text-lg font-black">
                  {group.title}
                </h3>
                {group.rule ? <span className="text-xs font-black uppercase text-[var(--accent-ink)]">{group.rule}</span> : null}
                <span className="text-xs font-bold text-[var(--faint)]">
                  {group.items.length} attività · {cfu} CFU in elenco
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
                {group.items.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    responsible={course.responsibleTeacherId ? teachersById.get(course.responsibleTeacherId) ?? null : null}
                    added={inSubjects.has(course.name.trim().toLowerCase())}
                    onOpen={() => setOpenId(course.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-6 flex items-start gap-2 px-1 text-xs text-[var(--muted)]">
        <Icon name="Info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-black text-[var(--text)]">Non disponibile</span> = campo non pubblicato nella fonte ufficiale (mai inventato). Ogni scheda riporta fonte e data
          di verifica.
          {notOffered.length ? ` Non erogati nell'A.A. ${BARB_META.academicYear}: ${notOffered.map((course) => course.name).join(", ")}.` : ""}
        </span>
      </p>

      <CourseDrawer
        course={openCourse}
        teachersById={teachersById}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => setOpenId(ordered[openIndex - 1].id) : undefined}
        onNext={openIndex >= 0 && openIndex < ordered.length - 1 ? () => setOpenId(ordered[openIndex + 1].id) : undefined}
        position={openIndex >= 0 ? `${openIndex + 1} di ${ordered.length}` : undefined}
      />
    </div>
  );
}

function CourseCard({
  course,
  responsible,
  added,
  onOpen
}: {
  course: BarbCourse;
  responsible: BarbTeacher | null;
  added: boolean;
  onOpen: () => void;
}) {
  const notOffered = course.offered === false;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={`quiet-panel motion-safe group flex min-h-[124px] min-w-0 flex-col p-3 text-left sm:min-h-[132px] sm:p-3.5 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-[var(--surface)] ${
        notOffered ? "opacity-65" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Tag color={SEMESTER_TONE[course.semester]}>{SEMESTER_SHORT[course.semester]}</Tag>
        <Tag className="shrink-0">{course.cfu} CFU</Tag>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {added ? (
            <span className="grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-[#10131d]" title="Già in Materie">
              <Icon name="Check" className="h-3.5 w-3.5" />
              <span className="sr-only">Già in Materie</span>
            </span>
          ) : null}
          <Icon name="ChevronRight" className="hidden h-4 w-4 text-[var(--faint)] transition-transform group-hover:translate-x-0.5 sm:block" />
        </span>
      </div>
      <h4 className="three-line-safe mt-2 text-sm font-black leading-snug sm:text-[15px]">{course.name}</h4>
      <div className="mt-auto pt-2">
        {notOffered ? (
          <p className="text-xs font-black text-[var(--warning-text)]">Non erogato {BARB_META.academicYear}</p>
        ) : (
          <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
            {responsible ? responsible.displayName : course.teacherIds.length ? `${course.teacherIds.length} docenti` : "Docente non pubblicato"}
            {course.ssd.length ? ` · ${course.ssd[0]}` : ""}
          </p>
        )}
      </div>
    </button>
  );
}

function AddToSubjects({ course, teacher }: { course: BarbCourse; teacher: BarbTeacher | null }) {
  const { subjects, addSubject } = useStudyStore(useShallow((state) => ({ subjects: state.subjects, addSubject: state.addSubject })));
  const [busy, setBusy] = useState(false);
  const exists = subjects.some((subject) => subject.name.trim().toLowerCase() === course.name.trim().toLowerCase());
  if (exists) {
    return (
      <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--success-bg)] px-4 text-sm font-extrabold text-[var(--success-text)]">
        <Icon name="Check" className="h-4 w-4" /> Già in Materie
      </span>
    );
  }
  return (
    <Button
      icon="Plus"
      variant="primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await addSubject({
            name: course.name,
            teacher: teacher?.displayName ?? "",
            cfu: course.cfu,
            semester: `${SEMESTER_LABEL[course.semester]} ${BARB_META.academicYear}`,
            status: "active",
            tags: ["barb", ...course.ssd],
            notes: [
              course.officialPageUrl ? `Scheda ufficiale: ${course.officialPageUrl}` : null,
              course.arielUrl ? `Ariel: ${course.arielUrl}` : null,
              teacher?.email ? `Docente: ${teacher.displayName} <${teacher.email}>` : null,
              course.examMode ? `Esame: ${course.examMode}${course.grading ? ` (${course.grading})` : ""}` : null
            ]
              .filter(Boolean)
              .join("\n")
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      Aggiungi a Materie
    </Button>
  );
}

/** Testo lungo con anteprima a righe limitate e pulsante "mostra tutto". */
function TextSection({ title, value }: { title: string; value: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const long = (value?.length ?? 0) > 420;
  return (
    <section className="min-w-0">
      <h4 className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{title}</h4>
      {value ? (
        <>
          <p className={`whitespace-pre-line text-sm leading-relaxed ${long && !expanded ? "line-clamp-[7]" : ""}`}>{value}</p>
          {long ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-sm font-black text-[var(--accent-ink)]">
              {expanded ? "Mostra meno" : "Mostra tutto"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm">
          <Missing />
        </p>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-[var(--surface-soft)] p-3">
      <dt className="text-[11px] font-black uppercase text-[var(--faint)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-bold">{children}</dd>
    </div>
  );
}

function CourseDrawer({
  course,
  teachersById,
  onClose,
  onPrev,
  onNext,
  position
}: {
  course: BarbCourse | null;
  teachersById: Map<string, BarbTeacher>;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
}) {
  const [detailTab, setDetailTab] = useUiState<DetailTab>("barb.detailTab", "panoramica", {
    scope: "tab",
    validate: oneOf("panoramica", "programma", "esame")
  });
  // Passando a un altro corso si riparte dalla panoramica; al primo caricamento (anche dopo un
  // refresh, quando i corsi arrivano in differita) la scheda salvata resta.
  const [detailFor, setDetailFor] = useState(course?.id);
  if (course && course.id !== detailFor) {
    if (detailFor !== undefined) setDetailTab("panoramica");
    setDetailFor(course.id);
  }

  const teachers = course
    ? course.teacherIds.map((id) => teachersById.get(id)).filter((teacher): teacher is BarbTeacher => Boolean(teacher))
    : [];
  const responsible = course?.responsibleTeacherId ? teachersById.get(course.responsibleTeacherId) ?? null : null;

  return (
    <Drawer
      open={Boolean(course)}
      onClose={onClose}
      title={course?.name ?? ""}
      eyebrow={
        course ? (
          <>
            <Pill active={course.character === "obbligatorio"}>{CHARACTER_LABEL[course.character]}</Pill>
            {course.choiceGroup ? <Pill>{PLAN_GROUPS.find((group) => group.id === course.choiceGroup)?.title ?? course.choiceGroup}</Pill> : null}
            <Pill>{course.cfu} CFU</Pill>
            {course.offered === false ? (
              <span className="inline-flex min-h-8 items-center rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 text-xs font-black text-[var(--warning-text)]">
                Non erogato {BARB_META.academicYear}
              </span>
            ) : null}
          </>
        ) : null
      }
      headerExtra={
        course?.englishName && course.englishName !== course.name ? <p className="text-sm font-bold text-[var(--muted)]">{course.englishName}</p> : null
      }
      footer={
        course ? (
          <div className="flex flex-wrap items-center gap-2">
            <AddToSubjects course={course} teacher={responsible ?? teachers[0] ?? null} />
            <div className="ml-auto flex items-center gap-1.5">
              {position ? <span className="hidden text-xs font-bold text-[var(--faint)] sm:inline">{position}</span> : null}
              <Button icon="ChevronLeft" variant="soft" onClick={onPrev} disabled={!onPrev} aria-label="Insegnamento precedente" className="px-3">
                <span className="sr-only">Precedente</span>
              </Button>
              <Button icon="ChevronRight" variant="soft" onClick={onNext} disabled={!onNext} aria-label="Insegnamento successivo" className="px-3">
                <span className="sr-only">Successivo</span>
              </Button>
            </div>
          </div>
        ) : null
      }
    >
      {course ? (
        <div className="grid grid-cols-1 gap-5">
          <Segmented
            label="Dettagli insegnamento"
            size="sm"
            className="justify-self-start"
            value={detailTab}
            onChange={setDetailTab}
            options={[
              { id: "panoramica", label: "Panoramica" },
              { id: "programma", label: "Programma" },
              { id: "esame", label: "Esame e materiali" }
            ]}
          />

          {detailTab === "panoramica" ? (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Fact label="Periodo">{SEMESTER_LABEL[course.semester]}{course.year ? ` · ${course.year}° anno` : ""}</Fact>
                <Fact label="Ore">{course.totalHours ? `${course.totalHours} ore` : <Missing />}</Fact>
                <Fact label="Lingua">{course.language ?? <Missing />}</Fact>
                <Fact label="SSD">{course.ssd.length ? course.ssd.join(", ") : <Missing />}</Fact>
                <Fact label="Esame">{course.examMode ?? <Missing />}</Fact>
                <Fact label="Valutazione">{course.grading ?? <Missing />}</Fact>
              </dl>

              {course.offeringNote ? (
                <p className="rounded-[16px] bg-[var(--surface-soft)] p-3 text-sm">
                  <span className="font-black">Edizione: </span>
                  {course.offeringNote}
                </p>
              ) : null}

              <section>
                <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Docenti</h4>
                {teachers.length ? (
                  <ul className="grid grid-cols-1 gap-2">
                    {teachers.map((teacher) => (
                      <li key={teacher.id} className="quiet-panel flex min-w-0 items-start gap-3 p-3 text-sm">
                        <span className="grid grid-cols-1 h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-black">
                          {teacher.displayName
                            .split(" ")
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-black">
                            {teacher.displayName}
                            {teacher.id === course.responsibleTeacherId ? (
                              <span className="ml-2 rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] font-black text-[var(--muted)]">Responsabile</span>
                            ) : null}
                          </p>
                          {teacher.email ? (
                            <a className="block truncate text-[var(--muted)] underline decoration-[var(--accent)] underline-offset-2" href={`mailto:${teacher.email}`}>
                              {teacher.email}
                            </a>
                          ) : null}
                          {teacher.officeHours ? (
                            <p className="mt-0.5 text-xs text-[var(--muted)]">
                              Ricevimento: {teacher.officeHours}
                              {teacher.officeHoursPlace ? ` · ${teacher.officeHoursPlace}` : ""}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm">
                    <Missing label={course.offered === false ? "Nessun docente (non erogato)" : "Non pubblicati sulla scheda"} />
                  </p>
                )}
              </section>

              <section>
                <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Orario</h4>
                {course.schedule.length || course.exceptions.length ? (
                  <ScheduleList course={course} />
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    Non ancora pubblicato sul portale ufficiale. <ExternalLink href={course.scheduleUrl ?? ORARI_URL}>Apri Agenda web</ExternalLink>
                  </p>
                )}
              </section>

              {course.conflicts.length ? (
                <div className="rounded-[16px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs font-bold text-[var(--warning-text)]">
                  {course.conflicts.map((conflict, index) => (
                    <p key={`${conflict.field}-${index}`}>
                      {conflict.field}: {conflict.note}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {course.officialPageUrl ? <LinkButton href={course.officialPageUrl} icon="ExternalLink">Scheda ufficiale</LinkButton> : null}
                {course.arielUrl ? <LinkButton href={course.arielUrl} icon="Globe">Ariel</LinkButton> : null}
                {!course.officialPageUrl && !course.arielUrl ? <Missing label="Nessun link ufficiale" /> : null}
              </div>
            </>
          ) : null}

          {detailTab === "programma" ? (
            <div className="grid grid-cols-1 gap-5">
              <TextSection title="Obiettivi" value={course.learningGoals} />
              <TextSection title="Risultati attesi" value={course.expectedOutcomes} />
              <TextSection title="Programma" value={course.syllabus} />
              <TextSection title="Prerequisiti" value={course.prerequisites} />
            </div>
          ) : null}

          {detailTab === "esame" ? (
            <div className="grid grid-cols-1 gap-5">
              <dl className="grid grid-cols-2 gap-2">
                <Fact label="Modalità">{course.examMode ?? <Missing />}</Fact>
                <Fact label="Valutazione">{course.grading ?? <Missing />}</Fact>
              </dl>
              <TextSection title="Verifica dell'apprendimento" value={course.examDetails} />
              <TextSection title="Metodi didattici" value={course.teachingMethods} />
              <TextSection title="Materiale di riferimento" value={course.references} />
            </div>
          ) : null}

          <p className="rounded-[16px] bg-[var(--surface-soft)] p-3 text-xs text-[var(--muted)]">
            Fonte: <ExternalLink href={course.provenance.sourceUrl}>{course.provenance.sourceUrl}</ExternalLink>
            <br />
            Verificata il {formatDate(course.provenance.lastVerifiedAt)} · confidenza {Math.round(course.provenance.confidence * 100)}%
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}

function ScheduleList({ course }: { course: BarbCourse }) {
  return (
    <ul className="grid grid-cols-1 gap-1">
      {course.schedule.map((rule) => (
        <li key={rule.id} className="text-sm">
          <span className="font-black">{weekdayLabel(rule.weekday)}</span> {rule.startTime}–{rule.endTime} · {rule.room ?? "aula n.d."}
          {rule.building ? ` · ${rule.building}` : ""}
          {rule.validFrom && rule.validTo ? <span className="text-[var(--muted)]"> ({formatDate(rule.validFrom)} → {formatDate(rule.validTo)})</span> : null}
        </li>
      ))}
      {course.exceptions.map((exception) => (
        <li key={exception.id} className="text-sm text-[var(--warning-text)]">
          {exception.kind === "cancellazione" ? "Annullata" : "Lezione"} {formatDate(exception.date)}
          {exception.startTime && exception.endTime ? ` · ${exception.startTime}–${exception.endTime}` : ""}
          {exception.room ? ` · ${exception.room}` : ""}
          {exception.note ? ` · ${exception.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

function TeachersTab({ teachers, courses }: { teachers: BarbTeacher[]; courses: BarbCourse[] }) {
  const [query, setQuery] = useUiState("barb.teacherQuery", "", { scope: "tab" });
  const courseName = useMemo(() => new Map(courses.map((course) => [course.id, course.name])), [courses]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...teachers].sort((a, b) => a.displayName.localeCompare(b.displayName, "it"));
    if (!q) return list;
    return list.filter((teacher) =>
      `${teacher.displayName} ${teacher.email ?? ""} ${teacher.courseIds.map((id) => courseName.get(id) ?? "").join(" ")}`.toLowerCase().includes(q)
    );
  }, [teachers, query, courseName]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-black">
            Docenti <span className="text-[var(--faint)]">({filtered.length})</span>
          </h3>
          <label className="relative block w-full sm:w-80">
            <span className="sr-only">Cerca docente o corso</span>
            <Icon name="Search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
            <input className={`${inputClass} pl-10`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca docente o corso" />
          </label>
        </div>
        {teachers.length === 0 ? (
          <div className="quiet-panel p-6 text-sm">
            <p className="font-black">Docenti non ancora importati.</p>
            <p className="mt-1 text-[var(--muted)]">
              Esegui <span className="font-mono">npm run barb:sync:teachers -- --apply</span> (Firecrawl locale). Nessun nominativo ipotizzato.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="Search" title="Nessun docente" body="Nessun risultato per questa ricerca." />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
            {filtered.map((teacher) => (
              <article key={teacher.id} className="quiet-panel flex min-w-0 flex-col p-3.5 text-sm">
                <h4 className="font-black">{teacher.displayName}</h4>
                {teacher.role ? (
                  <p className="one-line-safe text-xs font-bold text-[var(--muted)]" title={teacher.department ?? undefined}>
                    {teacher.role}
                    {teacher.department ? ` · ${teacher.department}` : ""}
                  </p>
                ) : null}
                <div className="mt-2 grid gap-1 text-xs">
                  {teacher.email ? (
                    <a className="flex min-w-0 items-center gap-1.5 hover:text-[var(--accent-ink)]" href={`mailto:${teacher.email}`}>
                      <Icon name="Mail" className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                      <span className="truncate underline decoration-[var(--accent)] underline-offset-2">{teacher.email}</span>
                    </a>
                  ) : (
                    <Missing label="Email non pubblicata" />
                  )}
                  {teacher.officeHours ? (
                    <p className="flex items-start gap-1.5 text-[var(--muted)]">
                      <Icon name="Clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                      <span>
                        {teacher.officeHours}
                        {teacher.officeHoursPlace ? ` · ${teacher.officeHoursPlace}` : ""}
                      </span>
                    </p>
                  ) : null}
                  {teacher.office ? (
                    <p className="flex items-start gap-1.5 text-[var(--muted)]">
                      <Icon name="MapPin" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                      <span>
                        {teacher.office}
                        {teacher.phone ? ` · ${teacher.phone}` : ""}
                      </span>
                    </p>
                  ) : null}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {teacher.courseIds.map((id) => (
                    <Tag key={id}>{courseName.get(id) ?? id}</Tag>
                  ))}
                </div>
                {teacher.unimiProfileUrl || teacher.website ? (
                  <p className="mt-auto flex flex-wrap gap-x-3 pt-2.5 text-xs font-bold">
                    {teacher.unimiProfileUrl ? <ExternalLink href={teacher.unimiProfileUrl}>Pagina UNIMI</ExternalLink> : null}
                    {teacher.website ? <ExternalLink href={teacher.website}>Sito web</ExternalLink> : null}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Panel>
      <aside className="grid grid-cols-1 content-start gap-4">
        <Panel>
          <h3 className="mb-3 text-lg font-black">Contatti ufficiali</h3>
          <ul className="grid grid-cols-1 gap-2">
            {BARB_META.contacts.map((contact) => (
              <li key={contact.label} className="rounded-[16px] bg-[var(--surface-soft)] p-3 text-sm">
                <p className="font-black">{contact.label}</p>
                <p className="break-words text-xs text-[var(--muted)]">{contact.value}</p>
                {contact.url ? (
                  <a className="mt-1 inline-flex items-center gap-1 text-xs font-black text-[var(--accent-ink)]" href={contact.url} target="_blank" rel="noreferrer">
                    Apri <Icon name="ExternalLink" className="h-3 w-3" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
        {BARB_META.roles.length ? (
          <Panel>
            <h3 className="mb-3 text-lg font-black">Referenti e tutor</h3>
            <dl className="grid grid-cols-1 gap-2.5 text-sm">
              {BARB_META.roles.map((role) => (
                <div key={role.role}>
                  <dt className="text-[11px] font-black uppercase text-[var(--faint)]">{role.role}</dt>
                  <dd>{role.people.map((person) => person.name).join(", ")}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}

function RoomsTab({ courses }: { courses: BarbCourse[] }) {
  const rooms = useMemo(() => {
    const map = new Map<string, { room: string; building: string | null; courses: string[] }>();
    for (const course of courses) {
      for (const rule of [...course.schedule, ...course.exceptions]) {
        if (!rule.room) continue;
        const key = `${rule.room}@@${rule.building ?? ""}`;
        const previous = map.get(key) ?? { room: rule.room, building: rule.building, courses: [] };
        if (!previous.courses.includes(course.name)) previous.courses.push(course.name);
        map.set(key, previous);
      }
    }
    return [...map.values()].sort((a, b) => a.room.localeCompare(b.room, "it"));
  }, [courses]);

  return (
    <Panel>
      <h3 className="mb-3 text-xl font-black">Aule e sedi</h3>
      {rooms.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="text-sm">
            <p className="font-black">Aule non ancora pubblicate.</p>
            <p className="mt-1 text-[var(--muted)]">
              Le aule arrivano dal portale orari ufficiale appena l&rsquo;orario viene pubblicato (<span className="font-mono">npm run barb:sync:schedule -- --apply</span>).
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {["Via Celoria 26 · Edifici Biologici", "Via Celoria 20 · Settore Didattico", "Via Golgi 19 · Edificio Golgi"].map((place) => (
                <li key={place} className="flex items-center gap-2 rounded-[16px] bg-[var(--surface-soft)] p-3 font-bold">
                  <Icon name="MapPin" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                  {place}
                </li>
              ))}
            </ul>
          </div>
          <a href={ORARI_URL} target="_blank" rel="noreferrer">
            <Button icon="MapPin" variant="soft">Portale orari EasyAcademy</Button>
          </a>
        </div>
      ) : (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
          {rooms.map((room) => (
            <div key={`${room.room}-${room.building}`} className="quiet-panel p-3 text-sm">
              <p className="font-black">{room.room}</p>
              <p className="text-xs text-[var(--muted)]">{room.building ?? "Edificio non disponibile"}</p>
              <p className="mt-1 text-xs">{room.courses.join(", ")}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SourcesTab({ syncLogs }: { syncLogs: ReturnType<typeof useBarbStore.getState>["syncLogs"] }) {
  const states = Object.values(BARB_META.sourceStates).sort((a, b) => a.url.localeCompare(b.url));
  const timetable = BARB_META.timetable;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel>
        <h3 className="mb-3 text-xl font-black">Fonti ufficiali</h3>
        <div className="grid grid-cols-1 gap-2">
          {BARB_META.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="quiet-panel flex items-center gap-2 p-3 text-sm hover:bg-[var(--surface)]">
              <Icon name="Globe" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span className="min-w-0 flex-1 truncate font-bold">{source.label}</span>
              <Tag>{source.kind}</Tag>
            </a>
          ))}
        </div>
        {states.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-black">{states.length} pagine verificate all&rsquo;ultima sincronizzazione</summary>
            <ul className="scrollbar-soft mt-2 grid max-h-72 gap-1 overflow-y-auto text-xs text-[var(--muted)]">
              {states.map((state) => (
                <li key={state.url} className="break-all">
                  {formatDateTime(state.fetchedAt)} · {state.statusCode ?? "?"} · <ExternalLink href={state.url}>{state.title ?? state.url}</ExternalLink>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>
      <Panel>
        <h3 className="mb-2 text-xl font-black">Sincronizzazione locale</h3>
        <p className="text-sm text-[var(--muted)]">
          Firecrawl OSS self-hosted (<span className="font-mono">http://localhost:3002</span>, docker in <span className="font-mono">~/firecrawl-oss</span>). Nessun cloud, nessun credito.
          Ogni sync produce un report in <span className="font-mono">.cache/ai/university/runs/</span>; i dati cambiano solo con <span className="font-mono">--apply</span> o
          <span className="font-mono"> barb:apply</span>, dopo la validazione.
        </p>
        <div className="mt-3 grid gap-1.5 font-mono text-xs sm:grid-cols-2">
          {[
            "npm run barb:check-updates",
            "npm run barb:sync",
            "npm run barb:sync:schedule",
            "npm run barb:apply",
            "npm run barb:status",
            "npm run barb:sync:teachers -- --course \"Anatomia dell'uomo\""
          ].map((command) => (
            <code key={command} className="quiet-panel truncate p-2" title={command}>
              {command}
            </code>
          ))}
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Stato orari</dt>
            <dd>
              {timetable ? (
                <>
                  <span className="font-black">{timetable.status === "pubblicato" ? "Pubblicato" : timetable.status === "non-pubblicato" ? "Non ancora pubblicato" : "Non verificato"}</span>
                  {timetable.checkedAt ? <span className="text-[var(--muted)]"> · controllato {formatDateTime(timetable.checkedAt)}</span> : null}
                  {timetable.note ? <span className="block text-[var(--muted)]">{timetable.note}</span> : null}
                </>
              ) : (
                <Missing label="Non ancora verificato" />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Ultima sincronizzazione applicata</dt>
            <dd>
              {syncLogs.length === 0 ? (
                <span className="text-[var(--muted)]">Nessuna sincronizzazione applicata: dati dal seed verificato a mano.</span>
              ) : (
                syncLogs.map((log) => (
                  <p key={log.id} className="mt-1 rounded-[14px] bg-[var(--surface-soft)] p-2 text-xs">
                    {formatDateTime(log.finishedAt ?? log.startedAt)} · scope {log.scope} · {log.recordsChanged} modifiche · {log.notes}
                  </p>
                ))
              )}
            </dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}

/** Vista settimanale/per-corso: senza regole ricorrenti mostra stato ufficiale + rimandi. */
function WeeklySchedule({ courses, semesters }: { courses: BarbCourse[]; semesters: BarbSemesterInfo[] }) {
  const [mode, setMode] = useUiState<"settimana" | "per-corso">("barb.scheduleMode", "settimana", { validate: oneOf("settimana", "per-corso") });
  const withSchedule = courses.filter((course) => course.schedule.length > 0);
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-black">Calendario lezioni</h3>
        {withSchedule.length ? (
          <Segmented
            label="Modalità calendario"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { id: "settimana", label: "Settimanale" },
              { id: "per-corso", label: "Per corso" }
            ]}
          />
        ) : null}
      </div>
      {withSchedule.length === 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <p className="text-sm font-black">Orario delle lezioni non ancora pubblicato: nessuna regola ricorrente importata (nessun orario ipotizzato).</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {semesters.map((semester) => (
              <div key={semester.id} className="quiet-panel p-3.5 text-sm">
                <p className="font-black">
                  {semester.label}
                  {semester.startDate && semester.endDate ? ` · ${formatDate(semester.startDate)} → ${formatDate(semester.endDate)}` : ""}
                </p>
                <p className="mt-1 text-[var(--muted)]">{semester.scheduleNote}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="https://barb.cdl.unimi.it/it/studiare/calendari-e-orari" target="_blank" rel="noreferrer">
              <Button icon="CalendarDays" variant="soft">Calendari e orari BARB</Button>
            </a>
            <a href={ORARI_URL} target="_blank" rel="noreferrer">
              <Button icon="Clock" variant="soft">Agenda web EasyAcademy</Button>
            </a>
          </div>
        </div>
      ) : mode === "settimana" ? (
        <WeekGrid courses={withSchedule} />
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {withSchedule.map((course) => (
            <div key={course.id} className="quiet-panel p-3 text-sm">
              <p className="mb-1 font-black">{course.name}</p>
              <ScheduleList course={course} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function WeekGrid({ courses }: { courses: BarbCourse[] }) {
  const days: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7];
  const activeDays = days.filter((day) => day <= 5 || courses.some((course) => course.schedule.some((rule) => rule.weekday === day)));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {activeDays.map((day) => {
        const items = courses
          .flatMap((course) => course.schedule.filter((rule) => rule.weekday === day).map((rule) => ({ course, rule })))
          .sort((a, b) => a.rule.startTime.localeCompare(b.rule.startTime));
        return (
          <div key={day} className="quiet-panel min-h-[140px] p-3">
            <p className="mb-2 font-black">{weekdayLabel(day)}</p>
            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="text-xs text-[var(--faint)]">Nessuna lezione</p>
              ) : (
                items.map(({ course, rule }) => (
                  <div key={rule.id} className="rounded-[14px] bg-[var(--surface-soft)] p-2 text-xs">
                    <p className="font-black">
                      {rule.startTime}–{rule.endTime}
                    </p>
                    <p className="two-line-safe">{course.name}</p>
                    <p className="text-[var(--muted)]">{rule.room ?? "Aula n.d."}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

