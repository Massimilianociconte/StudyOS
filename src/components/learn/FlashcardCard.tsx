// Una flashcard che si gira: fronte e retro nella stessa cella della griglia (l'altezza è quella del
// lato più alto, niente salti), rotazione 3D; con «riduci movimento» cambia solo in dissolvenza.
// Fronte sfumato col colore della materia, retro con l'accento: si capisce subito quale lato si legge.
// Un testo breve va grande e al centro; elenchi, tabelle e testi lunghi a sinistra, a misura di lettura.
// Nella sessione (`fill`) la scheda occupa l'altezza libera dello spazio che la contiene (unità cqh del
// contenitore), con un massimo: su ogni schermo resta una carta, non una striscia o una colonna.
import { m, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { isShortCardText } from "../../lib/learnSession";
import { LEARN_TEXT, RESULT_LABEL } from "../../lib/labels/learn";
import { safeCssColor } from "../../lib/sharing";
import type { CardBlock, Flashcard, ReviewResult } from "../../types";
import { Icon } from "../Icon";
import { Button } from "../ui";
import { SubjectMark, useSubject } from "../SubjectMark";
import { Blocks } from "./Blocks";

const ANSWER_TONE: Record<ReviewResult, string> = {
  correct: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]",
  wrong: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]",
  doubt: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]",
  skip: "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
};
const ANSWER_ICON: Record<ReviewResult, string> = { correct: "Check", wrong: "X", doubt: "CircleDot", skip: "SkipForward" };

function Content({ blocks, external, className = "" }: { blocks: readonly CardBlock[]; external: boolean; className?: string }) {
  const big = isShortCardText(blocks);
  return (
    <div
      className={`w-full min-w-0 ${
        big
          ? "text-center text-[clamp(1.25rem,0.95rem+1.4vw,2rem)] font-extrabold leading-snug short:text-xl"
          : "text-left text-[1.02rem] leading-relaxed sm:text-lg short:text-base"
      } ${className}`}
    >
      <Blocks blocks={blocks} external={external} />
    </div>
  );
}

function Face({
  label,
  hidden,
  back,
  children,
  reduce,
  fill,
  subject,
  answered,
  hint,
  top
}: {
  label: string;
  hidden: boolean;
  back?: boolean;
  children: ReactNode;
  reduce: boolean;
  fill: boolean;
  subject: { id: string; name: string } | null;
  answered?: ReviewResult;
  hint?: string;
  /** Sopra il contenuto, fuori dal centro verticale (la domanda sul retro). */
  top?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      aria-hidden={hidden}
      // inert: i link della faccia nascosta non ricevono il focus.
      {...(hidden ? { inert: true } : {})}
      data-side={back ? "back" : "front"}
      className={`flash-face flex min-w-0 flex-col p-5 [grid-area:1/1] sm:p-7 short:p-4 ${
        fill ? "min-h-[min(calc(100cqh-2.75rem),36rem)] short:min-h-[calc(100cqh-1.5rem)]" : "min-h-[min(46vh,22rem)]"
      } ${reduce && hidden ? "invisible" : ""}`}
      style={reduce ? undefined : { backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: back ? "rotateY(180deg)" : undefined }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {subject ? (
          // La materia della scheda, con la sua icona: si riconosce a colpo d'occhio di cosa si parla.
          <>
            <SubjectMark subjectId={subject.id} size="sm" />
            <span className="one-line-safe min-w-0 flex-1 text-left text-xs font-extrabold text-[var(--muted)]">{subject.name}</span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        {answered ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${ANSWER_TONE[answered]}`}
            title={LEARN_TEXT.yourAnswerWas(RESULT_LABEL[answered])}
          >
            <Icon name={ANSWER_ICON[answered]} className="h-3 w-3" />
            <span className="sr-only">{LEARN_TEXT.yourAnswerWas(RESULT_LABEL[answered])}</span>
            <span aria-hidden="true">{RESULT_LABEL[answered]}</span>
          </span>
        ) : null}
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${
            back ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent-ink)]" : "bg-[var(--surface-strong)] text-[var(--muted)]"
          }`}
        >
          <Icon name={back ? "Lightbulb" : "CircleHelp"} className="h-3.5 w-3.5" />
          {label}
        </span>
      </div>
      {top}
      <div className="flex min-w-0 flex-1 flex-col justify-center py-4 short:py-2">{children}</div>
      {hint ? (
        <p aria-hidden="true" className="flex items-center justify-center gap-1.5 text-xs font-bold text-[var(--faint)] short:hidden">
          <Icon name="RotateCcw" className="h-3.5 w-3.5" />
          {hint}
        </p>
      ) : null}
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
  questionOnBack = false,
  fill = false,
  stack = 0,
  answered,
  hint
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
  /** Occupa l'altezza del contenitore (che deve avere `container-type: size`), fino a un massimo. */
  fill?: boolean;
  /** Quante schede si vedono dietro (0–2): la pila che resta da ripassare. */
  stack?: number;
  /** Risposta già data a questa scheda (si è tornati indietro). */
  answered?: ReviewResult;
  /** Suggerimento in fondo al fronte («Tocca per girare»). */
  hint?: string;
}) {
  const reduce = useReducedMotion() === true;
  // Solo le materie tue: una scheda condivisa da un'altra persona ha l'id di una sua materia.
  const found = useSubject(card.subjectId);
  const subject = found ? { id: found.id, name: found.name } : null;
  const tint = found ? safeCssColor(found.color) : "";
  const layers = Math.max(0, Math.min(2, stack));
  return (
    <div className={`relative min-w-0 [perspective:1600px] ${layers > 1 ? "pb-3" : layers ? "pb-1.5" : ""} short:pb-0`} style={tint ? ({ "--card-tint": tint } as CSSProperties) : undefined}>
      {/* La pila: ogni scheda dietro sporge di 6px sotto quella davanti. */}
      {layers > 1 ? <div aria-hidden="true" className="flash-stack absolute inset-x-7 bottom-0 top-3 opacity-40 short:hidden" /> : null}
      {layers > 0 ? <div aria-hidden="true" className={`flash-stack absolute inset-x-3.5 top-1.5 opacity-70 short:hidden ${layers > 1 ? "bottom-1.5" : "bottom-0"}`} /> : null}
      <m.div
        className="relative grid min-w-0 cursor-pointer select-text [transform-style:preserve-3d]"
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
        <Face label={LEARN_TEXT.question} hidden={flipped} reduce={reduce} fill={fill} subject={subject} answered={answered} hint={hint}>
          <Content blocks={card.front} external={external} />
        </Face>
        <Face
          label={LEARN_TEXT.answer}
          hidden={!flipped}
          back
          reduce={reduce}
          fill={fill}
          subject={subject}
          answered={answered}
          top={
            questionOnBack && flipped ? (
              <div className="mt-4 border-b border-[var(--border)] pb-3 text-left text-sm font-semibold text-[var(--muted)] sm:text-base short:mt-2 short:pb-2">
                <Blocks blocks={card.front} external={external} />
              </div>
            ) : null
          }
        >
          <Content blocks={card.back} external={external} />
          {card.explanation?.length ? (
            <div className="mt-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-left text-sm sm:text-base">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-black uppercase text-[var(--faint)]">
                <Icon name="Info" className="h-3.5 w-3.5" />
                {LEARN_TEXT.explanation}
              </p>
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
