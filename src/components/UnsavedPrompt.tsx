import { Button } from "./ui";

/**
 * «Scartare le modifiche?» sul posto dei pulsanti (come in Attività, Materie, Note e Sessioni): i testi
 * li passa la schermata. «Continua a modificare» prende il focus, così un Invio non scarta nulla.
 */
export function UnsavedPrompt({
  title,
  text,
  keep,
  discard,
  onKeep,
  onDiscard,
  className = "bg-[var(--surface-soft)]"
}: {
  title: string;
  text: string;
  keep: string;
  discard: string;
  onKeep: () => void;
  onDiscard: () => void;
  /** Sfondo: dentro un riquadro già grigio (modifica in riga) si usa quello della pagina. */
  className?: string;
}) {
  return (
    <div role="group" aria-label={title} className={`rounded-[18px] p-3 ${className}`}>
      <p className="text-sm font-black">{title}</p>
      <p className="text-sm font-bold text-[var(--muted)]">{text}</p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="soft" onClick={onKeep} autoFocus>
          {keep}
        </Button>
        <Button variant="danger" icon="X" onClick={onDiscard}>
          {discard}
        </Button>
      </div>
    </div>
  );
}
