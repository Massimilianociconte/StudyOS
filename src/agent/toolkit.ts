// Mattoni comuni degli strumenti: esiti, paginazione e date. Li usano execute.ts e il modulo pigro
// sharedTools.ts, che così non importa execute.ts (niente import circolari).

import { addDays, addMinutes, differenceInCalendarDays, endOfDay, isValid, parseISO, startOfDay } from "date-fns";
import type { AgentCallResult } from "./types";
import { allDayDays, allDayTimes } from "../lib/repeat";
import { allDayRange } from "../lib/selectors";
import { civilAddDays, civilDaysBetween, civilFromParts, isValidTimeZone, utcToZonedParts } from "../lib/tz";
import { useStudyStore } from "../store/useStudyStore";
import type { CalendarEvent } from "../types";

export type Args = Record<string, unknown>;

export const text = (value: unknown) => (typeof value === "string" ? value : "");
export const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

export const page = <T>(items: T[], args: Args) => {
  const offset = Number(args.offset ?? 0);
  const limit = Number(args.limit ?? 30);
  const slice = items.slice(offset, offset + limit);
  const hasMore = offset + slice.length < items.length;
  return { total: items.length, count: slice.length, offset, limit, has_more: hasMore, ...(hasMore ? { next_offset: offset + slice.length } : {}), items: slice };
};

export const fail = (code: Extract<AgentCallResult, { ok: false }>["code"], error: string): AgentCallResult => ({ ok: false, code, error });

export const ok = (data: Record<string, unknown>): AgentCallResult => {
  const warning = useStudyStore.getState().persistError;
  return warning ? { ok: true, data: { ...data, warning } } : { ok: true, data };
};

export const state = () => useStudyStore.getState();

export const pick = (args: Args, keys: string[]) => {
  const patch: Record<string, unknown> = {};
  for (const key of keys) if (args[key] !== undefined) patch[key] = args[key];
  return patch;
};

// --- Date: l'agente scrive ISO 8601; senza offset vale l'ora locale del browser, come nell'app. ---

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const instant = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  let date = parseISO(value.trim());
  if (!isValid(date)) date = new Date(value);
  return isValid(date) ? date : null;
};

/** ISO in UTC come lo salva l'app. Una data senza ora può valere fine giornata (scadenze). */
export const toIso = (value: unknown, dayMeansEndOfDay = false) => {
  const date = instant(value);
  if (!date) return null;
  return (dayMeansEndOfDay && DAY_RE.test(text(value).trim()) ? endOfDay(date) : date).toISOString();
};

export const eventRange = (start: Date, end: Date | null, allDay: boolean): { start: string; end: string } | string => {
  if (allDay) return allDayRange(start);
  const finish = end ?? addMinutes(start, 60);
  if (finish <= start) return "L'orario di fine deve essere successivo all'inizio.";
  return { start: start.toISOString(), end: finish.toISOString() };
};

/** Finestra from/to delle letture di calendario: di base da oggi per 60 giorni, al massimo 400. */
export const dateWindow = (args: Args): { from: Date; to: Date } | string => {
  const from = args.from === undefined ? startOfDay(new Date()) : instant(args.from);
  if (!from) return "from non è una data valida.";
  const to = args.to === undefined ? addDays(from, 60) : instant(args.to);
  if (!to) return "to non è una data valida.";
  if (to <= from) return "to deve essere dopo from.";
  if (differenceInCalendarDays(to, from) > 400) return "Intervallo troppo lungo: al massimo 400 giorni per richiesta.";
  return { from, to };
};

/** Un'ora con offset (Z, +01:00) è un istante preciso; senza offset vale l'ora locale, come nell'app. */
const WITH_OFFSET = /T.*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Giorno civile di una data dell'agente per un tutto il giorno nel fuso `zone` dell'evento, e se è
 * mezzanotte: "YYYY-MM-DD" (o un'ora senza offset) è quel giorno; un istante con offset, il suo giorno
 * in quel fuso. Mai il giorno del dispositivo di una mezzanotte di un altro fuso (vedi GOTCHAS).
 */
const allDayArg = (value: unknown, zone: string | undefined) => {
  const raw = text(value).trim();
  const date = instant(raw);
  if (!date) return null;
  const parts = utcToZonedParts(date, WITH_OFFSET.test(raw) && isValidTimeZone(zone) ? zone : undefined);
  return { day: civilFromParts(parts.year, parts.month, parts.day), midnight: !parts.hour && !parts.minute && !parts.second && !parts.millisecond };
};

/**
 * Nuove date di un tutto il giorno (`event` è o diventa tutto il giorno), salvate come mezzanotti nel
 * fuso `zone` dell'evento (allDayTimes): start è il primo giorno, end l'ultimo compreso ("YYYY-MM-DD")
 * o la fine esclusiva a mezzanotte. Senza end tiene quanti giorni durava (un evento con orario: uno).
 */
const allDayNextRange = (event: Pick<CalendarEvent, "start" | "end" | "allDay">, args: Args, zone: string | undefined) => {
  const valid = isValidTimeZone(zone) ? zone : undefined;
  // Un'occorrenza espansa (occurrenceKey) si legge nel dispositivo; il resto nel fuso dell'evento.
  const shown = event.allDay === true ? allDayDays({ ...event, timeZone: valid }) : null;
  const from = args.start === undefined ? null : allDayArg(args.start, valid);
  if (args.start !== undefined && !from) return "start non è una data valida.";
  const first = from?.day ?? shown?.first ?? allDayArg(event.start, valid)?.day;
  if (!first) return "start non è una data valida.";
  let last = shown ? civilAddDays(first, civilDaysBetween(shown.first, shown.last)) : first;
  if (args.end !== undefined) {
    const to = allDayArg(args.end, valid);
    if (!to) return "end non è una data valida.";
    last = DAY_RE.test(text(args.end).trim()) || !to.midnight ? to.day : civilAddDays(to.day, -1);
    if (last < first) return "L'ultimo giorno deve essere uguale o successivo al primo.";
  }
  return allDayTimes(first, last, valid);
};

/**
 * Nuovo intervallo di un evento dopo una modifica di start, end o allDay (null = invariato). Un tutto
 * il giorno (anche su più giorni) tiene i suoi giorni nel fuso `zone` dell'evento (vedi allDayNextRange).
 */
export const nextEventRange = (event: Pick<CalendarEvent, "start" | "end" | "allDay">, args: Args, zone?: string): { start: string; end: string } | string | null => {
  if (args.start === undefined && args.end === undefined && typeof args.allDay !== "boolean") return null;
  const allDay = typeof args.allDay === "boolean" ? args.allDay : event.allDay === true;
  if (allDay) return allDayNextRange(event, args, zone);
  const oldStart = parseISO(event.start);
  const oldEnd = parseISO(event.end);
  const start = args.start === undefined ? oldStart : instant(args.start);
  if (!start || !isValid(start)) return "start non è una data valida.";
  let end: Date | null;
  if (args.end !== undefined) {
    end = instant(args.end);
    if (!end) return "end non è una data valida.";
  } else if (event.allDay === true && !allDay) {
    end = addMinutes(start, 60);
  } else {
    // Spostare l'inizio conserva la durata, come il trascinamento nel calendario.
    const duration = isValid(oldStart) && isValid(oldEnd) && oldEnd > oldStart ? oldEnd.getTime() - oldStart.getTime() : 60 * 60_000;
    end = new Date(start.getTime() + duration);
  }
  return eventRange(start, end, allDay);
};
