import type { ReactNode } from "react";
import type { BarbCourse } from "../lib/university/types";
import { courseVisual, type CourseSymbol } from "../lib/barbCourseVisuals";

// Duotone scientific icons on a 32-unit canvas (content roughly 3..29).
// Three tones of currentColor: a rounded outline, a soft body fill and a few
// solid accents. The fill gives each symbol volume, so it still reads as a
// shape on the 14px calendar chip and gains detail up to the 36px headers.
const tone = { fill: "currentColor", fillOpacity: 0.24 } as const; // outline + soft body
const wash = { fill: "currentColor", fillOpacity: 0.24, stroke: "none" } as const; // body only
const solid = { fill: "currentColor", stroke: "none" } as const;
const fine = { strokeWidth: 1.4 } as const;
const faint = { strokeOpacity: 0.5 } as const;

// Anatomia: bust with ribcage and spine.
const anatomy = (
  <>
    <circle cx="16" cy="7.2" r="3.7" {...tone} />
    <path d="M5.5 28v-5c0-4.9 3.5-8.6 7.3-9.5.9.9 2 1.4 3.2 1.4s2.3-.5 3.2-1.4c3.8.9 7.3 4.6 7.3 9.5v5Z" {...wash} />
    <path d="M5.5 28v-5c0-4.9 3.5-8.6 7.3-9.5.9.9 2 1.4 3.2 1.4s2.3-.5 3.2-1.4c3.8.9 7.3 4.6 7.3 9.5v5" />
    <path d="M16 17.6V28" {...fine} />
    <path d="M14.8 19.2c-2.3.1-4 .9-5 2.2M17.2 19.2c2.3.1 4 .9 5 2.2M14.8 23c-2 .1-3.5.8-4.4 1.8M17.2 23c2 .1 3.5.8 4.4 1.8" {...fine} />
  </>
);

// Farmacologia: two-tone capsule and a scored tablet.
const pharmacology = (
  <>
    <g transform="rotate(-45 12.5 12.5)">
      <path d="M12.5 8.5h-4a4 4 0 0 0 0 8h4Z" {...solid} />
      <rect x="4.5" y="8.5" width="16" height="8" rx="4" />
      <path d="M12.5 8.5v8" />
      <path d="M15 11h2.6" {...fine} />
    </g>
    <path d="M16.9 21.6v2.4c0 1.9 2.5 3.4 5.6 3.4s5.6-1.5 5.6-3.4v-2.4" {...tone} />
    <ellipse cx="22.5" cy="21.6" rx="5.6" ry="3.4" {...tone} />
    <path d="M20.2 21.6h4.6" {...fine} />
  </>
);

// Genetica: banded chromosome, sister chromatids joined at the centromere.
const chromatid = "M8.1 5.9a2.6 2.6 0 0 1 4.6-1.4l2.6 7c.4 1.2.3 3.3.3 4.5s.1 3.3-.3 4.5l-2.6 7a2.6 2.6 0 0 1-4.6-1.4l2.4-6.4c.7-1.8 1.4-2.7 1.4-3.7s-.7-1.9-1.4-3.7Z";
const genomics = (
  <>
    <path d={chromatid} {...tone} />
    <path d={chromatid} {...tone} transform="matrix(-1 0 0 1 32 0)" />
    <path d="M9.6 9.3 13.4 7.9M22.4 9.3l-3.8-1.4M9.6 22.7l3.8 1.4M22.4 22.7l-3.8 1.4" />
    <path d="M10.6 12.2l3.6-1.2M21.4 12.2l-3.6-1.2M10.6 19.8l3.6 1.2M21.4 19.8l-3.6 1.2" {...fine} {...faint} />
    <ellipse cx="16" cy="16" rx="1.9" ry="1.5" {...solid} />
  </>
);

