import { useEffect, useState } from "react";
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
import { DEGREE_PROGRAMS, DEGREE_PROGRAM_IDS, isDegreeProgramId, type DegreeProgramId } from "../lib/graduation";
import { Button, Field, Panel, Pill, SectionTitle, fileInputClass, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { CloudPanel } from "../components/CloudPanel";

const palettes: { id: PaletteName; label: string; colors: string[] }[] = [
  { id: "aurora", label: "Aurora Dark", colors: ["#7CF7C8", "#8B7CFF", "#FF7A8A"] },
  { id: "milk", label: "Milk White", colors: ["#4361EE", "#F4A261", "#2A9D8F"] },
  { id: "space", label: "Deep Space", colors: ["#B8F7FF", "#C084FC", "#FF8FAB"] },
  { id: "university", label: "University Focus", colors: ["#38BDF8", "#F97316", "#22C55E"] },
  { id: "forest", label: "Forest Calm", colors: ["#8BD8BD", "#C6C267", "#FF8F70"] },
  { id: "sunset", label: "Sunset Study", colors: ["#FF9F6E", "#FF6F91", "#7DD3FC"] },
  { id: "graphite", label: "Minimal Graphite", colors: ["#E5E7EB", "#9CA3AF", "#FCA5A5"] }
];

const THEME_LABEL: Record<ThemeMode, string> = { dark: "Scuro", light: "Chiaro", focus: "Focus" };

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

  const exportBackup = async (scope: "full" | "tasks" | "calendar" | "subjects" = "full") => {
    setMessage("");
    if (exportEncrypted && backupPassphrase.length < 8) {
      setMessage("Per un backup cifrato usa almeno 8 caratteri.");
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
      preferences: scope === "full" ? snapshot.preferences : []
      };
      const envelope = await createBackupEnvelope(scoped, settings, exportEncrypted ? backupPassphrase : undefined, scope);
      downloadJson(`studyos-${scope}-${new Date().toISOString().slice(0, 10)}${exportEncrypted ? "-encrypted" : ""}.json`, envelope);
      setMessage("Backup esportato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Esportazione non riuscita.");
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
          `Backup completo del ${backup.exportedAt.slice(0, 10)} (${summary.text}).\n\nSostituire TUTTI i dati attuali con il contenuto del backup?${
            isSignedIn() ? "\nLe modifiche verranno sincronizzate anche sul cloud." : ""
          }`
        );
        if (!ok) return;
        await replaceAllData(snapshot);
        setMessage(`Backup importato: ${summary.text}.`);
      } else {
        const result = await mergeData(snapshot);
        const scopeLabel = scope === "tasks" ? "task" : scope === "calendar" ? "calendario" : scope === "subjects" ? "materie" : scope;
        setMessage(`Backup parziale (${scopeLabel}) unito ai dati esistenti: ${result.added} nuovi, ${result.updated} aggiornati.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import non riuscito.");
    }
  };

  const resetData = async () => {
    if (!window.confirm("Resettare tutti i dati locali e ripartire da un workspace vuoto?")) return;
    setMessage("");
    try {
      if (isSignedIn()) {
        const alsoCloud = window.confirm(
          "Sei collegato al cloud.\n\nOK = elimina i dati anche dal cloud e da tutti i dispositivi sincronizzati.\nAnnulla = svuota solo questo dispositivo e riscarica i dati dal cloud."
        );
        await resetAllData({ propagate: alsoCloud });
        if (alsoCloud) await requestSync();
        else await resetCloudDeviceState();
        const sync = getCloudSyncState();
        setMessage(alsoCloud
          ? sync.pendingChanges || sync.status === "error" || sync.status === "offline"
            ? "Dati locali eliminati. Le cancellazioni cloud restano in coda e ripartiranno quando la sync sarà disponibile."
            : "Dati locali eliminati e cancellazioni cloud sincronizzate."
          : sync.status === "error" || sync.status === "offline"
            ? "Dispositivo svuotato. Il download dal cloud ripartirà quando la sync sarà disponibile."
            : "Dispositivo svuotato e dati cloud riscaricati.");
        return;
      }
      await resetAllData({ propagate: false });
      setMessage("Workspace locale resettato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset non riuscito.");
    }
  };

  const lockNow = async () => {
    setMessage("");
    try {
      await lockVault();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossibile bloccare: salvataggio non riuscito.");
    }
  };

  const activateVault = async () => {
    setMessage("");
    if (vaultPassphrase.length < 10) {
      setMessage("Per il vault usa almeno 10 caratteri.");
      return;
    }
    try {
      await enableVault(vaultPassphrase, vaultHint || undefined);
      setVaultPassphrase("");
      setVaultHint("");
      setMessage("Vault cifrato attivato. Da ora i dati vengono salvati come snapshot cifrato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Attivazione vault non riuscita.");
    }
  };

  const deactivateVault = async () => {
    try {
      await disableVault(vaultPassphrase || undefined);
      setMessage("Vault disattivato. I dati restano locali in IndexedDB standard.");
      setVaultPassphrase("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Non riesco a disattivare il vault.");
    }
  };

  return (
    <div>
      <SectionTitle
        title="Impostazioni"
        subtitle="Profilo, aspetto, privacy, cloud e backup dei tuoi dati."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4">
            <h3 className="text-2xl font-black">Profilo e obiettivi</h3>
            <p className="safe-text mt-1 text-sm font-bold text-[var(--muted)]">
              {displayName ? `Ciao, ${displayName}. ` : ""}Questi dati seguono il tuo account: con il cloud attivo sono uguali su ogni dispositivo.
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="grid grid-cols-1 h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-super bg-[var(--surface-soft)]">
              {preferences.avatarDataUrl ? (
                <img src={preferences.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon name="User" className="h-9 w-9 text-[var(--accent-ink)]" />
              )}
            </div>
            <div className="grid grid-cols-1 min-w-0 flex-1 gap-3">
              <Field label="Nome visualizzato">
                <input
                  className={inputClass}
                  value={preferences.displayName}
                  onChange={(event) => void updatePreferences({ displayName: event.target.value })}
                  placeholder="Il tuo nome"
                  autoComplete="given-name"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <label className="motion-safe inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold hover:bg-[var(--surface)]">
                  <Icon name="Upload" className="h-4 w-4" />
                  Foto profilo
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (event) => {
                      try {
                        const avatarDataUrl = await resizeImageFile(event.target.files?.[0]);
                        if (avatarDataUrl) await updatePreferences({ avatarDataUrl });
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Immagine non valida.");
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
            <span className="min-w-0 flex-1">Mostra la sezione del corso BARB · UNIMI</span>
          </label>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-2xl font-black">Aspetto</h3>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Modalità">
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

            <Field label="Palette">
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
                  <option value="comfortable">Comoda</option>
                  <option value="compact">Compatta</option>
                </select>
              </Field>
              <Field label="Vista iniziale">
                <select className={inputClass} value={settings.initialView} onChange={(event) => updateSettings({ initialView: event.target.value as UserSettings["initialView"] })}>
                  <option value="last">Ultima sezione aperta</option>
                  <option value="dashboard">Dashboard</option>
                  <option value="calendar">Calendario</option>
                  <option value="tasks">Task</option>
                  <option value="study">Studio</option>
                </select>
              </Field>
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-2xl font-black">Privacy locale</h3>
              <p className="text-sm text-[var(--muted)]">GitHub Pages ospita solo il codice. I dati sono nel browser.</p>
            </div>
            <Pill active={settings.security.mode === "vault"} className="shrink-0">{settings.security.mode === "vault" ? "Vault cifrato" : "Standard"}</Pill>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="quiet-panel flex items-center gap-3 p-4">
              <span className="grid grid-cols-1 h-12 w-12 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name={settings.security.mode === "vault" ? "Lock" : "Shield"} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-black">{settings.security.mode === "vault" ? "Snapshot IndexedDB cifrato" : "IndexedDB local-first"}</p>
                <p className="text-sm text-[var(--muted)]">
                  {settings.security.mode === "vault"
                    ? "La passphrase non viene salvata; serve a sbloccare la sessione."
                    : "Puoi attivare il vault o esportare backup cifrati."}
                </p>
              </div>
            </div>

            <Field label="Passphrase vault">
              <input className={inputClass} type="password" value={vaultPassphrase} onChange={(event) => setVaultPassphrase(event.target.value)} />
            </Field>
            {settings.security.mode === "standard" ? (
              <Field label="Suggerimento opzionale">
                <input className={inputClass} value={vaultHint} onChange={(event) => setVaultHint(event.target.value)} />
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {settings.security.mode === "standard" ? (
                <Button icon="Lock" variant="primary" onClick={activateVault}>
                  Attiva vault
                </Button>
              ) : (
                <>
                  <Button icon="Lock" variant="soft" onClick={() => void lockNow()}>
                    Blocca ora
                  </Button>
                  <Button icon="Shield" variant="danger" onClick={deactivateVault}>
                    Disattiva vault
                  </Button>
                </>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-2xl font-black">Backup e import</h3>
          <div className="grid grid-cols-1 gap-4">
            <label className="flex items-center gap-3 rounded-[22px] bg-[var(--surface-soft)] p-3 text-sm font-black">
              <input
                type="checkbox"
                checked={exportEncrypted}
                onChange={(event) => setExportEncrypted(event.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              Backup cifrato AES-GCM
            </label>

            {exportEncrypted ? (
              <Field label="Passphrase backup">
                <input className={inputClass} type="password" value={backupPassphrase} onChange={(event) => setBackupPassphrase(event.target.value)} />
              </Field>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button icon="Download" variant="primary" onClick={() => exportBackup("full")}>
                Backup completo
              </Button>
              <Button icon="Download" variant="soft" onClick={() => exportBackup("calendar")}>
                Calendario
              </Button>
              <Button icon="Download" variant="soft" onClick={() => exportBackup("tasks")}>
                Task
              </Button>
              <Button icon="Download" variant="soft" onClick={() => exportBackup("subjects")}>
                Materie
              </Button>
            </div>

            <Field label="Passphrase import cifrato">
              <input className={inputClass} type="password" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} />
            </Field>
            <Field label="Importa backup .json">
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

        <Panel>
          <h3 className="mb-4 text-2xl font-black">Dati locali</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DataStat label="Materie" value={subjects.length} />
            <DataStat label="Esami" value={exams.length} />
            <DataStat label="Task" value={tasks.length} />
            <DataStat label="Eventi" value={events.length} />
            <DataStat label="Allegati" value={attachments.length} />
          </div>
          <Button className="mt-5" icon="Trash2" variant="danger" onClick={() => void resetData()}>
            Reset dati locali
          </Button>
          {message ? (
            <p role="status" className="mt-4 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
              {message}
            </p>
          ) : null}
        </Panel>

        <CloudPanel />
      </div>
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
