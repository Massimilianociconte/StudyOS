// Avvisi del timer oltre al banner nell'app: un breve suono (Web Audio), la vibrazione dove c'è e,
// solo se la persona l'ha chiesto con un pulsante, la notifica di sistema. I browser fanno partire
// l'audio solo dopo un gesto: `primeTimerSound()` va chiamata da un tocco o un clic.
import { readUiState } from "./uiState";

/** Chiavi di stato UI (dispositivo) per le preferenze degli avvisi. */
export const TIMER_SOUND_KEY = "study.timerSound";
export const TIMER_VIBRATE_KEY = "study.timerVibrate";

type AudioContextClass = typeof AudioContext;

let audio: AudioContext | null = null;

const audioClass = (): AudioContextClass | undefined => {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
};

/** Da chiamare dentro un gesto (Avvia, Riprendi, primo tocco nell'app): sblocca il suono. */
export const primeTimerSound = () => {
  try {
    const Context = audioClass();
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // audio non disponibile: resta il banner
  }
};

const enabled = (key: string) => readUiState(key, "device") !== false;

/** Due note brevi (tre per l'obiettivo raggiunto). Silenzioso se l'audio non è stato sbloccato. */
export const playTimerBeep = (notes = 2) => {
  if (!audio || audio.state !== "running" || !enabled(TIMER_SOUND_KEY)) return;
  try {
    const start = audio.currentTime + 0.02;
    for (let index = 0; index < notes; index += 1) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = start + index * 0.22;
      oscillator.type = "sine";
      oscillator.frequency.value = index % 2 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    }
  } catch {
    // niente suono: resta il banner
  }
};

export const canVibrate = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export const vibrateTimer = () => {
  if (!canVibrate() || !enabled(TIMER_VIBRATE_KEY)) return;
  try {
    navigator.vibrate([180, 90, 180]);
  } catch {
    // vibrazione non consentita
  }
};

export type SystemNotificationState = "unsupported" | "default" | "granted" | "denied";

export const systemNotificationState = (): SystemNotificationState => {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
};

/** Chiede il permesso (solo da un pulsante esplicito). */
export const requestSystemNotifications = async (): Promise<SystemNotificationState> => {
  if (systemNotificationState() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return systemNotificationState();
  }
};

/** Notifica di sistema solo se permessa e se l'app non è in primo piano (lì basta il banner). */
export const showSystemNotification = async (title: string, body: string) => {
  if (systemNotificationState() !== "granted" || document.visibilityState === "visible") return;
  const options = { body, tag: "studyos-timer", icon: "./icons/studyos-192.png" };
  try {
    // Su Android la notifica passa dal service worker; altrove basta il costruttore.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    // notifica rifiutata dal sistema: resta il banner
  }
};
