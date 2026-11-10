import { useMemo } from "react";
import { encode } from "uqr";

const QR_OPTIONS = { ecc: "M", border: 2 } as const;

/** Moduli scuri come righe orizzontali: un solo path, nitido a ogni scala. */
const qrPath = (data: boolean[][]) => {
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      path += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return path;
};

/** QR sempre scuro su bianco (anche in tema scuro): è quello che le fotocamere leggono meglio. */
export function InviteQr({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => encode(value, QR_OPTIONS), [value]);
  const path = useMemo(() => qrPath(qr.data), [qr]);
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="block h-full w-full">
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={path} fill="#10131d" />
    </svg>
  );
}

export const qrPngBlob = (value: string, scale = 12) =>
  new Promise<Blob>((resolve, reject) => {
    const qr = encode(value, QR_OPTIONS);
    const canvas = document.createElement("canvas");
    canvas.width = qr.size * scale;
    canvas.height = qr.size * scale;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("Immagine non disponibile su questo browser."));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#10131d";
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && context.fillRect(x * scale, y * scale, scale, scale)));
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Immagine non disponibile su questo browser."))), "image/png");
  });
