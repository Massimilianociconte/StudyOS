import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PaletteName, ThemeMode, UserSettings } from "../types";
import {
  backupSummary,
  createBackupEnvelope,
  downloadJson,
  inferBackupScope,
  readBackupEnvelope,
  snapshotFromBackup
} from "../lib/backup";
import { selectPreferences, useStudyStore, snapshotFromState } from "../store/useStudyStore";
import { whenPersisted } from "../lib/persistence";
import { getCloudSyncState, isSignedIn, requestSync, resetCloudDeviceState } from "../lib/cloudSync";
import { resizeImageFile } from "../lib/files";
import { takeSettingsSection, type SettingsSection } from "../lib/settingsJump";
import { DEGREE_PROGRAMS, DEGREE_PROGRAM_IDS, isDegreeProgramId, type DegreeProgramId } from "../lib/graduation";
import { Button, Field, Panel, Pill, SectionTitle, fileInputClass, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { CloudPanel } from "../components/CloudPanel";
import { AgentSettings } from "../components/AgentDesk";
import { ProfileOnlineCard } from "../components/ProfileOnlineCard";

const palettes: { id: PaletteName; label: string; colors: string[] }[] = [
  { id: "aurora", label: "Aurora scuro", colors: ["#7CF7C8", "#8B7CFF", "#FF7A8A"] },
  { id: "milk", label: "Bianco latte", colors: ["#4361EE", "#F4A261", "#2A9D8F"] },
  { id: "space", label: "Spazio profondo", colors: ["#B8F7FF", "#C084FC", "#FF8FAB"] },
  { id: "university", label: "Università", colors: ["#38BDF8", "#F97316", "#22C55E"] },
  { id: "forest", label: "Bosco calmo", colors: ["#8BD8BD", "#C6C267", "#FF8F70"] },
  { id: "sunset", label: "Tramonto", colors: ["#FF9F6E", "#FF6F91", "#7DD3FC"] },
  { id: "graphite", label: "Grafite essenziale", colors: ["#E5E7EB", "#9CA3AF", "#FCA5A5"] }
];

const THEME_LABEL: Record<ThemeMode, string> = { dark: "Scuro", light: "Chiaro", focus: "Focus" };

/** Gli errori di password e copie arrivano dalla logica con termini tecnici: qui diventano frasi semplici. */
const plainError = (error: unknown, fallback: string) => {
  const text = error instanceof Error ? error.message : "";
  if (/passphrase richiesta/i.test(text)) return "Questa copia è protetta: scrivi la sua password qui sopra e scegli di nuovo il file.";
  if (/passphrase del backup non valida/i.test(text)) return "Password della copia sbagliata: correggila e scegli di nuovo il file.";
  if (/serve la passphrase/i.test(text)) return "Scrivi la password attuale per togliere la protezione.";
  if (/passphrase non valida/i.test(text)) return "Password sbagliata. Controlla maiuscole e minuscole e riprova.";
  if (/json valido|backup studyos non valido/i.test(text)) return "Questo file non è una copia di StudyOS. Scegli il file .json scaricato da qui.";
  if (/backup cifrato incompleto|backup senza dati/i.test(text)) return "Il file della copia è incompleto o danneggiato.";
  return text || fallback;
};

const formatDay = (iso: string) => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }) : iso.slice(0, 10);
};

