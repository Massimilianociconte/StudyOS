import { useEffect, useId, useMemo, useRef, useState } from "react";
import { m } from "framer-motion";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Subject } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { subjectColor, subjectName } from "../lib/selectors";
import { MAX_GRADE, MIN_GRADE, formatAverage, formatGrade, gradeStats, isValidGrade, librettoEntries, missingGrades, projectedStats, type GradeStats, type LibrettoEntry } from "../lib/grades";
import {
  BARB_THESIS_LEVELS,
  DEGREE_PROGRAMS,
  averageNeededFor,
  averageNeededOnRemaining,
  isDegreeProgramId,
  projectGraduation,
  sbThesisPoints,
  type DegreeProgramId,
  type GraduationProjection
} from "../lib/graduation";
import { LIBRETTO_SORTS, gaugeSpan, gradeTint, pointsToTop, sortLibretto, type LibrettoSort } from "../lib/librettoView";
import { Button, EmptyState, Field, HelpTip, ProgressBar, SectionTitle, Segmented, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { GradeDrawer } from "../components/GradeDrawer";
import { CAREER_HELP, CAREER_TEXT } from "../lib/labels/career";
import { requestSettingsSection } from "../lib/settingsJump";
import { oneOf, useUiState } from "../lib/uiState";

type Help = { title: string; text: string; example?: string };
type CareerTab = "libretto" | "laurea";
type Basis = "registered" | "targets";

const points = (value: number) => `${value.toFixed(2).replace(".", ",").replace(/,00$/, "")}`;
const shortDate = (date: string) => format(parseISO(date), "d MMM yyyy", { locale: it });

const TEXT = CAREER_TEXT;

export function CareerView() {
  const store = useStudyStore();
  const { exams, subjects, updatePreferences, setActiveView } = store;
  // Il corso di laurea cambia CFU totali e la sezione Corso di laurea: si sceglie solo in
  // Impostazioni (categoria Profilo), qui resta in sola lettura con il collegamento.
  const openDegreeSettings = () => {
    requestSettingsSection("profilo");
    setActiveView("settings");
  };
  const preferences = selectPreferences(store);
  const program: DegreeProgramId = isDegreeProgramId(preferences.degreeProgram) ? preferences.degreeProgram : "barb";
  const [gradeExam, setGradeExam] = useState<Exam | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [notice, setNotice] = useState("");
  // Su telefono e tablet una parte alla volta (dal computer sono affiancate e le schede non ci sono).
  const [tab, setTab] = useUiState<CareerTab>("career.tab", "libretto", { validate: oneOf("libretto", "laurea") });
  const [sort, setSort] = useUiState<LibrettoSort>("career.sort", "recent", { validate: oneOf(...LIBRETTO_SORTS) });
  const [basis, setBasis] = useUiState<Basis>("career.basis", "registered", { validate: oneOf("registered", "targets") });
  const hypothesesRef = useRef<HTMLHeadingElement>(null);

  const entries = useMemo(() => librettoEntries(exams, subjects), [exams, subjects]);
  const stats = gradeStats(entries);
  const withTargets = projectedStats(entries, exams, subjects);
  // Una riga per materia, mai per una materia già nel libretto.
  const missing = missingGrades(exams, entries);

  // Una sola stima per il riquadro in alto e per il calcolo: stesse ipotesi, stessi numeri.
  const targetsWeighted = withTargets?.weighted ?? null;
  const useTargets = basis === "targets" && targetsWeighted !== null;
  const average = useTargets ? targetsWeighted : stats.weighted;
  const honors = entries.filter((entry) => entry.honors).length;
  const sbThesisGrade = preferences.sbThesisGrade ?? 27;
  const barbThesisPoints = preferences.barbThesisPoints ?? 7;
  const abroad = Boolean(preferences.abroad);
  const thesis = program === "scienze-biologiche" ? sbThesisGrade : barbThesisPoints;
  const projection = projectGraduation({ program, weightedAverage: average, honors, thesis, abroad });

  const openEditor = (exam: Exam | null) => {
    setNotice("");
    setGradeExam(exam);
    setGradeOpen(true);
  };

  // «Cambia le ipotesi»: apre la scheda del voto e porta alle ipotesi. Lo spostamento avviene
  // dopo il disegno della scheda (prima la sezione è nascosta e non si può raggiungere).
  const [hypothesesJump, setHypothesesJump] = useState(0);
  const editHypotheses = () => {
    setTab("laurea");
    setHypothesesJump((count) => count + 1);
  };
  useEffect(() => {
    if (!hypothesesJump) return;
    const heading = hypothesesRef.current;
    if (!heading) return;
    heading.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  }, [hypothesesJump]);

  return (
    <div>
      <SectionTitle
        title={TEXT.title}
        subtitle={TEXT.subtitle}
        action={
          // Con il libretto vuoto l'invito principale è nel riquadro del libretto: qui resta secondario.
          <Button icon="Award" variant={entries.length ? "primary" : "soft"} onClick={() => openEditor(null)}>
            {TEXT.recordGrade}
          </Button>
        }
      />

      {notice ? (
        <p role="status" className="mb-4 rounded-[18px] border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm font-bold text-[var(--success-text)]">
          {notice}
        </p>
      ) : null}

      {!subjects.length ? (
        <div className="quiet-panel mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="safe-text text-sm font-bold text-[var(--muted)]">{TEXT.noSubjects}</p>
          <Button icon="BookOpen" variant="soft" onClick={() => setActiveView("subjects")}>
            {TEXT.goToSubjects}
          </Button>
        </div>
      ) : null}

      <Hero projection={projection} stats={stats} missing={missing.length} honors={honors} degreeCfu={preferences.degreeCfu} onEditHypotheses={editHypotheses} />

      <div className="mb-4 lg:hidden">
        <Segmented
          value={tab}
          onChange={setTab}
          label={TEXT.tabs.label}
          options={[
            { id: "libretto", label: TEXT.tabs.libretto, icon: "Award", count: entries.length },
            { id: "laurea", label: TEXT.tabs.laurea, icon: "GraduationCap" }
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
        <div className={`min-w-0 ${tab === "laurea" ? "hidden lg:block" : ""}`}>
          <LibrettoSection
            entries={entries}
            missing={missing}
            subjects={subjects}
            sort={sort}
            onSort={setSort}
            onOpen={(examId) => openEditor(exams.find((exam) => exam.id === examId) ?? null)}
            onMissing={openEditor}
            onAdd={() => openEditor(null)}
          />
        </div>
        <div className={`min-w-0 ${tab === "libretto" ? "hidden lg:block" : ""}`}>
          <GraduationSection
            program={program}
            degreeCfu={preferences.degreeCfu}
            projection={projection}
            average={average}
            weighted={stats.weighted}
            targetsWeighted={targetsWeighted}
            useTargets={useTargets}
            entries={entries}
            exams={exams}
            subjects={subjects}
            sbThesisGrade={sbThesisGrade}
            barbThesisPoints={barbThesisPoints}
            abroad={abroad}
            hypothesesRef={hypothesesRef}
            onBasis={setBasis}
            onChangeProgram={openDegreeSettings}
            onScenario={(patch) => void updatePreferences(patch)}
          />
        </div>
      </div>

      <GradeDrawer
        open={gradeOpen}
        exam={gradeExam}
        subjects={subjects}
        exams={exams}
        onClose={() => setGradeOpen(false)}
        onSaved={(text) => {
          setGradeOpen(false);
          setNotice(text);
        }}
      />
    </div>
  );
}

/** In alto: il voto previsto con la barra 66–110 e i tre numeri che contano. */
function Hero({
  projection,
  stats,
  missing,
  honors,
  degreeCfu,
  onEditHypotheses
}: {
  projection: GraduationProjection | null;
  stats: GradeStats;
  missing: number;
  honors: number;
  degreeCfu: number;
  onEditHypotheses: () => void;
}) {
  const text = TEXT.hero;
  const kpi = TEXT.kpi;
  const range = projection !== null && projection.cappedMax > projection.capped;
  const span = projection ? gaugeSpan(projection.capped, projection.cappedMax) : null;
  const toTop = projection ? pointsToTop(projection.total) : null;
  const totalCfu = Math.max(1, degreeCfu);
  const cfuLeft = Math.max(0, degreeCfu - stats.cfuEarned);
  const passedDetail = !stats.passed
    ? { text: kpi.passedNone, tone: "text-[var(--muted)]" }
    : missing
      ? { text: kpi.passedMissing(missing), tone: "text-[var(--warning-text)]" }
      : { text: honors ? kpi.passedHonors(honors) : kpi.passedPlain, tone: "text-[var(--muted)]" };

  return (
    <section aria-label={text.label} className="soft-panel relative mb-4 overflow-hidden p-[var(--pad)]">
      {/* Solo luce di sfondo: il colore dell'accento dà carattere senza toccare il contrasto del testo. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] blur-3xl" />
      <div className="relative grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-black uppercase text-[var(--faint)]">
            <Icon name="GraduationCap" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <span className="min-w-0">{text.label}</span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 tabular-nums">
            <span className="text-5xl font-black leading-none sm:text-6xl">{projection ? points(projection.capped) : "—"}</span>
            {range && projection ? <span className="text-2xl font-black text-[var(--muted)] sm:text-3xl">– {points(projection.cappedMax)}</span> : null}
            <span className="text-lg font-black text-[var(--muted)]">{text.outOf}</span>
          </p>

          {span && projection ? (
            <div className="mt-4">
              <div
                role="img"
                aria-label={text.gauge(range ? `${points(projection.capped)}–${points(projection.cappedMax)}` : points(projection.capped))}
                className="relative h-3 overflow-hidden rounded-full bg-[var(--surface-strong)]"
              >
                {span.upTo > span.sure ? (
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_38%,transparent)]" style={{ width: `${span.upTo}%` }} />
                ) : null}
                <m.div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${span.sure}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <div aria-hidden="true" className="mt-1.5 flex justify-between text-[11px] font-black tabular-nums text-[var(--faint)]">
                <span>66</span>
                <span>110</span>
              </div>
            </div>
          ) : null}

          {projection ? (
            <>
              <p className={`mt-3 flex items-start gap-2 text-sm font-extrabold ${toTop === null ? "text-[var(--success-text)]" : ""}`}>
                <Icon name={toTop === null ? "Check" : "Target"} className={`mt-0.5 h-4 w-4 shrink-0 ${toTop === null ? "" : "text-[var(--accent-ink)]"}`} />
                <span className="safe-text">{toTop === null ? text.top : text.missing(points(toTop))}</span>
              </p>
              {projection.totalMax > 110 ? (
                <p className="safe-text mt-1 text-xs font-bold text-[var(--muted)]">
                  {text.overTop(projection.totalMax > projection.total ? `${points(projection.total)}–${points(projection.totalMax)}` : points(projection.total))}
                </p>
              ) : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs font-bold text-[var(--muted)]">
                <span>{text.assumptions}</span>
                <button
                  type="button"
                  onClick={onEditHypotheses}
                  className="relative inline-flex min-h-8 items-center gap-1 font-extrabold text-[var(--accent-ink)] after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:underline"
                >
                  <Icon name="PenLine" className="h-3.5 w-3.5" />
                  {text.editAssumptions}
                </button>
              </p>
            </>
          ) : (
            <p className="safe-text mt-3 text-sm font-bold text-[var(--muted)]">{text.empty}</p>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
          <Kpi
            label={kpi.weighted}
            help={CAREER_HELP.weighted}
            value={formatAverage(stats.weighted)}
            detail={
              <span className="flex min-w-0 items-center gap-1">
                <span className="safe-text min-w-0">{kpi.arithmetic(formatAverage(stats.arithmetic))}</span>
                <HelpTip title={CAREER_HELP.arithmetic.title} text={CAREER_HELP.arithmetic.text} example={CAREER_HELP.arithmetic.example} />
              </span>
            }
          />
          <Kpi label={kpi.passed} value={`${stats.passed}`} detail={<span className={`safe-text block ${passedDetail.tone}`}>{passedDetail.text}</span>} />
          <Kpi
            className="col-span-2 sm:col-span-1"
            label={kpi.cfu}
            help={CAREER_HELP.cfu}
            value={`${stats.cfuEarned}`}
            suffix={kpi.cfuOf(degreeCfu)}
            detail={<span className="safe-text block">{cfuLeft ? kpi.cfuLeft(cfuLeft) : kpi.cfuDone}</span>}
            progress={(stats.cfuEarned / totalCfu) * 100}
            progressLabel={kpi.cfuBar}
          />
        </div>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  suffix,
  detail,
  help,
  progress,
  progressLabel,
  className = ""
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: React.ReactNode;
  help?: Help;
  progress?: number;
  progressLabel?: string;
  className?: string;
}) {
  return (
    <div className={`quiet-panel min-w-0 p-3 ${className}`}>
      {/* L'etichetta va a capo invece di troncarsi: su telefono il riquadro è stretto. */}
      <div className="flex min-h-6 min-w-0 items-center gap-1">
        <p className="safe-text min-w-0 text-[11px] font-black uppercase leading-tight text-[var(--faint)]">{label}</p>
        {help ? <HelpTip title={help.title} text={help.text} example={help.example} /> : null}
      </div>
      <p className="mt-0.5 flex min-w-0 items-baseline gap-1 tabular-nums">
        <span className="text-2xl font-black leading-tight">{value}</span>
        {suffix ? <span className="text-sm font-black text-[var(--muted)]">{suffix}</span> : null}
      </p>
      <div className="min-w-0 text-xs font-bold text-[var(--muted)]">{detail}</div>
      {progress !== undefined ? (
        <div className="mt-2">
          <ProgressBar value={progress} label={progressLabel} />
        </div>
      ) : null}
    </div>
  );
}

function LibrettoSection({
  entries,
  missing,
  subjects,
  sort,
  onSort,
  onOpen,
  onMissing,
  onAdd
}: {
  entries: LibrettoEntry[];
  missing: Exam[];
  subjects: Subject[];
  sort: LibrettoSort;
  onSort: (sort: LibrettoSort) => void;
  onOpen: (examId: string) => void;
  onMissing: (exam: Exam) => void;
  onAdd: () => void;
}) {
  const text = TEXT.libretto;
  const titleId = useId();
  const sorted = useMemo(() => sortLibretto(entries, sort), [entries, sort]);

  return (
    <section aria-labelledby={titleId} className="grid min-w-0 grid-cols-1 gap-4">
      {/* Prima ciò che manca: un esame superato senza voto non entra in medie e CFU. */}
      {missing.length ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-2">
          <h3 className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-xs font-black uppercase text-[var(--warning-text)]">
            <Icon name="AlertTriangle" className="h-3.5 w-3.5 shrink-0" />
            {text.missingTitle} · {missing.length}
          </h3>
          <ul className="grid grid-cols-1 gap-1">
            {missing.map((exam) => (
              <li key={exam.id}>
                <button
                  type="button"
                  onClick={() => onMissing(exam)}
                  className="motion-safe flex min-h-12 w-full min-w-0 items-center gap-3 rounded-[14px] px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--surface)_70%,transparent)]"
                >
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColor(subjects, exam.subjectId) }} />
                  <span className="min-w-0 flex-1">
                    <span className="one-line-safe block text-sm font-extrabold">{subjectName(subjects, exam.subjectId)}</span>
                    <span className="block text-xs font-bold text-[var(--muted)]">{text.missingWhen(shortDate(exam.date))}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--surface)] px-3 py-1.5 text-xs font-black text-[var(--accent-ink)]">{text.addGrade}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!entries.length ? (
        <>
          <h3 id={titleId} className="sr-only">
            {text.title}
          </h3>
          <EmptyState
            icon="Award"
            title={TEXT.emptyTitle}
            body={TEXT.emptyBody}
            action={
              <Button icon="Award" variant="primary" onClick={onAdd}>
                {TEXT.recordGrade}
              </Button>
            }
          />
        </>
      ) : (
        <div className="soft-panel min-w-0 p-[var(--pad)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 id={titleId} className="text-lg font-black">
              {text.title} <span className="tabular-nums text-[var(--muted)]">· {entries.length}</span>
            </h3>
            <Segmented
              size="sm"
              value={sort}
              onChange={onSort}
              label={text.sortLabel}
              options={LIBRETTO_SORTS.map((id) => ({ id, label: text.sorts[id] }))}
            />
          </div>
          <ul className="grid grid-cols-1 gap-1">
            {sorted.map((entry) => (
              <li key={entry.examId}>
                <button
                  type="button"
                  onClick={() => onOpen(entry.examId)}
                  aria-label={text.open(entry.name, formatGrade(entry))}
                  className="motion-safe group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-[18px] px-2 py-1.5 text-left hover:bg-[var(--surface-soft)]"
                >
                  <GradeBadge entry={entry} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(subjects, entry.subjectId) }} />
                      <span className="one-line-safe text-sm font-extrabold">{entry.name}</span>
                    </span>
                    <span className="block text-xs font-bold text-[var(--muted)]">
                      {entry.cfu} CFU · {shortDate(entry.date)}
                    </span>
                  </span>
                  <Icon name="ChevronRight" className="motion-safe h-4 w-4 shrink-0 text-[var(--muted)] group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)]" />
                </button>
              </li>
            ))}
          </ul>
          <p className="safe-text mt-3 border-t border-[var(--border)] px-1 pt-3 text-xs font-bold text-[var(--faint)]">{text.legend}</p>
        </div>
      )}
    </section>
  );
}

