import { useState } from "react";
import { format, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { MAX_GRADE, MIN_GRADE, examToRecord, isValidGrade } from "../lib/grades";
import { failedExamPatch, outcomeOf, recordDateFor, withoutDateToDecide, type ExamOutcome } from "../lib/examOutcome";
import { DateField, DateTimeField } from "./DatePicker";
import { Button, Drawer, Field, HelpTip, inputClass } from "./ui";
import { CAREER_HELP, GRADE_TEXT } from "../lib/labels/career";
import { useOnce } from "../hooks/useOnce";

const GRADES = Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, index) => MIN_GRADE + index);

const toDateInput = (iso?: string) => {
  if (!iso) return format(new Date(), "yyyy-MM-dd");
  const date = parseISO(iso);
  return Number.isNaN(date.getTime()) ? format(new Date(), "yyyy-MM-dd") : format(date, "yyyy-MM-dd");
};

/** Esame già nel libretto (con voto o idoneità): il modulo ne modifica il voto. */
const isGraded = (exam: Exam) => exam.status === "done" && (Boolean(exam.passFail) || isValidGrade(exam.grade));

/**
 * Registra (o modifica) l'esito di un esame. Senza `exam`: se la materia ha già un esame sostenuto
 * senza voto o non chiuso lo aggiorna (niente doppioni), altrimenti lo crea; si può creare al volo
 * la materia (esami degli anni precedenti) o partire da una materia data (`subjectId`). Con un
 * `exam` ancora senza voto: «Com'è andata?» con voto, idoneità o non superato (l'esame resta
 * aperto). Con un `exam` già nel libretto: modifica voto, lode, idoneità e data.
 */