// Patologia: injured cell, fragmented nucleus, shed apoptotic bodies.
const pathology = (
  <>
    <path d="M14.2 5.5c5.2-.2 9.4 3.4 9.7 8.6.3 5.4-3.3 9.8-8.8 10.2C9.6 24.7 5 21 4.7 15.6 4.4 10.2 8.8 5.7 14.2 5.5Z" {...tone} />
    <path d="M20.8 7.3 17.8 11.3l2.7 1.8-2.4 3.6" {...fine} />
    <circle cx="11.6" cy="14.4" r="2" {...solid} />
    <circle cx="14.8" cy="17.2" r="1.3" {...solid} />
    <circle cx="11.4" cy="18.8" r="1.1" {...solid} />
    <circle cx="25.4" cy="24.8" r="2.1" {...tone} />
    <circle cx="21" cy="27.6" r="1.1" {...solid} />
    <circle cx="27.6" cy="19.4" r="0.9" {...solid} />
  </>
);

// Fisiologia: lungs with trachea and bronchi.
const lung = "M13.4 10C9.4 10.3 5.7 16 5.4 22.6c-.1 2.6 1.5 4.1 4 3.6 2.6-.6 4.5-2 4.7-4.8l.6-10.1c.1-.8-.5-1.3-1.3-1.3Z";
const physiology = (
  <>
    <path d={lung} {...tone} />
    <path d={lung} {...tone} transform="matrix(-1 0 0 1 32 0)" />
    <path d="M16 3.5v9.3" />
    <path d="M16 12.6c0 1.8-1.3 2.9-3 3.5M16 12.6c0 1.8 1.3 2.9 3 3.5" />
    <path d="M11.2 17.8 9 20.4M10.4 22.4 8.6 23.6M20.8 17.8l2.2 2.6M21.6 22.4l1.8 1.2" {...fine} />
  </>
);

// Biostatistica: Gaussian curve over a histogram, with the mean.
const statistics = (
  <>
    <path d="M4.5 26c4.6 0 6.4-16.5 11.5-16.5S22.9 26 27.5 26Z" {...wash} />
    <path d="M10 18.5h3.2V26H10ZM14.4 12h3.2v14h-3.2ZM18.8 18.5H22V26h-3.2Z" {...wash} />
    <path d="M4.5 26c4.6 0 6.4-16.5 11.5-16.5S22.9 26 27.5 26" />
    <path d="M3.5 26.5h25" />
    <path d="M16 5.5v2.2" {...fine} />
    <circle cx="16" cy="9.5" r="1.5" {...solid} />
  </>
);

// Inglese: two speech bubbles, the front one lettered.
const language = (
  <>
    <path d="M15.5 9.8V7.5a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v5.8a3 3 0 0 1-3 3h-.4v3.2l-3.4-3.2" {...fine} />
    <circle cx="20.6" cy="8.6" r="0.9" {...solid} />
    <circle cx="23.6" cy="8.6" r="0.9" {...solid} />
    <path d="M6.5 10.5h12.5a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-7.2l-4.4 4v-4h-.9a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z" {...tone} />
    <path d="M7.4 19.6 9.8 13.8l2.4 5.8M8.3 17.6h3" {...fine} />
    <path d="M14.2 17.5c0-1.2.9-2 2-2s1.9.8 1.9 2-.8 2-1.9 2-2-.8-2-2ZM18.1 15.6v4" {...fine} />
  </>
);

// Mondo del lavoro: briefcase with curved flap and clasp.
const career = (
  <>
    <rect x="4.5" y="10.5" width="23" height="15.5" rx="3" {...tone} />
    <path d="M12 10.5V8.6a2.1 2.1 0 0 1 2.1-2.1h3.8A2.1 2.1 0 0 1 20 8.6v1.9" />
    <path d="M4.5 16.2c3.6 1.6 7.4 2.4 11.5 2.4s7.9-.8 11.5-2.4" {...fine} />
    <rect x="13.8" y="16.6" width="4.4" height="4.4" rx="1.2" {...solid} />
  </>
);

