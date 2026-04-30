import { useState, type PropsWithChildren } from "react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { AppView } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { Button, IconButton } from "./ui";
import { QuickAddModal } from "./QuickAddModal";
import { CloudStatusBadge } from "./CloudStatusBadge";
import { GlobalSearch } from "./GlobalSearch";

const navItems: { view: AppView; label: string; icon: string }[] = [
  { view: "dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { view: "calendar", label: "Calendario", icon: "CalendarDays" },
  { view: "tasks", label: "Task", icon: "Check" },
  { view: "study", label: "Studio", icon: "Timer" },
  { view: "subjects", label: "Materie", icon: "BookOpen" },
  { view: "exams", label: "Esami", icon: "GraduationCap" },
  { view: "materials", label: "Materiali", icon: "Paperclip" },
  { view: "goals", label: "Obiettivi", icon: "Target" },
  { view: "stats", label: "Statistiche", icon: "BarChart3" },
  { view: "settings", label: "Impostazioni", icon: "Settings" }
];

const mobileItems = navItems.filter((item) =>
  ["dashboard", "calendar", "tasks", "study", "settings"].includes(item.view)
);

export function AppShell({ children }: PropsWithChildren) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const { activeView, setActiveView, settings, updateSettings, lockVault } = useStudyStore();

  const todayLabel = format(new Date(), "EEEE d MMMM", { locale: it });

  return (
    <main className="app-bg min-h-screen pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
      <div className="mx-auto grid min-h-screen w-full max-w-[1720px] grid-cols-1 md:grid-cols-[280px_1fr]">
        <aside className="sticky top-0 hidden h-screen p-4 md:block">
          <div className="soft-panel flex h-full flex-col p-4">
            <button
              type="button"
              onClick={() => setActiveView("dashboard")}
              className="mb-6 flex items-center gap-3 rounded-[26px] p-2 text-left"
            >
              <span className="grid h-14 w-14 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name="Sparkles" className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-2xl font-black">StudyOS</span>
                <span className="block text-xs font-bold text-[var(--muted)]">
                  {settings.profile?.displayName?.trim() || "local-first workspace"}
                </span>
              </span>
            </button>

            <nav className="scrollbar-soft flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Sezioni principali">
              {navItems.map((item) => {
                const active = activeView === item.view;
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => setActiveView(item.view)}
                    className={`motion-safe flex min-h-12 w-full items-center gap-3 rounded-[22px] px-3 text-left text-sm font-black ${
                      active
                        ? "bg-[var(--accent)] text-[#10131d]"
                        : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                    }`}
                  >
                    <Icon name={item.icon} className="h-4.5 w-4.5 shrink-0" />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-4 rounded-[26px] border border-[var(--border)] bg-[var(--surface-soft)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-black uppercase text-[var(--faint)]">Privacy</span>
                <Icon name={settings.security.mode === "vault" ? "Lock" : "Shield"} className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <p className="text-sm font-extrabold">
                {settings.security.mode === "vault" ? "Vault cifrato attivo" : "Dati locali nel browser"}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">Locale di default, cloud sync solo se configuri e accedi.</p>
              {settings.security.mode === "vault" ? (
                <Button icon="Lock" variant="soft" className="mt-3 w-full" onClick={lockVault}>
                  Blocca
                </Button>
              ) : null}
              <CloudStatusBadge onClick={() => setActiveView("settings")} />
            </div>
          </div>
        </aside>

        <section className="min-w-0 px-3 py-3 sm:px-5 md:py-5" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <header className="sticky top-0 z-30 mb-6 rounded-[30px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_72%,transparent)] p-2 backdrop-blur-2xl md:top-4 md:mb-8">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[180px] flex-1">
                <GlobalSearch onJump={(view) => setActiveView(view)} />
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-xs font-black uppercase text-[var(--faint)]">Oggi</p>
                <p className="text-sm font-extrabold capitalize">{todayLabel}</p>
              </div>
              <IconButton
                icon={settings.themeMode === "light" ? "Sun" : "Moon"}
                label={settings.themeMode === "light" ? "Passa al tema scuro" : "Passa al tema chiaro"}
                onClick={() => updateSettings({ themeMode: settings.themeMode === "light" ? "dark" : "light" })}
              />
              <button
                type="button"
                aria-label="Apri profilo"
                title="Apri profilo"
                onClick={() => setActiveView("settings")}
                className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]"
              >
                {settings.profile?.avatarDataUrl ? (
                  <img src={settings.profile.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="User" className="h-4.5 w-4.5" />
                )}
              </button>
              <Button icon="Plus" variant="primary" onClick={() => setQuickAddOpen(true)}>
                Quick add
              </Button>
            </div>
          </header>

          <div className="mx-auto max-w-[1380px]">{children}</div>
        </section>
      </div>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="Aggiungi rapidamente"
        style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        className="fixed right-5 z-40 grid h-16 w-16 place-items-center rounded-super bg-[var(--accent)] text-[#10131d] shadow-soft md:hidden"
      >
        <Icon name="Plus" className="h-7 w-7" />
      </button>

      <nav
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        className="fixed left-3 right-3 z-40 grid grid-cols-5 gap-1 rounded-[30px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] p-2 backdrop-blur-2xl md:hidden"
        aria-label="Navigazione mobile"
      >
        {mobileItems.map((item) => {
          const active = activeView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setActiveView(item.view)}
              className={`grid min-h-14 min-w-0 place-items-center rounded-[22px] text-[11px] font-black ${
                active ? "bg-[var(--accent)] text-[#10131d]" : "text-[var(--muted)]"
              }`}
            >
              <Icon name={item.icon} className="h-5 w-5" />
              <span className="one-line-safe px-0.5 text-center">
                {item.view === "dashboard" ? "Home" : item.view === "settings" ? "Altro" : item.label.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </nav>

      <QuickAddModal open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </main>
  );
}
