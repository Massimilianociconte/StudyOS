// Quiz: dati (titolo, raccolta, tempo) e domande. Ogni domanda: testo a blocchi, risposta singola o
// multipla, da 2 a 10 risposte con «giusta» e il perché, spiegazione ed errori comuni.
import { useEffect, useId, useState } from "react";
import type { LearningSource } from "../../agent/learningShared";
import { createQuiz, deleteQuestions, saveQuestion, updateQuiz } from "../../store/learning";
import { deleteSharedQuestions, saveSharedQuestion, updateSharedQuiz } from "../../store/sharedLearning";
import { blocksPlainText } from "../../lib/cardBlocks";
import { sortByPosition } from "../../lib/learningModel";
import { QUIZ_LIMITS, optionLetter, safeOptions } from "../../lib/quizScoring";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { Quiz, QuizOption, QuizQuestion, StudyDeck } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Button, Drawer, Field, IconButton, inputClass } from "../ui";
import { BlockListEditor, keyBlocks, keyBlocksOrBlank, unkeyBlocks, type KeyedBlock } from "./BlockListEditor";
import { errorText } from "./useLearnData";

interface QuestionDraft {
  kind: "single" | "multiple";
  prompt: KeyedBlock[];
  options: (Partial<QuizOption> & { key: string; text: string; correct: boolean; feedback: string })[];
  explanation: KeyedBlock[];
  mistakes: string;
}

let optionSeed = 0;
const blankOption = () => ({ key: `opt${++optionSeed}`, text: "", correct: false, feedback: "" });

const questionDraft = (question?: QuizQuestion): QuestionDraft => ({
  kind: question?.kind ?? "single",
  prompt: keyBlocksOrBlank(question?.prompt),
  options: question ? safeOptions(question.options).map((option) => ({ ...option, key: `opt${++optionSeed}`, feedback: option.feedback ?? "" })) : [blankOption(), blankOption(), blankOption(), blankOption()],
  explanation: keyBlocks(question?.explanation),
  mistakes: question?.mistakes ?? ""
});

