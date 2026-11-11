import { useId, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Subject } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { subjectColor, subjectName } from "../lib/selectors";
import { MAX_GRADE, MIN_GRADE, formatAverage, formatGrade, gradeStats, isValidGrade, librettoEntries, projectedStats, type LibrettoEntry } from "../lib/grades";
import {
  BARB_THESIS_LEVELS,
  DEGREE_PROGRAMS,
  averageNeededFor,
  averageNeededOnRemaining,
  isDegreeProgramId,
  projectGraduation,
  sbThesisPoints,
  type DegreeProgramId
} from "../lib/graduation";
import { Button, EmptyState, Field, HelpTip, Panel, ProgressBar, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { GradeDrawer } from "../components/GradeDrawer";
import { CAREER_HELP, CAREER_TEXT } from "../lib/labels";
import { requestSettingsSection } from "../lib/settingsJump";
import { oneOf, useUiState } from "../lib/uiState";

type Help = { title: string; text: string; example?: string };

const points = (value: number) => `${value.toFixed(2).replace(".", ",").replace(/,00$/, "")}`;

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

  const entries = useMemo(() => librettoEntries(exams, subjects), [exams, subjects]);
  const stats = gradeStats(entries);
  const withTargets = projectedStats(entries, exams, subjects);
  const missing = exams
    .filter((exam) => !exam.archived && exam.status === "done" && !exam.passFail && !isValidGrade(exam.grade))
    .sort((a, b) => b.date.localeCompare(a.date));

  const openEditor = (exam: Exam | null) => {
    setNotice("");
    setGradeExam(exam);
    setGradeOpen(true);
  };

  return (
    <div>
      <SectionTitle
        title="Libretto e laurea"
        subtitle="Registra i voti degli esami: medie e voto di laurea previsto si calcolano da soli."
        action={
          // Con il libretto vuoto l'invito principale è nel riquadro sotto: qui resta secondario.
          <Button icon="Award" variant={entries.length ? "primary" : "soft"} onClick={() => openEditor(null)}>
            Registra un voto
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Media ponderata"
          value={formatAverage(stats.weighted)}
          detail={stats.graded ? "Pesata sui CFU" : "Ancora nessun voto"}
          help={CAREER_HELP.weighted}
        />
        <Tile
          label="Media aritmetica"
          value={formatAverage(stats.arithmetic)}
          detail={stats.passed ? `${stats.passed} ${stats.passed === 1 ? "esame superato" : "esami superati"}` : "Registra il primo voto"}
          help={CAREER_HELP.arithmetic}
        />
        <Tile
          label="CFU acquisiti"
          value={`${stats.cfuEarned}`}
          detail={`Su ${preferences.degreeCfu} del corso`}
          help={CAREER_HELP.cfu}
          progress={(stats.cfuEarned / Math.max(1, preferences.degreeCfu)) * 100}
        />
        <Tile
          label="Voto di partenza"
          value={formatAverage(stats.base110)}
          detail="Media × 110 / 30"
          help={CAREER_HELP.base}
        />
      </div>

      {notice ? (
        <p role="status" className="mb-4 rounded-[18px] border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm font-bold text-[var(--success-text)]">
          {notice}
        </p>
      ) : null}

      {!subjects.length ? (
        <Panel className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold text-[var(--muted)]">Non hai ancora materie: aggiungile in Materie oppure creale mentre registri un voto.</p>
            <Button icon="BookOpen" variant="soft" onClick={() => setActiveView("subjects")}>
              Vai a Materie
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <GraduationPanel
          program={program}
          entries={entries}
          weighted={stats.weighted}
          targetsWeighted={withTargets?.weighted ?? null}
          exams={exams}
          subjects={subjects}
          sbThesisGrade={preferences.sbThesisGrade ?? 27}
          barbThesisPoints={preferences.barbThesisPoints ?? 7}
          abroad={Boolean(preferences.abroad)}
          onChangeProgram={openDegreeSettings}
          onScenario={(patch) => void updatePreferences(patch)}
        />

        <section aria-label="Esami registrati" className="grid min-w-0 content-start grid-cols-1 gap-4">
          <LibrettoList entries={entries} subjects={subjects} onOpen={(examId) => openEditor(exams.find((exam) => exam.id === examId) ?? null)} onAdd={() => openEditor(null)} />
          {missing.length ? (
            <div>
              <h3 className="mb-2 px-1 text-xs font-black uppercase text-[var(--warning-text)]">Esami superati senza voto · {missing.length}</h3>
              <ul className="soft-panel grid grid-cols-1 gap-0.5 p-2">
                {missing.map((exam) => (
                  <li key={exam.id}>
                    <button type="button" onClick={() => openEditor(exam)} className="flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2.5 py-2 text-left hover:bg-[var(--surface-soft)]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subjectColor(subjects, exam.subjectId) }} />
                      <span className="one-line-safe min-w-0 flex-1 text-sm font-extrabold">{subjectName(subjects, exam.subjectId)}</span>
                      <span className="shrink-0 text-xs font-black text-[var(--accent-ink)]">Aggiungi voto</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
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

function Tile({ label, value, detail, help, progress }: { label: string; value: string; detail: string; help: Help; progress?: number }) {
  return (
    <div className="quiet-panel min-w-0 p-3.5">
      {/* La spiegazione era solo nel title (invisibile su touch): ora è nel "?". */}
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 truncate text-[11px] font-black uppercase text-[var(--faint)]">{label}</p>
        <HelpTip title={help.title} text={help.text} example={help.example} />
      </div>
      <p className="mt-1 truncate text-2xl font-black tabular-nums">{value}</p>
      <p className="truncate text-xs font-bold text-[var(--muted)]">{detail}</p>
      {progress !== undefined ? (
        <div className="mt-2">
          <ProgressBar value={progress} />
        </div>
      ) : null}
    </div>
  );
}

function GraduationPanel({
  program,
  entries,
  weighted,
  targetsWeighted,
  exams,
  subjects,
  sbThesisGrade,
  barbThesisPoints,
  abroad,
  onChangeProgram,
  onScenario
}: {
  program: DegreeProgramId;
  entries: LibrettoEntry[];
  weighted: number | null;
  targetsWeighted: number | null;
  exams: Exam[];
  subjects: Subject[];
  sbThesisGrade: number;
  barbThesisPoints: number;
  abroad: boolean;
  onChangeProgram: () => void;
  onScenario: (patch: { sbThesisGrade?: number; barbThesisPoints?: number; abroad?: boolean }) => void;
}) {
  const [basis, setBasis] = useUiState<"registered" | "targets">("career.basis", "registered", { validate: oneOf("registered", "targets") });
  const basisId = useId();
  const info = DEGREE_PROGRAMS[program];
  const useTargets = basis === "targets" && targetsWeighted !== null;
  const average = useTargets ? targetsWeighted : weighted;
  const honors = entries.filter((entry) => entry.honors).length;
  const thesis = program === "scienze-biologiche" ? sbThesisGrade : barbThesisPoints;
  const projection = projectGraduation({ program, weightedAverage: average, honors, thesis, abroad });

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
    <Panel>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xl font-black">Voto di laurea previsto</h3>
          {/* Sola lettura: il corso di laurea si cambia in Impostazioni, dove sta già la scelta. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-bold text-[var(--muted)]">
            <span className="safe-text min-w-0">{CAREER_TEXT.rulesOf(info.name, info.level, info.totalCfu)}</span>
            <button
              type="button"
              onClick={onChangeProgram}
              aria-label={CAREER_TEXT.changeInSettingsAria}
              className="relative inline-flex min-h-8 items-center gap-1 font-extrabold text-[var(--accent-ink)] after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:underline"
            >
              <Icon name="Settings" className="h-3.5 w-3.5" />
              {CAREER_TEXT.changeInSettings}
            </button>
          </p>
        </div>
      </div>

      {/* Prima il risultato, poi le ipotesi che lo cambiano. */}
      {projection ? (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1 rounded-[22px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] p-4">
            <div>
              <p className="text-xs font-black uppercase text-[var(--faint)]">Con le ipotesi qui sotto</p>
              <p className="text-4xl font-black tabular-nums">
                {points(projection.capped)}
                {projection.cappedMax > projection.capped ? <span className="text-2xl"> – {points(projection.cappedMax)}</span> : null}
                <span className="text-lg text-[var(--muted)]"> / 110</span>
              </p>
            </div>
            {projection.totalMax > 110 ? (
              <p className="pb-1 text-xs font-bold text-[var(--muted)]">
                Il calcolo dà {points(projection.total)}
                {projection.totalMax > projection.total ? `–${points(projection.totalMax)}` : ""}: sopra 110 la lode la decide la commissione.
              </p>
            ) : null}
          </div>

          <dl className="mt-3 grid grid-cols-1 gap-1 text-sm">
            <Row label={`Voto di partenza (media ${formatAverage(average)} × 110 / 30)`} value={points(projection.base)} strong />
            {projection.parts.map((part) => (
              <Row key={part.label} label={part.label} value={part.upTo ? `Fino a +${points(part.upTo)}` : `+${points(part.points)}`} />
            ))}
            <Row label="Totale" value={projection.totalMax > projection.total ? `${points(projection.total)} – ${points(projection.totalMax)}` : points(projection.total)} strong />
            {projection.manifestoTotal !== undefined ? <Row label="Totale secondo il Manifesto 2026/27 (+1 per l'estero)" value={points(projection.manifestoTotal)} /> : null}
          </dl>

          {needed !== null ? (
            <p className="mt-3 rounded-[16px] border border-[var(--border)] p-3 text-sm font-bold">
              {projection.total >= 110
                ? "Con queste ipotesi arrivi a 110."
                : `Per arrivare a 110 ti serve una media ponderata di almeno ${formatAverage(needed)}.`}
              {projection.total < 110 && neededOnPlanned !== null ? (
                <span className="mt-1 block text-xs text-[var(--muted)]">
                  {neededOnPlanned > MAX_GRADE
                    ? `Gli esami in programma (${plannedCfu} CFU) da soli non bastano: servirebbe una media di ${formatAverage(neededOnPlanned)}.`
                    : neededOnPlanned <= MIN_GRADE
                      ? `Negli esami in programma (${plannedCfu} CFU) ti basta passarli.`
                      : `Negli esami in programma (${plannedCfu} CFU) ti serve una media di ${formatAverage(neededOnPlanned)}.`}
                </span>
              ) : null}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-4 rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm font-bold text-[var(--muted)]">
          Registra almeno un voto, o metti un voto obiettivo agli esami in programma, per vedere la stima.
        </p>
      )}

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <p className="mb-2 text-[11px] font-black uppercase text-[var(--faint)]">Le tue ipotesi</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {program === "scienze-biologiche" ? (
            <Field label="Voto che prevedi per la prova finale">
              <select className={inputClass} value={sbThesisGrade} onChange={(event) => onScenario({ sbThesisGrade: Number(event.target.value) })}>
                {Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, index) => MAX_GRADE - index).map((grade) => (
                  <option key={grade} value={grade}>
                    {grade === MAX_GRADE ? "30 o 30 e lode" : grade} → +{sbThesisPoints(grade)} punti
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Punti che prevedi per la tesi">
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
              <label htmlFor={basisId} className="text-xs font-black uppercase text-[var(--faint)]">
                {CAREER_TEXT.basis}
              </label>
              <HelpTip title={CAREER_HELP.basis.title} text={CAREER_HELP.basis.text} />
            </div>
            <select id={basisId} className={inputClass} value={useTargets ? "targets" : "registered"} onChange={(event) => setBasis(event.target.value as "registered" | "targets")}>
              <option value="registered">Solo i voti già registrati ({formatAverage(weighted)})</option>
              {targetsWeighted !== null ? <option value="targets">Anche i voti obiettivo degli esami in programma ({formatAverage(targetsWeighted)})</option> : null}
            </select>
          </div>
        </div>
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 text-sm font-bold">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={abroad} onChange={(event) => onScenario({ abroad: event.target.checked })} />
          <span className="min-w-0 flex-1">
            {program === "scienze-biologiche" ? "Programma Erasmus svolto almeno al 70%" : "Tesi svolta all'estero o almeno 3 esami superati all'estero"}
          </span>
        </label>
      </div>

      {projection ? (
        <ul className="mt-3 grid grid-cols-1 gap-1 text-xs font-bold text-[var(--muted)]">
          {projection.notes.map((note) => (
            <li key={note} className="flex gap-2">
              <Icon name="Info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
          <li className="flex gap-2">
            <Icon name="Info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>È una stima: voto finale, eventuali arrotondamenti e lode li decide la commissione di laurea.</span>
          </li>
        </ul>
      ) : null}

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <p className="mb-1 text-[11px] font-black uppercase text-[var(--faint)]">Fonti ufficiali delle regole</p>
        <ul className="grid grid-cols-1 gap-1">
          {info.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 text-xs font-bold text-[var(--accent-ink)] hover:underline">
                <Icon name="ExternalLink" className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {source.label} <span className="text-[var(--muted)]">· {source.date}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 rounded-[12px] px-2 py-1 ${strong ? "bg-[var(--surface-soft)] font-black" : "font-bold text-[var(--muted)]"}`}>
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 tabular-nums text-[var(--text)]">{value}</dd>
    </div>
  );
}

function LibrettoList({
  entries,
  subjects,
  onOpen,
  onAdd
}: {
  entries: LibrettoEntry[];
  subjects: Subject[];
  onOpen: (examId: string) => void;
  onAdd: () => void;
}) {
  if (!entries.length) {
    return (
      <EmptyState
        icon="Award"
        title={CAREER_TEXT.emptyTitle}
        body={CAREER_TEXT.emptyBody}
        action={
          <Button icon="Award" variant="primary" onClick={onAdd}>
            {CAREER_TEXT.recordGrade}
          </Button>
        }
      />
    );
  }
  return (
    <div>
      <h3 className="mb-2 px-1 text-xs font-black uppercase text-[var(--faint)]">Esami superati · {entries.length}</h3>
      <ul className="soft-panel grid grid-cols-1 gap-0.5 p-2">
        {entries.map((entry) => (
          <li key={entry.examId}>
            <button type="button" onClick={() => onOpen(entry.examId)} className="flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2.5 py-2 text-left hover:bg-[var(--surface-soft)]">
              <span
                className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center rounded-[14px] text-sm font-black tabular-nums"
                title={formatGrade(entry)}
                style={{ background: `color-mix(in srgb, ${subjectColor(subjects, entry.subjectId)} 24%, transparent)` }}
              >
                {entry.passFail ? "ID" : entry.honors ? "30L" : entry.grade}
              </span>
              <span className="min-w-0 flex-1">
                <span className="one-line-safe block text-sm font-extrabold">{entry.name}</span>
                <span className="block text-xs font-bold text-[var(--muted)]">
                  {entry.cfu} CFU · {format(parseISO(entry.date), "d MMM yyyy", { locale: it })}
                </span>
              </span>
              {entry.honors || entry.passFail ? <span className="hidden shrink-0 text-xs font-black text-[var(--muted)] sm:block">{formatGrade(entry)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-1 text-xs font-bold text-[var(--faint)]">
        La lode vale 30 nella media. Le idoneità danno CFU ma non entrano nella media. Gli esami con più CFU pesano di più.
      </p>
    </div>
  );
}
