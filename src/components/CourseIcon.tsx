import type { ReactNode } from "react";
import type { BarbCourse } from "../lib/university/types";
import { courseVisual, type CourseSymbol } from "../lib/barbCourseVisuals";

// Hand-drawn scientific line icons on a 32-unit canvas (content roughly 4..28).
// Bold 2-unit rounded strokes with a few solid accents, so every symbol stays
// legible from the 14px calendar chip up to the 36px course header.
// Filled accents use fill="currentColor" stroke="none" inline.

// Double helix with rungs.
const dna = (
  <>
    <path d="M10.5 4.5c0 7 11 7.5 11 11.5s-11 4.5-11 11.5" />
    <path d="M21.5 4.5c0 7-11 7.5-11 11.5s11 4.5 11 11.5" />
    <path d="M11.5 9.5h9M12.5 20.5h7M13.4 16h5.2" />
  </>
);

// Neuron: soma with nucleus, dendrites, long axon with terminals.
const neuron = (
  <>
    <circle cx="11" cy="16" r="5.2" />
    <circle cx="11" cy="16" r="1.6" fill="currentColor" stroke="none" />
    <path d="M7 12.5 3.5 9M6.4 16H3M7 19.5l-3.5 3.5" />
    <path d="M16 16h8" />
    <path d="M24 16l4-3.5M24 16l4 3.5M24 16h4.5" />
  </>
);

// Generic cell with nucleus.
const cell = (
  <>
    <path d="M26 16c0 6.5-4.5 10.5-10.5 10S5 20.5 5 15 9.5 5.5 16 6s10 4.5 10 10Z" />
    <circle cx="15" cy="15" r="3.8" />
    <circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none" />
  </>
);

// Antibody Y.
const antibody = (
  <>
    <path d="M10.5 5.5 16 13.5 21.5 5.5M16 13.5V27" />
    <circle cx="16" cy="24.5" r="1.2" fill="currentColor" stroke="none" />
  </>
);

// Membrane receptor: lipid bilayer, Y receptor, ligand.
const receptor = (
  <>
    <path d="M4 21.5h24M4 25.5h24" />
    <path d="M11.5 11.5 16 17l4.5-5.5M16 17v8.5" />
    <circle cx="24.5" cy="9" r="2.3" />
    <circle cx="24.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
  </>
);

// Side-view microscope.
const microscope = (
  <>
    <path d="M8 4.5h5M8.5 4.5V13M12.5 4.5V13" />
    <path d="M10.5 13v3.5" />
    <path d="M12.5 13c5.5 1 7.5 3.5 7.5 8.5" />
    <path d="M10.5 20h13" />
    <circle cx="17.5" cy="16.5" r="1.4" />
    <path d="M7 27.5h16" />
    <path d="M15 27.5v-3" />
  </>
);

// Test tubes with liquid and bubbles.
const vials = (
  <>
    <path d="M5.5 6.5h10" />
    <path d="M7.5 6.5V19a3.2 3.2 0 0 0 6.4 0V6.5" />
    <path d="M7.5 14.5h6.4" />
    <path d="M19.5 10.5h8" />
    <path d="M21 10.5v10a2.6 2.6 0 0 0 5.2 0v-10" />
    <path d="M21 17h5.2" />
    <circle cx="10.2" cy="17.2" r="1" fill="currentColor" stroke="none" />
    <circle cx="23.4" cy="18.6" r="0.9" fill="currentColor" stroke="none" />
  </>
);

// Heart with ECG trace.
const heart = (
  <>
    <path d="M16 27S3.5 18.5 5.2 11.2C6.2 6.5 12 6.3 14.6 10c.5-.7 1-1.3 1.4-1.6.4.3.9.9 1.4 1.6 2.6-3.7 8.4-3.5 9.4 1.2 1.7 7.3-10.8 15.8-10.8 15.8Z" />
    <path d="M8.5 16.5h3l1.7-3.4 2.6 6.8 1.8-3.4h5.4" />
  </>
);

// Rod bacterium with pili, flagellum and granules.
const microbe = (
  <>
    <rect x="7" y="12" width="13.5" height="8" rx="4" />
    <path d="M9.5 12V8.5M13.5 12V8.5M17.5 12V8.5M10 20v3.5M14.5 20v3.5" />
    <path d="M20.5 15c4 0 4 6 7.5 6.5" />
    <circle cx="12" cy="16" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="16" r="1.1" fill="currentColor" stroke="none" />
  </>
);