// Antropologia: skull with sockets, nasal aperture and teeth.
const anthropology = (
  <>
    <path d="M16 4.5C9.9 4.5 5.5 8.9 5.5 14.7c0 3.4 1.5 5.8 3.8 7.2V25a2 2 0 0 0 2 2h9.4a2 2 0 0 0 2-2v-3.1c2.3-1.4 3.8-3.8 3.8-7.2 0-5.8-4.4-10.2-10.5-10.2Z" {...tone} />
    <path d="M9.6 15.6c0-1.8 1.5-2.7 3.1-2.7s2.7 1.2 2.5 2.8c-.2 1.6-1.4 2.6-2.9 2.6s-2.7-1-2.7-2.7Z" {...solid} />
    <path d="M22.4 15.6c0-1.8-1.5-2.7-3.1-2.7s-2.7 1.2-2.5 2.8c.2 1.6 1.4 2.6 2.9 2.6s2.7-1 2.7-2.7Z" {...solid} />
    <path d="M16 18.9 14.9 21h2.2Z" {...solid} />
    <path d="M13.2 23.6V27M16 23.6V27M18.8 23.6V27" {...fine} />
  </>
);

// Ecotossicologia: veined leaf beside a falling drop.
const ecotoxicology = (
  <>
    <path d="M4.5 25C4 15 10 7 22.5 6c.6 12-6 19.5-18 19Z" {...tone} />
    <path d="M4.5 25 16.5 13" />
    <path d="M9 20.5V17M9 20.5h3.6M13 16.5v-3.9M13 16.5h3.8" {...fine} />
    <path d="M25 17.2c2 2.8 3.3 4.5 3.3 6.1a3.3 3.3 0 0 1-6.6 0c0-1.6 1.3-3.3 3.3-6.1Z" {...solid} />
  </>
);

// Modelli di malattia: lab mouse in profile.
const diseaseModel = (
  <>
    <path d="M15.45 12.5A3.3 3.3 0 1 1 21.3 13.8c-1.8-.9-3.7-1.3-5.85-1.3Z" {...tone} />
    <path d="M5.5 23.5c-.4-6.2 4.2-11 10.2-11 4.8 0 8 2.6 9.6 5.6l2.4 1.2c.9.5.8 1.8-.2 2.1l-2.3.7c-1.3 1.6-3.6 2.7-6.7 2.7H6.7c-.7 0-1.2-.6-1.2-1.3Z" {...tone} />
    <circle cx="21.8" cy="17.4" r="1.15" {...solid} />
    <circle cx="27.9" cy="19.9" r="0.9" {...solid} />
    <path d="M5.8 22.6c-2.5-.5-3.5 1.9-2.1 3.4 1.5 1.6 4.3 1.2 6.3 1.5" {...fine} />
    <path d="M11 24.8v1.7M18.6 24.8v1.7" {...fine} />
    <path d="M26.2 21.6l2.6 1.2M25.8 22.4l1.8 1.9" {...fine} {...faint} />
  </>
);

// Trasduzione del segnale: ligand on a receptor across the bilayer, cascade inside.
const signaling = (
  <>
    <path d="M3 12h26v5.5H3Z" {...wash} />
    <path d="M3 12h10.6M18.4 12H29M3 17.5h10.6M18.4 17.5H29" {...fine} />
    <circle cx="5.5" cy="12" r="1.1" {...solid} />
    <circle cx="9.5" cy="12" r="1.1" {...solid} />
    <circle cx="22.5" cy="12" r="1.1" {...solid} />
    <circle cx="26.5" cy="12" r="1.1" {...solid} />
    <circle cx="5.5" cy="17.5" r="1.1" {...solid} />
    <circle cx="9.5" cy="17.5" r="1.1" {...solid} />
    <circle cx="22.5" cy="17.5" r="1.1" {...solid} />
    <circle cx="26.5" cy="17.5" r="1.1" {...solid} />
    <path d="M16 21V10.4M16 10.4l-3.6-4.6M16 10.4l3.6-4.6" />
    <circle cx="16" cy="5" r="1.9" {...solid} />
    <path d="M12.6 22.6 16 25l3.4-2.4M12.6 26.4 16 28.8l3.4-2.4" {...fine} />
  </>
);

