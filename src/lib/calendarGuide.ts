/**
 * Guida a importazione ed esportazione del calendario (file .ics): quale dispositivo si sta usando,
 * quali app hanno senso lì e i passi per ogni combinazione. Dove una combinazione non si può fare da
 * quel dispositivo, un rimando spiega perché e indica la strada che funziona. Solo dati e logica:
 * i testi sono in labels.ts, i disegni in components/CalendarGuideArt.
 */
import { CALENDAR_GUIDE_REDIRECT, CALENDAR_GUIDE_STEPS } from "./labels/calendarGuide";
import { MONTH_NAME } from "./labels";
import { civilAddDays, civilDateOf, isCivilDate, utcToZonedParts } from "./tz";

export type GuideDevice = "samsung" | "android" | "ios" | "windows" | "macos";
export type GuideApp = "google" | "apple" | "samsung" | "outlook";
/** `export`: da StudyOS a un'altra app; `import`: da un'altra app a StudyOS. */
export type GuideDirection = "export" | "import";

export const GUIDE_DEVICES: readonly GuideDevice[] = ["samsung", "android", "ios", "windows", "macos"];
export const GUIDE_APPS: readonly GuideApp[] = ["google", "apple", "samsung", "outlook"];

/** Disegni dei passi (components/CalendarGuideArt), nello stile del dispositivo e dell'app. */
export type GuideArt =
  | "download"
  | "transfer"
  | "phoneFiles"
  | "phonePreview"
  | "phoneMenu"
  | "webSettings"
  | "webPanel"
  | "zip"
  | "desktopMenu"
  | "desktopPreview"
  | "choose";

/** Pulsante dentro il passo: scaricare il file di StudyOS o scegliere quello dell'altra app. */
export type GuideAction = "download" | "chooseFile";

export interface GuideStep {
  text: string;
  /** Nome di un'icona di components/Icon. */
  icon: string;
  art?: GuideArt;
  action?: GuideAction;
}

export type Guide =
  | { kind: "steps"; steps: GuideStep[]; needsComputer: boolean }
  | { kind: "redirect"; reason: string; to: { device: GuideDevice; app: GuideApp } };

export interface DeviceHints {
  userAgent?: string;
  /** `navigator.userAgentData.platform` se c'è, altrimenti `navigator.platform`. */
  platform?: string;
  maxTouchPoints?: number;
}

/**
 * Dispositivo dal browser. iPadOS si presenta come un Mac: lo distingue lo schermo touch. Samsung si
 * riconosce da Samsung Internet o dal modello ("SM-…"); Chrome su Samsung spesso nasconde il modello
 * e risulta un Android qualsiasi (si cambia a mano). Linux, Chromebook e casi ignoti: un computer.
 */
export const detectDevice = ({ userAgent = "", platform = "", maxTouchPoints = 0 }: DeviceHints = {}): GuideDevice => {
  const os = platform.toLowerCase();
  if (/SamsungBrowser|\bSM-[A-Z0-9]/i.test(userAgent)) return "samsung";
  if (/iPhone|iPad|iPod/.test(userAgent) || /^(iphone|ipad|ipod|ios)/.test(os)) return "ios";
  const mac = /Macintosh|Mac OS X/.test(userAgent) || os.startsWith("mac");
  if (mac && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent) || os === "android") return "android";
  if (/Windows/i.test(userAgent) || os.startsWith("win")) return "windows";
  if (mac) return "macos";
  return "windows";
};

const APPS: Record<GuideDevice, GuideApp[]> = {
  samsung: ["samsung", "google", "outlook"],
  android: ["google", "outlook"],
  ios: ["apple", "google", "outlook"],
  windows: ["outlook", "google"],
  macos: ["apple", "google", "outlook"]
};

/** Le app che hanno senso sul dispositivo, la sua per prima. */
export const appsFor = (device: GuideDevice): GuideApp[] => [...APPS[device]];

const PHONES: readonly GuideDevice[] = ["samsung", "android", "ios"];
export const isPhone = (device: GuideDevice) => PHONES.includes(device);

type StepId = keyof typeof CALENDAR_GUIDE_STEPS;
const step = (id: StepId, icon: string, art?: GuideArt, action?: GuideAction): GuideStep => ({
  text: CALENDAR_GUIDE_STEPS[id],
  icon,
  ...(art ? { art } : {}),
  ...(action ? { action } : {})
});

const steps = (needsComputer: boolean, ...list: GuideStep[]): Guide => ({ kind: "steps", steps: list, needsComputer });
const redirect = (reason: string, device: GuideDevice, app: GuideApp): Guide => ({ kind: "redirect", reason, to: { device, app } });