// Human figure.
const person = (
  <>
    <circle cx="16" cy="7.4" r="3.2" />
    <path d="M16 11.5V21" />
    <path d="M8 14.5 16 17.5 24 14.5" />
    <path d="M16 21l-4.5 6M16 21l4.5 6" />
  </>
);

// Genomics: mini helix beside a bar chart.
const genomics = (
  <>
    <path d="M5.5 5c0 6 8 6.5 8 11s-8 5-8 11" />
    <path d="M13.5 5c0 6-8 6.5-8 11s8 5 8 11" />
    <path d="M7 11h5M7 21h5" />
    <path d="M18 25.5h10" />
    <path d="M20 25.5V17M23.5 25.5v-11M27 25.5v-6" />
  </>
);

// Diseased cell: cell plus circled X badge.
const pathology = (
  <>
    <circle cx="12.5" cy="15" r="8" />
    <circle cx="12.5" cy="15" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="22.5" cy="22.5" r="4.6" />
    <path d="M20.6 20.6l3.8 3.8M24.4 20.6l-3.8 3.8" />
  </>
);

// Physiology pulse trace.
const physiology = (
  <>
    <path d="M3 16.5h6l2.2-7.5 3.4 14 2.6-9.5 1.8 3H29" />
    <circle cx="3" cy="16.5" r="1.2" fill="currentColor" stroke="none" />
  </>
);

// Bar chart with trend arrow.
const statistics = (
  <>
    <path d="M5.5 4.5v21.5H27" />
    <path d="M10.5 26v-9M15.5 26V12M20.5 26v-6" />
    <path d="M9 12.5 14 9l3.5 2.5L24 5.5" />
    <path d="M20.5 5.5H24V9" />
  </>
);

// Speech bubble with "Aa".
const language = (
  <>
    <path d="M5 6.5h22v13H16.5L9.5 25v-5.5H5Z" />
    <path d="M10 15.5 12.5 10l2.5 5.5M10.8 13.6h3.4" />
    <circle cx="20.5" cy="14" r="1.8" />
    <path d="M22.3 12.5v4.5" />
  </>
);

// Briefcase.
const career = (
  <>
    <rect x="5.5" y="11" width="21" height="13.5" rx="2.5" />
    <path d="M5.5 16.5h21" />
    <path d="M12 11V8.7a1.7 1.7 0 0 1 1.7-1.7h4.6a1.7 1.7 0 0 1 1.7 1.7V11" />
    <path d="M14.8 16.5v3h2.4v-3" />
  </>
);

// Skull, side-simplified front view.
const anthropology = (
  <>
    <path d="M9 18.5v-1.2a7 7 0 0 1 14 0v1.2" />
    <path d="M9 18.5V22M23 18.5V22" />
    <circle cx="13" cy="16.3" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="16.3" r="1.5" fill="currentColor" stroke="none" />
    <path d="M16 18.3v2" />
    <path d="M11.5 22.5h9" />
    <path d="M13.8 22.5V26M16 22.5v3.5M18.2 22.5V26" />
    <path d="M11.5 26h9" />
  </>
);

// Leaf with veins and a water droplet.
const ecotoxicology = (
  <>
    <path d="M14.5 4.5C9 9 8 17 14.5 25 21 17 20 9 14.5 4.5Z" />
    <path d="M14.5 8v14" />
    <path d="M14.5 12.5 11.5 11M14.5 12.5l3 2M14.5 17l-3.5-1.5M14.5 17l3.5 2" />
    <path d="M23.5 20c1.4 1.9 2.3 3 2.3 4.2a2.3 2.3 0 0 1-4.6 0c0-1.2.9-2.3 2.3-4.2Z" />
  </>
);

// Lab mouse: body, ear, snout, tail, eye.
const diseaseModel = (
  <>
    <circle cx="13.5" cy="18" r="6.5" />
    <circle cx="19" cy="11.8" r="2.1" />
    <path d="M19 16.5 26 19" />
    <circle cx="26" cy="19" r="1" fill="currentColor" stroke="none" />
    <path d="M7.5 19.5C4 20.5 3.5 25 6.5 26.3" />
    <circle cx="16" cy="16.5" r="1.2" fill="currentColor" stroke="none" />
  </>
);

