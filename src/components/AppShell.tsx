import { useState, type PropsWithChildren } from "react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import type { AppView } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { Button, Drawer, IconButton } from "./ui";
import { QuickAddModal } from "./QuickAddModal";
import { CloudStatusBadge } from "./CloudStatusBadge";
import { GlobalSearch } from "./GlobalSearch";
import { TaskTimerReminder } from "./TaskTimerReminder";
import { StudyTimerWatcher } from "./StudyTimerWatcher";

// `short`: etichetta per la barra compatta dei tablet e per la barra in basso su telefono.
const navItems: { view: AppView; label: string; short: string; icon: string }[] = [
  { view: "dashboard", label: "Dashboard", short: "Home", icon: "LayoutDashboard" },
  { view: "calendar", label: "Calendario", short: "Calendario", icon: "CalendarDays" },
  { view: "tasks", label: "Task", short: "Task", icon: "Check" },
  { view: "study", label: "Studio", short: "Studio", icon: "Timer" },
  { view: "subjects", label: "Materie", short: "Materie", icon: "BookOpen" },
  { view: "barb", label: "BARB · UNIMI", short: "BARB", icon: "Landmark" },
  { view: "exams", label: "Esami", short: "Esami", icon: "GraduationCap" },
  { view: "career", label: "Libretto e laurea", short: "Libretto", icon: "Award" },
  { view: "materials", label: "Materiali", short: "Materiali", icon: "Paperclip" },
  { view: "goals", label: "Obiettivi", short: "Obiettivi", icon: "Target" },
  { view: "stats", label: "Statistiche", short: "Statistiche", icon: "BarChart3" },
  { view: "settings", label: "Impostazioni", short: "Opzioni", icon: "Settings" }
];

const MOBILE_PRIMARY: AppView[] = ["dashboard", "calendar", "tasks", "study"];
const mobileItems = navItems.filter((item) => MOBILE_PRIMARY.includes(item.view));

