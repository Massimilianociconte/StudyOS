import type { ReactNode } from "react";
import type { BarbCourse } from "../lib/university/types";
import { courseVisual, type CourseSymbol } from "../lib/barbCourseVisuals";

// Scientific schematics share a 32-unit canvas, rounded 1.6-unit strokes and generous
// negative space. They stay legible on the smallest subject chip without raster assets.
const dna = <><path d="M10 4c0 8 12 8 12 16s-12 8-12 8M22 4c0 8-12 8-12 16s12 8 12 8"/><path d="m11 7 10 0m-9 5 8 0m-8 8 8 0m-9 5 10 0"/></>;
const neuron = <><path d="m12 12-5-5m5 7-8 1m10-4 1-7m-2 15-6 6m11-10 7-5m-7 12 8 3m-4-1 1 5m-4-3 2-3"/><path d="M17 12c4 2 5 5 2 8-3 4-9 2-10-2-1-4 4-8 8-6Z"/><circle cx="14.5" cy="16" r="1.4"/></>;
const cell = <><path d="M26 16c0 7-4 11-11 10S5 20 5 14 10 5 17 6s9 5 9 10Z"/><circle cx="15" cy="15" r="4"/><path d="m9 20 2 2m10-12 2 2"/></>;
const antibody = <><path d="m8 5 8 9 8-9M5 8l8 9v10m14-19-8 9v10M16 14v13"/></>;
const receptor = <><path d="M4 21h10m5 0h9M12 14l4 4 4-4m-7 1v7h6v-7m-3 7v6"/><path d="m13 4 3-2 3 2v4l-3 2-3-2Z"/><path d="M5 25h6m11 0h5"/></>;
const microscope = <><path d="m14 5 4-2 6 10-4 2-6-10ZM19 16c2 7-1 11-7 11H6m6 0h15M7 20h11m-8-2v5"/><path d="M22 14c7 3 6 12 1 13"/></>;
const vials = <><path d="M6 5h7m-6 0v17a3 3 0 0 0 6 0V5m5 3h7m-6 0v16a3 3 0 0 0 6 0V8M7 17h6m6 2h6"/><path d="m9 9 2 0m10 3 2 0"/></>;
const heart = <><path d="M16 27S3 18 5 10c1-6 8-6 11-1 3-5 10-5 11 1 2 8-11 17-11 17Z"/><path d="M4 16h7l3-5 4 10 3-5h7"/></>;
const microbe = <><path d="M10 10c4-4 9-4 13 0s2 9-2 13-9 2-13-2-2-7 2-11Z"/><path d="m9 7-2-3m9 3V3m8 5 3-3m-1 11h4m-6 7 3 3m-10-1v4m-9-6-3 2M6 14H2"/><circle cx="13" cy="13" r="1"/><circle cx="19" cy="18" r="1.5"/></>;
const person = <><circle cx="16" cy="6" r="3"/><path d="M9 28v-9l-4-2 2-6h18l2 6-4 2v9m-7-16v8m-5-4h10m-5 4-5 8m5-8 5 8"/></>;
const symbols: Record<CourseSymbol | "unknown", ReactNode> = {
  patent: <><path d="M5 3h15l6 6v20H5Zm15 0v7h6M9 14h5m-5 4h8"/><path d="m17 19 3-2 3 2v4l-3 2-3-2Zm3 6v4m-5-2 5-2 5 2"/></>,
  anatomy: person,
  receptor,
  genomics: <g transform="translate(-2 0)">{dna}<path d="M23 15h7v10h-7m0-7h4m-4 4h4"/></g>,
  pathology: <>{cell}<path d="m20 20 6 6m-6 0 6-6"/></>,
  physiology: <><path d="M3 17h6l4-9 5 17 4-11h7"/><path d="M5 6h4m14 20h4"/></>,
  statistics: <><path d="M5 4v23h23M9 22v-6m6 6V9m6 13v-9m6 9V5"/><path d="m8 11 7-6 6 4 6-6"/></>,
  language: <><path d="M5 5h22v16H16l-7 6v-6H5Z"/><path d="m9 16 3-7 3 7m-5-2h4m5-5v7h3a2 2 0 0 0 0-4h-3m0-3h3a1.5 1.5 0 0 1 0 3"/></>,
  career: <><path d="M5 12h22v15H5Zm7 0V7h8v5M5 18h22m-13-2v5h4v-5"/><path d="m14 4 2-2 2 2"/></>,
  anthropology: <><path d="M23 18v-4C23 4 8 3 8 13l-3 6h4v6h7v4m7-11-5 5"/><circle cx="17" cy="12" r="2"/><path d="m12 16 2 2m4 2h3"/></>,
  ecotoxicology: <><path d="M17 4C4 6 3 18 10 23c7 4 15-4 15-14-3 0-5-2-8-5ZM8 27l12-16m-7 8-2-7m5 4 7 1"/><path d="m23 23 2 5h-4Z"/></>,
  "disease-model": <><path d="M11 3h10m-8 0v9L5 25a2 2 0 0 0 2 3h18a2 2 0 0 0 2-3l-8-13V3M10 18h12"/><circle cx="14" cy="22" r="2"/><path d="m19 25 3-3"/></>,
  signaling: <>{receptor}<path d="m7 6 3 4m-3 0h3V7m11 18 3 4m-3 0h3v-3"/></>,
  "drug-target": <><circle cx="16" cy="17" r="10"/><circle cx="16" cy="17" r="5"/><path d="m16 17 9-12m-5 0h5v5M6 4l4 4"/></>,
  clinical: <>{vials}<path d="M22 2v4m-2-2h4"/></>,
  "stem-cell": <><circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/><path d="m14 15 4 3m-9-2v5m10-8 4-3"/><circle cx="9" cy="26" r="3"/><circle cx="23" cy="23" r="5"/><circle cx="27" cy="7" r="3"/><circle cx="23" cy="23" r="1.5"/></>,
  biotherapy: <>{antibody}<path d="M7 27h4m-2-2v4m14-2h4m-2-2v4"/></>,
  "cell-physiology": <>{cell}<path d="M2 14h9l2-4 4 11 3-6h10"/></>,
  endocrine: <><path d="M11 9c-6-4-8 4-5 9s7 5 10 1c3 4 8 4 10-1s1-13-5-9c-3 2-7 2-10 0ZM16 9V4m0 17v7"/><circle cx="10" cy="15" r="1"/><circle cx="22" cy="15" r="1"/></>,
  microbiology: microbe,
  brain: <><path d="M16 6C10 1 4 7 6 13 1 18 6 27 12 25c1 4 4 4 4 0 0 4 3 4 4 0 6 2 11-7 6-12 2-6-4-12-10-7Zm0 0v19"/><path d="M8 9c5-1 5 5 2 5m-3 5c5-2 7 2 5 4m12-14c-5-1-5 5-2 5m3 5c-5-2-7 2-5 4"/></>,
  neuron,
  oncology: <><circle cx="16" cy="16" r="11"/><circle cx="13" cy="14" r="3"/><circle cx="22" cy="12" r="2"/><circle cx="19" cy="22" r="3"/><path d="m6 24 4-2m12-19-2 4"/></>,
  "cell-pathology": <>{cell}<path d="m5 4 3 3m17 18 3 3M12 13l5 4m-5 0 5-4"/></>,
  epidemiology: <><circle cx="16" cy="16" r="4"/><circle cx="6" cy="6" r="2"/><circle cx="26" cy="6" r="2"/><circle cx="6" cy="26" r="2"/><circle cx="26" cy="26" r="2"/><path d="m8 8 5 5m6 0 5-5m-5 11 5 5m-11-5-5 5"/><path d="m14 16 2 2 3-3"/></>,
  cardiovascular: heart,
  neuromuscular: <><g transform="translate(-1 -1) scale(.65)">{neuron}</g><path d="M14 21c3-4 10-6 14-3l-3 8c-4 2-9 2-12-1Zm3 2 7-2m-6 5 6-3"/></>,
  dna,
  diagnostics: <>{vials}<path d="m18 4 3-3m1 1 3 3"/></>,
  bioinformatics: <><g transform="translate(-4 1) scale(.75)">{dna}</g><rect x="17" y="10" width="12" height="12" rx="2"/><path d="m20 14 2 2-2 2m4 0h2m-5 4v4m-3 0h8"/></>,
  immunology: antibody,
  microscope,
  internship: <>{microscope}<path d="m4 8 3 3 5-5"/></>,
  thesis: <><path d="M7 3h14l5 5v21H7Zm14 0v6h5M11 14h11m-11 4h11m-11 4h5"/><path d="m19 26 2-3 2 3"/></>,
  unknown: <><path d="M5 6c5-2 8-1 11 2 3-3 6-4 11-2v21c-5-2-8-1-11 1-3-2-6-3-11-1ZM16 8v20"/></>
};

export function CourseIcon({ course, className }: { course: Pick<BarbCourse, "id" | "name">; className?: string }) {
  const { kind } = courseVisual(course);
  return <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{symbols[kind]}</svg>;
}
