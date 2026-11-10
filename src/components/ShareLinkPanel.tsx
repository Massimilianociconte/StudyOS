import { useState } from "react";
import { telegramShareUrl, whatsappShareUrl } from "../lib/groupInvite";
import { Button } from "./ui";
import { Icon } from "./Icon";
import { InviteQr, qrPngBlob } from "./InviteQr";

const linkClass =
  "motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold text-[var(--text)] hover:bg-[var(--surface)]";

/** Link di invito pronto da mandare: copia, condivisione di sistema, WhatsApp, Telegram, email, QR. */
export function ShareLinkPanel({ link, message, subject }: { link: string; message: string; subject: string }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async (text: string, done: string) => {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setStatus(done);
    } catch {
      setError("Copia non riuscita: tieni premuto sul link e copialo a mano.");
    }
  };

  const share = async () => {
    setError("");
    try {
      await navigator.share({ title: subject, text: message, url: link });
      setStatus("Invito condiviso.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      await copy(message, "Condivisione non disponibile: messaggio copiato, incollalo dove vuoi.");
    }
  };

  const downloadQr = async () => {
    setError("");
    try {
      const url = URL.createObjectURL(await qrPngBlob(link));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "studyos-invito-condivisione.png";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("QR scaricato.");
    } catch (cause) {
      setError(cause instanceof Error ? `QR non scaricato. ${cause.message}` : "QR non scaricato. Riprova.");
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex min-w-0 items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
        <Icon name="Share2" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold" title={link}>
          {link}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="primary" icon="Copy" onClick={() => void copy(link, "Link copiato.")}>
          Copia il link
        </Button>
        {canShare ? (
          <Button variant="soft" icon="Share2" onClick={() => void share()}>
            Condividi…
          </Button>
        ) : null}
        <a className={linkClass} href={whatsappShareUrl(message)} target="_blank" rel="noopener noreferrer">
          <Icon name="MessageCircle" className="h-4 w-4" />
          WhatsApp
        </a>
        <a className={linkClass} href={telegramShareUrl(link, subject)} target="_blank" rel="noopener noreferrer">
          <Icon name="Send" className="h-4 w-4" />
          Telegram
        </a>
        <a className={linkClass} href={mailto}>
          <Icon name="Mail" className="h-4 w-4" />
          Email
        </a>
        <Button variant="soft" icon="QrCode" aria-expanded={showQr} onClick={() => setShowQr((value) => !value)}>
          {showQr ? "Nascondi il QR" : "Mostra il QR"}
        </Button>
      </div>
      {showQr ? (
        <div className="grid grid-cols-1 justify-items-center gap-2">
          <div className="h-52 w-52 overflow-hidden rounded-[18px]">
            <InviteQr value={link} label="QR dell'invito a condividere" />
          </div>
          <Button variant="ghost" icon="QrCode" onClick={() => void downloadQr()}>
            Scarica il QR
          </Button>
        </div>
      ) : null}
      <p aria-live="polite" className={`text-sm font-bold ${error ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>
        {error || status}
      </p>
    </div>
  );
}