// Bersagli farmacologici: bullseye hit by a fletched arrow.
const drugTarget = (
  <>
    <circle cx="14" cy="18" r="9.5" {...tone} />
    <circle cx="14" cy="18" r="5.6" />
    <circle cx="14" cy="18" r="2.2" {...solid} />
    <path d="M14 18 26 6" />
    <path d="M26 6h3M26 6V3M23.8 8.2h3M23.8 8.2v-3" {...fine} />
  </>
);

// Biochimica clinica: capped blood tube, sample drop and medical cross.
const clinical = (
  <>
    <rect x="6.3" y="3.5" width="9.4" height="4.2" rx="1.3" {...solid} />
    <path d="M8 15h6v8.5a3 3 0 0 1-6 0Z" {...wash} />
    <path d="M8 7.7v15.8a3 3 0 0 0 6 0V7.7" />
    <path d="M8 11.5h3" {...fine} />
    <circle cx="22.8" cy="21.6" r="6" {...tone} />
    <path d="M22.8 18.4v6.4M19.6 21.6H26" />
    <path d="M23.4 4.5c1.6 2.2 2.6 3.5 2.6 4.8a2.6 2.6 0 0 1-5.2 0c0-1.3 1-2.6 2.6-4.8Z" {...solid} />
  </>
);

// Cellule staminali: asymmetric division, mother cell budding a daughter.
const stemCell = (
  <>
    <path d="M16.87 13.01A7 7 0 1 0 18.5 17.55 5 5 0 1 0 16.87 13.01Z" {...tone} />
    <circle cx="10.8" cy="18" r="2.7" {...fine} />
    <circle cx="11.4" cy="17.4" r="1.1" {...solid} />
    <circle cx="22.2" cy="13.6" r="1.7" {...solid} />
    <path d="M7 2.4c.4 2 1.4 3 3.4 3.4-2 .4-3 1.4-3.4 3.4-.4-2-1.4-3-3.4-3.4 2-.4 3-1.4 3.4-3.4Z" {...solid} />
    <path d="M26.2 22.6v4M24.2 24.6h4" {...fine} />
  </>
);

// Farmaci biologici: filled syringe.
const biotherapy = (
  <>
    <g transform="rotate(-45 16 16)">
      <path d="M10 12.5h8.2v7H10Z" {...wash} />
      <rect x="10" y="12.5" width="13.5" height="7" rx="1.3" />
      <path d="M18.2 12.5v7" />
      <path d="M12.6 12.5v2.4M15.2 12.5v2.4" {...fine} />
      <path d="M23.5 11v10M23.5 16h4M27.5 12.6v6.8" />
      <path d="M10 14.6H7.6v2.8H10" />
      <path d="M7.6 16H3" {...fine} />
    </g>
    <circle cx="5.4" cy="28.2" r="1.2" {...solid} />
  </>
);

// Fisiologia cellulare: mitochondrion with cristae.
const cellPhysiology = (
  <>
    <g transform="rotate(-28 16 16)">
      <ellipse cx="16" cy="16" rx="12" ry="7.2" {...tone} />
      <path d="M6.8 16c1.4 0 1.5-3.4 3-3.4s1.4 6.8 3 6.8 1.5-6.8 3.1-6.8 1.5 6.8 3.1 6.8 1.5-6.8 3-6.8 1.6 3.4 3 3.4" {...fine} />
    </g>
  </>
);

// Sistema endocrino: thyroid lobes on the trachea, hormone granules.
const endocrine = (
  <>
    <path d="M13.8 3.5v9.4M18.2 3.5v9.4M13.8 21.6v6.9M18.2 21.6v6.9" {...fine} />
    <path d="M13.8 6.6h4.4M13.8 25.4h4.4" {...fine} />
    <path d="M16 14.5c-1.3-1-2.5-1.4-3.6-1.4-.5-2.6-2.1-4.4-4.2-4.4C5.3 8.7 4 12.2 4 16.2 4 21 6.4 24 9.3 24c2.4 0 4.6-1.6 6.7-4.5 2.1 2.9 4.3 4.5 6.7 4.5 2.9 0 5.3-3 5.3-7.8 0-4-1.3-7.5-4.2-7.5-2.1 0-3.7 1.8-4.2 4.4-1.1 0-2.3.4-3.6 1.4Z" {...tone} />
    <path d="M8.2 12.6c-1.3 1.6-1.7 4.4-.8 6.8M23.8 12.6c1.3 1.6 1.7 4.4.8 6.8" {...fine} {...faint} />
  </>
);

