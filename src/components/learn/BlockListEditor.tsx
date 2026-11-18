// Editor di un lato della scheda (fronte, retro, spiegazione, testo della domanda): elenco di blocchi
// con tipo, campi del tipo, sposta su/giù e togli. La validazione vera è normalizeBlocks al salvataggio.
import { useId, useState } from "react";
import { BLOCK_TYPES, CARD_LIMITS, safeBlocks } from "../../lib/cardBlocks";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { CardBlock, CardBlockType } from "../../types";
import { Icon } from "../Icon";
import { inputClass } from "../ui";

const textareaClass = `${inputClass} min-h-[5.5rem] py-2.5 leading-relaxed`;
const smallButton =
  "motion-safe grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:opacity-40";

export const emptyBlock = (type: CardBlockType): CardBlock => {
  switch (type) {
    case "heading":
      return { type, text: "" };
    case "list":
      return { type, items: [] };
    case "formula":
      return { type, latex: "" };
    case "image":
      return { type, url: "", alt: "" };
    case "svg":
      return { type, svg: "", alt: "" };
    case "code":
      return { type, code: "" };
    case "table":
      return { type, rows: [] };
    case "callout":
      return { type, text: "", tone: "info" };
    case "reference":
      return { type, title: "" };
    default:
      return { type: "text", text: "" };
  }
};

/** Toglie le voci vuote (elenchi, righe di tabella) prima della validazione. */
export const cleanDraftBlocks = (blocks: readonly CardBlock[]): CardBlock[] =>
  blocks
    .map((block) => {
      if (block.type === "list") return { ...block, items: block.items.map((item) => item.trim()).filter(Boolean) };
      if (block.type === "table") return { ...block, rows: block.rows.filter((row) => row.some((cell) => cell.trim())) };
      return block;
    })
    .filter((block) => {
      if (block.type === "text" || block.type === "heading" || block.type === "callout") return block.text.trim() !== "";
      if (block.type === "list") return block.items.length > 0;
      if (block.type === "formula") return block.latex.trim() !== "";
      if (block.type === "code") return block.code.trim() !== "";
      if (block.type === "table") return block.rows.length > 0;
      if (block.type === "reference") return block.title.trim() !== "";
      return true;
    });

/** Righe di testo ↔ voci (elenco) o celle separate da | (tabella): il testo grezzo resta locale. */
function LinesField({ value, onChange, label, help, rows = 4 }: { value: string; onChange: (text: string) => void; label: string; help: string; rows?: number }) {
  const [text, setText] = useState(value);
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <textarea
        aria-label={label}
        className={textareaClass}
        rows={rows}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
      />
      <span className="mt-1 block text-xs font-medium text-[var(--faint)]">{help}</span>
    </label>
  );
}