function QuestionEditor({
  open,
  quizId,
  question,
  shared,
  onClose
}: {
  open: boolean;
  quizId: string;
  question?: QuizQuestion;
  shared?: LearningSource;
  onClose: () => void;
}) {
  const radioName = useId();
  const [draft, setDraft] = useState<QuestionDraft>(() => questionDraft(question));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setDraft(questionDraft(question));
    setError("");
  }, [open, question]);

  const setOption = (index: number, patch: Partial<QuestionDraft["options"][number]>) =>
    setDraft((value) => ({
      ...value,
      options: value.options.map((option, i) => {
        if (i === index) return { ...option, ...patch };
        // Risposta singola: segnare una giusta toglie il segno dalle altre.
        if (patch.correct && value.kind === "single") return { ...option, correct: false };
        return option;
      })
    }));

  const save = async () => {
    setBusy(true);
    setError("");
    const options = draft.options
      .filter((option) => option.text.trim())
      .map((option) => ({ ...(option.id ? { id: option.id } : {}), text: option.text, correct: option.correct, ...(option.feedback.trim() ? { feedback: option.feedback } : {}) }));
    try {
      const input = { kind: draft.kind, prompt: unkeyBlocks(draft.prompt), options, explanation: unkeyBlocks(draft.explanation), mistakes: draft.mistakes };
      if (shared) await saveSharedQuestion(shared, quizId, input, question?.id);
      else await saveQuestion(quizId, input, question?.id);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissOutside={false}
      title={question ? LEARN_TEXT.questionPrompt : LEARN_TEXT.newQuestion}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <p role="alert" className="safe-text mr-auto min-w-0 flex-1 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          <Button onClick={onClose}>{LEARN_TEXT.cancel}</Button>
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>
            {LEARN_TEXT.save}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5">
        <BlockListEditor label={LEARN_TEXT.questionPrompt} value={draft.prompt} onChange={(prompt) => setDraft((value) => ({ ...value, prompt }))} required />
        <Field label={LEARN_TEXT.questionKind}>
          <select
            className={inputClass}
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as "single" | "multiple";
              setDraft((value) => {
                // Da multipla a singola: resta giusta solo la prima segnata.
                let seen = false;
                const options = kind === "single" ? value.options.map((option) => (option.correct && !seen ? ((seen = true), option) : { ...option, correct: false })) : value.options;
                return { ...value, kind, options };
              });
            }}
          >
            <option value="single">{LEARN_TEXT.kindSingle}</option>
            <option value="multiple">{LEARN_TEXT.kindMultiple}</option>
          </select>
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{draft.kind === "multiple" ? LEARN_TEXT.multipleHint : LEARN_TEXT.singleHint}</legend>
          {draft.options.map((option, index) => (
            <div key={option.key} className="grid gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-2.5">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-black">{optionLetter(index)}</span>
                <input
                  aria-label={LEARN_TEXT.option(optionLetter(index))}
                  className={`${inputClass} min-w-0 flex-1`}
                  maxLength={QUIZ_LIMITS.optionText}
                  value={option.text}
                  onChange={(event) => setOption(index, { text: event.target.value })}
                />
                <label className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-black">
                  <input type={draft.kind === "single" ? "radio" : "checkbox"} name={radioName} checked={option.correct} onChange={(event) => setOption(index, { correct: event.target.checked })} />
                  {LEARN_TEXT.optionCorrect}
                </label>
                <IconButton
                  icon="X"
                  label={`${LEARN_TEXT.removeOption} ${optionLetter(index)}`}
                  disabled={draft.options.length <= QUIZ_LIMITS.minOptions}
                  onClick={() => setDraft((value) => ({ ...value, options: value.options.filter((_, i) => i !== index) }))}
                />
              </div>
              <input
                aria-label={`${LEARN_TEXT.optionFeedback} ${optionLetter(index)}`}
                placeholder={LEARN_TEXT.optionFeedback}
                className={inputClass}
                maxLength={QUIZ_LIMITS.feedback}
                value={option.feedback}
                onChange={(event) => setOption(index, { feedback: event.target.value })}
              />
            </div>
          ))}
          {draft.options.length < QUIZ_LIMITS.maxOptions ? (
            <div>
              <Button variant="soft" icon="Plus" onClick={() => setDraft((value) => ({ ...value, options: [...value.options, blankOption()] }))}>
                {LEARN_TEXT.addOption}
              </Button>
            </div>
          ) : null}
        </fieldset>
        <BlockListEditor label={LEARN_TEXT.questionExplanation} value={draft.explanation} onChange={(explanation) => setDraft((value) => ({ ...value, explanation }))} />
        <Field label="Errori comuni (facoltativo)">
          <textarea className={`${inputClass} min-h-20 py-2.5`} maxLength={QUIZ_LIMITS.mistakes} value={draft.mistakes} onChange={(event) => setDraft((value) => ({ ...value, mistakes: event.target.value }))} />
        </Field>
      </div>
    </Drawer>
  );
}

