// Segno di una materia, lo stesso della sezione Materie: copertina, icona del corso del catalogo o icona
// scelta, sul colore della materia. Si passa l'id: la materia si legge dallo store. Senza materia, o con
// una materia che non è tua (raccolta condivisa da un'altra persona), resta l'icona di riserva.
import { Suspense } from "react";
import { lazyView } from "../lib/lazyView";
import { safeCssColor } from "../lib/sharing";
import { COURSE_INK, DARK_INK, inkOn } from "../lib/subjectInk";
import { useCourseLookup } from "../lib/useCourseLookup";
import { useStudyStore } from "../store/useStudyStore";
import type { Subject } from "../types";
import { Icon } from "./Icon";

const CourseIcon = lazyView(() => import("./CourseIcon"), "CourseIcon");

const SIZES = {
  sm: { box: "h-6 w-6 rounded-[8px]", icon: "h-3.5 w-3.5", course: "h-5 w-5" },
  md: { box: "h-9 w-9 rounded-[12px]", icon: "h-4.5 w-4.5", course: "h-7 w-7" }
} as const;

/** La materia con quell'id (null se manca o non è tua). */
export const useSubject = (subjectId: string | undefined): Subject | null =>
  useStudyStore((state) => (subjectId ? (state.subjects.find((subject) => subject.id === subjectId) ?? null) : null));

export function SubjectMark({
  subjectId,
  size = "md",
  fallback = "Layers",
  className = ""
}: {
  subjectId: string | undefined;
  size?: keyof typeof SIZES;
  /** Icona quando la materia non c'è. */
  fallback?: string;
  className?: string;
}) {
  const subject = useSubject(subjectId);
  const lookup = useCourseLookup(Boolean(subject));
  const course = subject && lookup ? lookup(subject) : null;
  const sizes = SIZES[size];

  if (!subject) {
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center bg-[var(--surface-strong)] text-[var(--accent-ink)] ${sizes.box} ${className}`}>
        <Icon name={fallback} className={sizes.icon} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      title={subject.name}
      className={`grid shrink-0 grid-cols-1 place-items-center overflow-hidden ${sizes.box} ${className}`}
      style={{ background: safeCssColor(subject.color) || "var(--accent)", color: inkOn(subject.color, course ? COURSE_INK : DARK_INK) }}
    >
      {subject.cover ? (
        <img src={subject.cover} alt="" className="h-full w-full object-cover" />
      ) : course ? (
        <Suspense fallback={<span className={sizes.course} />}>
          <CourseIcon course={course} className={sizes.course} />
        </Suspense>
      ) : (
        <Icon name={subject.icon || "BookOpen"} className={sizes.icon} />
      )}
    </span>
  );
}