export function GradeDrawer({
  open,
  exam,
  subjectId: fixedSubjectId,
  subjects,
  exams,
  onClose,
  onSaved
}: {
  open: boolean;
  exam?: Exam | null;
  /** Materia già scelta (es. «Segna come superata» in Materie): niente scelta della materia. */
  subjectId?: string | null;
  subjects: Subject[];
  exams: Exam[];
  onClose: () => void;
  onSaved: (message: string, outcome: ExamOutcome) => void;
}) {
  const { addExam, updateExam, deleteExam, addSubject, updateSubject } = useStudyStore();
  const passedSubjects = new Set(
    exams.filter((item) => item.status === "done" && (item.passFail || isValidGrade(item.grade)) && item.id !== exam?.id).map((item) => item.subjectId)
  );
  const available = subjects.filter((subject) => !subject.archived && subject.status !== "archived" && !passedSubjects.has(subject.id));
  // Giorno proposto per la materia scelta: quello dell'esame che verrà riusato, se è già passato.
  const suggestedDate = (subjectId: string) => recordDateFor(subjectId && subjectId !== "__new" ? examToRecord(exams, subjectId) : undefined);
  // Senza materie selezionabili si parte direttamente dal nuovo insegnamento.
  const initial = () => ({
    subjectId: exam?.subjectId ?? fixedSubjectId ?? (available.length ? "" : "__new"),
    newName: "",
    newCfu: "6",
    // Voto già registrato: la sua data. Esame da registrare: la sua, se è passata. Materia: quella dell'esame che si riusa.
    date: exam && isGraded(exam) ? toDateInput(exam.date) : exam ? recordDateFor(exam) : suggestedDate(fixedSubjectId ?? ""),
    grade: exam?.grade ? String(exam.grade) : "",
    honors: Boolean(exam?.honors),
    outcome: outcomeOf(exam),
    newDate: ""
  });
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  // Un solo Registra / Elimina per volta: un doppio tocco creerebbe due esami (e due materie).
  const once = useOnce();
  // Ripristina il modulo a ogni apertura (anche passando da un esame all'altro).
  const key = open ? exam?.id ?? `new:${fixedSubjectId ?? ""}` : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key) {
      setDraft(initial());
      setError("");
      once.release();
    }
  }

  const editing = Boolean(exam && isGraded(exam));
  // Esame ancora senza voto (data passata, o «Sostenuto» senza voto): si può anche non averlo superato.
  const recording = Boolean(exam && !editing);
  const subjectFixed = Boolean(exam || fixedSubjectId);
  const creating = draft.subjectId === "__new";
  const subjectName = subjects.find((subject) => subject.id === draft.subjectId)?.name ?? "";
  const outcomes: { id: ExamOutcome; label: string }[] = [
    { id: "grade", label: GRADE_TEXT.outcomeGrade },
    { id: "passFail", label: GRADE_TEXT.outcomePassFail },
    ...(recording ? [{ id: "failed" as const, label: GRADE_TEXT.outcomeFailed }] : [])
  ];
  const todayStart = `${format(new Date(), "yyyy-MM-dd")}T00:00`;

  const markPassed = async (subjectId: string) => {
    const subject = useStudyStore.getState().subjects.find((item) => item.id === subjectId);
    if (subject && subject.status !== "completed" && subject.status !== "archived") await updateSubject(subjectId, { status: "completed" });
  };

  const save = async () => {
    if (!once.take()) return;
    setError("");
    // Errore del modulo: Registra torna usabile.
    const fail = (message: string) => {
      setError(message);
      once.release();
    };

    if (draft.outcome === "failed") {
      if (!exam) return fail(GRADE_TEXT.outcomeAsk);
      let newDate: Date | null = null;
      if (draft.newDate) {
        newDate = new Date(draft.newDate);
        if (Number.isNaN(newDate.getTime())) return fail(GRADE_TEXT.newDateInvalid);
        if (newDate.getTime() < startOfDay(new Date()).getTime()) return fail(GRADE_TEXT.newDatePast);
      }
      await updateExam(exam.id, failedExamPatch(exam, newDate?.toISOString()));
      onSaved(GRADE_TEXT.failedSaved(subjectName || "Esame", newDate ? format(newDate, "d MMMM", { locale: it }) : null), "failed");
      return;
    }

    const passFail = draft.outcome === "passFail";
    const grade = Number(draft.grade);
    if (!passFail && !isValidGrade(grade)) return fail(`Scegli un voto da ${MIN_GRADE} a ${MAX_GRADE}.`);
    const date = new Date(`${draft.date}T12:00`);
    if (Number.isNaN(date.getTime())) return fail("Data non valida: scegli il giorno dell'esame.");
    const result = {
      status: "done" as const,
      date: date.toISOString(),
      preparation: 100,
      grade: passFail ? undefined : grade,
      honors: !passFail && grade === MAX_GRADE && draft.honors,
      passFail
    };
    const outcome = passFail ? "idoneità" : result.honors ? "30 e lode" : String(grade);

    if (exam) {
      await updateExam(exam.id, { ...result, tags: withoutDateToDecide(exam.tags) });
      if (recording) await markPassed(exam.subjectId);
      onSaved(GRADE_TEXT.saved(subjectName || "Esame", outcome, passFail, editing), draft.outcome);
      return;
    }

    let subjectId = draft.subjectId;
    let name = subjectName;
    if (creating) {
      const cfu = Number(draft.newCfu.replace(",", "."));
      if (!draft.newName.trim()) return fail("Scrivi il nome della materia.");
      if (!Number.isFinite(cfu) || cfu < 0 || cfu > 60) return fail("CFU non validi: scrivi un numero da 0 a 60.");
      name = draft.newName.trim();
      subjectId = await addSubject({ name, cfu, status: "completed", semester: "" });
    }
    if (!subjectId) return fail("Scegli la materia dell'esame.");
    // Riusa l'esame «Sostenuto» senza voto (o il primo da dare): la materia resta una riga del libretto.
    const pendingExam = examToRecord(exams, subjectId);
    if (pendingExam) await updateExam(pendingExam.id, { ...result, tags: withoutDateToDecide(pendingExam.tags) });
    else await addExam({ subjectId, targetGrade: Math.min(MAX_GRADE, grade || 28), ...result });
    await markPassed(subjectId);
    onSaved(GRADE_TEXT.saved(name, outcome, passFail, false), draft.outcome);
  };

  const remove = async () => {
    if (!exam || !once.take()) return;
    if (!window.confirm(`Eliminare il voto di "${subjectName}"? L'esame viene tolto dal libretto e le medie si aggiornano. Non si può annullare.`)) {
      once.release();
      return;
    }
    await deleteExam(exam.id);
    onSaved(`${subjectName}: voto eliminato dal libretto.`, outcomeOf(exam));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={recording ? GRADE_TEXT.outcomeAsk : "Libretto"}
      title={editing || recording ? subjectName || "Modifica voto" : fixedSubjectId ? subjectName || GRADE_TEXT.recordTitle : "Registra un voto"}
      width="max-w-[480px]"
      footer={
        <div className="flex items-center gap-2">
          {editing ? (
            <Button variant="danger" icon="Trash2" onClick={() => void remove()} disabled={once.busy}>
              Elimina voto
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={once.busy}>
            {editing ? "Salva voto" : recording ? GRADE_TEXT.saveOutcome : GRADE_TEXT.recordButton(draft.outcome)}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        {subjectFixed ? null : (
          <Field label="Materia">
            <select
              className={inputClass}
              value={draft.subjectId}
              onChange={(event) => {
                const subjectId = event.target.value;
                setDraft((value) => ({ ...value, subjectId, date: suggestedDate(subjectId) }));
              }}
            >
              <option value="">Scegli la materia</option>
              {available.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name} · {subject.cfu} CFU
                </option>
              ))}
              <option value="__new">+ Materia non in elenco (Es. di un anno precedente)</option>
            </select>
          </Field>
        )}
        {creating ? (
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
            <Field label="Nome della materia">
              <input className={inputClass} value={draft.newName} onChange={(event) => setDraft((value) => ({ ...value, newName: event.target.value }))} placeholder="Es. Chimica generale" autoFocus />
            </Field>
            <Field label="CFU">
              <input className={inputClass} inputMode="numeric" value={draft.newCfu} onChange={(event) => setDraft((value) => ({ ...value, newCfu: event.target.value }))} />
            </Field>
          </div>
        ) : null}

        {/* Il "?" sta accanto all'etichetta, non dentro: un tocco sul "?" non sceglie l'esito. */}
        <fieldset className="min-w-0">
          <legend className="mb-1 block text-xs font-black uppercase text-[var(--faint)]">{GRADE_TEXT.outcome}</legend>
          <div className="grid grid-cols-1">
            {outcomes.map((option) => (
              <span key={option.id} className="flex min-w-0 items-center gap-1.5">
                <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-sm font-bold">
                  <input
                    type="radio"
                    name="grade-outcome"
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={draft.outcome === option.id}
                    onChange={() => setDraft((value) => ({ ...value, outcome: option.id, honors: option.id === "grade" && value.honors }))}
                  />
                  <span className="safe-text min-w-0">{option.label}</span>
                </label>
                {option.id === "passFail" ? <HelpTip title={CAREER_HELP.passFail.title} text={CAREER_HELP.passFail.text} example={CAREER_HELP.passFail.example} /> : null}
              </span>
            ))}
          </div>
        </fieldset>

        {draft.outcome === "failed" ? (
          <div className="grid grid-cols-1 gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
            <p className="text-sm font-bold">{GRADE_TEXT.failedHint}</p>
            <DateTimeField label={GRADE_TEXT.newDate} value={draft.newDate} min={todayStart} optional onChange={(newDate) => setDraft((value) => ({ ...value, newDate }))} />
            <p className="text-xs font-bold text-[var(--muted)]">{GRADE_TEXT.newDateHint}</p>
          </div>
        ) : (
          <>
            <div className={`grid gap-2 ${draft.outcome === "grade" ? "grid-cols-2" : "grid-cols-1"}`}>
              {draft.outcome === "grade" ? (
                <Field label="Voto">
                  <select
                    className={inputClass}
                    value={draft.grade}
                    onChange={(event) => setDraft((value) => ({ ...value, grade: event.target.value, honors: event.target.value === String(MAX_GRADE) && value.honors }))}
                  >
                    <option value="">Scegli il voto</option>
                    {GRADES.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <DateField label="Data dell'esame" value={draft.date} onChange={(date) => setDraft((value) => ({ ...value, date }))} />
            </div>
            {draft.outcome === "grade" ? (
              <span className="flex items-center gap-1.5">
                <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={draft.honors}
                    disabled={draft.grade !== String(MAX_GRADE)}
                    onChange={(event) => setDraft((value) => ({ ...value, honors: event.target.checked }))}
                  />
                  Lode (solo con 30)
                </label>
                <HelpTip title={CAREER_HELP.honors.title} text={CAREER_HELP.honors.text} />
              </span>
            ) : null}
          </>
        )}
        {(editing || recording || fixedSubjectId) && draft.outcome !== "failed" ? (
          <p className="text-xs font-bold text-[var(--muted)]">
            Vale {subjects.find((subject) => subject.id === draft.subjectId)?.cfu ?? 0} CFU. Per cambiarli apri la materia in Materie.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