// --- Da StudyOS a un'altra app ---

const exportGuide = (device: GuideDevice, app: GuideApp, synced: boolean): Guide => {
  const phone = isPhone(device);
  if (app === "apple" && device !== "ios" && device !== "macos") return redirect(CALENDAR_GUIDE_REDIRECT.appleOnlyApple, "ios", "apple");
  if (app === "samsung" && device !== "samsung") return redirect(CALENDAR_GUIDE_REDIRECT.samsungOnlySamsung, "samsung", "samsung");
  const toComputer = step(synced ? "downloadToComputerSynced" : "downloadToComputer", "Download", "transfer", "download");
  const download = step("download", "Download", "download", "download");
  // Ultimo passo di ogni esportazione: come ripartire puliti, e perché (una nuova importazione non toglie).
  const startClean = step("startClean", "RotateCcw");
  if (app === "google") {
    const import_ = step("googleImport", "Upload", "webPanel");
    const onPhone = step("googleOnPhone", "Check");
    const ownCalendar = step("googleOwnCalendar", "CalendarPlus");
    if (phone) return steps(true, toComputer, ownCalendar, step("googleOnComputer", "Globe", "webSettings"), import_, onPhone, startClean);
    return steps(false, download, ownCalendar, step("googleSettings", "Settings", "webSettings"), import_, onPhone, startClean);
  }
  if (app === "outlook") {
    if (phone) return steps(true, toComputer, step("outlookOnComputer", "Globe", "webPanel"), step("outlookOnPhone", "Check"), startClean);
    if (device === "windows")
      return steps(false, download, step("outlookClassicImport", "FileText", "desktopMenu"), step("outlookWebImport", "Globe", "webPanel"), startClean);
    return steps(false, download, step("outlookWebImport", "Globe", "webPanel"), step("outlookOnPhone", "Check"), startClean);
  }
  if (app === "apple") {
    if (device === "ios")
      return steps(
        false,
        step("downloadIos", "Download", "download", "download"),
        step("iosOpenFile", "FileText", "phoneFiles"),
        step("iosAddAll", "CalendarPlus", "phonePreview"),
        startClean
      );
    return steps(false, download, step("macOpen", "FileText", "desktopMenu"), step("macPick", "CalendarPlus", "desktopPreview"), startClean);
  }
  // Calendario Samsung, dal telefono Samsung: solo strade verificate (aprire il file da «Archivio», o Google).
  return steps(
    false,
    step("downloadPhone", "Download", "download", "download"),
    step("samsungOpenFile", "FileText", "phoneFiles"),
    step("samsungSave", "CalendarPlus", "phonePreview"),
    step("samsungViaGoogle", "Globe"),
    startClean
  );
};

// --- Da un'altra app a StudyOS ---

const importGuide = (device: GuideDevice, app: GuideApp, synced: boolean): Guide => {
  const phone = isPhone(device);
  if (app === "apple") {
    if (device === "macos")
      return steps(false, step("macSelect", "CalendarDays", "desktopPreview"), step("macExport", "Download", "desktopMenu"), step("chooseFile", "Import", "choose", "chooseFile"));
    return redirect(device === "ios" ? CALENDAR_GUIDE_REDIRECT.appleIosNoFile : CALENDAR_GUIDE_REDIRECT.appleOnlyMac, "macos", "apple");
  }
  // Il Calendario Samsung non salva file (nessuna voce verificabile): gli eventi di un account Google
  // collegato al telefono si esportano da Google, sul dispositivo scelto.
  if (app === "samsung") return redirect(CALENDAR_GUIDE_REDIRECT.samsungNoFile, device, "google");
  if (app === "outlook") {
    if (device !== "windows") return redirect(CALENDAR_GUIDE_REDIRECT.outlookOnlyWindows, "windows", "outlook");
    return steps(false, step("outlookSave", "Download", "desktopMenu"), step("outlookNoFile", "Info"), step("chooseFile", "Import", "choose", "chooseFile"));
  }
  // Google Calendar: l'esportazione c'è solo sul sito, da computer.
  const export_ = step("googleExport", "Download", "webPanel");
  const unzip = step("unzip", "Archive", "zip");
  if (phone) return steps(true, step("googleOnComputer", "Globe", "webSettings"), export_, unzip, step(synced ? "chooseFileFromComputerSynced" : "chooseFileFromComputer", "Import", "transfer", "chooseFile"));
  return steps(false, step("googleSettings", "Settings", "webSettings"), export_, unzip, step("chooseFile", "Import", "choose", "chooseFile"));
};

