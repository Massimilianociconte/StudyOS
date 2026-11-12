import { useEffect, useState, type PropsWithChildren } from "react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import type { AppView } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
// Già nel bundle iniziale (lo importa useStudyStore): solo lo stato, mai shareSync o supabase.
import { useSharedStore } from "../store/useSharedStore";
import { SHARE_NOTICE_TEXT, SHELL_TEXT } from "../lib/labels";
import { Icon } from "./Icon";
import { Button, Drawer, IconButton } from "./ui";
import { NotificationsBell } from "./NotificationsBell";
import type { QuickAddMode } from "./QuickAddModal";
import { DeferredPart } from "./DeferredPart";
import { lazyView } from "../lib/lazyView";
import { CloudStatusBadge } from "./CloudStatusBadge";
import { GlobalSearch } from "./GlobalSearch";
import { TaskTimerReminder } from "./TaskTimerReminder";
import { StudyTimerWatcher } from "./StudyTimerWatcher";
import { requestSettingsSection } from "../lib/settingsJump";
import { QUICK_ADD_EVENT } from "../lib/quickAdd";

// `short`: etichetta per la barra compatta dei tablet e per la barra in basso su telefono.
// `hint`: cosa si trova nella sezione, in parole semplici (tooltip e foglio "Altro" su telefono).
type NavItem = { view: AppView; label: string; short: string; icon: string; hint: string };

// Sezioni raggruppate per uso: chi apre l'app la prima volta trova subito le quattro di ogni giorno.
const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Ogni giorno",
    items: [
      { view: "dashboard", label: "Home", short: "Home", icon: "LayoutDashboard", hint: "Il riepilogo di oggi" },
      { view: "calendar", label: "Calendario", short: "Calendario", icon: "CalendarDays", hint: "Lezioni, impegni e scadenze" },
      { view: "tasks", label: "Attività", short: "Attività", icon: "Check", hint: "Le cose da fare, con scadenza" },
      { view: "study", label: "Studio", short: "Studio", icon: "Timer", hint: "Timer, sessioni e ripassi" }
    ]
  },
  {
    title: "Università",
    items: [
      { view: "subjects", label: "Materie", short: "Materie", icon: "BookOpen", hint: "I corsi che stai seguendo" },
      { view: "exams", label: "Esami", short: "Esami", icon: "GraduationCap", hint: "Date e preparazione" },
      { view: "career", label: "Libretto e laurea", short: "Libretto", icon: "Award", hint: "Voti, media e voto di laurea" },
      { view: "barb", label: "Corso di laurea", short: "Corso", icon: "Landmark", hint: "Insegnamenti e appelli ufficiali BARB" }
    ]
  },
  {
    title: "Strumenti",
    items: [
      { view: "materials", label: "Materiali", short: "Materiali", icon: "Paperclip", hint: "File, PDF e link" },
      { view: "goals", label: "Obiettivi", short: "Obiettivi", icon: "Target", hint: "Traguardi da raggiungere" },
      { view: "stats", label: "Statistiche", short: "Statistiche", icon: "BarChart3", hint: "Quanto e come studi" },
      { view: "groups", label: "Gruppi", short: "Gruppi", icon: "Users", hint: "Studia con i compagni" },
      { view: "sharing", label: "Condivisione", short: "Condividi", icon: "Share2", hint: "Cosa vedono gli altri e cosa vedi tu" }
    ]
  }
];

const settingsItem: NavItem = { view: "settings", label: "Impostazioni", short: "Impostazioni", icon: "Settings", hint: "Profilo, account e copie di sicurezza" };

const MOBILE_PRIMARY: AppView[] = ["dashboard", "calendar", "tasks", "study"];
// Pannelli e modali che non servono al primo disegno: arrivano in differita (e si scaldano a riposo).
const loadQuickAdd = () => import("./QuickAddModal");
const loadNotificationsPanel = () => import("./NotificationsPanel");
const loadAgentDock = () => import("./AgentDesk");
const QuickAddModal = lazyView(loadQuickAdd, "QuickAddModal");
const NotificationsPanel = lazyView(loadNotificationsPanel, "NotificationsPanel");
const AgentDock = lazyView(loadAgentDock, "AgentDock");