// Microbiologia: Petri dish with colonies on agar.
const microbiology = (
  <>
    <circle cx="16" cy="16" r="12" />
    <circle cx="16" cy="16" r="9.4" {...wash} />
    <circle cx="12.2" cy="12.6" r="1.7" {...solid} />
    <circle cx="19.8" cy="11.8" r="1.1" {...solid} />
    <circle cx="20.2" cy="19" r="2" {...solid} />
    <circle cx="16.4" cy="15.6" r="0.9" {...solid} />
    <circle cx="12.4" cy="19.8" r="2.5" {...tone} />
    <path d="M8.2 7.6A11.6 11.6 0 0 1 12 5" {...fine} {...faint} />
  </>
);

// Neuroanatomia: brain in lateral view with cerebellum and brainstem.
const brain = (
  <>
    <path d="M24 21.8c2.6-1 4-3.4 4-6.4C28 9.6 22.5 5.5 15.6 5.5 8.8 5.5 4 9.6 4 15c0 4 2.6 6.9 6.4 7.4 1.6.2 2.9-.2 4-1l3 .9c1.8.5 3.5.3 5-.6Z" {...tone} />
    <path d="M18.8 22.4c.4 2.3 2.5 3.8 4.8 3.4 2.2-.4 3.6-2.2 3.4-4.3-1.1.6-2.1.8-3 .3" {...wash} />
    <path d="M18.8 22.4c.4 2.3 2.5 3.8 4.8 3.4 2.2-.4 3.6-2.2 3.4-4.3" />
    <path d="M18.4 23.2c-.3 1.9-.8 3.5-1.8 5" />
    <path d="M9.6 17.4c2.8-1 5.8-.8 8.4 1" {...fine} />
    <path d="M16.6 5.9c-.8 2.6.6 4.8-.4 7.6" {...fine} />
    <path d="M8.4 12.6c1.6-1.6 4-1.6 5.4-.2M20 9.6c1.6.6 2.6 2 2.6 3.8M21 17.4c1.4-.4 2.8 0 3.8 1" {...fine} />
  </>
);

// Neurofisiologia: neuron with dendrites, myelinated axon and terminal boutons.
const neuron = (
  <>
    <circle cx="9.6" cy="10.4" r="4.3" {...tone} />
    <circle cx="9.6" cy="10.4" r="1.5" {...solid} />
    <path d="M6.7 7.4C5.6 6.3 5 4.9 4.9 3.1M5.6 6C4.6 5.5 3.6 5.4 2.6 5.6M5.4 11.9c-1.3.5-2.6.4-3.6-.4M7.1 14.2c-.5 1.5-1.4 2.6-2.8 3.3M11.9 6.5c.4-1.5 1.3-2.7 2.8-3.4M13.2 4.6c-.2-.8-.6-1.6-1.2-2.2" {...fine} />
    <path d="M12.7 13.5 24.9 25.7" />
    <rect x="-2.7" y="-1.8" width="5.4" height="3.6" rx="1.8" transform="translate(17.2 18) rotate(45)" {...tone} />
    <rect x="-2.7" y="-1.8" width="5.4" height="3.6" rx="1.8" transform="translate(21.7 22.5) rotate(45)" {...tone} />
    <path d="M24.9 25.7l3 .6M24.9 25.7l.6 3M24.9 25.7l2.6 2.6" {...fine} />
    <circle cx="28.2" cy="26.4" r="1.1" {...solid} />
    <circle cx="25.6" cy="29" r="1.1" {...solid} />
    <circle cx="27.8" cy="28.6" r="1.1" {...solid} />
  </>
);

