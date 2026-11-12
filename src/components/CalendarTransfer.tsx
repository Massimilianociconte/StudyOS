import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { format, parseISO } from "date-fns";
import type { EventCategory } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import type { IcsImportedEvent, IcsMergePlan, IcsParseResult } from "../lib/ics";
import { downloadBlob } from "../lib/backup";
import { EVENT_CATEGORY_LABEL } from "../lib/labels";
import { CALENDAR_GUIDE_TEXT as T } from "../lib/labels/calendarGuide";
import { describeRule } from "../lib/repeat";
import { civilDateOf, isValidTimeZone } from "../lib/tz";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "../lib/cloudSyncState";
import { selectableSubjects } from "../lib/selectors";
import {
  GUIDE_DEVICES,
  appsFor,
  detectDevice,
  guideFor,
  importButton,
  isPhone,
  previewSpan,
  previewWarnings,
  previewWhen,
  type GuideApp,
  type GuideDevice,
  type GuideDirection,
  type GuideStep
} from "../lib/calendarGuide";
import { Button, Drawer, Field, inputClass, type PageAction } from "./ui";
import { Icon } from "./Icon";
import { DeviceGlyph, GuideArtView } from "./CalendarGuideArt";

const MAX_ICS_BYTES = 5 * 1024 * 1024;

type IcsModule = typeof import("../lib/ics");
type Stage = "direction" | "device" | "app" | "steps" | "preview" | "result";
const PREVIOUS: Partial<Record<Stage, Stage>> = { device: "direction", app: "device", steps: "app", preview: "steps" };

/** Comandi per aprire la guida da fuori (il menu "Altre azioni" del Calendario). */
export interface CalendarTransferHandle {
  /** Apre la guida; con `direction` salta la prima domanda. */
  open: (direction?: GuideDirection) => void;
}

/** Voce "Importa o esporta" per il menu "Altre azioni". */
export const transferMenuItem = (onClick: () => void): PageAction => ({ label: T.menuItem, icon: "Import", onClick });

const readHints = () => {
  if (typeof navigator === "undefined") return {};
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return { userAgent: navigator.userAgent, platform: data?.platform || navigator.platform, maxTouchPoints: navigator.maxTouchPoints };
};

const ICS_TYPE = "text/calendar";
/** Pausa prima di rifare l'anteprima quando cambia il calendario. */
const PLAN_PAUSE_MS = 500;
const canShareFiles = () => {
  try {
    return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "studyos.ics", { type: ICS_TYPE })] });
  } catch {
    return false;
  }
};

/** Giorno dell'evento (YYYY-MM-DD) nel suo fuso: serve alla frase della regola di ripetizione. */
const civilStart = (event: IcsImportedEvent) =>
  event.allDay ? event.start.slice(0, 10) : civilDateOf(new Date(event.start), isValidTimeZone(event.timeZone) ? event.timeZone : undefined);
const startDate = (event: IcsImportedEvent) => (event.allDay ? parseISO(event.start) : new Date(event.start));

/** Accesso fatto e sincronizzazione attiva: solo allora la guida propone di usare StudyOS dal computer. */
const syncedNow = () => cloudConfigured && Boolean(getCloudSyncState().session);
const useSynced = () => {
  const [synced, setSynced] = useState(syncedNow);
  useEffect(() => subscribeCloudSync(() => setSynced(syncedNow())), []);
  return synced;
};

/**
 * Guida per portare il calendario da StudyOS a un'altra app e viceversa (file .ics): direzione,
 * dispositivo (riconosciuto, si può cambiare), app, passi numerati con il pulsante dentro il passo
 * che lo chiede. L'importazione mostra un'anteprima (regole di ripetizione, avvisi) prima di scrivere.
 */
