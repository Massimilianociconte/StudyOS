// Corso del catalogo BARB di una materia (per la sua icona). Il catalogo è grande e si carica a parte,
// una volta sola per tutta l'app; finché non arriva le materie usano l'icona scelta da chi studia.
import { useEffect, useState } from "react";
import type { Subject } from "../types";
import type { BarbCourse } from "./university/types";

type CourseLookup = (subject: Subject) => BarbCourse | null;

let ready: CourseLookup | null = null;
let pending: Promise<CourseLookup> | null = null;

const load = () =>
  (pending ??= Promise.all([import("./university/examSessions"), import("../data/university/barb.dataset")]).then(([sessions, data]) => {
    // Una materia (stesso oggetto dello store) si risolve una volta: le liste di schede la chiedono spesso.
    const memo = new WeakMap<Subject, BarbCourse | null>();
    ready = (subject) => {
      if (memo.has(subject)) return memo.get(subject) ?? null;
      const course = sessions.resolveBarbCourse(subject, data.BARB_DATASET.courses);
      memo.set(subject, course);
      return course;
    };
    return ready;
  }));

export function useCourseLookup(enabled: boolean): CourseLookup | null {
  const [lookup, setLookup] = useState<CourseLookup | null>(() => ready);
  useEffect(() => {
    if (!enabled || lookup) return;
    let alive = true;
    load()
      .then((found) => {
        if (alive) setLookup(() => found);
      })
      .catch(() => {
        // Rete assente: si riprova al prossimo montaggio, intanto resta l'icona della materia.
        pending = null;
      });
    return () => {
      alive = false;
    };
  }, [enabled, lookup]);
  return lookup;
}
