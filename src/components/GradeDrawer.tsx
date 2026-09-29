import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { Exam, Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { MAX_GRADE, MIN_GRADE, isValidGrade } from "../lib/grades";
import { Button, Drawer, Field, inputClass } from "./ui";

const GRADES = Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, index) => MIN_GRADE + index);

const toDateInput = (iso?: string) => {
  if (!iso) return format(new Date(), "yyyy-MM-dd");
  const date = parseISO(iso);
  return Number.isNaN(date.getTime()) ? format(new Date(), "yyyy-MM-dd") : format(date, "yyyy-MM-dd");
};

/**
 * Registra (o modifica) un esame superato nel libretto. Senza `exam`: se la materia ha già un
 * esame non chiuso lo aggiorna (niente doppioni), altrimenti lo crea; si può creare al volo la
 * materia (esami degli anni precedenti). Con `exam`: modifica voto, lode, idoneità e data.
 */
export function GradeDrawer({
  open,
  exam,
  subjects,
  exams,
  onClose,
  onSaved
}: {
  open: boolean;
  exam?: Exam | null;
  subjects: Subject[];
  exams: Exam[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { addExam, updateExam, deleteExam, addSubject, updateSubject } = useStudyStore();
  const passedSubjects = new Set(
    exams.filter((item) => item.status === "done" && (item.passFail || isValidGrade(item.grade)) && item.id !== exam?.id).map((item) => item.subjectId)
  );
  const available = subjects.filter((subject) => !subject.archived && subject.status !== "archived" && !passedSubjects.has(subject.id));
  // Senza materie selezionabili si parte direttamente dal nuovo insegnamento.
  const initial = () => ({
    subjectId: exam?.subjectId ?? (available.length ? "" : "__new"),
    newName: "",
    newCfu: "6",
    date: toDateInput(exam?.date),
    grade: exam?.grade ? String(exam.grade) : "",
    honors: Boolean(exam?.honors),
    passFail: Boolean(exam?.passFail)
  });
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  // Ripristina il modulo a ogni apertura (anche passando da un esame all'altro).
  const key = open ? exam?.id ?? "new" : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key) {
      setDraft(initial());
      setError("");
    }
  }

  const editing = Boolean(exam);
  const creating = draft.subjectId === "__new";
  const subjectName = subjects.find((subject) => subject.id === draft.subjectId)?.name ?? "";

  const save = async () => {
    setError("");
    const grade = Number(draft.grade);
    if (!draft.passFail && !isValidGrade(grade)) return setError(`Scegli un voto da ${MIN_GRADE} a ${MAX_GRADE}.`);
    const date = new Date(`${draft.date}T12:00`);
    if (Number.isNaN(date.getTime())) return setError("Data non valida.");
    const result = {
      status: "done" as const,
      date: date.toISOString(),
      preparation: 100,
      grade: draft.passFail ? undefined : grade,
      honors: !draft.passFail && grade === MAX_GRADE && draft.honors,
      passFail: draft.passFail
    };
    const outcome = draft.passFail ? "idoneità" : result.honors ? "30 e lode" : String(grade);

    if (exam) {
      await updateExam(exam.id, result);
      onSaved(`${subjectName || "Esame"}: ${outcome} aggiornato nel libretto.`);
      return;
    }

    let subjectId = draft.subjectId;
    let name = subjectName;
    if (creating) {
      const cfu = Number(draft.newCfu.replace(",", "."));
      if (!draft.newName.trim()) return setError("Scrivi il nome dell'insegnamento.");
      if (!Number.isFinite(cfu) || cfu < 0 || cfu > 60) return setError("CFU non validi (0–60).");
      name = draft.newName.trim();
      subjectId = await addSubject({ name, cfu, status: "completed", semester: "" });
    }
    if (!subjectId) return setError("Scegli la materia.");
    const pendingExam = exams
      .filter((item) => item.subjectId === subjectId && item.status !== "done")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (pendingExam) await updateExam(pendingExam.id, result);
    else await addExam({ subjectId, targetGrade: Math.min(MAX_GRADE, grade || 28), ...result });
    const subject = useStudyStore.getState().subjects.find((item) => item.id === subjectId);
    if (subject && subject.status !== "completed" && subject.status !== "archived") await updateSubject(subjectId, { status: "completed" });
    onSaved(`${name}: ${outcome} registrato nel libretto.`);
  };

  const remove = async () => {
    if (!exam) return;
    if (!window.confirm(`Eliminare il voto di "${subjectName}" dal libretto? L'esame viene cancellato.`)) return;
    await deleteExam(exam.id);
    onSaved(`${subjectName}: voto eliminato dal libretto.`);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Libretto"
      title={editing ? subjectName || "Modifica voto" : "Registra un esame superato"}
      width="max-w-[480px]"
      footer={
        <div className="flex items-center gap-2">
          {editing ? (
            <Button variant="danger" icon="Trash2" onClick={() => void remove()}>
              Elimina
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={() => void save()}>
            {editing ? "Salva" : "Registra"}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        {editing ? null : (
          <Field label="Insegnamento">
            <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
              <option value="">Seleziona</option>
              {available.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name} · {subject.cfu} CFU
                </option>
              ))}
              <option value="__new">+ Nuovo insegnamento (es. di un anno precedente)</option>
            </select>
          </Field>
        )}
        {creating ? (
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
            <Field label="Nome">
              <input className={inputClass} value={draft.newName} onChange={(event) => setDraft((value) => ({ ...value, newName: event.target.value }))} autoFocus />
            </Field>
            <Field label="CFU">
              <input className={inputClass} inputMode="numeric" value={draft.newCfu} onChange={(event) => setDraft((value) => ({ ...value, newCfu: event.target.value }))} />
            </Field>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data">
            <input className={inputClass} type="date" value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} />
          </Field>
          <Field label="Voto">
            <select
              className={inputClass}
              value={draft.passFail ? "" : draft.grade}
              disabled={draft.passFail}
              onChange={(event) => setDraft((value) => ({ ...value, grade: event.target.value, honors: event.target.value === String(MAX_GRADE) && value.honors }))}
            >
              <option value="">{draft.passFail ? "Senza voto" : "Scegli"}</option>
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={draft.honors}
              disabled={draft.passFail || draft.grade !== String(MAX_GRADE)}
              onChange={(event) => setDraft((value) => ({ ...value, honors: event.target.checked }))}
            />
            Lode
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={draft.passFail}
              onChange={(event) => setDraft((value) => ({ ...value, passFail: event.target.checked, honors: false }))}
            />
            Idoneità (senza voto)
          </label>
        </div>
        {editing && exam ? (
          <p className="text-xs font-bold text-[var(--muted)]">
            CFU: {subjects.find((subject) => subject.id === exam.subjectId)?.cfu ?? 0} (si modificano dalla scheda della materia).
          </p>
        ) : null}
        {error ? <p className="text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
      </div>
    </Drawer>
  );
}
