// Rendering dei blocchi di una flashcard (testo, formule, elenchi, tabelle, immagini, SVG, …).
// Niente innerHTML per i testi: segmenti React. Le formule passano da KaTeX (trust: false, caricato
// solo qui); gli SVG dal sanitizzatore a elenco consentito e poi in <img> (nessuno script può girare);
// le immagini solo https pubblici, senza referrer; nelle raccolte di altri si caricano al tocco.
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { KATEX_OPTIONS, parseInline, safeBlocks, safeUrl, sanitizeSvg } from "../../lib/cardBlocks";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { CardBlock } from "../../types";
import { Icon } from "../Icon";

type Katex = typeof import("katex").default;
let katexPromise: Promise<Katex> | null = null;
const loadKatex = () => {
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    // mhchem (\ce, \pu) dopo KaTeX: si registra sull'istanza importata.
    .then(async ([module]) => {
      await import("katex/contrib/mhchem");
      return module.default;
    })
    .catch((error) => {
      katexPromise = null;
      throw error;
    });
  return katexPromise;
};

const formulaCache = new Map<string, string>();
const FORMULA_CACHE_MAX = 400;

const renderFormula = (katex: Katex, latex: string, display: boolean) => {
  const key = `${display ? "D" : "I"}${latex}`;
  const cached = formulaCache.get(key);
  if (cached !== undefined) return cached;
  // Nessun comando che apre link, include HTML o classi: l'input viene dagli agenti.
  const html = katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode: display });
  if (formulaCache.size >= FORMULA_CACHE_MAX) formulaCache.delete(formulaCache.keys().next().value as string);
  formulaCache.set(key, html);
  return html;
};

export function Formula({ latex, display = false }: { latex: string; display?: boolean }) {
  const key = `${display ? "D" : "I"}${latex}`;
  const [html, setHtml] = useState<string | null>(() => formulaCache.get(key) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    const cached = formulaCache.get(key);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    setHtml(null);
    loadKatex()
      .then((katex) => {
        if (alive) setHtml(renderFormula(katex, latex, display));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [key, latex, display]);
  if (failed) {
    return (
      <code className="rounded bg-[var(--surface-strong)] px-1 text-[0.9em]" title={LEARN_TEXT.formulaError}>
        {latex}
      </code>
    );
  }
  if (html === null) return <span className="text-[var(--muted)]">{latex}</span>;
  // Output di KaTeX con trust: false (testo dell'agente sempre come testo, mai come markup).
  return display ? <div className="learn-formula overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="learn-formula" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function InlineText({ text }: { text: string }) {
  const segments = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {segments.map((segment, index) => {
        switch (segment.kind) {
          case "bold":
            return <strong key={index}>{segment.text}</strong>;
          case "italic":
            return <em key={index}>{segment.text}</em>;
          case "code":
            return (
              <code key={index} className="rounded bg-[var(--surface-strong)] px-1 text-[0.9em]">
                {segment.text}
              </code>
            );
          case "math":
            return <Formula key={index} latex={segment.text} />;
          case "sup":
            return <sup key={index}>{segment.text}</sup>;
          case "sub":
            return <sub key={index}>{segment.text}</sub>;
          default:
            return <span key={index}>{segment.text}</span>;
        }
      })}
    </>
  );
}

/** Testo con a capo: ogni riga vuota separa un paragrafo. */
function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n{2,}/);
  return (
    <>
      {parts.map((part, index) => (
        <p key={index} className="safe-text whitespace-pre-line">
          <InlineText text={part} />
        </p>
      ))}
    </>
  );
}

function CardImage({ url, alt, caption, width, height, external }: { url: string; alt: string; caption?: string; width?: number; height?: number; external: boolean }) {
  const safe = safeUrl(url);
  const [wanted, setWanted] = useState(!external);
  const [failed, setFailed] = useState(false);
  if (!safe) return <p className="text-sm text-[var(--muted)]">{LEARN_TEXT.imageError}</p>;
  const host = (() => {
    try {
      return new URL(safe).hostname;
    } catch {
      return "";
    }
  })();
  const ratio = width && height ? `${width} / ${height}` : undefined;
  return (
    <figure className="my-1">
      {!wanted ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setWanted(true);
          }}
          className="motion-safe grid grid-cols-1 min-h-24 w-full place-items-center gap-1 rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-3 text-center text-sm font-bold text-[var(--muted)] hover:bg-[var(--surface)]"
          style={ratio ? { aspectRatio: ratio } : undefined}
        >
          <Icon name="Image" className="h-5 w-5" />
          <span>{LEARN_TEXT.imageTapToLoad}</span>
          <span className="text-xs font-medium">{LEARN_TEXT.imageExternal(host)}</span>
        </button>
      ) : failed ? (
        <div className="grid grid-cols-1 min-h-16 place-items-center rounded-[16px] bg-[var(--surface-soft)] p-3 text-sm text-[var(--muted)]">
          {LEARN_TEXT.imageError} · {alt}
        </div>
      ) : (
        <img
          src={safe}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="mx-auto max-h-[50vh] w-auto max-w-full rounded-[12px] bg-[var(--surface-soft)] object-contain"
          style={ratio ? { aspectRatio: ratio } : undefined}
        />
      )}
      {caption ? <figcaption className="safe-text mt-1 text-center text-xs text-[var(--muted)]">{caption}</figcaption> : null}
    </figure>
  );
}

