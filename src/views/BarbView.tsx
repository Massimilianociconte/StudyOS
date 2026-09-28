// Vista BARB — Biologia Applicata alla Ricerca Biomedica (UNIMI), A.A. 2026/2027.
// Legge SOLO il dataset verificato (seed + overlay sincronizzato). Nessun fetch live verso
// UNIMI/Firecrawl: il flusso è UNIMI -> Firecrawl locale -> validazione -> overlay -> frontend.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { BARB_META, useBarbStore } from "../store/useBarbStore";
import { useStudyStore } from "../store/useStudyStore";
import { Button, EmptyState, Field, Panel, Pill, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { weekdayLabel } from "../lib/university/normalize";
import type { BarbCourse, BarbSemesterInfo, BarbTeacher } from "../lib/university/types";

type Tab = "corsi" | "calendario" | "docenti" | "aule" | "fonti";

const TABS: { id: Tab; label: string }[] = [
  { id: "corsi", label: "Corsi" },
  { id: "calendario", label: "Calendario" },
  { id: "docenti", label: "Docenti e contatti" },
  { id: "aule", label: "Aule e sedi" },
  { id: "fonti", label: "Fonti e sync" }
];

const ORARI_URL = "https://orari.unimi.it/PortaleStudenti/";

const CHARACTER_LABEL: Record<BarbCourse["character"], string> = {
  obbligatorio: "Obbligatorio",
  "opzionale-scelta-guidata": "Scelta guidata",
  "scelta-libera": "Scelta libera",
  lingua: "Lingua",
  "altre-conoscenze": "Altre conoscenze",
  "tirocinio-tesi": "Tirocinio / Tesi"
};

const GROUP_LABEL: Record<string, string> = {
  "gruppo-1": "Gruppo 1 — scegli 1 (6 CFU)",
  "gruppo-2": "Gruppo 2 — scegli 2 (12 CFU)",
  "gruppo-3": "Gruppo 3 — scegli 2 (12 CFU)"
};

const SEMESTER_LABEL: Record<BarbCourse["semester"], string> = {
  primo: "1° semestre",
  secondo: "2° semestre",
  annuale: "Annuale",
  "non-definito": "Periodo non definito"
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "mai";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
};

function Missing({ label }: { label?: string }) {
  return <span className="font-bold text-[var(--faint)]">{label ?? "non disponibile"}</span>;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="break-words underline decoration-[var(--accent)] underline-offset-2" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function BarbView() {
  const [tab, setTab] = useState<Tab>("corsi");
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

  return (
    <div>
      <SectionTitle
        title={BARB_META.degreeName}
        subtitle={`${BARB_META.degreeClass} · ${BARB_META.degreeCode} · A.A. ${BARB_META.academicYear} · solo fonti ufficiali UNIMI, ultima verifica ${formatDate(verified)}`}
        action={
          <a href="https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico" target="_blank" rel="noreferrer">
            <Button icon="GraduationCap" variant="primary">Piano ufficiale</Button>
          </a>
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        {semesters.map((semester) => (
          <SemesterPanel key={semester.id} semester={semester} courses={courses} />
        ))}
      </div>

      <div className="scrollbar-soft -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Sezioni BARB">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="shrink-0">
            <Pill active={tab === t.id}>{t.label}</Pill>
          </button>
        ))}
      </div>

      {tab === "corsi" ? <CoursesTab courses={courses} teachersById={teachersById} /> : null}
      {tab === "calendario" ? <WeeklySchedule courses={courses} semesters={semesters} /> : null}
      {tab === "docenti" ? <TeachersTab teachers={teachers} courses={courses} /> : null}
      {tab === "aule" ? <RoomsTab courses={courses} /> : null}
      {tab === "fonti" ? <SourcesTab syncLogs={syncLogs} /> : null}
    </div>
  );
}

function SemesterPanel({ semester, courses }: { semester: BarbSemesterInfo; courses: BarbCourse[] }) {
  const count = courses.filter((course) => course.semester === semester.id).length;
  const status =
    semester.scheduleStatus === "pubblicato"
      ? "Orario pubblicato"
      : semester.scheduleStatus === "in-attesa-pdf"
        ? "Orario non ancora pubblicato"
        : "Orario non ancora pubblicato";
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <Icon name={semester.id === "primo" ? "CalendarDays" : "AlarmClock"} className="h-4 w-4 text-[var(--accent)]" />
        <h3 className="font-black">
          {semester.label}
          {semester.startDate && semester.endDate ? ` · ${formatDate(semester.startDate)} → ${formatDate(semester.endDate)}` : " · date non pubblicate"}
        </h3>
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">{semester.scheduleNote}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Pill active={semester.scheduleStatus === "pubblicato"}>{status}</Pill>
        <Pill>{count} attività</Pill>
      </div>
    </Panel>
  );
}