export function CalendarTransfer({ ref }: { ref?: Ref<CalendarTransferHandle> } = {}) {
  const { events, exams, tasks, subjects, importEvents } = useStudyStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("direction");
  const [direction, setDirection] = useState<GuideDirection>("export");
  const [detected, setDetected] = useState<GuideDevice>("windows");
  const [device, setDevice] = useState<GuideDevice>("windows");
  const [app, setApp] = useState<GuideApp>("outlook");
  const [ics, setIcs] = useState<IcsModule | null>(null);
  const [downloaded, setDownloaded] = useState("");
  const [parsed, setParsed] = useState<(IcsParseResult & { fileName: string }) | null>(null);
  const [category, setCategory] = useState<EventCategory>("lesson");
  const [matchSubjects, setMatchSubjects] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  // La prima schermata mostrata: l'avviso «è una copia, non un collegamento» si legge lì, una volta.
  const [firstStage, setFirstStage] = useState<Stage>("direction");
  // Da dove si è scelto il file (scorciatoia della prima schermata o passi della guida): lì tornano
  // «Indietro» dall'anteprima e «Importa un altro file».
  const [fileFrom, setFileFrom] = useState<Stage>("steps");
  const synced = useSynced();
  const shareable = useMemo(() => (open ? canShareFiles() : false), [open]);

  const reset = () => {
    setStage("direction");
    setDownloaded("");
    setParsed(null);
    setCategory("lesson");
    setMatchSubjects(true);
    setError("");
    setResult("");
    setBusy(false);
    setFirstStage("direction");
    setFileFrom("steps");
  };

  const openGuide = (next?: GuideDirection) => {
    reset();
    const found = detectDevice(readHints());
    setDetected(found);
    setDevice(found);
    setApp(appsFor(found)[0]);
    setDirection(next ?? "export");
    setStage(next ? "device" : "direction");
    setFirstStage(next ? "device" : "direction");
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  useImperativeHandle(ref, () => ({ open: openGuide }));

  // Il modulo dei file .ics si carica all'apertura: download e condivisione partono subito al tocco.
  useEffect(() => {
    if (!open || ics) return;
    let alive = true;
    void import("../lib/ics")
      .then((module) => {
        if (alive) setIcs(module);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, ics]);

  // A ogni passaggio si riparte dall'inizio del pannello, con il titolo della domanda a fuoco.
  useEffect(() => {
    if (!open) return;
    top.current?.scrollIntoView({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [stage]);

  const go = (next: Stage) => {
    setError("");
    setStage(next);
  };

  const fileName = () => `studyos-calendario-${format(new Date(), "yyyy-MM-dd")}.ics`;
  const buildText = (module: IcsModule) =>
    module.buildIcs({ events, exams, tasks, subjects, categoryLabel: (value) => EVENT_CATEGORY_LABEL[value] });

  const download = () => {
    if (!ics) return;
    const name = fileName();
    downloadBlob(name, new Blob([buildText(ics)], { type: `${ICS_TYPE};charset=utf-8` }));
    setDownloaded(name);
  };

  const share = async () => {
    if (!ics) return;
    const name = fileName();
    try {
      await navigator.share({ files: [new File([buildText(ics)], name, { type: ICS_TYPE })], title: name });
      setDownloaded(name);
    } catch {
      // Condivisione annullata: resta il pulsante per scaricare.
    }
  };

  const readFile = async (file?: File) => {
    setError("");
    if (!file) return;
    if (file.size > MAX_ICS_BYTES) {
      setError(T.tooBig);
      return;
    }
    let loaded = ics;
    let text = "";
    try {
      loaded ??= await import("../lib/ics");
      // Byte, non testo: le righe piegate si uniscono prima di leggere l'UTF-8 (una piega può cadere in
      // mezzo a una lettera accentata).
      text = loaded.decodeIcsBytes(new Uint8Array(await file.arrayBuffer()));
    } catch {
      setError(T.unreadable);
      return;
    }
    setIcs(loaded);
    const outcome = loaded.parseIcs(text);
    if (!outcome.events.length) {
      setError(T.empty(outcome.warnings[0]));
      return;
    }
    setParsed({ ...outcome, fileName: file.name });
    setDirection("import");
    go("preview");
  };

  /** «Scegli il file» dalla guida o «Ho già il file» dalla prima schermata. */
  const chooseFile = (from: Stage) => {
    setFileFrom(from);
    fileInput.current?.click();
  };

  const candidates = useMemo(() => selectableSubjects(subjects), [subjects]);
  // Conti veri: la stessa unione dell'importazione, con il calendario di adesso (tipo e materie non li cambiano).
  // Subito per un file nuovo; se cambia il calendario (sincronizzazione, altre schede) si rifà una volta sola,
  // dopo una pausa, non a ogni modifica. L'importazione rifà comunque l'unione sul calendario di quel momento.
  const items = useMemo(() => (parsed && ics ? ics.icsImportItems(parsed.events, { defaultCategory: "lesson" }) : null), [parsed, ics]);
  const [planned, setPlanned] = useState<{ file: IcsParseResult; plan: IcsMergePlan } | null>(null);
  const plannedFile = useRef<IcsParseResult | null>(null);
  useEffect(() => {
    if (!parsed || !ics || !items) return;
    const run = () => {
      let next = 0;
      plannedFile.current = parsed;
      setPlanned({
        file: parsed,
        plan: ics.mergeIcsImport({ events, exams, tasks, items, now: new Date().toISOString(), newId: () => `anteprima-${++next}` })
      });
    };
    if (plannedFile.current !== parsed) {
      run();
      return;
    }
    const timer = window.setTimeout(run, PLAN_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [parsed, ics, items, events, exams, tasks]);
  const plan = planned && planned.file === parsed ? planned.plan : null;
  // `remember`: niente di nuovo, ma importando si scrive l'impronta degli eventi importati con una versione
  // precedente (così le modifiche fatte qui restano dalla prossima volta): il pulsante resta, come «Fatto».
  const button = importButton(plan);
  const nothingNew = button === "nothing" || button === "remember";
  // Prima reimportazione di un calendario importato con una versione precedente: il luogo passa dalla
  // descrizione al campo Luogo, e quegli eventi risultano aggiornati una volta (lo si dice).
  const placeMoved = useMemo(() => {
    if (!plan?.updated) return false;
    const before = new Map(events.map((event) => [event.id, event]));
    return plan.puts.some((put) => {
      const old = before.get(put.id);
      const place = put.location?.trim();
      return Boolean(old && place && !old.location?.trim() && old.description?.includes(place));
    });
  }, [plan, events]);
  const warnings = previewWarnings(parsed ? [...parsed.warnings, ...(plan?.warnings ?? [])] : []);
  const preview = useMemo(() => {
    if (!parsed || !ics) return null;
    const masters = parsed.events.filter((event) => !event.recurrenceId);
    const sorted = [...masters].sort((a, b) => startDate(a).getTime() - startDate(b).getTime());
    // Dal primo inizio all'ultima fine (una gita di più giorni conta fino al suo ultimo giorno).
    const span = previewSpan(masters);
    return {
      count: masters.length,
      changed: parsed.events.length - masters.length,
      recurring: masters.filter((event) => event.repeat).length,
      matched: masters.filter((event) => ics.matchSubject(event.title, candidates)).length,
      from: span.from,
      to: span.to,
      open: span.open === true,
      sample: sorted.slice(0, 6)
    };
  }, [parsed, ics, candidates]);

  const confirmImport = async () => {
    if (!parsed || !ics || busy) return;
    setBusy(true);
    setError("");
    try {
      // Serie, date escluse, giorni modificati e promemoria passano così come sono nel file.
      const payload = ics.icsImportItems(parsed.events, { defaultCategory: category, subjects: candidates, matchSubjects });
      const { added, updated } = await importEvents(payload);
      // Niente di nuovo da dire (solo l'impronta dei vecchi import): un solo «Fatto», si chiude.
      if (button === "remember") {
        close();
        return;
      }
      setResult(T.result(added, updated));
      setParsed(null);
      go("result");
    } catch {
      setError(T.importFailed);
    } finally {
      setBusy(false);
    }
  };

  const guide = guideFor(direction, device, app, { synced });
  const previous = stage === "preview" ? fileFrom : PREVIOUS[stage];

  const stepAction = (item: GuideStep) => {
    if (item.action === "download")
      return (
        <div className="mt-3 grid grid-cols-1 gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="Download" onClick={download} disabled={!ics}>
              {ics ? T.download : T.loading}
            </Button>
            {shareable && isPhone(detected) ? (
              <Button variant="soft" icon="Share2" onClick={() => void share()} disabled={!ics}>
                {T.share}
              </Button>
            ) : null}
          </div>
          {downloaded ? (
            <p role="status" className="flex items-start gap-1.5 text-xs font-bold text-[var(--success-text)]">
              <Icon name="Check" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{T.downloaded(downloaded)}</span>
            </p>
          ) : null}
        </div>
      );
    if (item.action === "chooseFile")
      return (
        <div className="mt-3 grid grid-cols-1 gap-2">
          <div>
            <Button variant="primary" icon="Import" onClick={() => chooseFile("steps")}>
              {T.chooseFile}
            </Button>
          </div>
          {error ? <Alert>{error}</Alert> : null}
        </div>
      );
    return null;
  };

  const choice = (selected: boolean) =>
    `motion-safe flex min-h-11 w-full items-center gap-3 rounded-[18px] border p-3 text-left transition-colors hover:bg-[var(--surface-strong)] ${
      selected ? "border-[var(--accent)] bg-[var(--surface-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
    }`;

  const question = (text: ReactNode, sub?: ReactNode) => (
    <div className="grid grid-cols-1 gap-1">
      <h3 ref={heading} tabIndex={-1} className="break-words text-base font-black outline-none">
        {text}
      </h3>
      {sub ? <p className="text-sm font-bold text-[var(--muted)]">{sub}</p> : null}
    </div>
  );

  let body: ReactNode = null;
  if (stage === "direction")
    body = (
      <>
        {question(T.directionQuestion)}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["export", "import"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`${choice(false)} sm:flex-col sm:items-start`}
              onClick={() => {
                setDirection(id);
                go("device");
              }}
            >
              <span className="grid h-10 w-10 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--accent-ink)]">
                <Icon name={id === "export" ? "Send" : "Import"} className="h-5 w-5" />
              </span>
              <span className="grid min-w-0 grid-cols-1 gap-0.5">
                <span className="text-sm font-black">{T.direction[id].title}</span>
                <span className="text-xs font-bold text-[var(--muted)]">{T.direction[id].text}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] p-3">
          <p className="text-xs font-black uppercase text-[var(--faint)]">{T.shortcutsTitle}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" icon="Download" onClick={download} disabled={!ics}>
              {ics ? T.shortcutDownload : T.loading}
            </Button>
            <Button variant="soft" icon="Import" onClick={() => chooseFile("direction")}>
              {T.shortcutChooseFile}
            </Button>
          </div>
          {downloaded ? (
            <p role="status" className="flex items-start gap-1.5 text-xs font-bold text-[var(--success-text)]">
              <Icon name="Check" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{T.downloadedShortcut(downloaded)}</span>
            </p>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
        </div>
      </>
    );
  else if (stage === "device")
    body = (
      <>
        {question(T.deviceQuestion, T.direction[direction].title)}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GUIDE_DEVICES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === device}
              className={choice(id === device)}
              onClick={() => {
                if (id !== device) setApp(appsFor(id)[0]);
                setDevice(id);
                go("app");
              }}
            >
              <DeviceGlyph device={id} className="h-9 w-9 shrink-0 text-[var(--text)]" />
              <span className="min-w-0 flex-1 text-sm font-black">{T.device[id]}</span>
              {id === detected ? (
                <span className="shrink-0 rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] font-black text-[var(--accent-ink)]">{T.thisDevice}</span>
              ) : null}
            </button>
          ))}
        </div>
      </>
    );
  else if (stage === "app")
    body = (
      <>
        {question(T.appQuestion, T.device[device])}
        <div className="grid grid-cols-1 gap-2">
          {appsFor(device).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === app}
              className={choice(id === app)}
              onClick={() => {
                setApp(id);
                go("steps");
              }}
            >
              <span className="grid h-9 w-9 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)]">
                <Icon name="CalendarDays" className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-black">{T.app[id]}</span>
              <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            </button>
          ))}
        </div>
        <p className="text-xs font-bold text-[var(--muted)]">{T.otherApp}</p>
      </>
    );
  else if (stage === "steps")
    body = (
      <>
        {question(
          T.route(direction, T.app[app], T.device[device]),
          guide.kind === "steps" && guide.needsComputer ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2.5 py-0.5 text-xs font-black text-[var(--warning-text)]">
              <DeviceGlyph device="windows" className="h-4 w-4" />
              {T.needsComputer}
            </span>
          ) : undefined
        )}
        {guide.kind === "redirect" ? (
          <div className="grid grid-cols-1 gap-3 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4 text-[var(--warning-text)]">
            <p className="flex items-center gap-2 text-sm font-black">
              <Icon name="AlertTriangle" className="h-4 w-4 shrink-0" />
              {T.redirectTitle}
            </p>
            <p className="text-sm font-bold">{guide.reason}</p>
            <button
              type="button"
              className="motion-safe inline-flex min-h-11 items-center gap-2 justify-self-start rounded-full bg-[var(--accent)] px-4 py-2 text-left text-sm font-extrabold text-[#10131d] shadow-lift hover:scale-[1.02]"
              onClick={() => {
                setDevice(guide.to.device);
                setApp(guide.to.app);
                setError("");
                // Stesso passo, nuova guida: il pulsante sparisce, il fuoco va al titolo (resta nel pannello).
                top.current?.scrollIntoView({ block: "start" });
                heading.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name="ChevronRight" className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{T.redirectButton(T.app[guide.to.app], T.device[guide.to.device])}</span>
            </button>
          </div>
        ) : (
          <ol className="grid grid-cols-1 gap-3">
            {guide.steps.map((item, index) => (
              <li key={item.text} className="grid grid-cols-1 gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-[minmax(0,1fr)_168px] sm:items-start">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-8 w-8 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-sm font-black tabular-nums" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-start gap-2 text-sm font-bold leading-relaxed">
                      <Icon name={item.icon} className="mt-1 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                      <span className="min-w-0 break-words">{item.text}</span>
                    </p>
                    {stepAction(item)}
                  </div>
                </div>
                {item.art ? (
                  <GuideArtView art={item.art} app={app} device={device} className="mx-auto h-auto w-full max-w-[200px] sm:max-w-none" />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </>
    );
  else if (stage === "preview" && parsed && preview)
    body = (
      <>
        {question(parsed.fileName, `${T.previewSummary(preview.count, preview.recurring, preview.changed)} ${preview.from ? T.previewRange(preview.from, preview.to, preview.open) : ""}`)}
        <p className="text-xs font-bold text-[var(--muted)]">{nothingNew ? T.nothingNewHint : T.previewNoDuplicates}</p>
        {/* La modifica fatta a mano vince sul file: lo si dice, invece di lasciar credere che il file non dica niente. */}
        {plan?.editsKept ? <p className="text-xs font-bold text-[var(--muted)]">{T.previewKeptEdits(plan.editsKept)}</p> : null}
        {placeMoved ? <p className="text-xs font-bold text-[var(--muted)]">{T.previewPlaceMoved}</p> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Field label={T.categoryLabel}>
              <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as EventCategory)}>
                {(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((id) => (
                  <option key={id} value={id}>
                    {EVENT_CATEGORY_LABEL[id]}
                  </option>
                ))}
              </select>
            </Field>
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">{T.categoryHint}</p>
          </div>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm font-bold">
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" checked={matchSubjects} onChange={(event) => setMatchSubjects(event.target.checked)} />
            {T.matchSubjects(preview.matched)}
          </label>
        </div>
        <ul className="grid grid-cols-1 gap-1 rounded-[18px] bg-[var(--surface-soft)] p-2">
          {preview.sample.map((event, index) => (
            <li key={`${event.uid ?? event.title}-${index}`} className="grid min-w-0 grid-cols-1 gap-0.5 px-1.5 py-1 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs font-black tabular-nums text-[var(--muted)]">
                  {previewWhen(event)}
                </span>
                <span className="one-line-safe min-w-0 flex-1 font-bold">{event.title}</span>
              </span>
              {event.repeat ? (
                <span className="flex min-w-0 items-start gap-1 text-xs font-black text-[var(--accent-ink)]">
                  <Icon name="RefreshCw" className="mt-px h-3 w-3 shrink-0" />
                  <span className="min-w-0 break-words">{describeRule(event.repeat, civilStart(event))}</span>
                </span>
              ) : null}
            </li>
          ))}
          {preview.count > preview.sample.length ? <li className="px-1.5 text-xs font-bold text-[var(--faint)]">{T.previewMore(preview.count - preview.sample.length)}</li> : null}
        </ul>
        {warnings.shown.length ? (
          <div className="grid grid-cols-1 gap-1.5 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-[var(--warning-text)]">
            <p className="flex items-center gap-1.5 text-xs font-black">
              <Icon name="AlertTriangle" className="h-3.5 w-3.5 shrink-0" />
              {T.warningsTitle}
            </p>
            <ul className="grid grid-cols-1 gap-1 text-xs font-bold">
              {warnings.shown.map((warning) => (
                <li key={warning} className="break-words">
                  {warning}
                </li>
              ))}
              {warnings.more ? <li className="break-words">{T.moreWarnings(warnings.more)}</li> : null}
            </ul>
          </div>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
      </>
    );
  else if (stage === "result")
    body = (
      <>
        {question(T.resultTitle)}
        <p role="status" className="flex items-start gap-2 rounded-[18px] border border-[var(--success-border)] bg-[var(--success-bg)] p-4 text-sm font-bold text-[var(--success-text)]">
          <Icon name="CheckCheck" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{result}</span>
        </p>
      </>
    );

  const footer =
    stage === "direction" ? undefined : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {previous ? (
          <Button variant="ghost" icon="ChevronLeft" onClick={() => go(previous)}>
            {T.back}
          </Button>
        ) : stage === "result" ? (
          <Button variant="ghost" icon="Import" onClick={() => go(fileFrom)}>
            {T.importAnother}
          </Button>
        ) : (
          <span />
        )}
        {stage === "preview" && preview ? (
          <Button variant="primary" icon="Check" onClick={() => void confirmImport()} disabled={busy || button === "loading" || button === "nothing"}>
            {button === "nothing" ? T.nothingNew : button === "remember" ? T.done : plan ? T.apply(plan.added, plan.updated) : T.loading}
          </Button>
        ) : stage === "steps" || stage === "result" ? (
          <Button variant={stage === "result" ? "primary" : "soft"} icon="Check" onClick={close}>
            {T.done}
          </Button>
        ) : null}
      </div>
    );

  return (
    <Drawer open={open} onClose={close} eyebrow={T.eyebrow} title={T.title} width="max-w-[600px]" footer={footer}>
      <div ref={top} className="grid scroll-mt-4 grid-cols-1 gap-4">
        {stage === firstStage ? (
          <p className="flex items-start gap-2 rounded-[14px] bg-[var(--surface-soft)] p-3 text-xs font-bold text-[var(--muted)]">
            <Icon name="Info" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{T.honesty}</span>
          </p>
        ) : null}
        {body}
        <input
          ref={fileInput}
          type="file"
          accept=".ics,text/calendar"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void readFile(file);
          }}
        />
      </div>
    </Drawer>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-[14px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs font-bold text-[var(--danger-text)]">
      <Icon name="AlertTriangle" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