function SvgImage({ svg, alt, caption, background }: { svg: string; alt: string; caption?: string; background?: "light" | "transparent" }) {
  // Ricostruito dall'elenco consentito e mostrato come immagine: un <img> non esegue script né carica risorse.
  const src = useMemo(() => {
    const check = sanitizeSvg(svg);
    return check.ok && check.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(check.svg)}` : null;
  }, [svg]);
  return (
    <figure className="my-1">
      {src ? (
        <img
          src={src}
          alt={alt}
          className={`mx-auto max-h-[50vh] w-full max-w-full object-contain ${background === "transparent" ? "" : "rounded-[12px] bg-white p-2"}`}
        />
      ) : (
        <p className="text-sm text-[var(--muted)]">{LEARN_TEXT.svgBlocked}</p>
      )}
      {caption ? <figcaption className="safe-text mt-1 text-center text-xs text-[var(--muted)]">{caption}</figcaption> : null}
    </figure>
  );
}

const CALLOUT_TONE: Record<string, { color: string; icon: string }> = {
  info: { color: "var(--accent-ink)", icon: "Info" },
  tip: { color: "var(--success-text)", icon: "Sparkles" },
  warning: { color: "var(--warning-text)", icon: "AlertTriangle" },
  key: { color: "var(--accent-2)", icon: "Star" }
};

function Block({ block, external }: { block: CardBlock; external: boolean }): ReactNode {
  switch (block.type) {
    case "text":
      return <Paragraphs text={block.text} />;
    case "heading":
      return block.level === 3 ? (
        <h4 className="safe-text text-base font-black">
          <InlineText text={block.text} />
        </h4>
      ) : (
        <h3 className="safe-text text-lg font-black">
          <InlineText text={block.text} />
        </h3>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`safe-text space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText text={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "formula":
      return (
        <figure>
          <Formula latex={block.latex} display={block.display !== false} />
          {block.caption ? <figcaption className="safe-text text-center text-xs text-[var(--muted)]">{block.caption}</figcaption> : null}
        </figure>
      );
    case "image":
      // key: «tocca per caricare» e l'errore valgono per quell'indirizzo, non per la posizione del blocco
      // (un'altra immagine nello stesso punto riparte da capo, mai caricata in automatico).
      return <CardImage key={`${external ? "x" : "o"}:${block.url}`} {...block} external={external} />;
    case "svg":
      return <SvgImage svg={block.svg} alt={block.alt} caption={block.caption} background={block.background} />;
    case "code":
      return (
        <pre className="scrollbar-soft max-w-full overflow-x-auto rounded-[14px] bg-[var(--surface-strong)] p-3 text-left text-[13px] leading-snug" aria-label={block.language || undefined}>
          <code>{block.code}</code>
        </pre>
      );
    case "table":
      return (
        <figure className="scrollbar-soft max-w-full overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            {block.header?.length ? (
              <thead>
                <tr>
                  {block.header.map((cell, index) => (
                    <th key={index} scope="col" className="border-b border-[var(--border)] px-2 py-1.5 font-black">
                      <InlineText text={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-[var(--border)] last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-2 py-1.5 align-top">
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.caption ? <figcaption className="safe-text mt-1 text-xs text-[var(--muted)]">{block.caption}</figcaption> : null}
        </figure>
      );
    case "callout": {
      const tone = CALLOUT_TONE[block.tone ?? "info"] ?? CALLOUT_TONE.info;
      return (
        <aside className="rounded-[16px] border-l-4 bg-[var(--surface-soft)] p-3 text-left" style={{ borderColor: tone.color }}>
          {block.title ? (
            <p className="mb-1 flex items-center gap-1.5 text-sm font-black" style={{ color: tone.color }}>
              <Icon name={tone.icon} className="h-4 w-4 shrink-0" />
              <span className="safe-text">{block.title}</span>
            </p>
          ) : null}
          <Paragraphs text={block.text} />
        </aside>
      );
    }
    case "reference": {
      const url = block.url ? safeUrl(block.url) : null;
      const where = [block.chapter ? `cap. ${block.chapter}` : "", block.section ? `§ ${block.section}` : "", block.pages ? `pp. ${block.pages}` : ""].filter(Boolean).join(", ");
      return (
        <p className="safe-text flex items-start gap-1.5 text-left text-sm text-[var(--muted)]">
          <Icon name="BookOpen" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="font-bold text-[var(--accent-ink)] underline" onClick={(event) => event.stopPropagation()}>
                {block.title}
              </a>
            ) : (
              <span className="font-bold text-[var(--text)]">{block.title}</span>
            )}
            {where ? ` — ${where}` : ""}
            {block.note ? ` · ${block.note}` : ""}
          </span>
        </p>
      );
    }
    default:
      return null;
  }
}

/** Blocchi di un lato. `external`: contenuto di un'altra persona (immagini al tocco). */
export const Blocks = memo(function Blocks({ blocks, external = false, className = "" }: { blocks: readonly CardBlock[]; external?: boolean; className?: string }) {
  // Le righe possono arrivare da fuori dall'app (sync, chi ha «Può modificare» su una raccolta
  // condivisa): si mostrano solo i blocchi validi, mai un errore che blocca la vista.
  const safe = useMemo(() => safeBlocks(blocks), [blocks]);
  return (
    <div className={`learn-blocks min-w-0 space-y-2.5 ${className}`}>
      {safe.map((block, index) => (
        <Block key={index} block={block} external={external} />
      ))}
    </div>
  );
});
