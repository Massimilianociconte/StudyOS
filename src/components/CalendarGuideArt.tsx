import type { ReactNode } from "react";
import type { GuideApp, GuideArt, GuideDevice } from "../lib/calendarGuide";

/**
 * Piccoli disegni dei passi della guida (CalendarTransfer): schermi stilizzati di telefono, computer
 * e browser con il punto da toccare evidenziato. Solo forme e colori del tema, niente schermate o
 * loghi di altre app; il testo del passo dice tutto, quindi i disegni sono nascosti agli screen reader.
 */

const INK_ON_ACCENT = "#10131d";

const Line = ({ x, y, w, o = 0.7, h = 4 }: { x: number; y: number; w: number; o?: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="var(--faint)" opacity={o} />
);

/** Punto toccato: cerchio pieno con alone. */
const Tap = ({ x, y }: { x: number; y: number }) => (
  <g>
    <circle cx={x} cy={y} r="9" fill="var(--accent-ink)" opacity="0.2" />
    <circle cx={x} cy={y} r="4" fill="var(--accent-ink)" />
  </g>
);

/** Il file .ics: foglio con l'angolo piegato e la fascia colorata. */
const FileSheet = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 0h16l7 7v23H0z" fill="var(--surface-strong)" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M16 0v7h7" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" />
    <rect x="3" y="17" width="17" height="7" rx="2" fill="var(--accent)" />
  </g>
);

const Arrow = ({ d }: { d: string }) => (
  <path d={d} fill="none" stroke="var(--accent-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 6" />
);

const Phone = ({ device, children }: { device: GuideDevice; children: ReactNode }) => (
  <g>
    <rect x="66" y="4" width="68" height="112" rx="12" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
    {device === "ios" ? (
      <rect x="90" y="9" width="20" height="5" rx="2.5" fill="var(--text)" opacity="0.7" />
    ) : (
      <circle cx="100" cy="11.5" r="2.5" fill="var(--text)" opacity="0.7" />
    )}
    {children}
  </g>
);

/** Finestra del browser (calendar.google.com, outlook.com). */
const Browser = ({ children }: { children: ReactNode }) => (
  <g>
    <rect x="8" y="8" width="184" height="104" rx="8" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
    <path d="M8 26h184" stroke="var(--border)" strokeWidth="2" />
    <circle cx="18" cy="17" r="2.5" fill="var(--faint)" />
    <circle cx="26" cy="17" r="2.5" fill="var(--faint)" />
    <circle cx="34" cy="17" r="2.5" fill="var(--faint)" />
    <rect x="46" y="12" width="104" height="10" rx="5" fill="var(--surface-soft)" />
    {children}
  </g>
);

/** Finestra di un programma con la barra dei menu (Outlook classico, Calendario del Mac). */
const DesktopWindow = ({ device, children }: { device: GuideDevice; children: ReactNode }) => (
  <g>
    <rect x="8" y="8" width="184" height="104" rx={device === "macos" ? 9 : 4} fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
    <path d="M8 24h184" stroke="var(--border)" strokeWidth="2" />
    {device === "macos" ? (
      <>
        <circle cx="18" cy="16" r="2.5" fill="var(--faint)" />
        <circle cx="26" cy="16" r="2.5" fill="var(--faint)" />
        <circle cx="34" cy="16" r="2.5" fill="var(--faint)" />
      </>
    ) : (
      <>
        <rect x="160" y="14" width="6" height="4" rx="1" fill="var(--faint)" opacity="0.6" />
        <rect x="172" y="13" width="6" height="6" rx="1" fill="none" stroke="var(--faint)" strokeWidth="1.2" />
      </>
    )}
    {children}
  </g>
);

const Laptop = ({ x, y, s = 1, device = "windows" }: { x: number; y: number; s?: number; device?: GuideDevice }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="6" y="0" width="52" height="34" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
    {device === "macos" ? <rect x="28" y="0" width="8" height="3" rx="1.5" fill="var(--border)" /> : null}
    <rect x="11" y="6" width="42" height="22" rx="2" fill="var(--surface-soft)" />
    <path d="M0 38h64l-4 5H4z" fill="var(--surface-strong)" stroke="var(--border)" strokeWidth="2" strokeLinejoin="round" />
  </g>
);

