import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
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

/** Comandi per aprire importazione ed esportazione da fuori (es. il menu "Altre azioni"). */
export interface CalendarTransferHandle {
  /** Apre la scelta del file da importare: va chiamato dentro un tocco o un clic. */
  chooseFile: () => void;
  exportFile: () => void;
}

/**
 * Pulsanti Importa/Esporta .ics del calendario (Google, Apple, orario delle lezioni). L'import
 * mostra un'anteprima prima di scrivere: tipo predefinito, abbinamento alle materie, avvisi.
 * Con `buttons={false}` non mostra i pulsanti: si comanda con `ref` (anteprima e avvisi restano qui).
 */
export function CalendarTransfer({ ref, buttons = true }: { ref?: Ref<CalendarTransferHandle>; buttons?: boolean } = {}) {
  const { events, exams, tasks, subjects, importEvents } = useStudyStore();
  const fileInput = useRef<HTMLInputElement>(null);
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
    setError("");
    setResult("File del calendario scaricato: aprilo con Google Calendar o Apple Calendario per aggiungere eventi, esami e scadenze.");
  };

  useImperativeHandle(ref, () => ({ chooseFile: () => fileInput.current?.click(), exportFile: exportIcs }));

  const readFile = async (file?: File) => {
    setError("");
    setResult("");
    if (!file) return;
    if (file.size > MAX_ICS_BYTES) {
      setError("Il file è troppo grande (massimo 5 MB). Esporta un periodo più breve dal tuo calendario e riprova.");
      return;
    }
    let text = "";
    try {
      text = await file.text();
    } catch {
      setError("Non è stato possibile leggere il file. Riprova o scegli un altro file .ics.");
      return;
    }
    const outcome = parseIcs(text);
    if (!outcome.events.length) {
      setError(
        `Nel file non ci sono eventi da importare.${outcome.warnings[0] ? ` ${outcome.warnings[0]}` : ""} Scegli un file .ics esportato da Google Calendar, Apple Calendario o dall'orario delle lezioni.`
      );
      return;
    }
    setParsed({ ...outcome, fileName: file.name });
  };

  const candidates = useMemo(() => selectableSubjects(subjects), [subjects]);
  const preview = useMemo(() => {
    if (!parsed) return null;
    const sorted = [...parsed.events].sort((a, b) => a.start.localeCompare(b.start));
    const matched = parsed.events.filter((event) => matchSubject(event.title, candidates)).length;
    return {
      first: sorted[0]?.start,
      last: sorted[sorted.length - 1]?.start,
      recurring: parsed.events.filter((event) => event.recurrence !== "none").length,
      matched,
      sample: sorted.slice(0, 6)
    };
  }, [parsed, candidates]);

  const confirmImport = async () => {
    if (!parsed) return;
    const payload = parsed.events.map((event) => {
      const subject = matchSubjects ? matchSubject(event.title, candidates) : undefined;
      return {
        title: event.title,
        description: event.description,
        start: event.start,
        end: event.end,
        // Gli eventi VALUE=DATE del file diventano "Tutto il giorno" (prima il flag veniva perso).
        allDay: event.allDay,
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
      added ? `${added} ${added === 1 ? "evento aggiunto" : "eventi aggiunti"}` : "",
      updated ? `${updated} ${updated === 1 ? "evento aggiornato" : "eventi aggiornati"}` : ""
    ].filter(Boolean);
    setResult(
      parts.length
        ? `Fatto: ${parts.join(", ")} nel calendario. Puoi modificarli o eliminarli come gli altri.`
        : "Nessuna novità: gli eventi di questo file erano già tutti nel calendario."
    );
  };

  const input = (
    <input
      ref={fileInput}
      type="file"
      accept=".ics,text/calendar"
      className="sr-only"
      tabIndex={buttons ? undefined : -1}
      aria-hidden={buttons ? undefined : true}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        void readFile(file);
      }}
    />
  );

  return (
    <>
      {buttons ? (
        <>
          <label
            className="motion-safe inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-transparent px-4 text-sm font-extrabold text-[var(--text)] hover:bg-[var(--surface)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)]"
            title="Scegli un file .ics esportato da Google Calendar, Apple Calendario o dall'orario delle lezioni: prima di aggiungere vedrai un'anteprima"
          >
            <Icon name="Import" className="h-4 w-4" />
            <span className="hidden sm:inline">Importa da Google/Apple</span>
            <span className="sr-only sm:hidden">Importa da Google o Apple (file .ics)</span>
            {input}
          </label>
          <Button
            variant="ghost"
            icon="Download"
            onClick={exportIcs}
            title="Scarica eventi, esami e scadenze in un file .ics da aprire in Google Calendar o Apple Calendario"
            aria-label="Esporta il calendario in un file .ics"
          >
            <span className="hidden sm:inline">Esporta</span>
          </Button>
        </>
      ) : (
        input
      )}

      {error || result ? (
        <div
          role="status"
          style={{ bottom: "calc(7rem + env(safe-area-inset-bottom))" }}
          className={`fixed left-1/2 z-50 flex w-[min(92vw,460px)] -translate-x-1/2 items-start gap-2 rounded-[18px] border p-3 text-sm font-bold shadow-soft backdrop-blur-xl sm:!bottom-6 ${
            error ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]" : "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
          }`}
        >
          <p className="min-w-0 flex-1">{error || result}</p>
          <button
            type="button"
            aria-label="Chiudi avviso"
            onClick={() => {
              setError("");
              setResult("");
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-black/10"
          >
            <Icon name="X" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <Drawer
        open={Boolean(parsed)}
        onClose={() => setParsed(null)}
        eyebrow="Importa da Google/Apple"
        title={parsed?.fileName ?? ""}
        width="max-w-[560px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setParsed(null)}>
              Annulla
            </Button>
            <Button variant="primary" icon="Check" onClick={() => void confirmImport()}>
              {parsed?.events.length === 1 ? "Aggiungi 1 evento al calendario" : `Aggiungi ${parsed?.events.length ?? 0} eventi al calendario`}
            </Button>
          </div>
        }
      >
        {parsed && preview ? (
          <div className="grid grid-cols-1 gap-4">
            <p className="text-sm font-bold text-[var(--muted)]">
              Nel file ci sono {parsed.events.length === 1 ? "1 evento" : `${parsed.events.length} eventi`}
              {preview.recurring ? ` (${preview.recurring} si ripetono)` : ""}
              {preview.first ? `, dal ${format(parseISO(preview.first), "d MMM yyyy", { locale: it })}` : ""}
              {preview.last && preview.last !== preview.first ? ` al ${format(parseISO(preview.last), "d MMM yyyy", { locale: it })}` : ""}. Controlla l'anteprima e
              aggiungili al calendario: se importi di nuovo lo stesso file, gli eventi già presenti vengono aggiornati, non duplicati.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Field label="Tipo di evento">
                  <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as EventCategory)}>
                    {(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((id) => (
                      <option key={id} value={id}>
                        {EVENT_CATEGORY_LABEL[id]}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="mt-1 text-xs font-bold text-[var(--muted)]">Usato quando il titolo non fa capire il tipo (es. «Esame», «Laboratorio»).</p>
              </div>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm font-bold">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={matchSubjects} onChange={(event) => setMatchSubjects(event.target.checked)} />
                Collega alle mie materie in base al titolo ({preview.matched} {preview.matched === 1 ? "riconosciuto" : "riconosciuti"})
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
                <li className="px-1.5 text-xs font-bold text-[var(--faint)]">…e altri {parsed.events.length - preview.sample.length}</li>
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