export function SettingsView() {
  const store = useStudyStore();
  const preferences = selectPreferences(store);
  const {
    settings,
    updateSettings,
    updatePreferences,
    enableVault,
    disableVault,
    lockVault,
    replaceAllData,
    mergeData,
    resetAllData,
    subjects,
    exams,
    tasks,
    events,
    attachments
  } = store;
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [exportEncrypted, setExportEncrypted] = useState(settings.security.backupEncryptionDefault);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultHint, setVaultHint] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [message, setMessage] = useState("");
  const displayName = settings.profile?.displayName?.trim();
  // undefined = ancora da leggere. Il ref sopravvive al doppio effetto di StrictMode,
  // mentre takeSettingsSection consuma la richiesta alla prima lettura.
  const jumpRef = useRef<SettingsSection | null | undefined>(undefined);

  useEffect(() => {
    if (jumpRef.current === undefined) jumpRef.current = takeSettingsSection();
    const target = jumpRef.current;
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      jumpRef.current = null;
      document.getElementById(`settings-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const exportBackup = async (scope: "full" | "tasks" | "calendar" | "subjects" = "full") => {
    setMessage("");
    if (exportEncrypted && backupPassphrase.length < 8) {
      setMessage("Per proteggere la copia scegli una password di almeno 8 caratteri.");
      return;
    }

    try {
      await whenPersisted();
      const state = useStudyStore.getState();
      const snapshot = snapshotFromState(state);
      const scoped = {
      ...snapshot,
      subjects: scope === "full" || scope === "subjects" ? snapshot.subjects : [],
      exams: scope === "full" ? snapshot.exams : [],
      events: scope === "full" || scope === "calendar" ? snapshot.events : [],
      tasks: scope === "full" || scope === "tasks" ? snapshot.tasks : [],
      sessions: scope === "full" ? snapshot.sessions : [],
      topics: scope === "full" ? snapshot.topics : [],
      attachments: scope === "full" ? snapshot.attachments : [],
      goals: scope === "full" ? snapshot.goals : [],
      notes: scope === "full" ? snapshot.notes : [],
      tags: scope === "full" ? snapshot.tags : [],
      reminders: scope === "full" ? snapshot.reminders : [],
      widgets: scope === "full" ? snapshot.widgets : [],
      preferences: scope === "full" ? snapshot.preferences : [],
      notifications: scope === "full" ? snapshot.notifications : [],
      studyGroups: scope === "full" ? snapshot.studyGroups : [],
      groupInvites: scope === "full" ? snapshot.groupInvites : [],
      groupResources: scope === "full" ? snapshot.groupResources : [],
      groupActivities: scope === "full" ? snapshot.groupActivities : []
      };
      const envelope = await createBackupEnvelope(scoped, settings, exportEncrypted ? backupPassphrase : undefined, scope);
      downloadJson(`studyos-${scope}-${new Date().toISOString().slice(0, 10)}${exportEncrypted ? "-encrypted" : ""}.json`, envelope);
      setMessage("Copia scaricata: la trovi nella cartella dei download. Conservala in un posto sicuro.");
    } catch (error) {
      setMessage(plainError(error, "Download della copia non riuscito. Riprova."));
    }
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    setMessage("");
    try {
      const backup = await readBackupEnvelope(file);
      const snapshot = await snapshotFromBackup(backup, backup.encrypted ? importPassphrase : undefined);
      const scope = inferBackupScope(backup, snapshot);
      const summary = backupSummary(snapshot);
      if (scope === "full") {
        const ok = window.confirm(
          `Copia completa del ${formatDay(backup.exportedAt)} (${summary.text}).\n\nSostituire TUTTI i dati attuali con quelli della copia? I dati attuali verranno cancellati e non si potrà annullare.${
            isSignedIn() ? "\nLa sostituzione arriverà anche al tuo account e agli altri dispositivi collegati." : ""
          }`
        );
        if (!ok) return;
        await replaceAllData(snapshot);
        setMessage(`Copia ripristinata: ${summary.text}.`);
      } else {
        const result = await mergeData(snapshot);
        const scopeLabel = scope === "tasks" ? "attività" : scope === "calendar" ? "calendario" : scope === "subjects" ? "materie" : scope;
        setMessage(`Copia parziale (${scopeLabel}) aggiunta ai tuoi dati: ${result.added} elementi nuovi, ${result.updated} aggiornati.`);
      }
    } catch (error) {
      setMessage(plainError(error, "Ripristino non riuscito. Controlla di aver scelto il file giusto e riprova."));
    }
  };

  const resetData = async () => {
    if (
      !window.confirm(
        "Cancellare tutti i dati di StudyOS da questo dispositivo?\n\nMaterie, esami, attività, eventi, allegati, profilo e tutto il resto verranno eliminati (restano solo le scelte di aspetto) e la protezione con password verrà tolta. Non si può annullare: se non hai una copia di sicurezza, premi Annulla e scaricala prima."
      )
    )
      return;
    setMessage("");
    try {
      if (isSignedIn()) {
        const alsoCloud = window.confirm(
          "Sei collegato al tuo account.\n\nOK = cancella i dati anche dall'account e da tutti i dispositivi collegati (non si può annullare).\nAnnulla = svuota solo questo dispositivo e riscarica i dati dall'account."
        );
        await resetAllData({ propagate: alsoCloud });
        if (alsoCloud) await requestSync();
        else await resetCloudDeviceState();
        const sync = getCloudSyncState();
        setMessage(alsoCloud
          ? sync.pendingChanges || sync.status === "error" || sync.status === "offline"
            ? "Dati cancellati da questo dispositivo. Verranno cancellati anche dall'account appena la sincronizzazione riprende."
            : "Dati cancellati da questo dispositivo e dall'account."
          : sync.status === "error" || sync.status === "offline"
            ? "Dispositivo svuotato. I dati dell'account verranno riscaricati appena la sincronizzazione riprende."
            : "Dispositivo svuotato e dati riscaricati dall'account.");
        return;
      }
      await resetAllData({ propagate: false });
      setMessage("Tutti i dati di questo dispositivo sono stati cancellati.");
    } catch (error) {
      setMessage(plainError(error, "Cancellazione non riuscita. Riprova."));
    }
  };

  const lockNow = async () => {
    setMessage("");
    try {
      await lockVault();
    } catch (error) {
      setMessage(plainError(error, "Blocco non riuscito: le ultime modifiche non sono ancora salvate. Riprova tra poco."));
    }
  };

  const activateVault = async () => {
    setMessage("");
    if (vaultPassphrase.length < 10) {
      setMessage("La password deve avere almeno 10 caratteri.");
      return;
    }
    try {
      await enableVault(vaultPassphrase, vaultHint || undefined);
      setVaultPassphrase("");
      setVaultHint("");
      setMessage("Protezione attivata: da ora StudyOS ti chiede la password ogni volta che lo apri su questo dispositivo.");
    } catch (error) {
      setMessage(plainError(error, "Non è stato possibile attivare la protezione. Riprova."));
    }
  };

  const deactivateVault = async () => {
    try {
      await disableVault(vaultPassphrase || undefined);
      setMessage("Protezione tolta: StudyOS si apre senza password. I dati restano su questo dispositivo.");
      setVaultPassphrase("");
    } catch (error) {
      setMessage(plainError(error, "Non è stato possibile togliere la protezione. Riprova."));
    }
  };

  return (
    <div>
      <SectionTitle
        title="Impostazioni"
        subtitle="Il tuo profilo, l'aspetto dell'app, l'account e la protezione dei tuoi dati."
      />

      {message ? (
        <p role="status" className="mb-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
          {message}
        </p>
      ) : null}

      <nav aria-label="Categorie di impostazioni" className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => document.getElementById(`settings-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--surface-soft)] px-3.5 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]"
          >
            <Icon name={section.icon} className="h-3.5 w-3.5" />
            {section.label}
          </button>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4">
        <section id="settings-profilo" aria-labelledby="settings-profilo-title" className="scroll-mt-24">
        <Panel>
          <SettingHeader
            section="profilo"
            title="Profilo e obiettivi"
            description={`${displayName ? `Ciao, ${displayName}. ` : ""}Il tuo nome, il tuo corso e quanto vuoi studiare. Se accedi con l'account li ritrovi su ogni dispositivo.`}
          />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="grid grid-cols-1 h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-super bg-[var(--surface-soft)]">
              {preferences.avatarDataUrl ? (
                <img src={preferences.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon name="User" className="h-9 w-9 text-[var(--accent-ink)]" />
              )}
            </div>
            <div className="grid grid-cols-1 min-w-0 flex-1 gap-3">
              <Field label="Il tuo nome">
                <input
                  className={inputClass}
                  value={preferences.displayName}
                  onChange={(event) => void updatePreferences({ displayName: event.target.value })}
                  placeholder="Es. Giulia"
                  autoComplete="given-name"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <label className="motion-safe inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold hover:bg-[var(--surface)]">
                  <Icon name="Upload" className="h-4 w-4" />
                  {preferences.avatarDataUrl ? "Cambia foto" : "Carica una foto"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (event) => {
                      try {
                        const avatarDataUrl = await resizeImageFile(event.target.files?.[0]);
                        if (avatarDataUrl) await updatePreferences({ avatarDataUrl });
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Questa immagine non si può usare. Prova con una foto JPG o PNG.");
                      } finally {
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                {preferences.avatarDataUrl ? (
                  <Button variant="danger" icon="Trash2" onClick={() => void updatePreferences({ avatarDataUrl: "" })}>
                    Rimuovi foto
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <Field label="Corso di laurea" className="mt-4">
            <select
              className={inputClass}
              value={isDegreeProgramId(preferences.degreeProgram) ? preferences.degreeProgram : "barb"}
              onChange={(event) => {
                const id = event.target.value as DegreeProgramId;
                // Cambiare corso aggiorna CFU totali e sezione BARB (entrambi restano modificabili).
                void updatePreferences({ degreeProgram: id, degreeCfu: DEGREE_PROGRAMS[id].totalCfu, showBarb: id === "barb" });
              }}
            >
              {DEGREE_PROGRAM_IDS.map((id) => (
                <option key={id} value={id}>
                  {DEGREE_PROGRAMS[id].name} · {DEGREE_PROGRAMS[id].level} (UNIMI)
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Obiettivo di studio (ore a settimana)">
              <NumberField
                value={Math.round((preferences.weeklyTargetMinutes / 60) * 2) / 2}
                min={1}
                max={80}
                onCommit={(hours) => void updatePreferences({ weeklyTargetMinutes: Math.round(hours * 60) })}
              />
            </Field>
            <Field label="CFU totali del corso di laurea">
              <NumberField value={preferences.degreeCfu} min={1} max={400} onCommit={(cfu) => void updatePreferences({ degreeCfu: Math.round(cfu) })} />
            </Field>
          </div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3 text-sm font-bold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={preferences.showBarb}
              onChange={(event) => void updatePreferences({ showBarb: event.target.checked })}
            />
            <span className="min-w-0 flex-1">Mostra la sezione Corso di laurea (BARB · UNIMI)</span>
          </label>
          <ProfileOnlineCard />
        </Panel>
        </section>

        <section id="settings-aspetto" aria-labelledby="settings-aspetto-title" className="scroll-mt-24">
        <Panel>
          <SettingHeader section="aspetto" title="Aspetto" description="Scegli tema e colori. Valgono solo su questo dispositivo." />
          <div className="grid grid-cols-1 gap-4">
            <Field label="Tema">
              <div className="grid grid-cols-3 gap-2">
                {(["dark", "light", "focus"] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={settings.themeMode === mode}
                    onClick={() => updateSettings({ themeMode: mode })}
                    className={`min-h-12 rounded-[20px] border px-3 text-sm font-black ${
                      settings.themeMode === mode ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] bg-[var(--surface-soft)]"
                    }`}
                  >
                    {THEME_LABEL[mode]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Colori">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {palettes.map((palette) => (
                  <button
                    key={palette.id}
                    type="button"
                    aria-pressed={settings.palette === palette.id}
                    onClick={() => updateSettings({ palette: palette.id })}
                    className={`flex min-h-14 items-center justify-between rounded-[22px] border p-3 text-left ${
                      settings.palette === palette.id ? "border-[var(--accent)] bg-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface-soft)]"
                    }`}
                  >
                    <span className="font-black">{palette.label}</span>
                    <span className="flex gap-1">
                      {palette.colors.map((color) => (
                        <span key={color} className="h-5 w-5 rounded-full" style={{ background: color }} />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Densità">
                <select className={inputClass} value={settings.density} onChange={(event) => updateSettings({ density: event.target.value as "comfortable" | "compact" })}>
                  <option value="comfortable">Comoda (più spazio)</option>
                  <option value="compact">Compatta (più cose a schermo)</option>
                </select>
              </Field>
              <Field label="Sezione all'apertura">
                <select className={inputClass} value={settings.initialView} onChange={(event) => updateSettings({ initialView: event.target.value as UserSettings["initialView"] })}>
                  <option value="dashboard">Home</option>
                  <option value="calendar">Calendario</option>
                  <option value="tasks">Attività</option>
                  <option value="study">Studio</option>
                  <option value="last">Ultima sezione aperta</option>
                </select>
              </Field>
            </div>
          </div>
        </Panel>
        </section>

        <section id="settings-account" aria-labelledby="settings-account-title" className="scroll-mt-24">
          <SettingHeader section="account" title="Account" description="Accedi per avere i tuoi dati su telefono e computer." />
          <CloudPanel />
        </section>

        <section id="settings-privacy" aria-labelledby="settings-privacy-title" className="scroll-mt-24">
        <Panel>
          <SettingHeader
            section="privacy"
            title="Privacy"
            description="Puoi chiedere una password ogni volta che StudyOS si apre su questo dispositivo."
            action={<Pill active={settings.security.mode === "vault"}>{settings.security.mode === "vault" ? "Protetto da password" : "Senza password"}</Pill>}
          />

          <div className="grid grid-cols-1 gap-3">
            <div className="quiet-panel flex items-center gap-3 p-4">
              <span className="grid grid-cols-1 h-12 w-12 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name={settings.security.mode === "vault" ? "Lock" : "Shield"} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-black">{settings.security.mode === "vault" ? "I dati su questo dispositivo sono protetti" : "Protezione non attiva"}</p>
                <p className="text-sm text-[var(--muted)]">
                  {settings.security.mode === "vault"
                    ? "Sono cifrati con la tua password, che non viene salvata da nessuna parte: serve ogni volta che apri StudyOS."
                    : "Chi usa questo browser può aprire StudyOS e vedere i tuoi dati."}
                </p>
              </div>
            </div>

            {settings.security.mode === "standard" ? (
              <>
                <p className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">
                  Se dimentichi la password, i dati di questo dispositivo non si possono più recuperare. Prima di attivarla scarica una copia di sicurezza.
                </p>
                <Field label="Scegli una password (almeno 10 caratteri)">
                  <input
                    className={inputClass}
                    type="password"
                    autoComplete="new-password"
                    value={vaultPassphrase}
                    onChange={(event) => setVaultPassphrase(event.target.value)}
                  />
                </Field>
                <Field label="Promemoria della password (facoltativo, visibile a chi apre l'app)">
                  <input
                    className={inputClass}
                    value={vaultHint}
                    onChange={(event) => setVaultHint(event.target.value)}
                    placeholder="Es. il titolo del mio libro preferito"
                  />
                </Field>
              </>
            ) : (
              <Field label="Password attuale (serve solo per togliere la protezione)">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={vaultPassphrase}
                  onChange={(event) => setVaultPassphrase(event.target.value)}
                />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              {settings.security.mode === "standard" ? (
                <Button icon="Lock" variant="primary" onClick={activateVault}>
                  Proteggi con una password
                </Button>
              ) : (
                <>
                  <Button icon="Lock" variant="soft" onClick={() => void lockNow()}>
                    Blocca ora
                  </Button>
                  <Button icon="Shield" variant="danger" onClick={deactivateVault}>
                    Togli la password
                  </Button>
                </>
              )}
            </div>
          </div>
        </Panel>
        </section>

        <section id="settings-backup" aria-labelledby="settings-backup-title" className="scroll-mt-24">
        <Panel>
          <SettingHeader section="backup" title="Copia di sicurezza" description="Salva tutti i tuoi dati in un file, per ripristinarli qui o su un altro dispositivo." />
          <div className="grid grid-cols-1 gap-4">
            <h4 className="text-sm font-black">Scarica una copia</h4>
            <label className="flex items-center gap-3 rounded-[22px] bg-[var(--surface-soft)] p-3 text-sm font-black">
              <input
                type="checkbox"
                checked={exportEncrypted}
                onChange={(event) => setExportEncrypted(event.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              Proteggi la copia con una password
            </label>

            {exportEncrypted ? (
              <Field label="Password della copia (almeno 8 caratteri, ti servirà per ripristinarla)">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={backupPassphrase}
                  onChange={(event) => setBackupPassphrase(event.target.value)}
                />
              </Field>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button icon="Download" variant="primary" onClick={() => exportBackup("full")}>
                Scarica una copia di sicurezza
              </Button>
            </div>
            <div>
              <p className="text-xs font-bold text-[var(--muted)]">Oppure scarica solo una parte:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button icon="Download" variant="soft" onClick={() => exportBackup("calendar")}>
                  Solo calendario
                </Button>
                <Button icon="Download" variant="soft" onClick={() => exportBackup("tasks")}>
                  Solo attività
                </Button>
                <Button icon="Download" variant="soft" onClick={() => exportBackup("subjects")}>
                  Solo materie
                </Button>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-black">Ripristina da una copia</h4>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Una copia completa sostituisce tutti i dati attuali (prima ti chiediamo conferma). Una copia parziale si aggiunge a quelli che hai già.
              </p>
            </div>
            <Field label="Password della copia (solo se l'hai protetta)">
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={importPassphrase}
                onChange={(event) => setImportPassphrase(event.target.value)}
              />
            </Field>
            <Field label="Scegli il file della copia (.json)">
              <input
                className={fileInputClass}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void importBackup(file);
                }}
              />
            </Field>
          </div>
        </Panel>
        </section>

        <section id="settings-agenti" aria-labelledby="settings-agenti-title" className="scroll-mt-24">
        <Panel>
          <SettingHeader
            section="agenti"
            title="Agenti AI"
            description="Collega ChatGPT, Claude o un altro assistente AI: potrà leggere il tuo studio e, se lo permetti, aggiornarlo con la tua conferma."
          />
          <AgentSettings />
        </Panel>
        </section>

        <section id="settings-dati" aria-labelledby="settings-dati-title" className="scroll-mt-24">
        <Panel>
          <SettingHeader
            section="dati"
            title="Spazio e dati"
            description="Quanti elementi hai salvato su questo dispositivo e, solo se serve davvero, come ripartire da zero."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DataStat label="Materie" value={subjects.length} />
            <DataStat label="Esami" value={exams.length} />
            <DataStat label="Attività" value={tasks.length} />
            <DataStat label="Eventi" value={events.length} />
            <DataStat label="Allegati" value={attachments.length} />
          </div>
          <div className="mt-5 rounded-[20px] border border-[var(--danger-border)] p-3">
            <p className="text-sm font-black text-[var(--danger-text)]">Cancella tutti i dati</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Elimina materie, esami, attività, eventi, allegati e profilo da questo dispositivo. Non si può annullare: scarica prima una copia di sicurezza. Se hai un account, potrai scegliere se cancellarli anche lì.
            </p>
            <Button className="mt-3" icon="Trash2" variant="danger" onClick={() => void resetData()}>
              Cancella tutti i dati
            </Button>
          </div>
        </Panel>
        </section>
      </div>
    </div>
  );
}

const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "profilo", label: "Profilo", icon: "User" },
  { id: "aspetto", label: "Aspetto", icon: "Palette" },
  { id: "account", label: "Account", icon: "LogIn" },
  { id: "privacy", label: "Privacy", icon: "Shield" },
  { id: "backup", label: "Copia di sicurezza", icon: "Download" },
  { id: "agenti", label: "Agenti AI", icon: "Sparkles" },
  { id: "dati", label: "Dati", icon: "Trash2" }
];

/** Intestazione di categoria: titolo + descrizione breve + eventuale azione. */
function SettingHeader({ section, title, description, action }: { section: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id={`settings-${section}-title`} className="text-2xl font-black">
          {title}
        </h3>
        <p className="safe-text mt-1 text-sm font-bold text-[var(--muted)]">{description}</p>
      </div>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}

function DataStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[20px] bg-[var(--surface-soft)] p-3">
      <div className="text-3xl font-black">{value}</div>
      <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
    </div>
  );
}

/** Campo numerico che salva solo a valore valido (su blur o Invio), senza sporcare i dati a ogni tasto. */
function NumberField({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value).replace(".", ","));
  useEffect(() => setDraft(String(value).replace(".", ",")), [value]);
  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(String(value).replace(".", ","));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped).replace(".", ","));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      className={inputClass}
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      aria-valuemin={min}
      aria-valuemax={max}
    />
  );
}
