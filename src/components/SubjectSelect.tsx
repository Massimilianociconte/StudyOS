// Tendina delle materie: ogni voce con il segno della materia (copertina, icona del corso o icona scelta
// sul suo colore), lo stesso della sezione Materie, così si riconosce a colpo d'occhio. Le materie di
// un'altra persona (calendario condiviso) non sono nello store: si mostrano con il loro colore.
import { safeCssColor } from "../lib/sharing";
import { DARK_INK, inkOn } from "../lib/subjectInk";
import { Icon } from "./Icon";
import { IconMark, IconSelect, type IconSelectOption } from "./IconSelect";
import { SubjectMark, useSubject } from "./SubjectMark";

export interface SubjectChoice {
  id: string;
  name: string;
  color?: string;
}

export function SubjectOptionMark({ subject }: { subject: SubjectChoice }) {
  const own = useSubject(subject.id);
  if (own) return <SubjectMark subjectId={subject.id} size="sm" />;
  return (
    <span
      aria-hidden="true"
      className="grid h-6 w-6 shrink-0 grid-cols-1 place-items-center rounded-[8px]"
      style={{ background: safeCssColor(subject.color ?? "") || "var(--accent)", color: inkOn(subject.color ?? "", DARK_INK) }}
    >
      <Icon name="BookOpen" className="h-3.5 w-3.5" />
    </span>
  );
}

export function SubjectSelect({
  value,
  onChange,
  subjects,
  none,
  placeholder,
  label,
  id,
  disabled
}: {
  value: string;
  onChange: (subjectId: string) => void;
  subjects: readonly SubjectChoice[];
  /** Voce senza materia (valore ""), con questo testo. Assente: la materia va scelta. */
  none?: string;
  /** Testo del campo finché la materia non è scelta (senza voce `none`). */
  placeholder?: string;
  /** Nome della tendina quando non sta dentro un Field. */
  label?: string;
  /** Id del campo, per un <label htmlFor> (HelpField). */
  id?: string;
  disabled?: boolean;
}) {
  const options: IconSelectOption[] = [
    ...(none !== undefined ? [{ value: "", label: none, mark: <IconMark name="Layers" /> }] : []),
    ...subjects.map((subject) => ({ value: subject.id, label: subject.name, mark: <SubjectOptionMark subject={subject} /> }))
  ];
  return <IconSelect value={value} options={options} onChange={onChange} placeholder={placeholder} label={label} id={id} disabled={disabled} />;
}
