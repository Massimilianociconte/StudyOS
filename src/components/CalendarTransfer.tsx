import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { EventCategory } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { buildIcs, guessCategory, matchSubject, parseIcs, type IcsParseResult } from "../lib/ics";
import { downloadBlob } from "../lib/backup";
import { EVENT_CATEGORY_LABEL } from "../lib/labels";
import { RECURRENCE_LABEL } from "../lib/recurrence";
import { selectableSubjects } from "../lib/selectors";
import { Button, Drawer, Field, inputClass } from "./ui";
import { Icon } from "./Icon";

const MAX_ICS_BYTES = 5 * 1024 * 1024;

/**
 * Pulsanti Importa/Esporta .ics del calendario. L'import mostra un'anteprima prima di
 * scrivere: categoria predefinita, abbinamento automatico alle materie, avvisi del parser.
 */
export function CalendarTransfer() {
  const { events, exams, tasks, subjects, importEvents } = useStudyStore();
  const [parsed, setParsed] = useState<(IcsParseResult & { fileName: string }) | null>(null);
  const [category, setCategory] = useState<EventCategory>("lesson");
  const [matchSubjects, setMatchSubjects] = useState(true);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  // Esito dell'import/export come avviso temporaneo (la barra del titolo non ha spazio per il testo).
  useEffect(() => {
    if (!result && !error) return;
    const timer = window.setTimeout(() => {
      setResult("");
      setError("");
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [result, error]);

  const exportIcs = () => {
    const text = buildIcs({ events, exams, tasks, subjects, categoryLabel: (value) => EVENT_CATEGORY_LABEL[value] });
    downloadBlob(`studyos-calendario-${format(new Date(), "yyyy-MM-dd")}.ics`, new Blob([text], { type: "text/calendar;charset=utf-8" }));
  };

  const readFile = async (file?: File) => {
    setError("");
    setResult("");
    if (!file) return;
    if (file.size > MAX_ICS_BYTES) {
      setError("File troppo grande (massimo 5 MB).");
      return;
    }
    const outcome = parseIcs(await file.text());
    if (!outcome.events.length) {
      setError(outcome.warnings[0] ?? "Nessun evento trovato nel file.");
      return;
    }
    setParsed({ ...outcome, fileName: file.name });
  };

  const candidates = useMemo(() => selectableSubjects(subjects), [subjects]);
  const preview = useMemo(() => {
    if (!parsed) return null;
    const sorted = [...parsed.events].sort((a, b) => a.start.localeCompare(b.start));
    const matched = matchSubjects ? parsed.events.filter((event) => matchSubject(event.title, candidates)).length : 0;
    return {
      first: sorted[0]?.start,
      last: sorted[sorted.length - 1]?.start,
      recurring: parsed.events.filter((event) => event.recurrence !== "none").length,
      matched,
      sample: sorted.slice(0, 6)
    };
  }, [parsed, matchSubjects, candidates]);

  const confirmImport = async () => {
    if (!parsed) return;
    const payload = parsed.events.map((event) => {
      const subject = matchSubjects ? matchSubject(event.title, candidates) : undefined;
      return {
        title: event.title,
        description: event.description,
        start: event.start,
        end: event.end,
        recurrence: event.recurrence,
        recurrenceUntil: event.recurrenceUntil,
        category: guessCategory(event.title, category),
        subjectId: subject?.id,
        color: subject?.color,
        sourceUid: event.uid
      };
    });
    const { added, updated } = await importEvents(payload);
    setParsed(null);
    const parts = [
      added ? `${added} ${added === 1 ? "evento importato" : "eventi importati"}` : "",
      updated ? `${updated} ${updated === 1 ? "evento aggiornato" : "eventi aggiornati"}` : ""
    ].filter(Boolean);
    setResult(`${parts.join(", ") || "Nessuna modifica"}. Gli eventi importati si modificano come gli altri.`);
  };

  return (
    <>
      <label
        className="motion-safe inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold hover:bg-[var(--surface)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)]"
        title="Importa un calendario .ics (orario delle lezioni, Google Calendar, Apple Calendario)"
      >
        <Icon name="Import" className="h-4 w-4" />
        <span className="hidden sm:inline">Importa</span>
        <span className="sr-only sm:hidden">Importa calendario .ics</span>
        <input
          type="file"
          accept=".ics,text/calendar"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void readFile(file);
          }}
        />
      </label>
      <Button variant="soft" icon="Download" onClick={exportIcs} title="Esporta eventi, esami e scadenze in un file .ics" aria-label="Esporta calendario .ics">
        <span className="hidden sm:inline">Esporta</span>
      </Button>

      {error || result ? (
        <p
          role="status"
          style={{ bottom: "calc(7rem + env(safe-area-inset-bottom))" }}
          className={`fixed left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 rounded-[18px] border p-3 text-sm font-bold shadow-soft backdrop-blur-xl sm:!bottom-6 ${
            error ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]" : "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
          }`}
        >
          {error || result}
        </p>
      ) : null}

      <Drawer
        open={Boolean(parsed)}
        onClose={() => setParsed(null)}
        eyebrow="Importa calendario"
        title={parsed?.fileName ?? ""}
        width="max-w-[560px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setParsed(null)}>
              Annulla
            </Button>
            <Button variant="primary" icon="Check" onClick={() => void confirmImport()}>
              Importa {parsed?.events.length ?? 0} eventi
            </Button>
          </div>
        }
      >
        {parsed && preview ? (
          <div className="grid grid-cols-1 gap-4">
            <p className="text-sm font-bold text-[var(--muted)]">
              {parsed.events.length} eventi{preview.recurring ? `, di cui ${preview.recurring} ripetuti` : ""}
              {preview.first ? ` · dal ${format(parseISO(preview.first), "d MMM yyyy", { locale: it })}` : ""}
              {preview.last && preview.last !== preview.first ? ` al ${format(parseISO(preview.last), "d MMM yyyy", { locale: it })}` : ""}. Reimportando lo stesso
              file gli eventi vengono aggiornati, non duplicati.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Categoria predefinita">
                <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as EventCategory)}>
                  {(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((id) => (
                    <option key={id} value={id}>
                      {EVENT_CATEGORY_LABEL[id]}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm font-bold">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={matchSubjects} onChange={(event) => setMatchSubjects(event.target.checked)} />
                Collega alle materie ({preview.matched} trovate)
              </label>
            </div>
            <ul className="grid grid-cols-1 gap-1 rounded-[18px] bg-[var(--surface-soft)] p-2">
              {preview.sample.map((event, index) => (
                <li key={`${event.uid ?? event.title}-${index}`} className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm">
                  <span className="shrink-0 text-xs font-black tabular-nums text-[var(--muted)]">
                    {format(parseISO(event.start), event.allDay ? "d MMM" : "d MMM HH:mm", { locale: it })}
                  </span>
                  <span className="one-line-safe min-w-0 flex-1 font-bold">{event.title}</span>
                  {event.recurrence !== "none" ? <span className="shrink-0 text-[11px] font-black text-[var(--accent-ink)]">{RECURRENCE_LABEL[event.recurrence]}</span> : null}
                </li>
              ))}
              {parsed.events.length > preview.sample.length ? (
                <li className="px-1.5 text-xs font-bold text-[var(--faint)]">e altri {parsed.events.length - preview.sample.length}</li>
              ) : null}
            </ul>
            {parsed.warnings.length ? (
              <ul className="grid grid-cols-1 gap-1 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs font-bold text-[var(--warning-text)]">
                {parsed.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