function CoursesTab({ courses, teachersById }: { courses: BarbCourse[]; teachersById: Map<string, BarbTeacher> }) {
  const [query, setQuery] = useState("");
  const [semester, setSemester] = useState("tutti");
  const [character, setCharacter] = useState("tutti");
  const [hideNotOffered, setHideNotOffered] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const notOffered = courses.filter((course) => course.offered === false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((course) => {
      if (semester !== "tutti" && course.semester !== semester) return false;
      if (character !== "tutti" && course.character !== character) return false;
      if (hideNotOffered && course.offered === false) return false;
      if (!q) return true;
      const teacherNames = course.teacherIds.map((id) => teachersById.get(id)?.displayName ?? "").join(" ");
      return `${course.name} ${course.ssd.join(" ")} ${course.cfu} ${teacherNames}`.toLowerCase().includes(q);
    });
  }, [courses, query, semester, character, hideNotOffered, teachersById]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <Field label="Cerca corso / SSD / docente">
            <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="es. fisiologia, BIOS-06, Cappelletti" />
          </Field>
          <Field label="Semestre">
            <select className={inputClass} value={semester} onChange={(e) => setSemester(e.target.value)}>
              <option value="tutti">Tutti</option>
              <option value="primo">Primo semestre</option>
              <option value="secondo">Secondo semestre</option>
              <option value="annuale">Annuale</option>
              <option value="non-definito">Periodo non definito</option>
            </select>
          </Field>
          <Field label="Tipologia">
            <select className={inputClass} value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option value="tutti">Tutte</option>
              <option value="obbligatorio">Obbligatori</option>
              <option value="opzionale-scelta-guidata">Scelta guidata</option>
              <option value="lingua">Lingua</option>
              <option value="altre-conoscenze">Altre conoscenze</option>
              <option value="tirocinio-tesi">Tirocinio / Tesi</option>
            </select>
          </Field>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-[var(--muted)]">
            {filtered.length} attività su {courses.length} totali
          </p>
          {notOffered.length ? (
            <label className="flex items-center gap-2 text-xs font-black">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={hideNotOffered} onChange={(e) => setHideNotOffered(e.target.checked)} />
              Nascondi non erogati quest&rsquo;anno ({notOffered.length})
            </label>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              teachersById={teachersById}
              open={openId === course.id}
              onToggle={() => setOpenId((value) => (value === course.id ? null : course.id))}
            />
          ))}
        </div>
        {filtered.length === 0 ? <EmptyState icon="Search" title="Nessun corso" body="Prova a cambiare filtri o ricerca." /> : null}
      </Panel>
      <aside className="grid content-start gap-4">
        <Panel>
          <h3 className="mb-2 text-xl font-black">Regole piano di studi</h3>
          <ul className="grid gap-2 text-sm">
            <li>
              <Pill>Obbligatori</Pill>{" "}
              <span className="text-[var(--muted)]">
                Anatomia, Farmacologia speciale, Genetica e genomica umana, Patologia, Principi di fisiologia, Biostatistica.
              </span>
            </li>
            <li><Pill>{GROUP_LABEL["gruppo-1"]}</Pill></li>
            <li><Pill>{GROUP_LABEL["gruppo-2"]}</Pill></li>
            <li><Pill>{GROUP_LABEL["gruppo-3"]}</Pill></li>
            <li className="text-[var(--muted)]">
              + 12 CFU a scelta libera coerente + 3 CFU altre conoscenze + 3 CFU inglese B2 + 36 CFU tirocinio/prova finale (2° anno).
            </li>
          </ul>
          {notOffered.length ? (
            <div className="mt-3 rounded-[16px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs font-bold text-[var(--warning-text)]">
              Non erogati nell&rsquo;A.A. {BARB_META.academicYear} secondo la scheda ufficiale: {notOffered.map((course) => course.name).join(", ")}.
            </div>
          ) : null}
        </Panel>
        <Panel>
          <h3 className="mb-2 text-xl font-black">Legenda dati</h3>
          <p className="text-sm text-[var(--muted)]">
            <span className="font-black text-[var(--text)]">non disponibile</span> = campo non pubblicato nella fonte ufficiale (mai inventato). Ogni scheda riporta fonte e data di verifica.
          </p>
        </Panel>
      </aside>
    </div>
  );
}

