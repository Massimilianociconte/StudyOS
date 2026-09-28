import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Un errore in una vista non deve lasciare l'app bianca: si mostra un messaggio e si può
 * ricaricare. I dati restano salvati (la persistenza è indipendente dal rendering).
 */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("StudyOS: errore nella vista", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="soft-panel border border-[var(--danger-border)] p-6">
        <h2 className="text-2xl font-black">Questa sezione non si è caricata</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          I tuoi dati sono al sicuro. Ricarica la pagina; se il problema persiste esporta un backup dalle Impostazioni.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-[var(--danger-text)]">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[var(--accent)] px-4 text-sm font-extrabold text-[#10131d]"
        >
          Ricarica
        </button>
      </div>
    );
  }
}