// Signaling: receptor in bilayer plus radiating ligand.
const signaling = (
  <>
    <path d="M3.5 22h13M3.5 26h13" />
    <path d="M9 13.5 13 18.5 17 13.5M13 18.5V24" />
    <circle cx="23.5" cy="10" r="1.6" fill="currentColor" stroke="none" />
    <path d="M19.5 6.5a5.6 5.6 0 0 1 8 0" />
    <path d="M17.5 4a9 9 0 0 1 12 0" />
  </>
);

// Drug target: concentric rings struck by an arrow.
const drugTarget = (
  <>
    <circle cx="14.5" cy="17.5" r="8" />
    <circle cx="14.5" cy="17.5" r="4.2" />
    <circle cx="14.5" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M25.5 6.5 18.5 13.5" />
    <path d="M25.5 6.5h-4M25.5 6.5v4" />
  </>
);

// Clinical tube with medical cross.
const clinical = (
  <>
    <path d="M4.5 9.5h10" />
    <path d="M6.5 9.5V19a3.2 3.2 0 0 0 6.4 0V9.5" />
    <path d="M6.5 15.5h6.4" />
    <circle cx="9.5" cy="17.8" r="1" fill="currentColor" stroke="none" />
    <path d="M24 5v8M20 9h8" />
  </>
);

// Dividing stem cell: mother budding a daughter.
const stemCell = (
  <>
    <circle cx="12" cy="15" r="7.5" />
    <circle cx="12" cy="15" r="2.2" />
    <circle cx="12" cy="15" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="22.5" cy="19.5" r="4.8" />
    <circle cx="22.5" cy="19.5" r="1.1" fill="currentColor" stroke="none" />
  </>
);

// Upright syringe.
const syringe = (
  <>
    <path d="M13 4.5h6" />
    <path d="M16 4.5V9" />
    <path d="M12 10.5h8" />
    <path d="M12.5 10.5h7V20h-7Z" />
    <path d="M12.5 14h2.5M12.5 17h2.5" />
    <path d="M14.5 20h3" />
    <path d="M16 21.5V28" />
  </>
);

// Cell crossed by a pulse (cell physiology).
const cellPhysiology = (
  <>
    <circle cx="16" cy="16" r="9" />
    <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
    <path d="M5 16h4l2-5 3 10 2.5-7 1.5 2H27" />
  </>
);

// Endocrine glands: two lobes, isthmus, hormone granules.
const endocrine = (
  <>
    <ellipse cx="10.5" cy="16" rx="4" ry="7" />
    <ellipse cx="21.5" cy="16" rx="4" ry="7" />
    <path d="M14.5 16h3" />
    <circle cx="10.5" cy="13" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="21.5" cy="19" r="1.2" fill="currentColor" stroke="none" />
  </>
);

// Petri dish, top view, with colonies.
const petri = (
  <>
    <circle cx="16" cy="16" r="10.5" />
    <circle cx="16" cy="16" r="6.8" />
    <circle cx="13.5" cy="14" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="19" r="1.6" />
  </>
);

// Brain hemispheres with midline and sulci.
const brain = (
  <>
    <path d="M16 5.5C11.5 1.5 5 6 6.3 11 3.3 13.8 4.8 20.5 9.3 20.8c1 3.3 4.3 3.8 6.7 2 2.4 1.8 5.7 1.3 6.7-2 4.5-.3 6-7 3-9.8 1.3-5-5.2-9.5-9.7-5.5Z" />
    <path d="M16 5.5V25" />
    <path d="M11 9.5c-2.2.8-2.5 4-.5 5.2M21 9.5c2.2.8 2.5 4 .5 5.2" />
  </>
);

// Awareness ribbon.
const ribbon = (
  <>
    <path d="M16 4.5c-3.4 0-5.8 2.5-5.8 5.4 0 2.4 1.4 4.2 3.2 5.1L9.5 27h4L16 19.6" />
    <path d="M16 4.5c3.4 0 5.8 2.5 5.8 5.4 0 2.4-1.4 4.2-3.2 5.1L22.5 27h-4L16 19.6" />
    <circle cx="16" cy="9.8" r="1.2" fill="currentColor" stroke="none" />
  </>
);

// Cell under a magnifier.
const cellInspector = (
  <>
    <circle cx="12.5" cy="14.5" r="7.5" />
    <circle cx="12.5" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="22" cy="21.5" r="4.2" />
    <path d="M25.2 24.7 28 27.5" />
  </>
);