// Oncologia: awareness ribbon.
const oncology = (
  <>
    <path
      d="M12.4 19.4C10.2 16.4 8 13.6 8 9.4a8 6.8 0 0 1 16 0c0 4.2-2.2 7-4.4 10l4.7 6a1.3 1.3 0 0 1-.3 1.9l-2.5 1.8a1.3 1.3 0 0 1-1.8-.3L16 23.8l-3.7 5a1.3 1.3 0 0 1-1.8.3L8 27.3a1.3 1.3 0 0 1-.3-1.9ZM16 15.4c-1.5-1.8-2.8-3.4-2.8-5.2a2.8 2.8 0 0 1 5.6 0c0 1.8-1.3 3.4-2.8 5.2Z"
      fillRule="evenodd"
      {...tone}
    />
    <path d="M12.4 19.4 16 15.4M16 23.8l3.6-4.4" />
    <path d="M16 23.8 19.6 19.4l4.7 6a1.3 1.3 0 0 1-.3 1.9l-2.5 1.8a1.3 1.3 0 0 1-1.8-.3Z" {...wash} />
  </>
);

// Patologia cellulare: magnifier on a cell with an irregular nucleus.
const cellPathology = (
  <>
    <circle cx="13.5" cy="13.5" r="9" {...tone} />
    <path d="M20 20 27 27" strokeWidth={3.6} />
    <path d="M13.7 8.6c2.9 0 5 2.1 5 4.9s-2.3 5.1-5.2 5.1-4.8-2.1-4.8-5c0-2.8 2.1-5 5-5Z" {...fine} />
    <path d="M12.2 11.8c.9-.9 2.6-.8 3.1.4.4 1 .1 1.6.7 2.3.5.8-.3 1.9-1.4 1.7-1.2-.2-1.5-.9-2.4-1.1-1.1-.4-1-2.4 0-3.3Z" {...solid} />
  </>
);

// Epidemiologia e prevenzione: globe with outbreak hotspots.
const epidemiology = (
  <>
    <circle cx="16" cy="16" r="11.8" {...tone} />
    <ellipse cx="16" cy="16" rx="5" ry="11.8" {...fine} />
    <path d="M4.2 16h23.6M6 10h20M6 22h20" {...fine} {...faint} />
    <circle cx="10.6" cy="11.2" r="1.7" {...solid} />
    <circle cx="10.6" cy="11.2" r="3.6" {...fine} />
    <circle cx="21" cy="19.6" r="1.4" {...solid} />
  </>
);

// Cardiovascolare e metabolico: heart crossed by an ECG trace.
const cardiovascular = (
  <>
    <path d="M16 27.5C9.5 23.2 4.5 18.4 4.5 12.2c0-3.7 2.7-6.6 6.3-6.6 2.2 0 4 1.1 5.2 2.9 1.2-1.8 3-2.9 5.2-2.9 3.6 0 6.3 2.9 6.3 6.6 0 6.2-5 11-11.5 15.3Z" {...tone} />
    <path d="M2.5 16.5h7l1.8-3.6 2.8 7.4 2.6-9 2.2 5.2h10.6" />
    <path d="M8.2 10.4c.5-1.1 1.4-1.8 2.6-2" {...fine} {...faint} />
  </>
);

// Malattie neuromuscolari: motor nerve ending on striated muscle fibers.
const neuromuscular = (
  <>
    <rect x="3.5" y="15" width="25" height="6.2" rx="3.1" {...tone} />
    <rect x="3.5" y="22.6" width="25" height="6.2" rx="3.1" {...tone} />
    <path d="M8.5 15.8v4.6M12.5 15.8v4.6M23.5 15.8v4.6M8.5 23.4V28M12.5 23.4V28M16.5 23.4V28M20.5 23.4V28M24.5 23.4V28" {...fine} {...faint} />
    <path d="M8 3.5c0 3.6 3.2 4.6 6.4 5.6 2.4.8 3.6 2 3.6 4" />
    <path d="M18 13.1 15.6 14M18 13.1l2.4.9" {...fine} />
    <circle cx="15" cy="14.2" r="1.3" {...solid} />
    <circle cx="21" cy="14.2" r="1.3" {...solid} />
  </>
);

