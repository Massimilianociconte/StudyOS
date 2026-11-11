/**
 * Guida a importazione ed esportazione del calendario (file .ics): quale dispositivo si sta usando,
 * quali app hanno senso lì e i passi per ogni combinazione. Dove una combinazione non si può fare da
 * quel dispositivo, un rimando spiega perché e indica la strada che funziona. Solo dati e logica:
 * i testi sono in labels.ts, i disegni in components/CalendarGuideArt.
 */
import { CALENDAR_GUIDE_REDIRECT, CALENDAR_GUIDE_STEPS } from "./labels";

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

const exportGuide = (device: GuideDevice, app: GuideApp): Guide => {
  const phone = isPhone(device);
  if (app === "apple" && device !== "ios" && device !== "macos") return redirect(CALENDAR_GUIDE_REDIRECT.appleOnlyApple, "ios", "apple");
  if (app === "samsung" && device !== "samsung") return redirect(CALENDAR_GUIDE_REDIRECT.samsungOnlySamsung, "samsung", "samsung");
  const toComputer = step("downloadToComputer", "Download", "transfer", "download");
  const download = step("download", "Download", "download", "download");
  if (app === "google") {
    const import_ = step("googleImport", "Upload", "webPanel");
    const onPhone = step("googleOnPhone", "Check");
    if (phone) return steps(true, toComputer, step("googleOnComputer", "Globe", "webSettings"), import_, onPhone);
    return steps(false, download, step("googleOwnCalendar", "CalendarPlus"), step("googleSettings", "Settings", "webSettings"), import_, onPhone);
  }
  if (app === "outlook") {
    if (phone) return steps(true, toComputer, step("outlookOnComputer", "Globe", "webPanel"), step("outlookOnPhone", "Check"));
    if (device === "windows")
      return steps(false, download, step("outlookClassicImport", "FileText", "desktopMenu"), step("outlookWebImport", "Globe", "webPanel"));
    return steps(false, download, step("outlookWebImport", "Globe", "webPanel"), step("outlookOnPhone", "Check"));
  }
  if (app === "apple") {
    if (device === "ios")
      return steps(false, step("downloadIos", "Download", "download", "download"), step("iosOpenFile", "FileText", "phoneFiles"), step("iosAddAll", "CalendarPlus", "phonePreview"));
    return steps(false, download, step("macOpen", "FileText", "desktopMenu"), step("macPick", "CalendarPlus", "desktopPreview"));
  }
  // Calendario Samsung, dal telefono Samsung.
  return steps(
    false,
    step("downloadPhone", "Download", "download", "download"),
    step("samsungOpenFile", "FileText", "phoneFiles"),
    step("samsungSave", "CalendarPlus", "phonePreview"),
    step("samsungMenu", "Menu", "phoneMenu")
  );
};

// --- Da un'altra app a StudyOS ---

const importGuide = (device: GuideDevice, app: GuideApp): Guide => {
  const phone = isPhone(device);
  if (app === "apple") {
    if (device === "macos")
      return steps(false, step("macSelect", "CalendarDays", "desktopPreview"), step("macExport", "Download", "desktopMenu"), step("chooseFile", "Import", "choose", "chooseFile"));
    return redirect(device === "ios" ? CALENDAR_GUIDE_REDIRECT.appleIosNoFile : CALENDAR_GUIDE_REDIRECT.appleOnlyMac, "macos", "apple");
  }
  if (app === "samsung") {
    if (device !== "samsung") return redirect(CALENDAR_GUIDE_REDIRECT.samsungOnlySamsung, "samsung", "samsung");
    return steps(false, step("samsungExport", "Menu", "phoneMenu"), step("samsungGoogle", "Globe"), step("chooseFilePhone", "Import", "choose", "chooseFile"));
  }
  if (app === "outlook") {
    if (device !== "windows") return redirect(CALENDAR_GUIDE_REDIRECT.outlookOnlyWindows, "windows", "outlook");
    return steps(false, step("outlookSave", "Download", "desktopMenu"), step("outlookNoFile", "Info"), step("chooseFile", "Import", "choose", "chooseFile"));
  }
  // Google Calendar: l'esportazione c'è solo sul sito, da computer.
  const export_ = step("googleExport", "Download", "webPanel");
  const unzip = step("unzip", "Archive", "zip");
  if (phone) return steps(true, step("googleOnComputer", "Globe", "webSettings"), export_, unzip, step("chooseFileFromComputer", "Import", "transfer", "chooseFile"));
  return steps(false, step("googleSettings", "Settings", "webSettings"), export_, unzip, step("chooseFile", "Import", "choose", "chooseFile"));
};

/** Passi per portare il calendario da StudyOS a `app` (o viceversa) su `device`, oppure dove farlo. */
export const guideFor = (direction: GuideDirection, device: GuideDevice, app: GuideApp): Guide =>
  direction === "export" ? exportGuide(device, app) : importGuide(device, app);