export function AppShell({ children }: PropsWithChildren) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { activeView, setActiveView, settings, updateSettings, lockVault, persistError, retryPersist } = useStudyStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setActiveView: state.setActiveView,
      settings: state.settings,
      updateSettings: state.updateSettings,
      lockVault: state.lockVault,
      persistError: state.persistError,
      retryPersist: state.retryPersist
    }))
  );

  const preferences = useStudyStore(selectPreferences);
  const todayLabel = format(new Date(), "EEEE d MMMM", { locale: it });
  const displayName = preferences.displayName.trim();
  // La sezione BARB si può nascondere dalle impostazioni (preferenza sincronizzata).
  const visibleItems = preferences.showBarb ? navItems : navItems.filter((item) => item.view !== "barb");
  // Tutte le altre sezioni restano raggiungibili da mobile tramite il foglio "Altro".
  const moreItems = visibleItems.filter((item) => !MOBILE_PRIMARY.includes(item.view));

  return (
    // Layout per larghezza: telefono (<640) barra in basso; tablet e finestre medie (640–1279)
    // barra laterale compatta a icone; desktop (≥1280) barra laterale completa.
    <main className="app-bg min-h-dvh pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1720px] grid-cols-1 sm:grid-cols-[92px_minmax(0,1fr)] xl:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh py-3 pl-3 sm:block xl:p-4">
          <div className="soft-panel flex h-full flex-col items-center px-1.5 py-3 xl:hidden">
            <button
              type="button"
              onClick={() => setActiveView("dashboard")}
              aria-label="StudyOS, vai alla dashboard"
              title="StudyOS"
              className="mb-2 grid h-12 w-12 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]"
            >
              <Icon name="Sparkles" className="h-5 w-5" />
            </button>
            <nav className="no-scrollbar flex w-full flex-1 flex-col gap-0.5 overflow-y-auto py-1" aria-label="Sezioni principali">
              {visibleItems.map((item) => {
                const active = activeView === item.view;
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => setActiveView(item.view)}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    className={`motion-safe flex min-h-[52px] w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 text-[10px] font-black leading-tight [@media(max-height:860px)]:min-h-[46px] ${
                      active ? "bg-[var(--accent)] text-[#10131d]" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                    }`}
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                    <span className="w-full truncate text-center">{item.short}</span>
                  </button>
                );
              })}
            </nav>
            <div className="mt-2 flex shrink-0 flex-col items-center gap-2">
              {settings.security.mode === "vault" ? (
                <IconButton icon="Lock" label="Blocca il vault" onClick={() => void lockVault().catch(() => undefined)} />
              ) : null}
              <CloudStatusBadge compact onClick={() => setActiveView("settings")} />
            </div>
          </div>

          <div className="soft-panel hidden h-full flex-col p-4 xl:flex">
            <button
              type="button"
              onClick={() => setActiveView("dashboard")}
              className="mb-4 flex w-full min-w-0 items-center gap-3 rounded-[26px] p-2 text-left"
            >
              <span className="grid grid-cols-1 h-14 w-14 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name="Sparkles" className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="one-line-safe block text-2xl font-black">StudyOS</span>
                <span className="one-line-safe block text-xs font-bold text-[var(--muted)]" title={displayName || "local-first workspace"}>
                  {displayName || "local-first workspace"}
                </span>
              </span>
            </button>

            <nav className="scrollbar-soft flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Sezioni principali">
              {visibleItems.map((item) => {
                const active = activeView === item.view;
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => setActiveView(item.view)}
                    aria-current={active ? "page" : undefined}
                    className={`motion-safe flex min-h-11 w-full items-center gap-3 rounded-[20px] px-3 text-left text-sm font-black [@media(max-height:860px)]:min-h-10 ${
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

            <div className="mt-3 rounded-[24px] border border-[var(--border)] bg-[var(--surface-soft)] p-3.5 [@media(max-height:900px)]:border-0 [@media(max-height:900px)]:bg-transparent [@media(max-height:900px)]:p-0">
              {/* Su schermi bassi (tablet in orizzontale, 800 px) resta solo lo stato cloud: tutte le voci restano visibili. */}
              <div className="[@media(max-height:900px)]:hidden">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-[var(--faint)]">Privacy</span>
                  <Icon name={settings.security.mode === "vault" ? "Lock" : "Shield"} className="h-4 w-4 text-[var(--accent-ink)]" />
                </div>
                <p className="text-sm font-extrabold">
                  {settings.security.mode === "vault" ? "Vault cifrato attivo" : "Dati locali nel browser"}
                </p>
              </div>
              {settings.security.mode === "vault" ? (
                <Button icon="Lock" variant="soft" className="mt-3 w-full" onClick={() => void lockVault().catch(() => undefined)}>
                  Blocca
                </Button>
              ) : null}
              <CloudStatusBadge onClick={() => setActiveView("settings")} />
            </div>
          </div>
        </aside>

        <section className="min-w-0 px-3 py-3 sm:px-4 md:py-4 lg:px-6 xl:py-5" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <header className="sticky top-0 z-30 mb-5 rounded-[30px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_72%,transparent)] p-2 backdrop-blur-2xl sm:top-3 xl:top-4 xl:mb-8">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <GlobalSearch onJump={(view) => setActiveView(view)} />
              </div>
              <div className="hidden shrink-0 text-right lg:block">
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
                className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]"
              >
                {preferences.avatarDataUrl ? (
                  <img src={preferences.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="User" className="h-4.5 w-4.5" />
                )}
              </button>
              <Button icon="Plus" variant="primary" className="hidden shrink-0 sm:inline-flex" onClick={() => setQuickAddOpen(true)}>
                Aggiungi
              </Button>
            </div>
          </header>

          {persistError ? (
            <div
              role="alert"
              className="mx-auto mb-4 flex max-w-[1380px] flex-wrap items-center gap-3 rounded-[22px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]"
            >
              <Icon name="Shield" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{persistError} Le modifiche restano in memoria finché il salvataggio non riesce.</span>
              <Button variant="soft" onClick={() => void retryPersist()}>
                Riprova
              </Button>
            </div>
          ) : null}

          <div className="mx-auto max-w-[1380px]">{children}</div>

          <footer className="mx-auto mt-12 max-w-[1380px] border-t border-[var(--border)] py-6 text-center text-xs font-bold text-[var(--muted)]">
            <p>
              StudyOS &bull;{" "}
              <a
                href="https://webnovis.com"
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="font-extrabold text-[var(--text)] underline decoration-[var(--accent)] underline-offset-2 transition-colors hover:opacity-80"
              >
                WebNovis
              </a>
            </p>
          </footer>
        </section>
      </div>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="Aggiungi rapidamente"
        style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        className="fixed right-5 z-40 grid h-16 w-16 place-items-center rounded-super bg-[var(--accent)] text-[#10131d] shadow-soft sm:hidden"
      >
        <Icon name="Plus" className="h-7 w-7" />
      </button>

      <nav
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        className="fixed left-3 right-3 z-40 mx-auto grid max-w-[560px] grid-cols-5 gap-1 rounded-[30px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] p-2 backdrop-blur-2xl sm:hidden"
        aria-label="Navigazione mobile"
      >
        {mobileItems.map((item) => {
          const active = activeView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setActiveView(item.view)}
              aria-current={active ? "page" : undefined}
              className={`grid min-h-14 min-w-0 place-items-center rounded-[22px] text-[10.5px] font-black tracking-tight ${
                active ? "bg-[var(--accent)] text-[#10131d]" : "text-[var(--muted)]"
              }`}
            >
              <Icon name={item.icon} className="h-5 w-5" />
              <span className="one-line-safe px-0.5 text-center">{item.short}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={`grid min-h-14 min-w-0 place-items-center rounded-[22px] text-[10.5px] font-black tracking-tight ${
            MOBILE_PRIMARY.includes(activeView) ? "text-[var(--muted)]" : "bg-[var(--accent)] text-[#10131d]"
          }`}
        >
          <Icon name="Menu" className="h-5 w-5" />
          <span className="one-line-safe px-0.5 text-center">
            {MOBILE_PRIMARY.includes(activeView) ? "Altro" : navItems.find((item) => item.view === activeView)?.short ?? "Altro"}
          </span>
        </button>
      </nav>

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title="Tutte le sezioni" width="max-w-[420px]">
        <div className="grid grid-cols-2 gap-2">
          {moreItems.map((item) => {
            const active = activeView === item.view;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => {
                  setActiveView(item.view);
                  setMoreOpen(false);
                }}
                aria-current={active ? "page" : undefined}
                className={`motion-safe flex min-h-14 min-w-0 items-center gap-3 rounded-[20px] px-3 text-left text-sm font-black ${
                  active ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] hover:bg-[var(--surface)]"
                }`}
              >
                <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4">
          <CloudStatusBadge
            onClick={() => {
              setActiveView("settings");
              setMoreOpen(false);
            }}
          />
        </div>
      </Drawer>

      <TaskTimerReminder />
      <StudyTimerWatcher />
      <QuickAddModal open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </main>
  );
}