function SmallInput({ label, value, onChange, maxLength, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; maxLength: number; placeholder?: string; type?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-black uppercase text-[var(--faint)]">{label}</span>
      <input className={inputClass} type={type} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function BlockFields({ block, onChange }: { block: CardBlock; onChange: (block: CardBlock) => void }) {
  switch (block.type) {
    case "text":
      return (
        <label className="block">
          <span className="sr-only">{LEARN_TEXT.blockLabel.text}</span>
          <textarea aria-label={LEARN_TEXT.blockLabel.text} className={textareaClass} rows={3} maxLength={CARD_LIMITS.text} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
          <span className="mt-1 block text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.textHelp}</span>
        </label>
      );
    case "heading":
      return <SmallInput label={LEARN_TEXT.blockLabel.heading} value={block.text} maxLength={CARD_LIMITS.heading} onChange={(text) => onChange({ ...block, text })} />;
    case "list":
      return (
        <div className="grid grid-cols-1 gap-2">
          <LinesField
            label={LEARN_TEXT.blockLabel.list}
            help={LEARN_TEXT.listHelp}
            value={block.items.join("\n")}
            onChange={(text) => onChange({ ...block, items: text.split("\n").slice(0, CARD_LIMITS.listItems) })}
          />
          <label className="inline-flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={block.ordered === true} onChange={(event) => onChange({ ...block, ordered: event.target.checked || undefined })} />
            1, 2, 3…
          </label>
        </div>
      );
    case "formula":
      return (
        <div className="grid grid-cols-1 gap-2">
          <label className="block">
            <span className="sr-only">{LEARN_TEXT.blockLabel.formula}</span>
            <textarea aria-label={LEARN_TEXT.blockLabel.formula} className={`${textareaClass} font-mono`} rows={2} maxLength={CARD_LIMITS.latex} value={block.latex} onChange={(event) => onChange({ ...block, latex: event.target.value })} spellCheck={false} />
            <span className="mt-1 block text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.formulaHelp}</span>
          </label>
          <SmallInput label={LEARN_TEXT.caption} value={block.caption ?? ""} maxLength={CARD_LIMITS.caption} onChange={(caption) => onChange({ ...block, caption: caption || undefined })} />
        </div>
      );
    case "image":
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SmallInput label={LEARN_TEXT.imageUrl} type="url" placeholder="https://" value={block.url} maxLength={CARD_LIMITS.url} onChange={(url) => onChange({ ...block, url })} />
          </div>
          <SmallInput label={LEARN_TEXT.imageAlt} value={block.alt} maxLength={CARD_LIMITS.alt} onChange={(alt) => onChange({ ...block, alt })} />
          <SmallInput label={LEARN_TEXT.caption} value={block.caption ?? ""} maxLength={CARD_LIMITS.caption} onChange={(caption) => onChange({ ...block, caption: caption || undefined })} />
        </div>
      );
    case "svg":
      return (
        <div className="grid grid-cols-1 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-black uppercase text-[var(--faint)]">{LEARN_TEXT.svgCode}</span>
            <textarea className={`${textareaClass} font-mono text-xs`} rows={5} value={block.svg} onChange={(event) => onChange({ ...block, svg: event.target.value })} spellCheck={false} />
            <span className="mt-1 block text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.svgHelp}</span>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SmallInput label={LEARN_TEXT.imageAlt} value={block.alt} maxLength={CARD_LIMITS.alt} onChange={(alt) => onChange({ ...block, alt })} />
            <SmallInput label={LEARN_TEXT.caption} value={block.caption ?? ""} maxLength={CARD_LIMITS.caption} onChange={(caption) => onChange({ ...block, caption: caption || undefined })} />
          </div>
        </div>
      );
    case "code":
      return (
        <div className="grid grid-cols-1 gap-2">
          <textarea aria-label={LEARN_TEXT.blockLabel.code} className={`${textareaClass} font-mono text-xs`} rows={4} maxLength={CARD_LIMITS.code} value={block.code} onChange={(event) => onChange({ ...block, code: event.target.value })} spellCheck={false} />
          <SmallInput label={LEARN_TEXT.codeLanguage} value={block.language ?? ""} maxLength={CARD_LIMITS.codeLanguage} onChange={(language) => onChange({ ...block, language: language || undefined })} />
        </div>
      );
    case "table": {
      const lines = [...(block.header ? [block.header] : []), ...block.rows].map((row) => row.join(" | ")).join("\n");
      return (
        <div className="grid grid-cols-1 gap-2">
          <LinesField
            label={LEARN_TEXT.blockLabel.table}
            help={LEARN_TEXT.tableHelp}
            value={lines}
            rows={5}
            onChange={(text) => {
              const parsed = text
                .split("\n")
                .slice(0, CARD_LIMITS.tableRows + 1)
                .map((line) => line.split("|").map((cell) => cell.trim()).slice(0, CARD_LIMITS.tableCols));
              const [header, ...rows] = parsed;
              onChange({ ...block, ...(rows.length ? { header, rows } : { header: undefined, rows: header ? [header] : [] }) });
            }}
          />
          <SmallInput label={LEARN_TEXT.caption} value={block.caption ?? ""} maxLength={CARD_LIMITS.caption} onChange={(caption) => onChange({ ...block, caption: caption || undefined })} />
        </div>
      );
    }
    case "callout":
      return (
        <div className="grid grid-cols-1 gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <SmallInput label={LEARN_TEXT.calloutTitle} value={block.title ?? ""} maxLength={CARD_LIMITS.heading} onChange={(title) => onChange({ ...block, title: title || undefined })} />
            <label className="block">
              <span className="mb-1 block text-[11px] font-black uppercase text-[var(--faint)]">Tono</span>
              <select className={inputClass} value={block.tone ?? "info"} onChange={(event) => onChange({ ...block, tone: event.target.value as "info" | "tip" | "warning" | "key" })}>
                <option value="info">Informazione</option>
                <option value="tip">Consiglio</option>
                <option value="warning">Attenzione</option>
                <option value="key">Da ricordare</option>
              </select>
            </label>
          </div>
          <textarea aria-label={LEARN_TEXT.blockLabel.callout} className={textareaClass} rows={3} maxLength={CARD_LIMITS.text} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
        </div>
      );
    case "reference":
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SmallInput label={LEARN_TEXT.referenceTitle} value={block.title} maxLength={CARD_LIMITS.referenceField} onChange={(title) => onChange({ ...block, title })} />
          </div>
          <SmallInput label={LEARN_TEXT.referenceChapter} value={block.chapter ?? ""} maxLength={CARD_LIMITS.referenceField} onChange={(chapter) => onChange({ ...block, chapter: chapter || undefined })} />
          <SmallInput label={LEARN_TEXT.referencePages} value={block.pages ?? ""} maxLength={CARD_LIMITS.referenceField} onChange={(pages) => onChange({ ...block, pages: pages || undefined })} />
          <div className="sm:col-span-2">
            <SmallInput label="Link (https)" type="url" value={block.url ?? ""} maxLength={CARD_LIMITS.url} onChange={(url) => onChange({ ...block, url: url || undefined })} />
          </div>
        </div>
      );
  }
}

