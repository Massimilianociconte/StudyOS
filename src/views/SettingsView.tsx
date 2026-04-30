import { useState } from "react";
import type { AppView, PaletteName, ThemeMode } from "../types";
import { createBackupEnvelope, downloadJson, readBackupEnvelope, snapshotFromBackup } from "../lib/backup";
import { useStudyStore, snapshotFromState } from "../store/useStudyStore";
import { readImageFile } from "../lib/files";
import { Button, Field, Panel, Pill, SectionTitle, inputClass } from "../components/ui";
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

export function SettingsView() {
  const store = useStudyStore();
  const {
    settings,
    updateSettings,
    enableVault,
    disableVault,
    lockVault,
    replaceAllData,
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

  const exportBackup = async (scope: "full" | "tasks" | "calendar" | "subjects" = "full") => {
    setMessage("");
    if (exportEncrypted && backupPassphrase.length < 8) {
      setMessage("Per un backup cifrato usa almeno 8 caratteri.");
      return;
    }

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
      widgets: scope === "full" ? snapshot.widgets : []
    };
    const envelope = await createBackupEnvelope(scoped, settings, exportEncrypted ? backupPassphrase : undefined);
    downloadJson(`studyos-${scope}-${new Date().toISOString().slice(0, 10)}${exportEncrypted ? "-encrypted" : ""}.json`, envelope);
    setMessage("Backup esportato.");
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    setMessage("");
    try {
      const backup = await readBackupEnvelope(file);
      const snapshot = await snapshotFromBackup(backup, backup.encrypted ? importPassphrase : undefined);
      await replaceAllData(snapshot);
      setMessage("Backup importato correttamente.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import non riuscito.");
    }
  };

  const activateVault = async () => {
    setMessage("");
    if (vaultPassphrase.length < 10) {
      setMessage("Per il vault usa almeno 10 caratteri.");
      return;
    }
    await enableVault(vaultPassphrase, vaultHint || undefined);
    setVaultPassphrase("");
    setVaultHint("");
    setMessage("Vault cifrato attivato. Da ora i dati vengono salvati come snapshot cifrato.");
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
        subtitle="Tema, privacy, backup, portabilita e comportamento iniziale della piattaforma."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <h3 className="mb-4 text-2xl font-black">Profilo</h3>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-super bg-[var(--surface-soft)]">
              {settings.profile?.avatarDataUrl ? (
                <img src={settings.profile.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon name="User" className="h-9 w-9 text-[var(--accent)]" />
              )}
            </div>
            <div className="grid min-w-0 flex-1 gap-3">
              <Field label="Nome visualizzato">
                <input
                  className={inputClass}
                  value={settings.profile?.displayName ?? ""}
                  onChange={(event) => updateSettings({ profile: { displayName: event.target.value } })}
                  placeholder="Il tuo nome"
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
                        const avatarDataUrl = await readImageFile(event.target.files?.[0]);
                        if (avatarDataUrl) await updateSettings({ profile: { avatarDataUrl } });
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Immagine non valida.");
                      } finally {
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
                {settings.profile?.avatarDataUrl ? (
                  <Button variant="danger" icon="Trash2" onClick={() => updateSettings({ profile: { avatarDataUrl: "" } })}>
                    Rimuovi foto
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-2xl font-black">Aspetto</h3>
          <div className="grid gap-4">
            <Field label="Modalita">
              <div className="grid grid-cols-3 gap-2">
                {(["dark", "light", "focus"] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateSettings({ themeMode: mode })}
                    className={`min-h-12 rounded-[20px] border px-3 text-sm font-black ${
                      settings.themeMode === mode ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] bg-[var(--surface-soft)]"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Palette">
              <div className="grid gap-2 sm:grid-cols-2">
                {palettes.map((palette) => (
                  <button
                    key={palette.id}
                    type="button"
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Densita">
                <select className={inputClass} value={settings.density} onChange={(event) => updateSettings({ density: event.target.value as "comfortable" | "compact" })}>
                  <option value="comfortable">Comoda</option>
                  <option value="compact">Compatta</option>
                </select>
              </Field>
              <Field label="Vista iniziale">
                <select className={inputClass} value={settings.initialView} onChange={(event) => updateSettings({ initialView: event.target.value as AppView })}>
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
            <Pill active={settings.security.mode === "vault"}>{settings.security.mode === "vault" ? "vault" : "standard"}</Pill>
          </div>

          <div className="grid gap-3">
            <div className="quiet-panel flex items-center gap-3 p-4">
              <span className="grid h-12 w-12 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
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
                  <Button icon="Lock" variant="soft" onClick={lockVault}>
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
          <div className="grid gap-4">
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
                className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-sm file:font-black file:text-[#10131d]`}
                type="file"
                accept="application/json,.json"
                onChange={(event) => importBackup(event.target.files?.[0])}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-2xl font-black">Dati locali</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DataStat label="materie" value={subjects.length} />
            <DataStat label="esami" value={exams.length} />
            <DataStat label="task" value={tasks.length} />
            <DataStat label="eventi" value={events.length} />
            <DataStat label="allegati" value={attachments.length} />
          </div>
          <Button className="mt-5" icon="Trash2" variant="danger" onClick={() => {
            if (window.confirm("Resettare tutti i dati locali e ripartire da un workspace vuoto?")) resetAllData();
          }}>
            Reset dati locali
          </Button>
          {message ? <p className="mt-4 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">{message}</p> : null}
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