export function QuizEditor({
  open,
  quiz,
  questions,
  decks,
  shared,
  onClose,
  onCreated
}: {
  open: boolean;
  quiz?: Quiz;
  questions: readonly QuizQuestion[];
  decks: readonly StudyDeck[];
  /** Quiz di un'altra persona con «Può modificare» (si modifica, non se ne creano di nuovi). */
  shared?: LearningSource;
  onClose: () => void;
  onCreated?: (quiz: Quiz) => void;
}) {
  const [fields, setFields] = useState({ title: "", description: "", deckId: "", minutes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<QuizQuestion | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFields({ title: quiz?.title ?? "", description: quiz?.description ?? "", deckId: quiz?.deckId ?? "", minutes: quiz?.timeLimitMinutes ? String(quiz.timeLimitMinutes) : "" });
    setError("");
  }, [open, quiz?.id]);

  const own = quiz ? sortByPosition(questions.filter((question) => question.quizId === quiz.id)) : [];

  const saveFields = async () => {
    setBusy(true);
    setError("");
    const input = {
      title: fields.title,
      description: fields.description,
      deckId: fields.deckId || null,
      timeLimitMinutes: fields.minutes ? Number(fields.minutes) : null
    };
    try {
      if (quiz && shared) await updateSharedQuiz(shared, quiz.id, input);
      else if (quiz) await updateQuiz(quiz.id, input);
      else onCreated?.(await createQuiz(input));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Drawer
        open={open && !editing}
        onClose={onClose}
        title={quiz ? LEARN_TEXT.editQuiz : LEARN_TEXT.newQuiz}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error ? (
              <p role="alert" className="safe-text mr-auto min-w-0 flex-1 text-sm font-bold text-[var(--danger-text)]">
                {error}
              </p>
            ) : null}
            <Button onClick={onClose}>{LEARN_TEXT.sessionClose}</Button>
            <Button variant="primary" icon="Check" onClick={() => void saveFields()} disabled={busy || !fields.title.trim()}>
              {LEARN_TEXT.save}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <Field label={LEARN_TEXT.quizTitle}>
            <input className={inputClass} value={fields.title} maxLength={200} data-autofocus onChange={(event) => setFields((value) => ({ ...value, title: event.target.value }))} />
          </Field>
          <Field label={LEARN_TEXT.quizDescription}>
            <textarea className={`${inputClass} min-h-20 py-2.5`} value={fields.description} maxLength={4000} onChange={(event) => setFields((value) => ({ ...value, description: event.target.value }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label={LEARN_TEXT.deckParent}>
              <select className={inputClass} value={fields.deckId} onChange={(event) => setFields((value) => ({ ...value, deckId: event.target.value }))}>
                <option value="">—</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={LEARN_TEXT.quizMinutes}>
              <input className={inputClass} type="number" inputMode="numeric" min={1} max={600} value={fields.minutes} onChange={(event) => setFields((value) => ({ ...value, minutes: event.target.value }))} />
            </Field>
          </div>

          {quiz ? (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.questionsCount(own.length)}</h3>
                <Button variant="soft" icon="Plus" onClick={() => setEditing("new")}>
                  {LEARN_TEXT.newQuestion}
                </Button>
              </div>
              <ol className="grid gap-1">
                {own.map((question, index) => (
                  <li key={question.id} className="rounded-[16px] bg-[var(--surface-soft)] p-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setEditing(question)} className="motion-safe min-w-0 flex-1 rounded-[12px] px-2 py-1.5 text-left hover:bg-[var(--surface)]">
                        <span className="safe-text line-clamp-2 text-sm font-bold">
                          {index + 1}. {blocksPlainText(question.prompt, 160)}
                        </span>
                        <span className="text-xs font-bold text-[var(--muted)]">{question.kind === "multiple" ? LEARN_TEXT.kindMultiple : LEARN_TEXT.kindSingle}</span>
                      </button>
                      <IconButton icon="Trash2" label={`${LEARN_TEXT.deleteQuestion} ${index + 1}`} onClick={() => setConfirmDelete(question.id)} />
                    </div>
                    {confirmDelete === question.id ? (
                      <div className="mt-2">
                        <ConfirmWithError
                          text={`${LEARN_TEXT.deleteQuestion}?`}
                          confirmLabel={LEARN_TEXT.deleteQuestion}
                          icon="Trash2"
                          onCancel={() => setConfirmDelete(null)}
                          onConfirm={async () => {
                            try {
                              if (shared) await deleteSharedQuestions(shared, [question.id]);
                              else await deleteQuestions([question.id]);
                              setConfirmDelete(null);
                              return null;
                            } catch (failure) {
                              return errorText(failure);
                            }
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </Drawer>
      {quiz ? (
        <QuestionEditor open={editing !== null} quizId={quiz.id} question={editing && editing !== "new" ? editing : undefined} shared={shared} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}