/** Blocchi con una chiave stabile per React (l'ordine cambia con «sposta su/giù»). */
export interface KeyedBlock {
  key: string;
  block: CardBlock;
}

let keySeed = 0;
export const keyBlocks = (blocks: readonly CardBlock[] | undefined): KeyedBlock[] => safeBlocks(blocks).map((block) => ({ key: `b${++keySeed}`, block }));
/**
 * Per i campi obbligatori (fronte, retro, domanda): i blocchi salvati o, se non ce n'è nessuno
 * valido, un blocco di testo vuoto da scrivere. Non passa da keyBlocks: safeBlocks scarta il testo
 * vuoto, e il campo si aprirebbe senza niente da riempire.
 */
export const keyBlocksOrBlank = (blocks: readonly CardBlock[] | undefined): KeyedBlock[] => {
  const keyed = keyBlocks(blocks);
  return keyed.length ? keyed : [{ key: `b${++keySeed}`, block: emptyBlock("text") }];
};
export const unkeyBlocks = (items: readonly KeyedBlock[]) => cleanDraftBlocks(items.map((item) => item.block));

export function BlockListEditor({ label, value, onChange, required = false }: { label: string; value: KeyedBlock[]; onChange: (value: KeyedBlock[]) => void; required?: boolean }) {
  const headingId = useId();
  const [adding, setAdding] = useState<CardBlockType>("text");
  const update = (index: number, block: CardBlock) => onChange(value.map((item, i) => (i === index ? { ...item, block } : item)));
  const move = (index: number, delta: number) => {
    const next = value.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <section aria-labelledby={headingId} className="grid grid-cols-1 gap-2">
      <h3 id={headingId} className="text-xs font-black uppercase text-[var(--faint)]">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </h3>
      {value.map((item, index) => (
        <div key={item.key} role="group" aria-label={`${label} · ${LEARN_TEXT.blockLabel[item.block.type] ?? item.block.type} ${index + 1}`} className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-2.5">
          <div className="mb-2 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs font-black text-[var(--muted)]">{LEARN_TEXT.blockLabel[item.block.type] ?? item.block.type}</span>
            <button type="button" className={smallButton} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${LEARN_TEXT.moveUp}: ${LEARN_TEXT.blockLabel[item.block.type]}`}>
              <Icon name="ChevronUp" className="h-4 w-4" />
            </button>
            <button type="button" className={smallButton} disabled={index === value.length - 1} onClick={() => move(index, 1)} aria-label={`${LEARN_TEXT.moveDown}: ${LEARN_TEXT.blockLabel[item.block.type]}`}>
              <Icon name="ChevronDown" className="h-4 w-4" />
            </button>
            <button type="button" className={smallButton} onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label={`${LEARN_TEXT.removeBlock}: ${LEARN_TEXT.blockLabel[item.block.type]}`}>
              <Icon name="X" className="h-4 w-4" />
            </button>
          </div>
          <BlockFields block={item.block} onChange={(block) => update(index, block)} />
        </div>
      ))}
      {value.length < CARD_LIMITS.blocksPerSide ? (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${LEARN_TEXT.addBlock} (${label})`} className={`${inputClass} w-auto`} value={adding} onChange={(event) => setAdding(event.target.value as CardBlockType)}>
            {BLOCK_TYPES.map((type) => (
              <option key={type} value={type}>
                {LEARN_TEXT.blockLabel[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange([...value, { key: `b${++keySeed}`, block: emptyBlock(adding) }])}
            className="motion-safe inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold hover:bg-[var(--surface)]"
          >
            <Icon name="Plus" className="h-4 w-4" />
            {LEARN_TEXT.addBlock}
          </button>
        </div>
      ) : null}
    </section>
  );
}
