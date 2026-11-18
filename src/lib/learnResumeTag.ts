// Etichette di sessioni e quiz interrotti e ripresi: quando è avvenuta l'interruzione («ieri alle
// 18:30») e dove («questo dispositivo» o «iPhone · Safari»). Funzioni pure, provate nei test.
import { differenceInCalendarDays, differenceInMinutes, format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { LEARN_TEXT } from "./labels/learn";
import type { RunDevice, StudyRun } from "../types";

/** Icona per tipo di dispositivo. */
export const DEVICE_ICON: Record<RunDevice["kind"], string> = { phone: "Smartphone", tablet: "Tablet", computer: "Monitor" };

/** Quando: «adesso», «12 min fa», «oggi alle 9:05», «ieri alle 18:30», «lunedì alle 18:30», «il 3 nov, 18:30». */
export const pauseWhen = (at: string | undefined, now = new Date()): string => {
  if (!at) return "";
  const date = parseISO(at);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return LEARN_TEXT.whenNow;
  if (minutes < 60) return LEARN_TEXT.whenMinutes(minutes);
  const time = format(date, "H:mm");
  const days = differenceInCalendarDays(now, date);
  if (days <= 0) return LEARN_TEXT.whenToday(time);
  if (days === 1) return LEARN_TEXT.whenYesterday(time);
  if (days < 7) return LEARN_TEXT.whenWeekday(format(date, "EEEE", { locale: it }), time);
  return LEARN_TEXT.whenDate(format(date, date.getFullYear() === now.getFullYear() ? "d MMM, H:mm" : "d MMM yyyy, H:mm", { locale: it }));
};

export interface PauseWhere {
  /** Interrotta su questo stesso dispositivo. */
  here: boolean;
  name: string;
  kind: RunDevice["kind"];
}

/** Dove è stata interrotta (null per le pause salvate prima che si registrasse il dispositivo). */
export const pauseWhere = (run: Pick<StudyRun, "progress">, here: Pick<RunDevice, "id">): PauseWhere | null => {
  const device = run.progress?.device;
  if (!device) return null;
  return { here: device.id === here.id, name: device.name, kind: device.kind };
};

/** Testo completo di un'interruzione: «Interrotta ieri alle 18:30 su iPhone · Safari». */
export const pauseText = (run: Pick<StudyRun, "progress" | "kind">, here: Pick<RunDevice, "id">, now = new Date()): string => {
  const when = pauseWhen(run.progress?.at, now);
  if (!when) return "";
  const where = pauseWhere(run, here);
  const text = LEARN_TEXT.pausedWhen(when, run.kind === "quiz");
  return where ? `${text} ${LEARN_TEXT.pausedWhere(where.here ? null : where.name)}` : text;
};

/** Etichetta di una sessione ripresa (anche chiusa, nello storico); null se mai ripresa. */
export const resumedLabel = (run: Pick<StudyRun, "resumed">): string | null => {
  const resumed = run.resumed;
  if (!resumed?.count) return null;
  if (!resumed.elsewhere) return LEARN_TEXT.tagResumed;
  return resumed.from ? LEARN_TEXT.tagResumedFrom(resumed.from) : LEARN_TEXT.tagResumedElsewhere;
};