const mobileItems = navGroups[0].items.filter((item) => MOBILE_PRIMARY.includes(item.view));

/** Per quanto resta in vista la conferma dell'aggiunta rapida. */
const QUICK_ADD_DONE_MS = 5000;

export function AppShell({ children }: PropsWithChildren) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Il modale si monta alla prima apertura e poi resta montato (come prima).
  const [quickAddMounted, setQuickAddMounted] = useState(false);
  useEffect(() => {
    if (quickAddOpen) setQuickAddMounted(true);
  }, [quickAddOpen]);
  useEffect(() => {
    const warm = () => {
      void loadQuickAdd().catch(() => undefined);
      void loadNotificationsPanel().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, []);
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>("task");
  const [moreOpen, setMoreOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Conferma dell'aggiunta rapida (cosa si è creato e dove). Oggetto, non testo: la stessa frase detta
  // di nuovo riparte da capo.
  const [quickAddDone, setQuickAddDone] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!quickAddDone) return;
    const timer = window.setTimeout(() => setQuickAddDone(null), QUICK_ADD_DONE_MS);
    return () => window.clearTimeout(timer);
  }, [quickAddDone]);

  // Le viste (es. i primi passi della Home) aprono l'aggiunta rapida già sul tipo giusto.
  useEffect(() => {
    const onRequest = (event: Event) => {
      const mode = (event as CustomEvent<QuickAddMode | undefined>).detail;
      setQuickAddMode(mode ?? "task");
      setQuickAddOpen(true);
    };
    window.addEventListener(QUICK_ADD_EVENT, onRequest);
    return () => window.removeEventListener(QUICK_ADD_EVENT, onRequest);
  }, []);

  const openQuickAdd = () => {
    setQuickAddMode("task");
    setQuickAddOpen(true);
  };
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
  const shareNotice = useSharedStore((state) => state.notice);
  const todayLabel = format(new Date(), "EEEE d MMMM", { locale: it });
  const displayName = preferences.displayName.trim();
  // La sezione BARB si può nascondere dalle impostazioni (preferenza sincronizzata).
  const visibleGroups = navGroups.map((group) => ({
    ...group,
    items: preferences.showBarb ? group.items : group.items.filter((item) => item.view !== "barb")
  }));
  // Tutte le altre sezioni restano raggiungibili da mobile tramite il foglio "Altro".
  const moreGroups = [
    ...visibleGroups.map((group) => ({ ...group, items: group.items.filter((item) => !MOBILE_PRIMARY.includes(item.view)) })),
    { title: "Account", items: [settingsItem] }
  ].filter((group) => group.items.length);
  const openSettings = (section: Parameters<typeof requestSettingsSection>[0]) => {
    requestSettingsSection(section);
    setActiveView("settings");
  };

  const compactItem = (item: NavItem) => {
    const active = activeView === item.view;
    return (
      <button
        key={item.view}
        type="button"
        onClick={() => setActiveView(item.view)}
        aria-current={active ? "page" : undefined}
        aria-label={`${item.label}: ${item.hint}`}
        title={`${item.label} · ${item.hint}`}
        className={`motion-safe flex min-h-[52px] w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 text-[10px] font-black leading-tight [@media(max-height:860px)]:min-h-[46px] [@media(max-height:800px)]:!min-h-[42px] ${
          active ? "bg-[var(--accent)] text-[#10131d]" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        }`}
      >
        <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
        <span className="w-full truncate text-center">{item.short}</span>
      </button>
    );
  };

  const fullItem = (item: NavItem) => {
    const active = activeView === item.view;
    return (
      <button
        key={item.view}
        type="button"
        onClick={() => setActiveView(item.view)}
        aria-current={active ? "page" : undefined}
        title={item.hint}
        className={`motion-safe flex min-h-11 w-full items-center gap-3 rounded-[20px] px-3 text-left text-sm font-black [@media(max-height:920px)]:min-h-10 ${
          active
            ? "bg-[var(--accent)] text-[#10131d]"
            : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        }`}
      >
        <Icon name={item.icon} className="h-4.5 w-4.5 shrink-0" />
        <span className="min-w-0 truncate">{item.label}</span>
      </button>
    );
  };

  return (
    // Layout per larghezza: telefono (<640) barra in basso; tablet e finestre medie (640–1279)
    // barra laterale compatta a icone; desktop (≥1280) barra laterale completa.
    <main className="app-bg min-h-dvh pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1720px] grid-cols-1 sm:grid-cols-[92px_minmax(0,1fr)] xl:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh py-3 pl-3 sm:block xl:p-4">
          <div className="soft-panel flex h-full flex-col items-center px-1.5 py-3 xl:hidden">
            <button
              type="button"
              onClick={() => setActiveView("dashboard")}
              aria-label="StudyOS, vai alla Home"
              title="StudyOS · Home"
              className="mb-2 grid h-12 w-12 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]"
            >
              <Icon name="Sparkles" className="h-5 w-5" />
            </button>
            <nav className="no-scrollbar flex w-full flex-1 flex-col gap-0.5 overflow-y-auto py-1" aria-label="Sezioni principali">
              {visibleGroups.map((group, index) => (
                <div key={group.title} role="group" aria-label={group.title} className="flex flex-col gap-0.5">
                  {index ? <span aria-hidden="true" className="mx-3 my-0.5 h-px shrink-0 bg-[var(--border)]" /> : null}
                  {group.items.map(compactItem)}
                </div>
              ))}
              <span aria-hidden="true" className="mx-3 my-0.5 h-px shrink-0 bg-[var(--border)]" />
              {compactItem(settingsItem)}
            </nav>
            <div className="mt-2 flex shrink-0 flex-col items-center gap-2">
              {settings.security.mode === "vault" ? (
                <IconButton icon="Lock" label={SHELL_TEXT.lockAria} onClick={() => void lockVault().catch(() => undefined)} />
              ) : null}
              <CloudStatusBadge compact onClick={() => openSettings("account")} />
            </div>
          </div>

          <div className="soft-panel hidden h-full flex-col p-4 xl:flex">
            <button
              type="button"
              onClick={() => setActiveView("dashboard")}
              title="Vai alla Home"
              className="mb-4 flex w-full min-w-0 items-center gap-3 rounded-[26px] p-2 text-left"
            >
              <span className="grid grid-cols-1 h-14 w-14 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name="Sparkles" className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="one-line-safe block text-2xl font-black">StudyOS</span>
                <span className="one-line-safe block text-xs font-bold text-[var(--muted)]" title={displayName || "Lo studio, in ordine"}>
                  {displayName || "Lo studio, in ordine"}
                </span>
              </span>
            </button>

            <nav className="scrollbar-soft flex-1 space-y-3 overflow-y-auto pr-1 [@media(max-height:920px)]:space-y-2" aria-label="Sezioni principali">
              {visibleGroups.map((group) => (
                <div key={group.title} role="group" aria-label={group.title} className="space-y-1">
                  <p aria-hidden="true" className="px-3 text-[11px] font-black uppercase text-[var(--faint)] [@media(max-height:760px)]:sr-only">
                    {group.title}
                  </p>
                  {group.items.map(fullItem)}
                </div>
              ))}
              <div className="border-t border-[var(--border)] pt-3 [@media(max-height:920px)]:pt-2">{fullItem(settingsItem)}</div>
            </nav>

            <div className="mt-3 rounded-[24px] border border-[var(--border)] bg-[var(--surface-soft)] p-3.5 [@media(max-height:900px)]:border-0 [@media(max-height:900px)]:bg-transparent [@media(max-height:900px)]:p-0">
              {/* Su schermi bassi (tablet in orizzontale, 800 px) resta solo lo stato dell'account: tutte le voci restano visibili. */}
              <div className="[@media(max-height:900px)]:hidden">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-[var(--faint)]">I tuoi dati</span>
                  <Icon name={settings.security.mode === "vault" ? "Lock" : "Shield"} className="h-4 w-4 text-[var(--accent-ink)]" />
                </div>
                <p className="text-sm font-extrabold">
                  {settings.security.mode === "vault" ? "Protetti da password" : "Salvati su questo dispositivo"}
                </p>
              </div>
              {settings.security.mode === "vault" ? (
                <Button
                  icon="Lock"
                  variant="soft"
                  className="mt-3 w-full"
                  title={SHELL_TEXT.lockTitle}
                  onClick={() => void lockVault().catch(() => undefined)}
                >
                  {SHELL_TEXT.lock}
                </Button>
              ) : null}
              <CloudStatusBadge onClick={() => openSettings("account")} />
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
              {/* Sui telefoni lo spazio va alla ricerca: il tema resta in Impostazioni → Aspetto e avvio. */}
              <IconButton
                icon={settings.themeMode === "light" ? "Sun" : "Moon"}
                label={settings.themeMode === "light" ? "Passa al tema scuro" : "Passa al tema chiaro"}
                onClick={() => updateSettings({ themeMode: settings.themeMode === "light" ? "dark" : "light" })}
                className="hidden sm:grid"
              />
              <NotificationsBell onOpen={() => setNotificationsOpen(true)} />
              <button
                type="button"
                aria-label="Il tuo profilo"
                title="Il tuo profilo"
                onClick={() => openSettings("profilo")}
                className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]"
              >
                {preferences.avatarDataUrl ? (
                  <img src={preferences.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="User" className="h-4.5 w-4.5" />
                )}
              </button>
              <Button
                icon="Plus"
                variant="primary"
                className="hidden shrink-0 sm:inline-flex"
                title="Aggiungi un'attività, un evento, una materia o un materiale"
                onClick={openQuickAdd}
              >
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
              <span className="min-w-0 flex-1">{persistError} Non chiudere la pagina: le modifiche sono ancora qui e verranno salvate appena possibile.</span>
              <Button variant="soft" onClick={() => void retryPersist()}>
                Riprova a salvare
              </Button>
            </div>
          ) : null}

          {/* Avviso della condivisione (permesso tolto, modifica non salvata): in ogni sezione, così chi ha
              modificato un evento dal Calendario lo vede lì. La regione resta montata per gli screen reader. */}
          <div role="status" aria-live="polite" className="mx-auto max-w-[1380px]">
            {shareNotice ? (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[22px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm font-bold">
                <Icon name="AlertTriangle" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                <span className="safe-text min-w-0 flex-1">{shareNotice}</span>
                <Button variant="soft" title={SHARE_NOTICE_TEXT.dismissTitle} onClick={() => useSharedStore.getState().setNotice(null)}>
                  {SHARE_NOTICE_TEXT.dismiss}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="mx-auto max-w-[1380px]">{children}</div>

          <footer className="mx-auto mt-12 max-w-[1380px] border-t border-[var(--border)] py-6 text-center text-xs font-bold text-[var(--muted)]">
            <p>
              StudyOS &bull;{" "}
              <a
                href="https://webnovis.com"
                target="_blank"
                rel="nofollow noopener noreferrer"
                // Aspetto invariato; l'area di tocco arriva a 44 px di altezza (il testo ne è alto ~15).
                className="relative font-extrabold text-[var(--text)] underline decoration-[var(--accent)] underline-offset-2 transition-colors after:absolute after:inset-x-[-8px] after:inset-y-[-15px] after:content-[''] hover:opacity-80"
              >
                WebNovis
              </a>
            </p>
          </footer>
        </section>
      </div>

      <button
        type="button"
        onClick={openQuickAdd}
        aria-label="Aggiungi un'attività, un evento, una materia o un materiale"
        style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        className="fixed right-5 z-40 grid h-16 w-16 place-items-center rounded-super bg-[var(--accent)] text-[#10131d] shadow-soft sm:hidden"
      >
        <Icon name="Plus" className="h-7 w-7" />
      </button>

      <nav
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        // Sotto i 360 px meno margini e testo appena più piccolo, così «Calendario» si legge intero.
        className="fixed left-3 right-3 z-40 mx-auto grid max-w-[560px] grid-cols-5 gap-1 rounded-[30px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] p-2 backdrop-blur-2xl max-[359px]:left-2 max-[359px]:right-2 max-[359px]:gap-0.5 max-[359px]:p-1.5 sm:hidden"
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
              className={`grid min-h-14 min-w-0 place-items-center rounded-[22px] text-[10.5px] font-black tracking-tight max-[359px]:text-[10px] ${
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
          aria-label="Altre sezioni"
          className={`grid min-h-14 min-w-0 place-items-center rounded-[22px] text-[10.5px] font-black tracking-tight max-[359px]:text-[10px] ${
            MOBILE_PRIMARY.includes(activeView) ? "text-[var(--muted)]" : "bg-[var(--accent)] text-[#10131d]"
          }`}
        >
          <Icon name="Menu" className="h-5 w-5" />
          <span className="one-line-safe px-0.5 text-center">Altro</span>
        </button>
      </nav>

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title="Altre sezioni" width="max-w-[420px]">
        <div className="grid grid-cols-1 gap-4">
          {moreGroups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <p className="mb-2 px-1 text-[11px] font-black uppercase text-[var(--faint)]">{group.title}</p>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => {
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
                      className={`motion-safe flex min-h-14 min-w-0 items-center gap-3 rounded-[20px] px-3 py-2 text-left text-sm font-black ${
                        active ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className={`two-line-safe block text-[11px] font-bold leading-tight ${active ? "opacity-75" : "text-[var(--muted)]"}`}>{item.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-4">
          <CloudStatusBadge
            onClick={() => {
              openSettings("account");
              setMoreOpen(false);
            }}
          />
        </div>
        {/* Sui telefoni la barra laterale non c'è: il blocco con la password dell'app sta qui. */}
        {settings.security.mode === "vault" ? (
          <Button
            icon="Lock"
            variant="soft"
            className="mt-3 w-full"
            title={SHELL_TEXT.lockTitle}
            onClick={() => {
              setMoreOpen(false);
              void lockVault().catch(() => undefined);
            }}
          >
            {SHELL_TEXT.lock}
          </Button>
        ) : null}
      </Drawer>

      <TaskTimerReminder />
      <DeferredPart>
        <AgentDock />
      </DeferredPart>
      <StudyTimerWatcher />
      {quickAddMounted || quickAddOpen ? (
        <DeferredPart>
          <QuickAddModal
            open={quickAddOpen}
            initialMode={quickAddMode}
            onClose={() => setQuickAddOpen(false)}
            onSaved={(text) => setQuickAddDone({ text })}
          />
        </DeferredPart>
      ) : null}
      {/* Conferma dell'aggiunta rapida, in alto e sopra la pagina (in basso ci sono barra, «+» e avvisi).
          Non si tocca (i tocchi passano sotto) e sparisce da sola; la regione resta montata per gli screen reader. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 mx-auto max-w-md"
      >
        {quickAddDone ? (
          <p className="safe-text flex items-start gap-2 rounded-[22px] border border-[var(--success-border)] bg-[var(--bg-2)] p-3 text-sm font-bold text-[var(--success-text)] shadow-soft">
            <Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{quickAddDone.text}</span>
          </p>
        ) : null}
      </div>
      {notificationsOpen ? (
        <DeferredPart>
          <NotificationsPanel onClose={() => setNotificationsOpen(false)} />
        </DeferredPart>
      ) : null}
    </main>
  );
}
