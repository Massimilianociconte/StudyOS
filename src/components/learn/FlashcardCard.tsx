// Una flashcard che si gira: fronte e retro nella stessa cella della griglia (l'altezza è quella del
// lato più alto, niente salti), rotazione 3D; con «riduci movimento» cambia solo in dissolvenza.
import { m, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { Flashcard } from "../../types";
import { Button } from "../ui";
import { SubjectMark, useSubject } from "../SubjectMark";
import { Blocks } from "./Blocks";

function Face({
  label,
  hidden,
  back,
  children,
  reduce,
  subject
}: {
  label: string;
  hidden: boolean;
  back?: boolean;
  children: ReactNode;
  reduce: boolean;
  subject: { id: string; name: string } | null;
}) {
  return (
    <section
      aria-label={label}
      aria-hidden={hidden}
      // inert: i link della faccia nascosta non ricevono il focus.
      {...(hidden ? { inert: true } : {})}
      className={`soft-panel flex min-h-[min(46vh,22rem)] min-w-0 flex-col p-5 text-center [grid-area:1/1] sm:p-7 ${reduce && hidden ? "invisible" : ""}`}
      style={reduce ? undefined : { backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: back ? "rotateY(180deg)" : undefined }}
    >
      {subject ? (
        // La materia della scheda, con la sua icona: si riconosce a colpo d'occhio di cosa si parla.
        <div className="mb-3 flex min-w-0 items-center gap-2 text-left">
          <SubjectMark subjectId={subject.id} size="sm" />
          <span className="one-line-safe min-w-0 flex-1 text-xs font-extrabold text-[var(--muted)]">{subject.name}</span>
          <span className="shrink-0 text-xs font-black uppercase tracking-wide text-[var(--faint)]">{label}</span>
        </div>
      ) : (
        <span className="mb-3 text-xs font-black uppercase tracking-wide text-[var(--faint)]">{label}</span>
      )}
      <div className="m-auto w-full min-w-0 text-[1.05rem] leading-relaxed sm:text-lg">{children}</div>
    </section>
  );
}

export function FlashcardCard({
  card,
  flipped,
  onFlip,
  external = false,
  footer,
  flipButton = false,
  questionOnBack = false
}: {
  card: Flashcard;
  flipped: boolean;
  onFlip: () => void;
  external?: boolean;
  footer?: ReactNode;
  /** Pulsante «Mostra la risposta / la domanda» sotto la scheda: da tastiera e con lo screen reader la
   * scheda si gira da qui (il clic sulla scheda resta per il tocco). La sessione ha già i suoi comandi. */
  flipButton?: boolean;
  /** Sul retro, sopra la risposta, la domanda in piccolo: si confrontano senza rigirare. Solo a scheda
   * girata, così la domanda non è due volte nella pagina mentre si legge il fronte. */
  questionOnBack?: boolean;
}) {
  const reduce = useReducedMotion() === true;
  // Solo le materie tue: una scheda condivisa da un'altra persona ha l'id di una sua materia.
  const found = useSubject(card.subjectId);
  const subject = found ? { id: found.id, name: found.name } : null;
  return (
    <div className="min-w-0 [perspective:1600px]">
      <m.div
        className="grid min-w-0 cursor-pointer select-text [transform-style:preserve-3d]"
        onClick={(event) => {
          // Un clic su un link, un pulsante o una selezione di testo non gira la scheda.
          if ((event.target as HTMLElement).closest("a, button") || window.getSelection()?.toString()) return;
          onFlip();
        }}
        initial={false}
        animate={reduce ? { opacity: [0.6, 1] } : { rotateY: flipped ? 180 : 0 }}
        key={reduce ? String(flipped) : "card"}
        transition={reduce ? { duration: 0.15 } : { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <Face label={LEARN_TEXT.question} hidden={flipped} reduce={reduce} subject={subject}>
          <Blocks blocks={card.front} external={external} />
        </Face>
        <Face label={LEARN_TEXT.answer} hidden={!flipped} back reduce={reduce} subject={subject}>
          {questionOnBack && flipped ? (
            <div className="mb-4 border-b border-[var(--border)] pb-3 text-sm text-[var(--muted)] sm:text-base">
              <Blocks blocks={card.front} external={external} />
            </div>
          ) : null}
          <Blocks blocks={card.back} external={external} />
          {card.explanation?.length ? (
            <div className="mt-4 border-t border-[var(--border)] pt-3 text-left text-base">
              <p className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.explanation}</p>
              <Blocks blocks={card.explanation} external={external} />
            </div>
          ) : null}
          {footer}
        </Face>
      </m.div>
      {flipButton ? (
        <div className="mt-3 flex justify-center">
          {/* Il nome dice cosa succede al clic (cambia con il lato): niente aria-pressed, che vuole un nome fisso. */}
          <Button variant="soft" icon="RotateCcw" onClick={onFlip}>
            {flipped ? LEARN_TEXT.showQuestion : LEARN_TEXT.showAnswer}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