/** Il voto in un riquadro che si colora di più quanto più è alto; lode e idoneità scritte per esteso. */
function GradeBadge({ entry }: { entry: LibrettoEntry }) {
  const caption = entry.honors ? TEXT.libretto.honors : entry.passFail ? TEXT.libretto.passFail : null;
  return (
    <span
      aria-hidden="true"
      className={`grid h-12 w-12 shrink-0 grid-cols-1 content-center justify-items-center rounded-[16px] leading-none ${entry.honors ? "ring-2 ring-inset ring-[var(--accent)]" : ""}`}
      style={{ background: `color-mix(in srgb, var(--accent) ${gradeTint(entry)}%, var(--surface-soft))` }}
    >
      {entry.passFail ? <Icon name="Check" className="h-5 w-5" /> : <span className="text-lg font-black tabular-nums">{entry.grade}</span>}
      {caption ? <span className="mt-0.5 text-[10px] font-black uppercase">{caption}</span> : null}
    </span>
  );
}

function GraduationSection({
  program,
  degreeCfu,
  projection,
  average,
  weighted,
  targetsWeighted,
  useTargets,
  entries,
  exams,
  subjects,
  sbThesisGrade,
  barbThesisPoints,
  abroad,
  hypothesesRef,
  onBasis,
  onChangeProgram,
  onScenario
}: {
  program: DegreeProgramId;
  /** CFU del corso dalle Impostazioni: gli stessi del riquadro CFU. */
  degreeCfu: number;
  projection: GraduationProjection | null;
  /** Media usata nel calcolo (registrata o con i voti obiettivo). */
  average: number | null;
  weighted: number | null;
  targetsWeighted: number | null;
  useTargets: boolean;
  entries: LibrettoEntry[];
  exams: Exam[];
  subjects: Subject[];
  sbThesisGrade: number;
  barbThesisPoints: number;
  abroad: boolean;
  hypothesesRef: React.RefObject<HTMLHeadingElement | null>;
  onBasis: (basis: Basis) => void;
  onChangeProgram: () => void;
  onScenario: (patch: { sbThesisGrade?: number; barbThesisPoints?: number; abroad?: boolean }) => void;
}) {
  const text = TEXT.graduation;
  const titleId = useId();
  const basisId = useId();
  const info = DEGREE_PROGRAMS[program];
  // C'è una stima (voti registrati o voti obiettivo): solo allora le ipotesi e le fonti servono.
  const hasEstimate = weighted !== null || targetsWeighted !== null;

  // Media necessaria per 110 con lo scenario scelto e, se ci sono esami in programma, voto
  // medio che serve in quegli esami.
  const graded = entries.filter((entry) => !entry.passFail && isValidGrade(entry.grade));
  const weightedSum = graded.reduce((sum, entry) => sum + (entry.grade as number) * entry.cfu, 0);
  const gradedCfu = graded.reduce((sum, entry) => sum + entry.cfu, 0);
  const passedSubjects = new Set(entries.map((entry) => entry.subjectId));
  const plannedCfu = [...new Set(exams.filter((exam) => !exam.archived && exam.status !== "done" && !passedSubjects.has(exam.subjectId)).map((exam) => exam.subjectId))].reduce(
    (sum, subjectId) => sum + Math.max(0, subjects.find((subject) => subject.id === subjectId)?.cfu ?? 0),
    0
  );
  const fixedExtras = projection ? projection.parts.reduce((sum, part) => sum + part.points, 0) : null;
  const needed = fixedExtras === null ? null : averageNeededFor(110, fixedExtras);
  const neededOnPlanned = needed === null ? null : averageNeededOnRemaining(weightedSum, gradedCfu, plannedCfu, needed);

  return (
    <section aria-labelledby={titleId} className="soft-panel min-w-0 p-[var(--pad)]">
      <h3 id={titleId} className="text-lg font-black">
        {text.title}
      </h3>
      {/* Sola lettura: il corso di laurea si cambia in Impostazioni, dove sta già la scelta. */}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-bold text-[var(--muted)]">
        <span className="safe-text min-w-0">{TEXT.rulesOf(info.name, info.level, degreeCfu)}</span>
        <button
          type="button"
          onClick={onChangeProgram}
          aria-label={TEXT.changeInSettingsAria}
          className="relative inline-flex min-h-8 items-center gap-1 font-extrabold text-[var(--accent-ink)] after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:underline"
        >
          <Icon name="Settings" className="h-3.5 w-3.5" />
          {TEXT.changeInSettings}
        </button>
      </p>

      {projection ? (
        <>
          {/* Come uno scontrino: partenza, punti in più, totale. */}
          <dl className="mt-4 overflow-hidden rounded-[18px] border border-[var(--border)] text-sm">
            <ReceiptRow
              label={text.base(formatAverage(average))}
              value={points(projection.base)}
              help={CAREER_HELP.base}
            />
            {projection.parts.map((part) => (
              <ReceiptRow key={part.label} label={part.label} value={part.upTo ? text.upTo(points(part.upTo)) : `+${points(part.points)}`} />
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t-2 border-dashed border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5">
              <dt className="font-black">{text.total}</dt>
              <dd className="shrink-0 text-xl font-black tabular-nums">
                {projection.totalMax > projection.total ? `${points(projection.total)} – ${points(projection.totalMax)}` : points(projection.total)}
              </dd>
            </div>
            {projection.manifestoTotal !== undefined ? <ReceiptRow label={text.manifesto} value={points(projection.manifestoTotal)} muted /> : null}
          </dl>

          {needed !== null ? (
            <div className="mt-3 flex gap-2.5 rounded-[16px] border border-[var(--border)] p-3 text-sm font-bold">
              <Icon name={projection.total >= 110 ? "Check" : "Target"} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <p className="safe-text min-w-0">
                {projection.total >= 110 ? text.reached : text.needed(formatAverage(needed))}
                {projection.total < 110 && neededOnPlanned !== null ? (
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {neededOnPlanned > MAX_GRADE
                      ? text.plannedTooHigh(plannedCfu, formatAverage(neededOnPlanned))
                      : neededOnPlanned <= MIN_GRADE
                        ? text.plannedPass(plannedCfu)
                        : text.planned(plannedCfu, formatAverage(neededOnPlanned))}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="safe-text mt-4 rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm font-bold text-[var(--muted)]">{text.empty}</p>
      )}

      {/* Libretto vuoto e nessun voto obiettivo: niente ipotesi né fonti finché non c'è una stima. */}
      {hasEstimate ? (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h4 ref={hypothesesRef} tabIndex={-1} className="mb-3 text-xs font-black uppercase text-[var(--faint)] outline-none">
            {text.hypotheses}
          </h4>
          <div className="grid grid-cols-1 gap-4">
            {program === "scienze-biologiche" ? (
              <Field label={text.thesisSb}>
                <select className={inputClass} value={sbThesisGrade} onChange={(event) => onScenario({ sbThesisGrade: Number(event.target.value) })}>
                  {Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, index) => MAX_GRADE - index).map((grade) => (
                    <option key={grade} value={grade}>
                      {grade === MAX_GRADE ? "30 o 30 e lode" : grade} → +{sbThesisPoints(grade)} punti
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={text.thesisBarb}>
                <select className={inputClass} value={barbThesisPoints} onChange={(event) => onScenario({ barbThesisPoints: Number(event.target.value) })}>
                  {BARB_THESIS_LEVELS.map((level) => (
                    <option key={level.points} value={level.points}>
                      {level.points} {level.points === 1 ? "punto" : "punti"} · {level.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {/* Etichetta fuori da Field: il "?" non può stare dentro un <label>. */}
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span id={basisId} className="text-xs font-black uppercase text-[var(--faint)]">
                  {TEXT.basis}
                </span>
                <HelpTip title={CAREER_HELP.basis.title} text={CAREER_HELP.basis.text} />
              </div>
              {targetsWeighted !== null ? (
                <Segmented
                  value={useTargets ? "targets" : "registered"}
                  onChange={onBasis}
                  label={TEXT.basis}
                  options={[
                    { id: "registered", label: text.basisRegistered },
                    { id: "targets", label: text.basisTargets }
                  ]}
                />
              ) : (
                <p className="safe-text text-sm font-bold text-[var(--muted)]">{text.basisOnlyRegistered}</p>
              )}
              <p className="mt-1.5 text-xs font-bold text-[var(--muted)]">{text.basisUsed(formatAverage(average))}</p>
            </div>

            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 py-2 text-sm font-bold">
              <span className="safe-text min-w-0 flex-1">{program === "scienze-biologiche" ? text.abroadSb : text.abroadBarb}</span>
              <input type="checkbox" role="switch" className="peer sr-only" checked={abroad} onChange={(event) => onScenario({ abroad: event.target.checked })} />
              {/* Spento: binario a metà del colore del testo (contrasto ≥ 3:1 in chiaro e scuro).
                  Acceso: accento con il pallino scuro, come il testo dei pulsanti principali. */}
              <span
                aria-hidden="true"
                className="motion-safe relative h-7 w-12 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--text)_50%,transparent)] after:absolute after:left-[3px] after:top-[3px] after:h-[22px] after:w-[22px] after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-5 peer-checked:after:bg-[#10131d] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]"
              />
            </label>
          </div>
        </div>
      ) : null}

      {projection || hasEstimate ? (
        <details className="group mt-5 rounded-[16px] border border-[var(--border)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-extrabold [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <Icon name="Info" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              {text.how}
            </span>
            <Icon name="ChevronDown" className="motion-safe h-4 w-4 shrink-0 text-[var(--muted)] group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-3 px-3 pb-3">
            <ul className="grid grid-cols-1 gap-1.5 text-xs font-bold text-[var(--muted)]">
              {(projection?.notes ?? []).map((note) => (
                <li key={note} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  <span className="safe-text min-w-0">{note}</span>
                </li>
              ))}
              <li className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span className="safe-text min-w-0">{text.estimate}</span>
              </li>
            </ul>
            <div>
              <p className="mb-1 text-[11px] font-black uppercase text-[var(--faint)]">{text.sources}</p>
              <ul className="grid grid-cols-1 gap-1">
                {info.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-start gap-1.5 py-1 text-xs font-bold text-[var(--accent-ink)] hover:underline">
                      <Icon name="ExternalLink" className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="safe-text min-w-0">
                        {source.label} <span className="text-[var(--muted)]">· {source.date}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function ReceiptRow({ label, value, help, muted }: { label: string; value: string; help?: Help; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 ${muted ? "border-t border-[var(--border)] text-[var(--muted)]" : ""}`}>
      <dt className="flex min-w-0 items-center gap-1 font-bold">
        <span className="safe-text min-w-0">{label}</span>
        {help ? <HelpTip title={help.title} text={help.text} example={help.example} /> : null}
      </dt>
      <dd className="shrink-0 font-black tabular-nums">{value}</dd>
    </div>
  );
}
