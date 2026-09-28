import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useStudyStore } from "./store/useStudyStore";
import { AppShell } from "./components/AppShell";
import { LockScreen } from "./components/LockScreen";
import { initCloudSync } from "./lib/cloudSync";
import type { AppView } from "./types";

const DashboardView = lazy(() => import("./views/DashboardView").then((module) => ({ default: module.DashboardView })));
const CalendarView = lazy(() => import("./views/CalendarView").then((module) => ({ default: module.CalendarView })));
const TasksView = lazy(() => import("./views/TasksView").then((module) => ({ default: module.TasksView })));
const StudyView = lazy(() => import("./views/StudyView").then((module) => ({ default: module.StudyView })));
const SubjectsView = lazy(() => import("./views/SubjectsView").then((module) => ({ default: module.SubjectsView })));
const ExamsView = lazy(() => import("./views/ExamsView").then((module) => ({ default: module.ExamsView })));
const MaterialsView = lazy(() => import("./views/MaterialsView").then((module) => ({ default: module.MaterialsView })));
const GoalsView = lazy(() => import("./views/GoalsView").then((module) => ({ default: module.GoalsView })));
const StatsView = lazy(() => import("./views/StatsView").then((module) => ({ default: module.StatsView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((module) => ({ default: module.SettingsView })));
const BarbView = lazy(() => import("./views/BarbView").then((module) => ({ default: module.BarbView })));

const views: Record<AppView, ReactNode> = {
  dashboard: <DashboardView />,
  calendar: <CalendarView />,
  tasks: <TasksView />,
  study: <StudyView />,
  subjects: <SubjectsView />,
  exams: <ExamsView />,
  materials: <MaterialsView />,
  goals: <GoalsView />,
  stats: <StatsView />,
  barb: <BarbView />,
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

  useEffect(() => {
    init().then(() => {
      void initCloudSync();
    });
  }, [init]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.dataset.palette = palette;
    document.documentElement.dataset.density = density;
  }, [themeMode, palette, density]);

  if (loading) {
    return (
      <main className="app-bg grid min-h-screen place-items-center px-6">
        <div className="soft-panel w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-5 h-20 w-20 animate-pulse rounded-super bg-[var(--accent)]" />
          <h1 className="text-3xl font-black">StudyOS</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Preparazione del workspace locale...</p>
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
        <motion.div
          key={activeView}
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          <Suspense fallback={<div className="soft-panel min-h-[240px] p-8 text-lg font-black">Caricamento vista...</div>}>
            {views[activeView]}
          </Suspense>
        </motion.div>
      )}
    </AppShell>
  );
}
