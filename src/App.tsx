import { Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { m } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStudyStore } from "./store/useStudyStore";
import { AppShell } from "./components/AppShell";
import { LockScreen } from "./components/LockScreen";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary";
import { lazyView } from "./lib/lazyView";
import { cloudConfigured, subscribeCloudSync } from "./lib/cloudSyncState";
import { startPushSessionGuard } from "./lib/pushDevice";
import { useViewMemory } from "./lib/uiState";
import { useGroupInviteLinks } from "./hooks/useGroupInviteLinks";
import { useShareInviteLinks } from "./hooks/useShareInviteLinks";
import { useOpenLink } from "./hooks/useOpenLink";
import type { AppView } from "./types";

const DashboardView = lazyView(() => import("./views/DashboardView"), "DashboardView");
const CalendarView = lazyView(() => import("./views/CalendarView"), "CalendarView");
const TasksView = lazyView(() => import("./views/TasksView"), "TasksView");
const StudyView = lazyView(() => import("./views/StudyView"), "StudyView");
const SubjectsView = lazyView(() => import("./views/SubjectsView"), "SubjectsView");
const ExamsView = lazyView(() => import("./views/ExamsView"), "ExamsView");
const CareerView = lazyView(() => import("./views/CareerView"), "CareerView");
const MaterialsView = lazyView(() => import("./views/MaterialsView"), "MaterialsView");
const GoalsView = lazyView(() => import("./views/GoalsView"), "GoalsView");
const StatsView = lazyView(() => import("./views/StatsView"), "StatsView");
const SettingsView = lazyView(() => import("./views/SettingsView"), "SettingsView");
const BarbView = lazyView(() => import("./views/BarbView"), "BarbView");
const GroupsView = lazyView(() => import("./views/GroupsView"), "GroupsView");
const SharingView = lazyView(() => import("./views/SharingView"), "SharingView");

const views: Record<AppView, ReactNode> = {
  dashboard: <DashboardView />,
  calendar: <CalendarView />,
  tasks: <TasksView />,
  study: <StudyView />,
  subjects: <SubjectsView />,
  exams: <ExamsView />,
  career: <CareerView />,
  materials: <MaterialsView />,
  goals: <GoalsView />,
  stats: <StatsView />,
  barb: <BarbView />,
  groups: <GroupsView />,
  sharing: <SharingView />,
  settings: <SettingsView />
};

export default function App() {
  // Selettori mirati: l'App non si ri-renderizza a ogni modifica di task/eventi.
  const { init, loading, locked, activeView, themeMode, palette, density, error } = useStudyStore(
    useShallow((state) => ({
      init: state.init,
      loading: state.loading,
      locked: state.locked,
      activeView: state.activeView,
      themeMode: state.settings.themeMode,
      palette: state.settings.palette,
      density: state.settings.density,
      error: state.error
    }))
  );

  // Sezione e scroll sopravvivono al refresh (niente ritorno forzato alla dashboard).
  useViewMemory(activeView, !loading && !locked && !error);
  // Link/QR di invito: apre Gruppi e completa l'ingresso dopo login o registrazione.
  useGroupInviteLinks(!loading && !locked && !error);
  // Link/QR di condivisione: apre Condivisione sulla scheda dell'invito.
  useShareInviteLinks(!loading && !locked && !error);
  // Notifica push toccata: ?apri=notifiche|condivisione|gruppi|calendario apre la pagina giusta.
  useOpenLink(!loading && !locked && !error);

  useEffect(() => {
    init().then(() => {
      // Motore di sync + supabase-js caricati in differita: fuori dal bundle iniziale.
      if (cloudConfigured) void import("./lib/cloudSync").then((module) => module.initCloudSync());
      if (cloudConfigured) void import("./lib/shareSync").then((module) => module.initShareSync());
      // Nome del profilo online (ricerca persone): stesso caricamento in differita.
      if (cloudConfigured) void import("./lib/peopleSync").then((module) => module.initPeopleSync());
    });
  }, [init]);

  // Notifiche push: se questo dispositivo le aveva già attivate, si riallinea l'iscrizione all'avvio
  // e dopo ogni accesso; se la sessione finisce da sola (scaduta, revocata, uscita altrove) le
  // notifiche dell'account uscito smettono di arrivare qui. Il codice push si carica solo con il
  // permesso già concesso.
  useEffect(() => {
    if (loading || !cloudConfigured) return;
    return startPushSessionGuard(subscribeCloudSync);
  }, [loading]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.dataset.palette = palette;
    document.documentElement.dataset.density = density;
  }, [themeMode, palette, density]);

  useEffect(() => {
    if (loading) return;
    // Il collegamento agli agenti arriva in differita: non serve al primo disegno.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./lib/agentLink").then((module) => {
      if (cancelled) return;
      stop = module.startAgentLink();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [loading]);

  if (loading) {
    return (
      <main className="app-bg grid min-h-screen place-items-center px-6">
        <div className="soft-panel w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-5 h-20 w-20 animate-pulse rounded-super bg-[var(--accent)]" />
          <h1 className="text-3xl font-black">StudyOS</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Sto aprendo i tuoi dati…</p>
        </div>
      </main>
    );
  }

  if (locked) return <LockScreen />;

  return (
    <AppShell>
      {error ? (
        <div className="soft-panel border border-[var(--danger-border)] p-6 text-[var(--danger-text)]">{error}</div>
      ) : (
        <m.div
          key={activeView}
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          <ViewErrorBoundary key={activeView}>
            <Suspense fallback={<div className="soft-panel min-h-[240px] p-8 text-lg font-black">Caricamento…</div>}>
              {views[activeView]}
            </Suspense>
          </ViewErrorBoundary>
        </m.div>
      )}
    </AppShell>
  );
}
