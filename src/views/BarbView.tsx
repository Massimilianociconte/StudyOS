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
import { BARB_DATASET } from "../data/university/barb.dataset";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Drawer, EmptyState, Panel, Pill, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { CourseIcon } from "../components/CourseIcon";
import { BarbExamAvailability, BarbExamSessions } from "../components/BarbExamSessions";
import { courseColor } from "../lib/barbCourseVisuals";
import { SEMESTER_LABEL, SEMESTER_SHORT, SEMESTER_TONE, SEMESTER_IDS } from "../lib/semesters";
import { resolveBarbCourse } from "../lib/university/examSessions";
import { weekdayLabel } from "../lib/university/normalize";
import { isNullableString, oneOf, useUiState } from "../lib/uiState";
import { UNIVERSITY_SOURCE_KIND_LABEL } from "../lib/labels";
import type { BarbCourse, BarbSemesterInfo, BarbTeacher } from "../lib/university/types";

type Tab = "corsi" | "calendario" | "docenti" | "aule" | "fonti";
type SemesterFilter = "tutti" | BarbCourse["semester"];
type DetailTab = "panoramica" | "programma" | "esame";

const ORARI_URL = "https://orari.unimi.it/PortaleStudenti/";

const CHARACTER_LABEL: Record<BarbCourse["character"], string> = {
  obbligatorio: "Obbligatorio",
  "opzionale-scelta-guidata": "Scelta guidata",
  "scelta-libera": "Scelta libera",
  lingua: "Lingua",
  "altre-conoscenze": "Altre conoscenze",
  "tirocinio-tesi": "Tirocinio e tesi"
};

/** Struttura del piano di studi: ogni gruppo porta con sé la propria regola di scelta. */
const PLAN_GROUPS: { id: string; title: string; rule: string; match: (course: BarbCourse) => boolean }[] = [
  { id: "obbligatori", title: "Obbligatori", rule: "Da sostenere tutti (36 CFU)", match: (c) => c.character === "obbligatorio" },
  { id: "gruppo-1", title: "Gruppo 1", rule: "A scelta: 1 insegnamento (6 CFU)", match: (c) => c.choiceGroup === "gruppo-1" },
  { id: "gruppo-2", title: "Gruppo 2", rule: "A scelta: 2 insegnamenti (12 CFU)", match: (c) => c.choiceGroup === "gruppo-2" },
  { id: "gruppo-3", title: "Gruppo 3", rule: "A scelta: 2 insegnamenti (12 CFU)", match: (c) => c.choiceGroup === "gruppo-3" },
  {
    id: "altre",
    title: "Lingua, scelta libera e altre conoscenze",
    rule: "12 CFU a scelta libera · 3 CFU inglese B2 · 3 CFU altre conoscenze",
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
    return <div className="soft-panel min-h-[240px] p-8 text-lg font-black">Caricamento del corso di laurea…</div>;
  }

  const verified = BARB_META.syncedAt ?? BARB_META.exportedAt;
  const offered = courses.filter((course) => course.offered !== false).length;

  const tabs = [
    { id: "corsi" as const, label: "Insegnamenti", count: courses.length },
    { id: "calendario" as const, label: "Orario lezioni" },
    { id: "docenti" as const, label: "Docenti e contatti", count: teachers.length },
    { id: "aule" as const, label: "Aule e sedi" },
    { id: "fonti" as const, label: "Fonti ufficiali" }
  ];

  return (
    <div>
      <SectionTitle
        title="Corso di laurea BARB"
        subtitle="L'elenco ufficiale degli insegnamenti: scegli quelli del tuo piano di studi e aggiungili alle tue materie."
        action={
          <a href="https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico" target="_blank" rel="noreferrer">
            <Button icon="GraduationCap" variant="soft">Piano didattico ufficiale</Button>
          </a>
        }
      />
      <p className="safe-text mb-4 text-xs font-bold text-[var(--muted)]">
        <span className="font-black text-[var(--text)]">{BARB_META.degreeName}</span> · {BARB_META.degreeClass} · {BARB_META.degreeCode} · A.A.{" "}
        {BARB_META.academicYear} · dati dalle fonti ufficiali UNIMI, verificati il {formatDate(verified)}
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {semesters.map((semester) => (
          <SemesterTile key={semester.id} semester={semester} count={courses.filter((course) => course.semester === semester.id).length} />
        ))}
        <StatTile icon="BookOpen" label="Insegnamenti" value={String(courses.length)} detail={`${offered} attivi quest'anno`} />
        <StatTile icon="Users" label="Docenti" value={String(teachers.length)} detail={`${BARB_META.contacts.length} contatti ufficiali`} />
      </div>

      <div className="mb-4">
        <Segmented label="Sezioni del corso di laurea" value={tab} options={tabs} onChange={setTab} />
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
      <p className="mt-1 flex items-start gap-1.5 text-xs font-bold text-[var(--muted)]">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: published ? "var(--accent)" : "var(--warning)" }} />
        <span className="min-w-0">
          {published ? "Orario pubblicato" : "Orario non ancora pubblicato"} · {count} {count === 1 ? "insegnamento" : "insegnamenti"}
        </span>
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