// Biologia molecolare: double helix with base pairs.
const dna = (
  <>
    <path d="M16 9.75C13 8.4 10 6.8 10 3.5h12c0 3.3-3 4.9-6 6.25ZM16 9.75c3 1.35 6 3 6 6.25s-3 4.9-6 6.25c-3-1.35-6-3-6-6.25s3-4.9 6-6.25ZM16 22.25c3 1.35 6 2.95 6 6.25H10c0-3.3 3-4.9 6-6.25Z" {...wash} fillOpacity={0.16} />
    <path d="M10 3.5C10 10 22 10 22 16S10 22 10 28.5" />
    <path d="M22 3.5C22 10 10 10 10 16s12 6 12 12.5" {...faint} />
    <path d="M11.9 7.4h8.2M11.9 24.6h8.2" />
    <path d="M11.9 12.4h8.2M11.9 19.6h8.2" {...faint} />
    <circle cx="16" cy="9.8" r="1.5" {...solid} />
    <circle cx="16" cy="22.2" r="1.5" {...solid} />
  </>
);

// Diagnostica di laboratorio: microplate with reacting wells.
const wells = [8.5, 13.5, 18.5, 23.5].flatMap((x) => [12.5, 16.5, 20.5].map((y) => [x, y] as const));
const positive = new Set(["8.5,12.5", "13.5,16.5", "18.5,12.5", "23.5,20.5", "18.5,20.5"]);
const diagnostics = (
  <>
    <path d="M6.5 7.5h19a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-19a3 3 0 0 1-3-3v-8.5l3-3.5Z" {...tone} />
    {wells.map(([x, y]) =>
      positive.has(`${x},${y}`) ? <circle key={`${x},${y}`} cx={x} cy={y} r="1.65" {...solid} /> : <circle key={`${x},${y}`} cx={x} cy={y} r="1.4" {...fine} />
    )}
  </>
);

// Bioinformatica: double helix between code brackets.
const bioinformatics = (
  <>
    <path d="M12.5 6C12.5 11 19.5 11 19.5 16S12.5 21 12.5 26H19.5C19.5 21 12.5 21 12.5 16S19.5 11 19.5 6Z" {...wash} />
    <path d="M12.5 6c0 5 7 5 7 10s-7 5-7 10M19.5 6c0 5-7 5-7 10s7 5 7 10" />
    <path d="M13.6 8.8h4.8M13.6 23.2h4.8" {...fine} />
    <path d="M8 10.5 3 16l5 5.5M24 10.5l5 5.5-5 5.5" />
  </>
);

// Immunologia: shield shaded on one side, antibody in front.
const immunology = (
  <>
    <path d="M16 3.8 26 7.6v7.6c0 6.4-4.2 11-10 13.2C10.2 26.2 6 21.6 6 15.2V7.6Z" {...tone} />
    <path d="M16 3.8 26 7.6v7.6c0 6.4-4.2 11-10 13.2Z" {...wash} />
    <path d="M11.6 10.4 16 15.4l4.4-5M16 15.4v6.8" />
    <circle cx="11.4" cy="10.2" r="1.5" {...solid} />
    <circle cx="20.6" cy="10.2" r="1.5" {...solid} />
  </>
);

// Tecniche di indagine: compound microscope in profile.
const microscope = (
  <>
    <g transform="rotate(-24 14.4 9.8)">
      <rect x="12.4" y="4.6" width="4" height="10.8" rx="1" {...tone} />
      <rect x="11.6" y="2.4" width="5.6" height="2.4" rx="0.9" {...solid} />
      <path d="M14.4 15.4v2.4" />
    </g>
    <path d="M17 9.4c4.2.5 7.2 4 7.2 8.3 0 2.6-1 4.9-2.8 6.8" />
    <path d="M11.5 19.6h12" />
    <path d="M13.6 18.2h4.2" {...fine} />
    <circle cx="17.6" cy="22.2" r="1" {...solid} />
    <rect x="7" y="24.5" width="18" height="3.6" rx="1.8" {...tone} />
  </>
);