export interface GuideOptions {
  /** Accesso fatto e sincronizzazione attiva: StudyOS sul computer ha gli stessi dati (lo si può proporre). */
  synced?: boolean;
}

/** Passi per portare il calendario da StudyOS a `app` (o viceversa) su `device`, oppure dove farlo. */
export const guideFor = (direction: GuideDirection, device: GuideDevice, app: GuideApp, options: GuideOptions = {}): Guide =>
  direction === "export" ? exportGuide(device, app, options.synced === true) : importGuide(device, app, options.synced === true);

/** Avvisi mostrati nell'anteprima dell'importazione: oltre, si dice solo quanti ne restano. */
export const MAX_SHOWN_WARNINGS = 20;

/** Avvisi dell'anteprima senza doppioni, al più `max`; `more`: quanti restano fuori. */
export const previewWarnings = (warnings: readonly string[], max = MAX_SHOWN_WARNINGS) => {
  const unique = [...new Set(warnings)];
  return { shown: unique.slice(0, max), more: Math.max(0, unique.length - max) };
};

/**
 * Il pulsante dell'anteprima. `import`: ci sono eventi da aggiungere, aggiornare o togliere; `remember`:
 * niente di nuovo, ma l'importazione scrive l'impronta di eventi importati con una versione precedente
 * (così da qui in poi le modifiche fatte qui restano); `nothing`: niente da fare; `loading`: conti in corso.
 */
export const importButton = (plan: { added: number; updated: number; puts: readonly unknown[]; deletes: readonly unknown[] } | null) => {
  if (!plan) return "loading" as const;
  if (plan.added || plan.updated || plan.deletes.length) return "import" as const;
  return plan.puts.length ? ("remember" as const) : ("nothing" as const);
};

interface PreviewItem {
  start: string;
  end: string;
  allDay: boolean;
}

const pad2 = (value: number) => String(value).padStart(2, "0");
const monthShort = (month: number) => MONTH_NAME[month - 1]?.slice(0, 3) ?? "";
const dayParts = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};

/** Primo e ultimo giorno (YYYY-MM-DD) di un elemento: tutto il giorno con la fine esclusa; gli orari nel fuso `zone`. */
const previewDays = (item: PreviewItem, zone?: string) => {
  if (item.allDay) {
    const first = item.start.slice(0, 10);
    const end = item.end.slice(0, 10);
    return { first, last: isCivilDate(end) && end > first ? civilAddDays(end, -1) : first };
  }
  const startMs = Date.parse(item.start);
  const endMs = Date.parse(item.end);
  const first = civilDateOf(startMs, zone);
  // Finire a mezzanotte non occupa il giorno dopo.
  const last = endMs > startMs ? civilDateOf(endMs - 1, zone) : first;
  return { first, last: last > first ? last : first };
};

/** «7 dic», «7–10 dic», «30 nov – 1 dic», «28 dic 2026 – 2 gen 2027»; con l'ora nel fuso `zone` («25 nov 15:00»). */
export const previewWhen = (item: PreviewItem, zone?: string) => {
  if (!item.allDay) {
    const parts = utcToZonedParts(Date.parse(item.start), zone);
    return `${parts.day} ${monthShort(parts.month)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
  }
  const { first, last } = previewDays(item, zone);
  const a = dayParts(first);
  const b = dayParts(last);
  if (first === last) return `${a.day} ${monthShort(a.month)}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${monthShort(a.month)}`;
  if (a.year === b.year || b.year - a.year === 1) return `${a.day} ${monthShort(a.month)} – ${b.day} ${monthShort(b.month)}`;
  return `${a.day} ${monthShort(a.month)} ${a.year} – ${b.day} ${monthShort(b.month)} ${b.year}`;
};

/** Periodo coperto dagli elementi, dal primo inizio all'ultima fine (non all'ultimo inizio): «7 dic 2026». */
export const previewSpan = (items: readonly PreviewItem[], zone?: string): { from: string; to?: string } => {
  let first = "";
  let last = "";
  for (const item of items) {
    const days = previewDays(item, zone);
    if (!isCivilDate(days.first)) continue;
    if (!first || days.first < first) first = days.first;
    if (!last || days.last > last) last = days.last;
  }
  const long = (date: string) => {
    const { year, month, day } = dayParts(date);
    return `${day} ${monthShort(month)} ${year}`;
  };
  if (!first) return { from: "" };
  return last > first ? { from: long(first), to: long(last) } : { from: long(first) };
};