function useSelectedCourseIds(courses: BarbCourse[]) {
  const subjects = useStudyStore((state) => state.subjects);
  return useMemo(() => new Set(subjects.map((subject) => resolveBarbCourse(subject, courses)?.id).filter(Boolean)), [subjects, courses]);
}

function CoursesTab({ courses, teachersById }: { courses: BarbCourse[]; teachersById: Map<string, BarbTeacher> }) {
  const [query, setQuery] = useUiState("barb.courseQuery", "", { scope: "tab" });
  const [semester, setSemester] = useUiState<SemesterFilter>("barb.semester", "tutti", { validate: oneOf("tutti", "primo", "secondo", "annuale", "non-definito") });
  const [hideNotOffered, setHideNotOffered] = useUiState("barb.hideNotOffered", false);
  const [openId, setOpenId] = useUiState<string | null>("barb.openCourse", null, { scope: "tab", validate: isNullableString });
  const inSubjects = useSelectedCourseIds(courses);
  const [myPlanOnly, setMyPlanOnly] = useUiState("barb.myPlanOnly", false);

  const notOffered = courses.filter((course) => course.offered === false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((course) => {
      if (semester !== "tutti" && course.semester !== semester) return false;
      if (myPlanOnly && !inSubjects.has(course.id)) return false;
      if (hideNotOffered && course.offered === false) return false;
      if (!q) return true;
      const teacherNames = course.teacherIds.map((id) => teachersById.get(id)?.displayName ?? "").join(" ");
      return `${course.name} ${course.englishName ?? ""} ${course.ssd.join(" ")} ${course.cfu} ${teacherNames}`.toLowerCase().includes(q);
    });
  }, [courses, query, semester, hideNotOffered, teachersById, myPlanOnly, inSubjects]);

  const groups = useMemo(() => {
    const assigned = new Set<string>();
    const result = PLAN_GROUPS.map((group) => {
      const items = filtered.filter((course) => !assigned.has(course.id) && group.match(course));
      items.forEach((course) => assigned.add(course.id));
      return { ...group, items };
    });
    const rest = filtered.filter((course) => !assigned.has(course.id));
    if (rest.length) result.push({ id: "altro", title: "Altri insegnamenti", rule: "", match: () => true, items: rest });
    return result.filter((group) => group.items.length);
  }, [filtered]);

  // Ordine di navigazione del pannello dettagli = ordine visivo dei gruppi.
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const openIndex = ordered.findIndex((course) => course.id === openId);
  const openCourse = openIndex >= 0 ? ordered[openIndex] : courses.find((course) => course.id === openId) ?? null;

  const resetFilters = () => {
    setQuery("");
    setSemester("tutti");
    setMyPlanOnly(false);
    setHideNotOffered(false);
  };
  const onlyMineEmpty = myPlanOnly && inSubjects.size === 0;

  const semesterOptions = [
    { id: "tutti" as const, label: "Tutti", count: courses.length },
    { id: "primo" as const, label: "1° semestre", count: courses.filter((c) => c.semester === "primo").length },
    { id: "secondo" as const, label: "2° semestre", count: courses.filter((c) => c.semester === "secondo").length },
    { id: "annuale" as const, label: "Annuali", count: courses.filter((c) => c.semester === "annuale").length },
    { id: "non-definito" as const, label: "Da definire", count: courses.filter((c) => c.semester === "non-definito").length }
  ];

  return (
    <div>
      <div className="soft-panel mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Cerca insegnamento, docente o settore (SSD)</span>
          <Icon name="Search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input
            className={`${inputClass} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca insegnamento, docente o settore (SSD)"
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
          <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-2 text-xs font-black text-[var(--muted)]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={myPlanOnly} onChange={(event) => setMyPlanOnly(event.target.checked)} />
            Solo le mie materie ({inSubjects.size})
          </label>
          {notOffered.length ? (
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-2 text-xs font-black text-[var(--muted)]">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={hideNotOffered} onChange={(e) => setHideNotOffered(e.target.checked)} />
              Nascondi i non attivi quest'anno ({notOffered.length})
            </label>
          ) : null}
        </div>
      </div>

      {inSubjects.size > 0 ? <div className="mb-5 flex flex-wrap items-center gap-2 text-xs" aria-label="Nelle tue materie, per semestre">
        <span className="mr-1 font-black">Nelle tue materie</span>
        {SEMESTER_IDS.map((id) => {
          const selected = courses.filter((course) => inSubjects.has(course.id) && course.semester === id);
          return selected.length ? <Tag key={id} color={SEMESTER_TONE[id]}>{SEMESTER_LABEL[id]} · {selected.length} {selected.length === 1 ? "insegnamento" : "insegnamenti"} · {selected.reduce((sum, course) => sum + course.cfu, 0)} CFU</Tag> : null;
        })}
      </div> : !onlyMineEmpty ? (
        <p className="mb-5 flex items-start gap-2 px-1 text-sm text-[var(--muted)]">
          <Icon name="Info" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
          <span>
            <span className="font-black text-[var(--text)]">Come iniziare:</span> apri un insegnamento del tuo piano di studi e tocca «Aggiungi alle mie materie». Lo ritrovi poi in Materie.
          </span>
        </p>
      ) : null}
      {groups.length === 0 ? (
        onlyMineEmpty ? (
          <EmptyState
            icon="BookOpen"
            title="Ancora nessun insegnamento nelle tue materie"
            body="Apri un insegnamento del tuo piano e tocca «Aggiungi alle mie materie»: comparirà qui."
            action={<Button variant="soft" onClick={() => setMyPlanOnly(false)}>Mostra tutti gli insegnamenti</Button>}
          />
        ) : (
          <EmptyState
            icon="Search"
            title="Nessun insegnamento trovato"
            body="Prova un'altra ricerca o togli qualche filtro."
            action={<Button variant="soft" onClick={resetFilters}>Togli ricerca e filtri</Button>}
          />
        )
      ) : null}

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
                  {group.items.length} {group.items.length === 1 ? "insegnamento" : "insegnamenti"} in elenco · {cfu} CFU in totale
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
                {group.items.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    responsible={course.responsibleTeacherId ? teachersById.get(course.responsibleTeacherId) ?? null : null}
                    added={inSubjects.has(course.id)}
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
          <span className="font-black text-[var(--text)]">«Non disponibile»</span> vuol dire che la fonte ufficiale non lo pubblica: non inventiamo dati. Ogni scheda indica la fonte e
          la data di verifica.
          {notOffered.length ? ` Non attivi nell'A.A. ${BARB_META.academicYear}: ${notOffered.map((course) => course.name).join(", ")}.` : ""}
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
      <div className="flex min-w-0 items-start gap-1.5">
        {/* Su mobile la scheda è larga ~170 px: "Da definire" + CFU + icona non ci stanno, quindi i tag vanno a capo. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Tag color={SEMESTER_TONE[course.semester]}>{SEMESTER_SHORT[course.semester]}</Tag>
          <Tag className="shrink-0">{course.cfu} CFU</Tag>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {added ? (
            <span className="grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-[#10131d]" title="Già nelle tue materie">
              <Icon name="Check" className="h-3.5 w-3.5" />
              <span className="sr-only">Già nelle tue materie</span>
            </span>
          ) : !notOffered ? (
            <span className="grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--muted)]" title="Apri per aggiungerlo alle tue materie">
              <Icon name="Plus" className="h-3.5 w-3.5" />
              <span className="sr-only">Non ancora nelle tue materie: apri per aggiungerlo</span>
            </span>
          ) : null}
          <Icon name="ChevronRight" className="hidden h-4 w-4 text-[var(--faint)] transition-transform group-hover:translate-x-0.5 sm:block" />
        </span>
      </div>
      <div className="mt-3 flex min-w-0 items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: courseColor(course), color: "#172333" }}><CourseIcon course={course} className="h-8 w-8" /></span>
        <h4 className="three-line-safe text-sm font-black leading-snug sm:text-[15px]">{course.name}</h4>
      </div>
      <BarbExamAvailability course={course} />
      <div className="mt-auto pt-2">
        {notOffered ? (
          <p className="text-xs font-black text-[var(--warning-text)]" title={`Non attivo nell'A.A. ${BARB_META.academicYear}`}>Non attivo quest'anno</p>
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
  const { subjects, addSubject, setActiveView } = useStudyStore(
    useShallow((state) => ({ subjects: state.subjects, addSubject: state.addSubject, setActiveView: state.setActiveView }))
  );
  const [busy, setBusy] = useState(false);
  const exists = subjects.some((subject) => resolveBarbCourse(subject, BARB_DATASET.courses)?.id === course.id);
  if (exists) {
    return (
      <>
        <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--success-bg)] px-4 text-sm font-extrabold text-[var(--success-text)]">
          <Icon name="Check" className="h-4 w-4" /> Già nelle tue materie
        </span>
        <Button icon="BookOpen" variant="ghost" onClick={() => setActiveView("subjects")}>
          Apri Materie
        </Button>
      </>
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
            semester: course.semester,
            universityCourseId: course.id,
            icon: `barb:${course.id}`,
            color: courseColor(course),
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
      {busy ? "Aggiunta in corso…" : "Aggiungi alle mie materie"}
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
            <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: courseColor(course), color: "#172333" }}><CourseIcon course={course} className="h-9 w-9" /></span>
            <Tag color={SEMESTER_TONE[course.semester]}>{SEMESTER_LABEL[course.semester]}</Tag>
            <Pill active={course.character === "obbligatorio"}>{CHARACTER_LABEL[course.character]}</Pill>
            {course.choiceGroup ? <Pill>{PLAN_GROUPS.find((group) => group.id === course.choiceGroup)?.title ?? course.choiceGroup}</Pill> : null}
            <Pill>{course.cfu} CFU</Pill>
            {course.offered === false ? (
              <span
                className="inline-flex min-h-8 items-center rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 text-xs font-black text-[var(--warning-text)]"
                title={`Non attivo nell'A.A. ${BARB_META.academicYear}`}
              >
                Non attivo quest&rsquo;anno
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

          {detailTab === "esame" ? <BarbExamSessions course={course} /> : null}

          {detailTab === "panoramica" ? (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Fact label="Periodo">{SEMESTER_LABEL[course.semester]}{course.year ? ` · ${course.year}° anno` : ""}</Fact>
                <Fact label="Ore">{course.totalHours ? `${course.totalHours} ore` : <Missing />}</Fact>
                <Fact label="Lingua">{course.language ?? <Missing />}</Fact>
                <Fact label="Settore (SSD)">{course.ssd.length ? course.ssd.join(", ") : <Missing />}</Fact>
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
                    <Missing label={course.offered === false ? "Nessun docente: non attivo quest'anno" : "Non indicati nella scheda ufficiale"} />
                  </p>
                )}
              </section>

              <section>
                <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Orario</h4>
                {course.schedule.length || course.exceptions.length ? (
                  <ScheduleList course={course} />
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    Non ancora pubblicato dall&rsquo;università. <ExternalLink href={course.scheduleUrl ?? ORARI_URL}>Controlla l&rsquo;orario ufficiale</ExternalLink>
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
                {course.arielUrl ? <LinkButton href={course.arielUrl} icon="Globe">Materiali su Ariel</LinkButton> : null}
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
            Fonte ufficiale: <ExternalLink href={course.provenance.sourceUrl}>{course.provenance.sourceUrl}</ExternalLink>
            <br />
            Verificata il {formatDate(course.provenance.lastVerifiedAt)} · affidabilità dei dati {Math.round(course.provenance.confidence * 100)}%
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
          <span className="font-black">{weekdayLabel(rule.weekday)}</span> {rule.startTime}–{rule.endTime} · {rule.room ?? "aula non indicata"}
          {rule.building ? ` · ${rule.building}` : ""}
          {rule.validFrom && rule.validTo ? <span className="text-[var(--muted)]"> ({formatDate(rule.validFrom)} → {formatDate(rule.validTo)})</span> : null}
        </li>
      ))}
      {course.exceptions.map((exception) => (
        <li key={exception.id} className="text-sm text-[var(--warning-text)]">
          {exception.kind === "cancellazione" ? "Lezione annullata" : "Lezione"} {formatDate(exception.date)}
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
            <span className="sr-only">Cerca docente o insegnamento</span>
            <Icon name="Search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
            <input className={`${inputClass} pl-10`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca docente o insegnamento" />
          </label>
        </div>
        {teachers.length === 0 ? (
          <div className="quiet-panel p-6 text-sm">
            <p className="font-black">Elenco dei docenti non ancora disponibile</p>
            <p className="mt-1 text-[var(--muted)]">I nomi compaiono qui appena vengono letti dalle pagine ufficiali UNIMI: non ne inseriamo mai di ipotetici.</p>
            <p className="mt-2 text-xs text-[var(--faint)]">
              Per chi gestisce l&rsquo;app: <span className="font-mono">npm run barb:sync:teachers -- --apply</span>
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="Search"
            title="Nessun docente trovato"
            body="Prova con un altro nome o insegnamento."
            action={<Button variant="soft" onClick={() => setQuery("")}>Cancella la ricerca</Button>}
          />
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
                <div className="mt-2 grid grid-cols-1 gap-1 text-xs">
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
                    Apri il sito <Icon name="ExternalLink" className="h-3 w-3" />
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
            <p className="font-black">Aule non ancora pubblicate</p>
            <p className="mt-1 text-[var(--muted)]">
              Compariranno qui quando l&rsquo;università pubblicherà l&rsquo;orario delle lezioni. Intanto, ecco le sedi del corso:
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {["Via Celoria 26 · Edifici Biologici", "Via Celoria 20 · Settore Didattico", "Via Golgi 19 · Edificio Golgi"].map((place) => (
                <li key={place} className="flex items-center gap-2 rounded-[16px] bg-[var(--surface-soft)] p-3 font-bold">
                  <Icon name="MapPin" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                  {place}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[var(--faint)]">
              Per chi gestisce l&rsquo;app: <span className="font-mono">npm run barb:sync:schedule -- --apply</span>
            </p>
          </div>
          <a href={ORARI_URL} target="_blank" rel="noreferrer">
            <Button icon="MapPin" variant="soft">Apri l&rsquo;orario ufficiale</Button>
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
        <h3 className="mb-1 text-xl font-black">Pagine ufficiali consultate</h3>
        <p className="mb-3 text-sm text-[var(--muted)]">Tutti i dati di questa sezione vengono da qui: niente è inventato o dedotto.</p>
        <div className="grid grid-cols-1 gap-2">
          {BARB_META.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="quiet-panel flex items-center gap-2 p-3 text-sm hover:bg-[var(--surface)]">
              <Icon name="Globe" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span className="min-w-0 flex-1 truncate font-bold">{source.label}</span>
              <Tag>{UNIVERSITY_SOURCE_KIND_LABEL[source.kind] ?? source.kind}</Tag>
            </a>
          ))}
        </div>
        {states.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-black">{states.length} pagine controllate all&rsquo;ultimo aggiornamento</summary>
            <ul className="scrollbar-soft mt-2 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto text-xs text-[var(--muted)]">
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
        <h3 className="mb-2 text-xl font-black">Stato dei dati</h3>
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div>
            <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Orario delle lezioni</dt>
            <dd>
              {timetable ? (
                <>
                  <span className="font-black">{timetable.status === "pubblicato" ? "Pubblicato" : timetable.status === "non-pubblicato" ? "Non ancora pubblicato" : "Non ancora controllato"}</span>
                  {timetable.checkedAt ? <span className="text-[var(--muted)]"> · controllato il {formatDateTime(timetable.checkedAt)}</span> : null}
                  {timetable.note ? <span className="block text-[var(--muted)]">{timetable.note}</span> : null}
                </>
              ) : (
                <Missing label="Non ancora controllato" />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase text-[var(--faint)]">Ultimo aggiornamento dei dati</dt>
            <dd>
              {syncLogs.length === 0 ? (
                <span className="text-[var(--muted)]">Nessun aggiornamento automatico finora: i dati sono stati verificati a mano sulle fonti ufficiali.</span>
              ) : (
                syncLogs.map((log) => (
                  <p key={log.id} className="mt-1 rounded-[14px] bg-[var(--surface-soft)] p-2 text-xs">
                    {formatDateTime(log.finishedAt ?? log.startedAt)} · ambito {log.scope} · {log.recordsChanged} modifiche · {log.notes}
                  </p>
                ))
              )}
            </dd>
          </div>
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-black">Come si aggiornano i dati (per chi gestisce l&rsquo;app)</summary>
          <p className="mt-2 text-sm text-[var(--muted)]">
            L&rsquo;aggiornamento gira sul computer di chi gestisce l&rsquo;app, con Firecrawl in locale (<span className="font-mono">http://localhost:3002</span>, docker in{" "}
            <span className="font-mono">~/firecrawl-oss</span>): nessun servizio online, nessun credito. Ogni aggiornamento salva un report in{" "}
            <span className="font-mono">.cache/ai/university/runs/</span>; i dati cambiano solo con <span className="font-mono">--apply</span> o
            <span className="font-mono"> barb:apply</span>, dopo la verifica.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-1.5 font-mono text-xs sm:grid-cols-2">
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
        </details>
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
        <h3 className="text-xl font-black">Orario delle lezioni</h3>
        {withSchedule.length ? (
          <Segmented
            label="Come mostrare l'orario"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { id: "settimana", label: "Per settimana" },
              { id: "per-corso", label: "Per insegnamento" }
            ]}
          />
        ) : null}
      </div>
      {withSchedule.length === 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <p className="text-sm font-black">L&rsquo;università non ha ancora pubblicato l&rsquo;orario delle lezioni: appena esce, lo trovi qui. Non mostriamo orari ipotetici.</p>
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
              <Button icon="Clock" variant="soft">Orario ufficiale (Agenda web)</Button>
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
                    <p className="text-[var(--muted)]">{rule.room ?? "Aula non indicata"}</p>
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