/** Pulsante principale dentro un disegno, nella forma tipica dell'app. */
const AppButton = ({ app, x, y, w }: { app: GuideApp; x: number; y: number; w: number }) => (
  <rect x={x} y={y} width={w} height="12" rx={app === "outlook" ? 3 : 6} fill="var(--accent)" />
);

const art: Record<GuideArt, (props: { app: GuideApp; device: GuideDevice }) => ReactNode> = {
  // Il pulsante "Scarica" di StudyOS e il file che finisce nei download.
  download: () => (
    <g>
      <rect x="12" y="20" width="88" height="80" rx="14" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
      <Line x={24} y={34} w={50} o={0.8} h={5} />
      <Line x={24} y={46} w={64} />
      <Line x={24} y={55} w={44} />
      <rect x="24" y="72" width="64" height="16" rx="8" fill="var(--accent)" />
      <path d="M56 75v9m-4-4 4 4 4-4" fill="none" stroke={INK_ON_ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Arrow d="M106 60h20" />
      <path d="M132 50h18l6 6h30v42h-54z" fill="var(--surface-strong)" stroke="var(--border)" strokeWidth="2" strokeLinejoin="round" />
      <FileSheet x={148} y={30} />
    </g>
  ),
  // Dal telefono al computer, per email a se stessi.
  transfer: ({ device }) => (
    <g>
      <rect x="16" y="22" width="44" height="78" rx="9" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
      <FileSheet x={27} y={46} />
      <Arrow d="M68 60h22" />
      <rect x="92" y="48" width="26" height="20" rx="3" fill="var(--surface-strong)" stroke="var(--text)" strokeWidth="1.5" />
      <path d="M92 50l13 9 13-9" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" />
      <Arrow d="M124 60h10" />
      <Laptop x={136} y={40} s={0.85} device={device === "ios" ? "macos" : "windows"} />
    </g>
  ),
  // L'app dei file del telefono, con il file .ics da toccare.
  phoneFiles: ({ device }) => (
    <Phone device={device}>
      <Line x={74} y={22} w={30} o={0.8} h={5} />
      {[34, 50, 66, 82].map((y, index) => (
        <g key={y}>
          {index === 2 ? <rect x="70" y={y - 3} width="60" height="15" rx="5" fill="var(--surface-strong)" stroke="var(--accent-ink)" strokeWidth="1.5" /> : null}
          <rect x="74" y={y} width="9" height="9" rx="2" fill={index === 2 ? "var(--accent)" : "var(--surface-strong)"} />
          <Line x={87} y={y + 2.5} w={index === 2 ? 30 : 36} o={index === 2 ? 0.9 : 0.5} />
        </g>
      ))}
      <Tap x={118} y={73} />
    </Phone>
  ),
  // L'anteprima degli eventi nel calendario del telefono, con il pulsante per aggiungerli.
  phonePreview: ({ app, device }) => (
    <Phone device={device}>
      {app === "apple" ? (
        <>
          <Line x={74} y={22} w={18} o={0.6} />
          <rect x="106" y="19" width="22" height="10" rx="5" fill="var(--accent)" />
          <Tap x={117} y={24} />
        </>
      ) : (
        <Line x={74} y={22} w={34} o={0.8} h={5} />
      )}
      {[36, 52, 68].map((y) => (
        <g key={y}>
          <rect x="72" y={y} width="56" height="12" rx="4" fill="var(--surface-soft)" />
          <rect x="72" y={y} width="3" height="12" rx="1.5" fill="var(--accent)" />
          <Line x={79} y={y + 4} w={34} />
        </g>
      ))}
      {app === "samsung" ? (
        <>
          <rect x="72" y="96" width="26" height="12" rx="6" fill="var(--surface-strong)" />
          <rect x="102" y="96" width="26" height="12" rx="6" fill="var(--accent)" />
          <Tap x={115} y={102} />
        </>
      ) : app === "apple" ? null : (
        <>
          <AppButton app={app} x={96} y={96} w={32} />
          <Tap x={112} y={102} />
        </>
      )}
    </Phone>
  ),
  // Il menu dell'app Calendario aperto, con le impostazioni.
  phoneMenu: ({ device }) => (
    <Phone device={device}>
      <rect x="67" y="18" width="46" height="97" rx="0" fill="var(--surface-strong)" />
      <path d="M73 24h10M73 28h10M73 32h10" stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round" />
      {[44, 58, 72].map((y) => (
        <Line key={y} x={74} y={y} w={30} />
      ))}
      <rect x="70" y="84" width="40" height="14" rx="5" fill="var(--surface)" stroke="var(--accent-ink)" strokeWidth="1.5" />
      <circle cx="78" cy="91" r="3.5" fill="none" stroke="var(--accent-ink)" strokeWidth="1.8" />
      <Line x={85} y={89} w={20} o={0.9} />
      <Tap x={102} y={91} />
    </Phone>
  ),
  // Il sito nel browser: l'ingranaggio in alto e il menu con "Impostazioni".
  webSettings: () => (
    <Browser>
      <Line x={18} y={36} w={40} o={0.8} h={5} />
      {[50, 64, 78, 92].map((y) => (
        <g key={y}>
          <rect x="18" y={y} width="106" height="10" rx="3" fill="var(--surface-soft)" />
        </g>
      ))}
      <circle cx="176" cy="37" r="6" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" />
      <circle cx="176" cy="37" r="2" fill="var(--accent)" />
      <rect x="132" y="48" width="52" height="40" rx="6" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x="136" y="52" width="44" height="10" rx="3" fill="var(--surface-strong)" stroke="var(--accent-ink)" strokeWidth="1.2" />
      <Line x={140} y={55} w={26} o={0.9} />
      <Line x={140} y={68} w={30} />
      <Line x={140} y={78} w={22} />
      <Tap x={170} y={57} />
    </Browser>
  ),
  // La pagina delle impostazioni: menu a sinistra, file e pulsante a destra.
  webPanel: ({ app }) => (
    <Browser>
      <rect x="9" y="27" width="50" height="84" fill="var(--surface-soft)" />
      {[36, 48, 60, 72, 84].map((y, index) => (
        <g key={y}>
          {index === 3 ? <rect x="13" y={y - 3} width="42" height="10" rx={app === "outlook" ? 2 : 5} fill="var(--surface-strong)" stroke="var(--accent-ink)" strokeWidth="1.2" /> : null}
          <Line x={17} y={y} w={index === 3 ? 30 : 26} o={index === 3 ? 0.9 : 0.5} />
        </g>
      ))}
      <Line x={70} y={38} w={50} o={0.8} h={5} />
      <rect x="70" y="52" width="108" height="16" rx={app === "outlook" ? 2 : 4} fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      <FileSheet x={74} y={54} s={0.42} />
      <Line x={88} y={58} w={40} />
      <rect x="70" y="74" width="108" height="12" rx={app === "outlook" ? 2 : 4} fill="var(--surface-soft)" />
      <AppButton app={app} x={140} y={94} w={38} />
      <Tap x={159} y={100} />
    </Browser>
  ),
  // L'archivio .zip di Google con un file per calendario.
  zip: () => (
    <g>
      <rect x="20" y="26" width="58" height="70" rx="8" fill="var(--surface-strong)" stroke="var(--border)" strokeWidth="2" />
      {[32, 40, 48, 56].map((y) => (
        <g key={y}>
          <rect x="46" y={y} width="6" height="4" fill="var(--text)" opacity="0.55" />
          <rect x="46" y={y + 4} width="6" height="4" fill="var(--surface)" />
        </g>
      ))}
      <rect x="42" y="66" width="14" height="16" rx="3" fill="none" stroke="var(--text)" strokeWidth="1.5" opacity="0.7" />
      <Arrow d="M86 60h24" />
      <FileSheet x={118} y={30} />
      <FileSheet x={150} y={30} />
      <g opacity="0.55">
        <FileSheet x={134} y={70} />
      </g>
      <rect x="114" y="26" width="31" height="38" rx="5" fill="none" stroke="var(--accent-ink)" strokeWidth="2" />
    </g>
  ),
  // Un programma con la barra dei menu aperta su "File".
  desktopMenu: ({ device }) => (
    <DesktopWindow device={device}>
      {device === "macos" ? null : <Line x={16} y={14} w={14} o={0.8} />}
      <rect x={device === "macos" ? 44 : 36} y="11" width="18" height="10" rx="2" fill="var(--surface-strong)" stroke="var(--accent-ink)" strokeWidth="1.2" />
      <Line x={device === "macos" ? 66 : 58} y={14} w={14} />
      <Line x={device === "macos" ? 84 : 76} y={14} w={14} />
      <rect x="9" y="25" width="34" height="86" fill="var(--surface-soft)" />
      <rect x={device === "macos" ? 44 : 36} y="26" width="66" height="62" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      {[32, 44, 56, 70].map((y, index) => (
        <g key={y}>
          {index === 2 ? <rect x={device === "macos" ? 47 : 39} y={y - 3} width="60" height="10" rx="2" fill="var(--surface-strong)" stroke="var(--accent-ink)" strokeWidth="1.2" /> : null}
          <Line x={device === "macos" ? 51 : 43} y={y} w={index === 2 ? 40 : 34} o={index === 2 ? 0.9 : 0.5} />
        </g>
      ))}
      {[34, 50, 66, 82, 98].map((x) =>
        [80, 94].map((y) => <rect key={`${x}-${y}`} x={x + 82} y={y} width="12" height="10" rx="2" fill="var(--surface-soft)" stroke="var(--border)" />)
      )}
      <Tap x={device === "macos" ? 100 : 92} y={61} />
    </DesktopWindow>
  ),
  // Il Calendario del computer: elenco dei calendari a sinistra, mese a destra.
  desktopPreview: ({ device }) => (
    <DesktopWindow device={device}>
      <rect x="9" y="25" width="52" height="86" fill="var(--surface-soft)" />
      {[36, 50, 64, 78].map((y, index) => (
        <g key={y}>
          {index === 1 ? <rect x="12" y={y - 4} width="46" height="12" rx="4" fill="var(--surface-strong)" stroke="var(--accent-ink)" strokeWidth="1.2" /> : null}
          <circle cx="19" cy={y + 2} r="3" fill={index === 1 ? "var(--accent)" : "var(--faint)"} />
          <Line x={26} y={y} w={26} o={index === 1 ? 0.9 : 0.5} />
        </g>
      ))}
      {[0, 1, 2, 3, 4, 5].map((column) =>
        [0, 1, 2, 3].map((row) => (
          <rect
            key={`${column}-${row}`}
            x={68 + column * 20}
            y={32 + row * 19}
            width="17"
            height="16"
            rx="2"
            fill={column === 2 && row === 1 ? "var(--accent)" : "var(--surface-soft)"}
            stroke="var(--border)"
          />
        ))
      )}
      <Tap x={50} y={52} />
    </DesktopWindow>
  ),
  // StudyOS: il pulsante "Scegli il file" e l'anteprima.
  choose: () => (
    <g>
      <FileSheet x={88} y={6} />
      <Arrow d="M100 42v12" />
      <rect x="24" y="58" width="152" height="56" rx="14" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
      <Line x={38} y={70} w={60} o={0.8} h={5} />
      <Line x={38} y={82} w={86} />
      <rect x="112" y="92" width="52" height="14" rx="7" fill="var(--accent)" />
      <path d="M131 99h14m-5-4 5 4-5 4" fill="none" stroke={INK_ON_ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  )
};

export function GuideArtView({ art: kind, app, device, className = "" }: { art: GuideArt; app: GuideApp; device: GuideDevice; className?: string }) {
  const Draw = art[kind];
  return (
    <svg viewBox="0 0 200 120" className={className} aria-hidden="true" focusable="false">
      <Draw app={app} device={device} />
    </svg>
  );
}

/** Icona del dispositivo nella scelta: telefono (foro o isola della fotocamera) o portatile. */
export function DeviceGlyph({ device, className = "" }: { device: GuideDevice; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      {device === "windows" || device === "macos" ? (
        <g>
          <rect x="7" y="9" width="26" height="17" rx="2.5" fill="var(--surface-soft)" stroke="currentColor" strokeWidth="2" />
          {device === "macos" ? <rect x="18" y="9" width="4" height="2" rx="1" fill="currentColor" /> : null}
          <path d="M4 29h32l-2 3H6z" fill="currentColor" />
        </g>
      ) : (
        <g>
          <rect x="12" y="5" width="16" height="30" rx="4" fill="var(--surface-soft)" stroke="currentColor" strokeWidth="2" />
          {device === "ios" ? <rect x="17" y="8" width="6" height="2" rx="1" fill="currentColor" /> : <circle cx="20" cy="9" r="1.3" fill="currentColor" />}
          {device === "samsung" ? <path d="M15 31h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" /> : null}
        </g>
      )}
    </svg>
  );
}