// Tirocinio: lab coat with lapels, buttons and a pen in the pocket.
const internship = (
  <>
    <path d="M11.8 4.5h8.4l5.2 2.3c1.3.6 2.1 1.9 2.1 3.3V26a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 26V10.1c0-1.4.8-2.7 2.1-3.3Z" {...tone} />
    <path d="M12.6 4.5 16 12l3.4-7.5" {...wash} />
    <path d="M11.8 4.5 10.2 10l2.6.8L16 17l3.2-6.2 2.6-.8-1.6-5.5" {...fine} />
    <path d="M16 17v10.5M8.6 13v14.5M23.4 13v14.5" {...fine} />
    <circle cx="16" cy="20.4" r="1" {...solid} />
    <circle cx="16" cy="24.2" r="1" {...solid} />
    <path d="M18.6 15.2h3.4" {...fine} />
    <path d="M20.6 12.4v2.8" />
  </>
);

// Prova finale: mortarboard with tassel.
const thesis = (
  <>
    <path d="M9 13.8 16 17l7-3.2v6.4c0 2-3.2 3.6-7 3.6s-7-1.6-7-3.6Z" {...wash} />
    <path d="M9 13.8v6.4c0 2 3.2 3.6 7 3.6s7-1.6 7-3.6v-6.4" />
    <path d="M16 5 29 11 16 17 3 11Z" {...tone} />
    <path d="M16 11l8.5 3.4v7.4" {...fine} />
    <path d="M23.3 21.8h2.4l.7 3.8h-3.8Z" {...solid} />
    <circle cx="16" cy="11" r="1.2" {...solid} />
  </>
);

// Brevetti: document with an idea bulb and a certification seal.
const patent = (
  <>
    <path d="M17.5 4.5H7A1.5 1.5 0 0 0 5.5 6v20A1.5 1.5 0 0 0 7 27.5h10V22a5 5 0 0 1 6.5-4.8v-6.7Z" {...wash} />
    <path d="M16.5 27.5H7A1.5 1.5 0 0 1 5.5 26V6A1.5 1.5 0 0 1 7 4.5h10.5l6 6v6.6" />
    <path d="M17.5 4.5v4.5a1.5 1.5 0 0 0 1.5 1.5h4.5" {...fine} />
    <path d="M12.2 8.6a3.7 3.7 0 0 0-2 6.8v1.6h4v-1.6a3.7 3.7 0 0 0-2-6.8ZM10.9 19.4h2.6" {...fine} />
    <circle cx="22.5" cy="22" r="4.4" {...tone} />
    <circle cx="22.5" cy="22" r="1.6" {...solid} />
    <path d="M20.4 25.9 19.6 29.5l2.9-1.3 2.9 1.3-.8-3.6" {...fine} />
  </>
);

// Fallback: open book.
const book = (
  <>
    <path d="M16 8.2C13.2 6 9.6 5.4 4.5 6.2v19c5.1-.8 8.7-.2 11.5 2 2.8-2.2 6.4-2.8 11.5-2v-19c-5.1-.8-8.7-.2-11.5 2Z" {...tone} />
    <path d="M16 8.2v19" />
    <path d="M8 11.4c1.9-.2 3.6 0 5 .6M8 15.4c1.9-.2 3.6 0 5 .6M19 12c1.4-.6 3.1-.8 5-.6M19 16c1.4-.6 3.1-.8 5-.6" {...fine} />
  </>
);

const symbols: Record<CourseSymbol | "unknown", ReactNode> = {
  patent,
  anatomy,
  receptor: pharmacology,
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
  biotherapy,
  "cell-physiology": cellPhysiology,
  endocrine,
  microbiology,
  brain,
  neuron,
  oncology,
  "cell-pathology": cellPathology,
  epidemiology,
  cardiovascular,
  neuromuscular,
  dna,
  diagnostics,
  bioinformatics,
  immunology,
  microscope,
  internship,
  thesis,
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
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {symbols[kind]}
    </svg>
  );
}
