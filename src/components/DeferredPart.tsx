import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/**
 * Pezzo dell'interfaccia caricato in differita (modale, pannello): niente segnaposto mentre arriva
 * e, se il caricamento fallisce, sparisce senza trascinare giù il resto dell'app.
 */
class QuietBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("StudyOS: pezzo di interfaccia non caricato", error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function DeferredPart({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <QuietBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </QuietBoundary>
  );
}
