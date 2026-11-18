// Questo dispositivo, per dire dove è stata interrotta una sessione di ripasso o un quiz («su iPhone ·
// Safari», «su questo dispositivo»). L'id è casuale, per browser, nel localStorage: due browser sullo
// stesso computer sono due dispositivi. Il nome viene solo dal browser (sistema e programma), mai da
// dati della persona. Senza localStorage l'id vale per la pagina aperta.
import type { RunDevice } from "../types";

const KEY = "studyos-device-id";

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Nome e tipo dal browser. iPadOS si presenta come un Mac: lo distingue lo schermo touch. */
export const describeDevice = ({ userAgent = "", platform = "", maxTouchPoints = 0 }: { userAgent?: string; platform?: string; maxTouchPoints?: number } = {}): Pick<RunDevice, "name" | "kind"> => {
  const os = platform.toLowerCase();
  const mac = /Macintosh|Mac OS X/.test(userAgent) || os.startsWith("mac");
  let system: string;
  let kind: RunDevice["kind"];
  if (/iPhone|iPod/.test(userAgent) || os.startsWith("iphone")) [system, kind] = ["iPhone", "phone"];
  else if (/iPad/.test(userAgent) || os.startsWith("ipad") || (mac && maxTouchPoints > 1)) [system, kind] = ["iPad", "tablet"];
  else if (/Android/i.test(userAgent)) [system, kind] = /Mobile/i.test(userAgent) ? ["Android", "phone"] : ["tablet Android", "tablet"];
  else if (/CrOS/.test(userAgent)) [system, kind] = ["Chromebook", "computer"];
  else if (mac) [system, kind] = ["Mac", "computer"];
  else if (/Windows/i.test(userAgent) || os.startsWith("win")) [system, kind] = ["PC Windows", "computer"];
  else if (/Linux/i.test(userAgent) || os.startsWith("linux")) [system, kind] = ["computer Linux", "computer"];
  else [system, kind] = ["un altro dispositivo", "computer"];
  const browser = /SamsungBrowser/.test(userAgent)
    ? "Samsung Internet"
    : /Edg(A|iOS)?\//.test(userAgent)
      ? "Edge"
      : /OPR\/|Opera/.test(userAgent)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(userAgent)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "";
  return { name: browser ? `${system} · ${browser}` : system, kind };
};

let cached: RunDevice | null = null;

/** Questo browser (id stabile e nome), calcolato una volta per pagina. */
export const thisDevice = (): RunDevice => {
  if (cached) return cached;
  let id = "";
  try {
    id = localStorage.getItem(KEY) ?? "";
    if (!id) {
      id = randomId();
      localStorage.setItem(KEY, id);
    }
  } catch {
    id = id || randomId();
  }
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  cached = { id, ...describeDevice({ userAgent: nav?.userAgent ?? "", platform: nav?.platform ?? "", maxTouchPoints: nav?.maxTouchPoints ?? 0 }) };
  return cached;
};

/** Solo per i test. */
export const setThisDeviceForTests = (device: RunDevice | null) => {
  cached = device;
};