function AddToSubjects({ course, teacher }: { course: BarbCourse; teacher: BarbTeacher | null }) {
  const { subjects, addSubject } = useStudyStore(useShallow((state) => ({ subjects: state.subjects, addSubject: state.addSubject })));
  const [busy, setBusy] = useState(false);
  const exists = subjects.some((subject) => subject.name.trim().toLowerCase() === course.name.trim().toLowerCase());
  if (exists) return <Pill active>In Materie</Pill>;
  return (
    <Button
      icon="Plus"
      variant="soft"
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

function LongText({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return <Row k={label} v={<Missing />} />;
  if (value.length < 260) return <Row k={label} v={<span className="whitespace-pre-line">{value}</span>} />;
  return (
    <Row
      k={label}
      v={
        <details className="group">
          <summary className="cursor-pointer list-none">
            <span className="whitespace-pre-line">{value.slice(0, 220).trimEnd()}…</span>{" "}
            <span className="font-black text-[var(--accent)] group-open:hidden">mostra tutto</span>
          </summary>
          <p className="mt-1 whitespace-pre-line">{value.slice(220)}</p>
        </details>
      }
    />
  );
}

function CourseCard({
  course,
  teachersById,
  open,
  onToggle
}: {
  course: BarbCourse;
  teachersById: Map<string, BarbTeacher>;
  open: boolean;
  onToggle: () => void;
}) {
  const responsible = course.responsibleTeacherId ? teachersById.get(course.responsibleTeacherId) ?? null : null;
  const teachers = course.teacherIds.map((id) => teachersById.get(id)).filter((teacher): teacher is BarbTeacher => Boolean(teacher));
  return (
    <article className={`quiet-panel min-w-0 p-4 ${course.offered === false ? "opacity-80" : ""}`}>
      <button type="button" onClick={onToggle} className="w-full text-left" aria-expanded={open}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={course.character === "obbligatorio"}>{CHARACTER_LABEL[course.character]}</Pill>
          <Pill>{course.cfu} CFU</Pill>
          {course.choiceGroup ? <Pill>{GROUP_LABEL[course.choiceGroup] ?? course.choiceGroup}</Pill> : null}
          {course.offered === false ? (
            <span className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-1 text-xs font-black text-[var(--warning-text)]">
              Non erogato {BARB_META.academicYear}
            </span>
          ) : null}
        </div>
        <h3 className="two-line-safe mt-2 text-lg font-black">{course.name}</h3>
        <p className="mt-1 text-xs font-bold text-[var(--muted)]">
          {SEMESTER_LABEL[course.semester]}
          {course.year ? ` · ${course.year}° anno` : ""} · {course.ssd.length ? course.ssd.join(", ") : "SSD n.d."} · {course.language ?? "lingua n.d."}
          {course.totalHours ? ` · ${course.totalHours} ore` : ""}
        </p>
        {responsible ? <p className="mt-1 text-xs font-bold">Responsabile: {responsible.displayName}</p> : null}
      </button>
      {open ? (
        <dl className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3 text-sm">
          <Row
            k="Docenti"
            v={
              teachers.length ? (
                <ul className="grid gap-1">
                  {teachers.map((teacher) => (
                    <li key={teacher.id}>
                      <span className="font-black">{teacher.displayName}</span>
                      {teacher.id === course.responsibleTeacherId ? <span className="text-[var(--muted)]"> (responsabile)</span> : null}
                      {teacher.email ? (
                        <>
                          {" · "}
                          <a className="underline" href={`mailto:${teacher.email}`}>{teacher.email}</a>
                        </>
                      ) : null}
                      {teacher.officeHours ? <span className="block text-xs text-[var(--muted)]">Ricevimento: {teacher.officeHours}{teacher.officeHoursPlace ? ` · ${teacher.officeHoursPlace}` : ""}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <Missing label={course.offered === false ? "nessun docente (non erogato)" : "non pubblicati sulla scheda"} />
              )
            }
          />
          {course.offeringNote ? <Row k="Edizione" v={course.offeringNote} /> : null}
          <Row k="Esame" v={course.examMode ? `${course.examMode}${course.grading ? ` · ${course.grading}` : ""}` : <Missing />} />
          <LongText label="Verifica" value={course.examDetails} />
          <LongText label="Obiettivi" value={course.learningGoals} />
          <LongText label="Risultati attesi" value={course.expectedOutcomes} />
          <LongText label="Programma" value={course.syllabus} />
          <LongText label="Prerequisiti" value={course.prerequisites} />
          <LongText label="Metodi didattici" value={course.teachingMethods} />
          <LongText label="Materiale" value={course.references} />
          <Row
            k="Orario"
            v={
              course.schedule.length ? (
                <ScheduleList course={course} />
              ) : (
                <span>
                  Non ancora pubblicato sul portale ufficiale.{" "}
                  <ExternalLink href={course.scheduleUrl ?? ORARI_URL}>Apri Agenda web</ExternalLink>
                </span>
              )
            }
          />
          <Row
            k="Link"
            v={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {course.officialPageUrl ? <ExternalLink href={course.officialPageUrl}>Scheda ufficiale</ExternalLink> : null}
                {course.arielUrl ? <ExternalLink href={course.arielUrl}>Ariel</ExternalLink> : null}
                {!course.officialPageUrl && !course.arielUrl ? <Missing /> : null}
              </span>
            }
          />
          {course.conflicts.length ? (
            <div className="rounded-[16px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-2 text-xs font-bold text-[var(--warning-text)]">
              {course.conflicts.map((conflict, index) => (
                <p key={`${conflict.field}-${index}`}>
                  {conflict.field}: {conflict.note}
                </p>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <AddToSubjects course={course} teacher={responsible ?? teachers[0] ?? null} />
          </div>
          <div className="rounded-[16px] bg-[var(--surface-soft)] p-2 text-xs text-[var(--muted)]">
            Fonte: <ExternalLink href={course.provenance.sourceUrl}>{course.provenance.sourceUrl}</ExternalLink>
            <br />
            Verificata il {formatDate(course.provenance.lastVerifiedAt)} · confidenza {Math.round(course.provenance.confidence * 100)}%
          </div>
        </dl>
      ) : null}
    </article>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[130px_1fr] sm:gap-2">
      <dt className="text-xs font-black uppercase text-[var(--faint)]">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
}

function ScheduleList({ course }: { course: BarbCourse }) {
  return (
    <ul className="grid gap-1">
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
  const [query, setQuery] = useState("");
  const courseName = useMemo(() => new Map(courses.map((course) => [course.id, course.name])), [courses]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((teacher) =>
      `${teacher.displayName} ${teacher.email ?? ""} ${teacher.courseIds.map((id) => courseName.get(id) ?? "").join(" ")}`.toLowerCase().includes(q)
    );
  }, [teachers, query, courseName]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Panel>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-2xl font-black">Docenti ({teachers.length})</h3>
          <div className="w-full sm:w-72">
            <Field label="Cerca docente o corso">
              <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="es. Zambelli, patologia" />
            </Field>
          </div>
        </div>
        {teachers.length === 0 ? (
          <div className="quiet-panel p-6 text-sm">
            <p className="font-black">Docenti non ancora importati.</p>
            <p className="mt-1 text-[var(--muted)]">
              Esegui <span className="font-mono">npm run barb:sync:teachers -- --apply</span> (Firecrawl locale). Nessun nominativo ipotizzato.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((teacher) => (
              <article key={teacher.id} className="quiet-panel min-w-0 p-4 text-sm">
                <h4 className="font-black">{teacher.displayName}</h4>
                {teacher.role ? <p className="text-xs font-bold text-[var(--muted)]">{teacher.role}{teacher.department ? ` · ${teacher.department}` : ""}</p> : null}
                <p className="mt-2">
                  {teacher.email ? <a className="underline" href={`mailto:${teacher.email}`}>{teacher.email}</a> : <Missing label="email non pubblicata" />}
                  {teacher.phone ? <span className="text-[var(--muted)]"> · {teacher.phone}</span> : null}
                </p>
                {teacher.office ? <p className="text-xs text-[var(--muted)]">Sede: {teacher.office}</p> : null}
                {teacher.officeHours ? (
                  <p className="text-xs text-[var(--muted)]">
                    Ricevimento: {teacher.officeHours}
                    {teacher.officeHoursPlace ? ` · ${teacher.officeHoursPlace}` : ""}
                  </p>
                ) : null}
                <p className="mt-2 text-xs font-bold">{teacher.courseIds.map((id) => courseName.get(id) ?? id).join(" · ")}</p>
                <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
                  {teacher.unimiProfileUrl ? <ExternalLink href={teacher.unimiProfileUrl}>Pagina UNIMI</ExternalLink> : null}
                  {teacher.website ? <ExternalLink href={teacher.website}>Sito web</ExternalLink> : null}
                </p>
              </article>
            ))}
          </div>
        )}
      </Panel>
      <aside className="grid content-start gap-4">
        {BARB_META.roles.length ? (
          <Panel>
            <h3 className="mb-2 text-xl font-black">Referenti e tutor</h3>
            <dl className="grid gap-2 text-sm">
              {BARB_META.roles.map((role) => (
                <div key={role.role}>
                  <dt className="text-xs font-black uppercase text-[var(--faint)]">{role.role}</dt>
                  <dd>{role.people.map((person) => person.name).join(", ")}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ) : null}
        <Panel>
          <h3 className="mb-2 text-xl font-black">Contatti ufficiali</h3>
          <div className="grid gap-2">
            {BARB_META.contacts.map((contact) => (
              <div key={contact.label} className="quiet-panel p-3 text-sm">
                <p className="font-black">{contact.label}</p>
                <p className="break-words text-[var(--muted)]">{contact.value}</p>
                {contact.url ? <ExternalLink href={contact.url}>apri</ExternalLink> : null}
              </div>
            ))}
          </div>
        </Panel>
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
      <h3 className="mb-2 text-2xl font-black">Aule e sedi</h3>
      {rooms.length === 0 ? (
        <div className="quiet-panel p-6 text-sm">
          <p className="font-black">Aule non ancora pubblicate.</p>
          <p className="mt-1 text-[var(--muted)]">
            Le aule arrivano dal portale orari ufficiale appena l&rsquo;orario viene pubblicato (<span className="font-mono">npm run barb:sync:schedule -- --apply</span>).
            Sedi ufficiali dei corsi: Via Celoria 26 (Edifici Biologici), Via Celoria 20 (Settore Didattico), Via Golgi 19 (Edificio Golgi).
          </p>
          <div className="mt-3">
            <a href={ORARI_URL} target="_blank" rel="noreferrer"><Button icon="MapPin" variant="soft">Portale orari EasyAcademy</Button></a>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {rooms.map((room) => (
            <div key={`${room.room}-${room.building}`} className="quiet-panel p-3 text-sm">
              <span className="font-black">{room.room}</span>
              <span className="text-[var(--muted)]"> · {room.building ?? "edificio non disponibile"} · {room.courses.join(", ")}</span>
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
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <h3 className="mb-2 text-2xl font-black">Fonti ufficiali</h3>
        <div className="grid gap-2">
          {BARB_META.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="quiet-panel flex items-center gap-2 p-3 text-sm hover:bg-[var(--surface)]">
              <Icon name="Globe" className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <span className="min-w-0 flex-1 truncate font-bold">{source.label}</span>
              <Pill>{source.kind}</Pill>
            </a>
          ))}
        </div>
        {states.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-black">{states.length} pagine verificate all&rsquo;ultima sincronizzazione</summary>
            <ul className="mt-2 grid gap-1 text-xs text-[var(--muted)]">
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
        <h3 className="mb-2 text-2xl font-black">Sincronizzazione locale</h3>
        <p className="text-sm text-[var(--muted)]">
          Firecrawl OSS self-hosted (<span className="font-mono">http://localhost:3002</span>, docker in <span className="font-mono">~/firecrawl-oss</span>). Nessun cloud, nessun credito.
          Ogni sync produce un report in <span className="font-mono">.cache/ai/university/runs/</span>; i dati cambiano solo con <span className="font-mono">--apply</span> o
          <span className="font-mono"> barb:apply</span>, dopo la validazione.
        </p>
        <div className="mt-3 grid gap-2 font-mono text-xs">
          <code className="quiet-panel p-2">npm run barb:check-updates</code>
          <code className="quiet-panel p-2">npm run barb:sync</code>
          <code className="quiet-panel p-2">npm run barb:sync:schedule</code>
          <code className="quiet-panel p-2">npm run barb:sync:teachers -- --course "Anatomia dell'uomo"</code>
          <code className="quiet-panel p-2">npm run barb:apply</code>
          <code className="quiet-panel p-2">npm run barb:status</code>
        </div>
        <h4 className="mb-2 mt-4 font-black">Stato orari</h4>
        <p className="text-sm">
          {timetable ? (
            <>
              <span className="font-black">{timetable.status === "pubblicato" ? "Pubblicato" : timetable.status === "non-pubblicato" ? "Non ancora pubblicato" : "Non verificato"}</span>
              {timetable.checkedAt ? <span className="text-[var(--muted)]"> · controllato {formatDateTime(timetable.checkedAt)}</span> : null}
              {timetable.note ? <span className="block text-[var(--muted)]">{timetable.note}</span> : null}
            </>
          ) : (
            <Missing label="non ancora verificato" />
          )}
        </p>
        <h4 className="mb-2 mt-4 font-black">Ultima sincronizzazione applicata</h4>
        {syncLogs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nessuna sincronizzazione applicata: dati dal seed verificato a mano.</p>
        ) : (
          syncLogs.map((log) => (
            <div key={log.id} className="quiet-panel mb-2 p-3 text-xs">
              {formatDateTime(log.finishedAt ?? log.startedAt)} · scope {log.scope} · {log.recordsChanged} modifiche · {log.notes}
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}

/** Vista settimanale/per-corso: senza regole ricorrenti mostra stato ufficiale + rimandi. */
function WeeklySchedule({ courses, semesters }: { courses: BarbCourse[]; semesters: BarbSemesterInfo[] }) {
  const [mode, setMode] = useState<"settimana" | "per-corso">("settimana");
  const withSchedule = courses.filter((course) => course.schedule.length > 0);
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-2xl font-black">Calendario lezioni</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("settimana")}><Pill active={mode === "settimana"}>Settimanale</Pill></button>
          <button type="button" onClick={() => setMode("per-corso")}><Pill active={mode === "per-corso"}>Per corso</Pill></button>
        </div>
      </div>
      {withSchedule.length === 0 ? (
        <div className="quiet-panel p-6 text-sm">
          <p className="font-black">Orario delle lezioni non ancora pubblicato: nessuna regola ricorrente importata (nessun orario ipotizzato).</p>
          <ul className="mt-2 list-disc pl-5 text-[var(--muted)]">
            {semesters.map((semester) => (
              <li key={semester.id}>
                {semester.label}
                {semester.startDate && semester.endDate ? ` (${formatDate(semester.startDate)} → ${formatDate(semester.endDate)})` : ""}: {semester.scheduleNote}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="https://barb.cdl.unimi.it/it/studiare/calendari-e-orari" target="_blank" rel="noreferrer"><Button icon="CalendarDays" variant="soft">Calendari e orari BARB</Button></a>
            <a href={ORARI_URL} target="_blank" rel="noreferrer"><Button icon="Clock" variant="soft">Agenda web EasyAcademy</Button></a>
          </div>
        </div>
      ) : mode === "settimana" ? (
        <WeekGrid courses={withSchedule} />
      ) : (
        <div className="grid gap-2">
          {withSchedule.map((course) => (
            <div key={course.id} className="quiet-panel p-3 text-sm">
              <span className="font-black">{course.name}</span>
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
  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {days.map((day) => {
        const items = courses
          .flatMap((course) => course.schedule.filter((rule) => rule.weekday === day).map((rule) => ({ course, rule })))
          .sort((a, b) => a.rule.startTime.localeCompare(b.rule.startTime));
        return (
          <div key={day} className="quiet-panel min-h-[140px] p-3">
            <p className="mb-2 font-black">{weekdayLabel(day)}</p>
            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="text-xs text-[var(--faint)]">—</p>
              ) : (
                items.map(({ course, rule }) => (
                  <div key={rule.id} className="rounded-[14px] bg-[var(--surface-soft)] p-2 text-xs">
                    <p className="font-black">{rule.startTime}–{rule.endTime}</p>
                    <p className="two-line-safe">{course.name}</p>
                    <p className="text-[var(--muted)]">{rule.room ?? "aula n.d."}</p>
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