// Outbreak network: index case linked to four contacts.
const outbreak = (
  <>
    <path d="M9.5 10 14 13.8M22.5 10 18 13.8M9.5 22 14 18.2M22.5 22 18 18.2" />
    <circle cx="16" cy="16" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="7.5" cy="8.5" r="2.2" />
    <circle cx="24.5" cy="8.5" r="2.2" />
    <circle cx="7.5" cy="23.5" r="2.2" />
    <circle cx="24.5" cy="23.5" r="2.2" />
  </>
);

// Neuromuscular junction: axon forking onto muscle fibers.
const junction = (
  <>
    <path d="M4 16h9" />
    <path d="M13 16l4.5-4.5M13 16l4.5 4.5" />
    <circle cx="17.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="20.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M20 11.5h8M20 16h8M20 20.5h8" />
    <path d="M22.5 11.5v9" />
  </>
);

// Code brackets with slash (bioinformatics).
const codeChevrons = (
  <>
    <path d="M13.5 10.5 8.5 16l5 5.5" />
    <path d="M18.5 10.5l5 5.5-5 5.5" />
    <path d="M17.5 8.5 14.5 23.5" />
  </>
);

// Shield with antibody (immunology).
const shield = (
  <>
    <path d="M16 4.5 24.5 7.8v7c0 6.2-4.2 10-8.5 11.7-4.3-1.7-8.5-5.5-8.5-11.7v-7Z" />
    <path d="M12.8 11.5 16 15.4 19.2 11.5M16 15.4v6.5" />
  </>
);

// Erlenmeyer flask with check badge (internship).
const flaskCheck = (
  <>
    <path d="M12.5 4.5h6" />
    <path d="M13.5 4.5 8.5 20a2.3 2.3 0 0 0 2.2 3h6.6a2.3 2.3 0 0 0 2.2-3L18.5 4.5" />
    <path d="M10.3 16h11.4" />
    <circle cx="13" cy="19" r="1" fill="currentColor" stroke="none" />
    <circle cx="23.5" cy="23" r="4.5" />
    <path d="M21.4 23l1.6 1.6 2.8-3" />
  </>
);

// Graduation cap (thesis).
const mortarboard = (
  <>
    <path d="M16 5.5 28 10.5 16 15.5 4 10.5Z" />
    <path d="M11 13v6.2c0 1.9 10 1.9 10 0V13" />
    <path d="M24.5 13.5V21" />
    <circle cx="24.5" cy="23" r="1.3" fill="currentColor" stroke="none" />
  </>
);

// Patent: document with seal and ribbon.
const patent = (
  <>
    <path d="M8 4.5h8.5L21.5 9.5V27.5H8Z" />
    <path d="M16.5 4.5v5H21.5" />
    <path d="M11 14.5h7M11 18h7" />
    <circle cx="20.5" cy="22.5" r="3" />
    <path d="M19 24.8 18 27.5M22 24.8l1 2.7" />
  </>
);

// Fallback book.
const book = (
  <>
    <path d="M5.5 6.5c4.5-2 7.5-1.2 10.5 1.5 3-2.7 6-3.5 10.5-1.5v19.5c-4.5-2-7.5-1.2-10.5 1.5-3-2.7-6-3.5-10.5-1.5Z" />
    <path d="M16 8v19.5" />
  </>
);

const symbols: Record<CourseSymbol | "unknown", ReactNode> = {
  patent,
  anatomy: person,
  receptor,
  genomics,
  pathology,
  physiology,
  statistics,
  language,
  career,
  anthropology,
  ecotoxicology,
  "disease-model": diseaseModel,
  signaling,
  "drug-target": drugTarget,
  clinical,
  "stem-cell": stemCell,
  biotherapy: syringe,
  "cell-physiology": cellPhysiology,
  endocrine,
  microbiology: petri,
  brain,
  neuron,
  oncology: ribbon,
  "cell-pathology": cellInspector,
  epidemiology: outbreak,
  cardiovascular: heart,
  neuromuscular: junction,
  dna,
  diagnostics: vials,
  bioinformatics: codeChevrons,
  immunology: shield,
  microscope,
  internship: flaskCheck,
  thesis: mortarboard,
  unknown: book
};

export function CourseIcon({ course, className }: { course: Pick<BarbCourse, "id" | "name">; className?: string }) {
  const { kind } = courseVisual(course);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {symbols[kind]}
    </svg>
  );
}
