// Mattoni comuni degli strumenti: esiti, paginazione e date. Li usano execute.ts e il modulo pigro
// sharedTools.ts, che così non importa execute.ts (niente import circolari).

import { addDays, addMinutes, differenceInCalendarDays, endOfDay, isValid, parseISO, startOfDay } from "date-fns";
import type { AgentCallResult } from "./types";
import { allDayRange } from "../lib/selectors";
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

/** Nuovo intervallo di un evento dopo una modifica di start, end o allDay (null = invariato). */
export const nextEventRange = (event: Pick<CalendarEvent, "start" | "end" | "allDay">, args: Args): { start: string; end: string } | string | null => {
  if (args.start === undefined && args.end === undefined && typeof args.allDay !== "boolean") return null;
  const allDay = typeof args.allDay === "boolean" ? args.allDay : event.allDay === true;
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
