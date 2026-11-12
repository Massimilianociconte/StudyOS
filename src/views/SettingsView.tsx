import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PaletteName, StudySnapshot, ThemeMode, UserSettings } from "../types";
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
import { requestAccountFilesErase } from "../lib/attachmentFiles";
import { eraseAccountData, isSignedIn, requestSync, resetCloudDeviceState } from "../lib/cloudSync";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync, type CloudSyncState } from "../lib/cloudSyncState";
import { turnOffPushHere } from "../lib/pushDevice";
import { resizeImageFile } from "../lib/files";
import { SETTINGS_JUMP_EVENT, settingsSectionFromEvent, takeSettingsSection, type SettingsSection } from "../lib/settingsJump";
import { DEGREE_PROGRAMS, DEGREE_PROGRAM_IDS, isDegreeProgramId, type DegreeProgramId } from "../lib/graduation";
import { SETTINGS_TEXT } from "../lib/labels/settings";
import { GETTING_STARTED_HIDDEN_KEY } from "../lib/deviceStorage";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { Button, Field, Panel, PasswordInput, Pill, SectionTitle, fileInputClass, inputClass, useBackCloses } from "../components/ui";
import { Icon } from "../components/Icon";
import { CloudPanel } from "../components/CloudPanel";
import { AgentSettings } from "../components/AgentDesk";
import { PushToggle } from "../components/PushToggle";
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

/** Da 1024 px elenco e categoria stanno affiancati; sotto, prima l'elenco e poi la categoria. */
const WIDE_QUERY = "(min-width: 1024px)";

/** Categorie raggruppate per quello che si vuole fare: id invariati (salti da altre schermate). */
const GROUPS: { label: string; sections: { id: SettingsSection; icon: string }[] }[] = [
  { label: SETTINGS_TEXT.groups.you, sections: [{ id: "profilo", icon: "User" }] },
  {
    label: SETTINGS_TEXT.groups.account,
    sections: [
      { id: "account", icon: "LogIn" },
      { id: "agenti", icon: "Sparkles" }
    ]
  },
  {
    label: SETTINGS_TEXT.groups.device,
    sections: [
      { id: "aspetto", icon: "Palette" },
      { id: "privacy", icon: "Shield" }
    ]
  },
  {
    label: SETTINGS_TEXT.groups.data,
    sections: [
      { id: "backup", icon: "Download" },
      { id: "dati", icon: "Trash2" }
    ]
  }
];

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

const readGuideHidden = () => {
  try {
    return localStorage.getItem(GETTING_STARTED_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
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
  // Esito dell'ultima azione: si mostra dentro la categoria aperta, accanto a dove è successo.
  const [message, setMessage] = useState("");
  // Copia completa scelta: prima di sostituire tutto si chiede sul posto (niente finestra del browser).
  const [restore, setRestore] = useState<{ snapshot: StudySnapshot; day: string; summary: string } | null>(null);
  // «Cancella tutti i dati»: domanda sul posto con le scelte esplicite.
  const [eraseAsk, setEraseAsk] = useState(false);
  const [cloud, setCloud] = useState<CloudSyncState>(() => getCloudSyncState());
  useEffect(() => (cloudConfigured ? subscribeCloudSync(setCloud) : undefined), []);
  const signedIn = Boolean(cloud.session);

  const wide = useMediaQuery(WIDE_QUERY);
  // Categoria scelta. Su schermo largo senza scelta si mostra la prima; su telefono l'elenco.
  const [chosen, setChosen] = useState<SettingsSection | null>(null);
  const section: SettingsSection | null = chosen ?? (wide ? "profilo" : null);
  const detailRef = useRef<HTMLElement>(null);
  const rowRefs = useRef(new Map<SettingsSection, HTMLButtonElement>());
  // Dopo il cambio di categoria: focus sul titolo della categoria (`detail`), solo scorrimento
  // (`scroll`, schermo largo) o la riga da cui si era entrati. Vale quando sullo schermo c'è la
  // categoria `at`: al montaggio la prima resa mostra ancora quella predefinita.
  const focusNext = useRef<{ at: SettingsSection | null; to: "detail" | "scroll" | SettingsSection } | null>(null);
  // Fa ripartire lo spostamento del focus anche quando si riapre la stessa categoria.
  const [focusTick, setFocusTick] = useState(0);
  // undefined = ancora da leggere. Il ref sopravvive al doppio effetto di StrictMode,
  // mentre takeSettingsSection consuma la richiesta alla prima lettura.
  const jumpRef = useRef<SettingsSection | null | undefined>(undefined);
  // Turno delle azioni lente (copia, ripristino, cancellazione): cambiata categoria o scelto un altro
  // file, l'esito arrivato tardi non compare più sotto un'altra categoria né sostituisce la domanda.
  const actionTurn = useRef(0);

  const resetTransient = () => {
    actionTurn.current += 1;
    setMessage("");
    setRestore(null);
    setEraseAsk(false);
  };

  const planFocus = (at: SettingsSection | null, to: "detail" | "scroll" | SettingsSection) => {
    focusNext.current = { at, to };
    setFocusTick((tick) => tick + 1);
  };

  const openSection = (next: SettingsSection) => {
    resetTransient();
    setChosen(next);
    planFocus(next, wide ? "scroll" : "detail");
  };

  const backToList = () => {
    const from = section;
    resetTransient();
    setChosen(null);
    if (from) planFocus(null, from);
  };

  // Chiusa una domanda sul posto, il focus torna a ciò che l'aveva aperta (non si perde in cima alla pagina).
  const focusInDetail = (selector: string) =>
    window.requestAnimationFrame(() => detailRef.current?.querySelector<HTMLElement>(selector)?.focus());
  const cancelErase = () => {
    setEraseAsk(false);
    focusInDetail("[data-erase-open]");
  };
  const cancelRestore = () => {
    setRestore(null);
    focusInDetail("[data-restore-file]");
  };

  // Telefono: la categoria aperta fa da pagina, Indietro (anche il gesto) torna all'elenco.
  useBackCloses(!wide && chosen !== null, () => {
    backToList();
    return true;
  });

  useEffect(() => {
    if (jumpRef.current === undefined) jumpRef.current = takeSettingsSection();
    const target = jumpRef.current;
    if (!target) return;
    jumpRef.current = null;
    setChosen(target);
    planFocus(target, "detail");
  }, []);

  // Richiesta arrivata con Impostazioni già aperte (badge dell'account, link «vai al profilo» degli agenti).
  useEffect(() => {
    const onJump = (event: Event) => {
      const target = takeSettingsSection() ?? settingsSectionFromEvent(event);
      if (!target) return;
      resetTransient();
      setChosen(target);
      planFocus(target, "detail");
    };
    window.addEventListener(SETTINGS_JUMP_EVENT, onJump);
    return () => window.removeEventListener(SETTINGS_JUMP_EVENT, onJump);
  }, []);

  useEffect(() => {
    const plan = focusNext.current;
    if (!plan || plan.at !== section) return;
    // Il piano si consuma solo nel fotogramma: se l'effetto viene ripulito prima (StrictMode,
    // nuova resa) il giro successivo lo ritrova.
    const frame = window.requestAnimationFrame(() => {
      if (focusNext.current !== plan) return;
      focusNext.current = null;
      const target = plan.to;
      const detail = detailRef.current;
      if (target === "scroll") {
        // Schermo largo: il focus resta sull'elenco; se la categoria parte sopra lo schermo si torna su.
        if (detail && detail.getBoundingClientRect().top < 0) detail.scrollIntoView({ block: "start" });
      } else if (target === "detail") {
        detail?.scrollIntoView({ block: "start" });
        detail?.focus({ preventScroll: true });
      } else {
        rowRefs.current.get(target)?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, focusTick]);

  const exportBackup = async (scope: "full" | "tasks" | "calendar" | "subjects" = "full") => {
    const turn = actionTurn.current;
    const report = (text: string) => {
      if (turn === actionTurn.current) setMessage(text);
    };
    setMessage("");
    if (exportEncrypted && backupPassphrase.length < 8) {
      setMessage("Per proteggere la copia scegli una password di almeno 8 caratteri.");
      return;
    }

    try {
      await whenPersisted();
      const state = useStudyStore.getState();
      const snapshot = snapshotFromState(state);
      // Copia completa con i file dei materiali (copia locale o scaricati ora), incorporati solo nel file,
      // fino a 100 MB. Se i file non si possono aggiungere (o la copia con i file non si riesce a
      // creare) si scarica comunque la copia senza file: mai nessuna copia per colpa dei file.
      const plainAttachments = snapshot.attachments;
      let missingFiles = 0;
      let overLimitFiles = 0;
      let filesLeftOut = false;
      if (scope === "full" && snapshot.attachments.some((item) => item.storedFile)) {
        try {
          const { withFilesForExport } = await import("../lib/attachmentSync");
          const result = await withFilesForExport(snapshot.attachments);
          snapshot.attachments = result.attachments;
          missingFiles = result.missing;
          overLimitFiles = result.overLimit;
        } catch {
          filesLeftOut = true;
        }
      }
      const scopedFor = (attachments: StudySnapshot["attachments"]) => ({
      ...snapshot,
      subjects: scope === "full" || scope === "subjects" ? snapshot.subjects : [],
      exams: scope === "full" ? snapshot.exams : [],
      events: scope === "full" || scope === "calendar" ? snapshot.events : [],
      tasks: scope === "full" || scope === "tasks" ? snapshot.tasks : [],
      sessions: scope === "full" ? snapshot.sessions : [],
      topics: scope === "full" ? snapshot.topics : [],
      attachments: scope === "full" ? attachments : [],
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
      });
      const save = async (attachments: StudySnapshot["attachments"]) => {
        const envelope = await createBackupEnvelope(scopedFor(attachments), settings, exportEncrypted ? backupPassphrase : undefined, scope);
        downloadJson(`studyos-${scope}-${new Date().toISOString().slice(0, 10)}${exportEncrypted ? "-encrypted" : ""}.json`, envelope);
      };
      const withFiles = snapshot.attachments !== plainAttachments;
      try {
        await save(snapshot.attachments);
      } catch (error) {
        // Copia con i file troppo grande per questo browser: si riprova senza file.
        if (!withFiles) throw error;
        snapshot.attachments = plainAttachments;
        await save(plainAttachments);
        filesLeftOut = true;
      }
      const filesNote = filesLeftOut
        ? SETTINGS_TEXT.backup.filesLeftOut
        : `${overLimitFiles ? SETTINGS_TEXT.backup.filesOverLimit(overLimitFiles) : ""}${missingFiles ? SETTINGS_TEXT.backup.filesMissing(missingFiles) : ""}`;
      report(`Copia scaricata: la trovi nella cartella dei download. Conservala in un posto sicuro.${filesNote}`);
    } catch (error) {
      report(plainError(error, "Download della copia non riuscito. Riprova."));
    }
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    // Un nuovo file prende il turno: l'esito di uno scelto prima e ancora in lettura non conta più.
    const turn = ++actionTurn.current;
    const current = () => turn === actionTurn.current;
    setMessage("");
    setRestore(null);
    try {
      const backup = await readBackupEnvelope(file);
      const snapshot = await snapshotFromBackup(backup, backup.encrypted ? importPassphrase : undefined);
      if (!current()) return;
      const scope = inferBackupScope(backup, snapshot);
      const summary = backupSummary(snapshot);
      if (scope === "full") {
        // Si sostituisce solo dopo «Sostituisci tutti i dati» nella domanda qui sotto.
        setRestore({ snapshot, day: formatDay(backup.exportedAt), summary: summary.text });
        return;
      }
      const result = await mergeData(snapshot);
      const scopeLabel =
        scope === "tasks" ? "attività" : scope === "calendar" ? "calendario" : scope === "subjects" ? "materie" : scope === "items" ? "elementi scelti" : scope;
      if (current()) setMessage(`Copia parziale (${scopeLabel}) aggiunta ai tuoi dati: ${result.added} elementi nuovi, ${result.updated} aggiornati.`);
    } catch (error) {
      if (current()) setMessage(plainError(error, "Ripristino non riuscito. Controlla di aver scelto il file giusto e riprova."));
    }
  };

  const confirmRestore = async () => {
    if (!restore) return;
    const { snapshot, summary } = restore;
    const turn = actionTurn.current;
    setRestore(null);
    focusInDetail("[data-restore-file]");
    try {
      await replaceAllData(snapshot);
      if (turn === actionTurn.current) setMessage(`Copia ripristinata: ${summary}.`);
    } catch (error) {
      if (turn === actionTurn.current) setMessage(plainError(error, "Ripristino non riuscito. Controlla di aver scelto il file giusto e riprova."));
    }
  };

  /**
   * - `local`: nessun account collegato, si svuota questo dispositivo.
   * - `device`: account collegato, si svuota solo questo dispositivo e si riscarica dall'account.
   * - `cloud`: account collegato, si cancella anche dall'account e dagli altri dispositivi.
   */
  const eraseData = async (mode: "local" | "device" | "cloud") => {
    // L'account si è collegato o scollegato mentre la domanda era aperta: si richiede con le scelte giuste.
    if ((mode === "local") === isSignedIn()) return;
    const turn = actionTurn.current;
    const report = (text: string) => {
      if (turn === actionTurn.current) setMessage(text);
    };
    setEraseAsk(false);
    setMessage("");
    focusInDetail("[data-erase-open]");
    try {
      // Come ogni uscita e cancellazione: le notifiche di questo dispositivo si spengono per prime,
      // finché la sessione c'è (si riaccendono da Impostazioni → Profilo).
      await turnOffPushHere();
      if (mode !== "local") {
        const alsoCloud = mode === "cloud";
        const uid = getCloudSyncState().session?.user.id ?? null;
        await resetAllData({ propagate: alsoCloud });
        // Prima della sync: il server elimina anche ciò che questo dispositivo non ha mai ricevuto, e il
        // pull che segue non riporta qui i dati arrivati da altri dispositivi.
        const erased = alsoCloud ? await eraseAccountData() : null;
        // Anche i file dei materiali nello spazio file dell'account: se ora non riesce, si riprova da solo.
        // La richiesta si salva prima di caricare il modulo dei file: offline (modulo non caricabile)
        // resta comunque, e la passata dopo la esegue.
        if (alsoCloud && uid) await requestAccountFilesErase(uid).catch(() => undefined);
        const filesErased = alsoCloud
          ? await import("../lib/attachmentSync").then((module) => module.eraseAccountFiles()).catch(() => false)
          : true;
        // Anche i promemoria con l'app chiusa (le funzioni del server vecchie non li toccano).
        if (alsoCloud) await import("../lib/pushReminderSync").then((module) => module.clearPushReminders()).catch(() => undefined);
        if (alsoCloud) await requestSync();
        else await resetCloudDeviceState();
        const sync = getCloudSyncState();
        report(alsoCloud
          ? (erased === "failed"
            ? SETTINGS_TEXT.erase.accountUnreachable
            : sync.pendingChanges || sync.status === "error" || sync.status === "offline"
            ? "Dati cancellati da questo dispositivo. Verranno cancellati anche dall'account appena la sincronizzazione riprende."
            : "Dati cancellati da questo dispositivo e dall'account.") + (filesErased ? "" : SETTINGS_TEXT.erase.filesPending)
          : sync.status === "error" || sync.status === "offline"
            ? "Dispositivo svuotato. I dati dell'account verranno riscaricati appena la sincronizzazione riprende."
            : "Dispositivo svuotato e dati riscaricati dall'account.");
        return;
      }
      // Senza account i file aggiunti qui esistono solo qui: si cancellano anche quelli.
      await resetAllData({ propagate: false, wipeFiles: true });
      report("Tutti i dati di questo dispositivo sono stati cancellati.");
    } catch (error) {
      report(plainError(error, "Cancellazione non riuscita. Riprova."));
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

  const vaultOn = settings.security.mode === "vault";
  const degreeId: DegreeProgramId = isDegreeProgramId(preferences.degreeProgram) ? preferences.degreeProgram : "barb";
  const displayName = preferences.displayName.trim();

  // «Nascondi la guida» della Home vale su questo dispositivo (localStorage, come la scrive la Home).
  // Si propone di rimostrarla solo se la Home la mostrerebbe: con tutti i passi fatti resta nascosta comunque.
  const [guideHidden, setGuideHidden] = useState(readGuideHidden);
  const guideHasSteps = !(subjects.length && events.length && tasks.length && displayName);
  const showGuideAgain = () => {
    try {
      localStorage.removeItem(GETTING_STARTED_HIDDEN_KEY);
    } catch {
      // storage non disponibile: la Home non l'aveva salvata, la guida è già in vista
    }
    setGuideHidden(false);
    setMessage(SETTINGS_TEXT.appearance.guideShown);
    // Il pulsante sparisce: il focus va sulla scelta accanto, non sul body.
    focusInDetail("[data-start-view]");
  };

  // Com'è impostata adesso ogni categoria: si legge nell'elenco senza aprirla.
  const summaries: Record<SettingsSection, string> = {
    profilo: `${displayName || SETTINGS_TEXT.summaries.noName} · ${DEGREE_PROGRAMS[degreeId].name}`,
    account: !cloudConfigured
      ? SETTINGS_TEXT.summaries.cloudOff
      : cloud.session?.user.email
        ? SETTINGS_TEXT.summaries.signedIn(cloud.session.user.email)
        : SETTINGS_TEXT.summaries.signedOut,
    agenti: SETTINGS_TEXT.summaries.agents,
    aspetto: `${THEME_LABEL[settings.themeMode]} · ${palettes.find((palette) => palette.id === settings.palette)?.label ?? ""}`,
    privacy: vaultOn ? SETTINGS_TEXT.summaries.vaultOn : SETTINGS_TEXT.summaries.vaultOff,
    backup: SETTINGS_TEXT.summaries.backup,
    dati: SETTINGS_TEXT.summaries.data(subjects.length, tasks.length, events.length)
  };

  const content: Record<SettingsSection, ReactNode> = {
    profilo: (
      <div className="grid grid-cols-1 gap-4">
        <Panel>
          <h4 className="mb-3 text-lg font-black">{SETTINGS_TEXT.profile.whoTitle}</h4>
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
                <label className="motion-safe inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold hover:bg-[var(--surface)] focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-[var(--focus-ring)]">
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
        </Panel>

        <Panel>
          <h4 className="mb-3 text-lg font-black">{SETTINGS_TEXT.profile.studyTitle}</h4>
          <Field label="Corso di laurea">
            <select
              className={inputClass}
              value={degreeId}
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
          <ProfileOnlineCard extra={<PushToggle />} />
        </Panel>
      </div>
    ),

    account: <CloudPanel />,

    agenti: (
      <Panel>
        <AgentSettings />
      </Panel>
    ),

    aspetto: (
      <Panel>
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

          <div>
            <h4 className="mb-2 text-sm font-black">{SETTINGS_TEXT.appearance.comfortTitle}</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Densità">
                <select className={inputClass} value={settings.density} onChange={(event) => updateSettings({ density: event.target.value as "comfortable" | "compact" })}>
                  <option value="comfortable">Comoda (più spazio)</option>
                  <option value="compact">Compatta (più cose a schermo)</option>
                </select>
              </Field>
              <Field label="Sezione all'apertura">
                <select data-start-view className={inputClass} value={settings.initialView} onChange={(event) => updateSettings({ initialView: event.target.value as UserSettings["initialView"] })}>
                  <option value="dashboard">Home</option>
                  <option value="calendar">Calendario</option>
                  <option value="tasks">Attività</option>
                  <option value="study">Studio</option>
                  <option value="last">Ultima sezione aperta</option>
                </select>
              </Field>
            </div>
            {guideHidden && guideHasSteps ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
                <p className="min-w-0 flex-1 text-sm font-bold text-[var(--muted)]">{SETTINGS_TEXT.appearance.guideHint}</p>
                <Button variant="soft" icon="Eye" onClick={showGuideAgain}>
                  {SETTINGS_TEXT.appearance.guideShow}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Panel>
    ),

    privacy: (
      <Panel>
        {/* Modulo: Invio nel campo della password fa come il pulsante principale (proteggi o togli la password). */}
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void (vaultOn ? deactivateVault() : activateVault());
          }}
        >
          <div className="quiet-panel flex items-center gap-3 p-4">
            <span className="grid grid-cols-1 h-12 w-12 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
              <Icon name={vaultOn ? "Lock" : "Shield"} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-black">{vaultOn ? "I dati su questo dispositivo sono protetti" : "Protezione non attiva"}</p>
              <p className="text-sm text-[var(--muted)]">
                {vaultOn
                  ? "Sono cifrati con la tua password, che non viene salvata da nessuna parte: serve ogni volta che apri StudyOS."
                  : "Chi usa questo browser può aprire StudyOS e vedere i tuoi dati."}
              </p>
            </div>
          </div>

          {!vaultOn ? (
            <>
              <p className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">
                Se dimentichi la password, i dati di questo dispositivo non si possono più recuperare. Prima di attivarla scarica una copia di sicurezza.
              </p>
              <Field label="Scegli una password (almeno 10 caratteri)">
                <PasswordInput
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
              <PasswordInput
                autoComplete="current-password"
                value={vaultPassphrase}
                onChange={(event) => setVaultPassphrase(event.target.value)}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            {!vaultOn ? (
              <Button icon="Lock" variant="primary" type="submit">
                Proteggi con una password
              </Button>
            ) : (
              <>
                <Button icon="Lock" variant="soft" onClick={() => void lockNow()}>
                  Blocca ora
                </Button>
                <Button icon="Shield" variant="danger" type="submit">
                  Togli la password
                </Button>
              </>
            )}
          </div>
        </form>
      </Panel>
    ),

    backup: (
      <div className="grid grid-cols-1 gap-4">
        <Panel>
          <h4 className="mb-3 text-lg font-black">{SETTINGS_TEXT.backup.downloadTitle}</h4>
          <div className="grid grid-cols-1 gap-4">
            <label className="flex min-h-11 items-center gap-3 rounded-[22px] bg-[var(--surface-soft)] p-3 text-sm font-black">
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
                <PasswordInput
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
          </div>
        </Panel>

        <Panel>
          <h4 className="text-lg font-black">{SETTINGS_TEXT.backup.restoreTitle}</h4>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Una copia completa sostituisce tutti i dati attuali (prima ti chiediamo conferma). Una copia parziale si aggiunge a quelli che hai già.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <Field label="Password della copia (solo se l'hai protetta)">
              <PasswordInput
                autoComplete="off"
                value={importPassphrase}
                onChange={(event) => setImportPassphrase(event.target.value)}
              />
            </Field>
            <Field label="Scegli il file della copia (.json)">
              <input
                data-restore-file
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
            {restore ? (
              <div role="group" aria-labelledby="settings-restore-title" className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4">
                <p id="settings-restore-title" className="text-sm font-black text-[var(--danger-text)]">
                  {SETTINGS_TEXT.backup.restoreAskTitle(restore.day)}
                </p>
                <p className="mt-1 text-sm font-bold text-[var(--text)]">{SETTINGS_TEXT.backup.restoreAskText(restore.summary)}</p>
                {signedIn ? <p className="mt-1 text-sm font-bold text-[var(--text)]">{SETTINGS_TEXT.backup.restoreAskCloud}</p> : null}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="soft" onClick={cancelRestore} autoFocus>
                    {SETTINGS_TEXT.backup.cancel}
                  </Button>
                  <Button variant="danger" icon="Upload" onClick={() => void confirmRestore()}>
                    {SETTINGS_TEXT.backup.restoreConfirm}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    ),

    dati: (
      <Panel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
          {eraseAsk ? (
            <div role="group" aria-labelledby="settings-erase-title" className="mt-3 grid grid-cols-1 gap-2 rounded-[18px] bg-[var(--danger-bg)] p-3">
              <p id="settings-erase-title" className="text-sm font-black text-[var(--danger-text)]">
                {SETTINGS_TEXT.erase.askTitle}
              </p>
              <p className="text-sm font-bold text-[var(--text)]">{SETTINGS_TEXT.erase.askText}</p>
              {signedIn ? (
                <>
                  <p className="text-sm font-bold text-[var(--text)]">{SETTINGS_TEXT.erase.askSignedIn}</p>
                  <p className="text-sm text-[var(--muted)]">{SETTINGS_TEXT.erase.deviceOnlyHint}</p>
                  <p className="text-sm text-[var(--muted)]">{SETTINGS_TEXT.erase.alsoCloudHint}</p>
                </>
              ) : null}
              <div className="mt-1 flex flex-wrap justify-end gap-2">
                <Button variant="soft" onClick={cancelErase} autoFocus>
                  {SETTINGS_TEXT.erase.cancel}
                </Button>
                {signedIn ? (
                  <>
                    <Button variant="danger" icon="Smartphone" onClick={() => void eraseData("device")}>
                      {SETTINGS_TEXT.erase.deviceOnly}
                    </Button>
                    <Button variant="danger" icon="Trash2" onClick={() => void eraseData("cloud")}>
                      {SETTINGS_TEXT.erase.alsoCloud}
                    </Button>
                  </>
                ) : (
                  <Button variant="danger" icon="Trash2" onClick={() => void eraseData("local")}>
                    {SETTINGS_TEXT.erase.confirmLocal}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button
              data-erase-open
              className="mt-3"
              icon="Trash2"
              variant="danger"
              onClick={() => {
                setMessage("");
                setEraseAsk(true);
              }}
            >
              Cancella tutti i dati
            </Button>
          )}
        </div>
      </Panel>
    )
  };

  return (
    <div>
      {/* Telefono con una categoria aperta: in cima c'è «‹ Impostazioni», il titolo resta solo per i lettori di schermo. */}
      <div className={section && !wide ? "sr-only" : undefined}>
        <SectionTitle
          title={SETTINGS_TEXT.title}
          subtitle={`${displayName ? `${SETTINGS_TEXT.profile.hello(displayName)} ` : ""}${SETTINGS_TEXT.subtitle}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
        <nav aria-label={SETTINGS_TEXT.listLabel} className={`${section && !wide ? "hidden" : ""} lg:[@media(min-height:760px)]:sticky lg:[@media(min-height:760px)]:top-24`}>
          <div className="grid grid-cols-1 gap-4">
            {GROUPS.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <p className="mb-1.5 px-2 text-xs font-black uppercase tracking-wide text-[var(--faint)]">{group.label}</p>
                <ul className="soft-panel grid grid-cols-1 gap-1 !rounded-[26px] p-1.5">
                  {group.sections.map(({ id, icon }) => {
                    const selected = wide && section === id;
                    return (
                      <li key={id}>
                        <button
                          ref={(element) => {
                            if (element) rowRefs.current.set(id, element);
                            else rowRefs.current.delete(id);
                          }}
                          type="button"
                          aria-current={selected ? "true" : undefined}
                          onClick={() => openSection(id)}
                          className={`flex min-h-14 w-full items-center gap-3 rounded-[20px] px-2.5 py-2 text-left ${
                            selected ? "bg-[var(--surface-strong)]" : "hover:bg-[var(--surface)]"
                          }`}
                        >
                          <span
                            className={`grid h-10 w-10 shrink-0 grid-cols-1 place-items-center rounded-[14px] ${
                              selected ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--accent-ink)]"
                            }`}
                          >
                            <Icon name={icon} className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-black">{SETTINGS_TEXT.titles[id]}</span>
                            <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{summaries[id]}</span>
                          </span>
                          <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)] lg:hidden" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {section ? (
          <section
            key={section}
            ref={detailRef}
            id={`settings-${section}`}
            aria-labelledby={`settings-${section}-title`}
            tabIndex={-1}
            className="min-w-0 scroll-mt-24 outline-none"
            // Su schermo largo Profilo si vede anche senza sceglierlo: appena ci si lavora diventa la
            // scelta, così ruotando il tablet sotto i 1024 px resta aperto invece di tornare all'elenco.
            onFocus={() => {
              if (chosen === null) setChosen(section);
            }}
          >
            {!wide ? (
              <button
                type="button"
                onClick={backToList}
                aria-label={SETTINGS_TEXT.backLabel}
                className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-black text-[var(--accent-ink)] hover:bg-[var(--surface)]"
              >
                <Icon name="ChevronLeft" className="h-4 w-4" />
                {SETTINGS_TEXT.back}
              </button>
            ) : null}
            <SettingHeader
              section={section}
              title={SETTINGS_TEXT.titles[section]}
              description={SETTINGS_TEXT.descriptions[section]}
              action={
                section === "privacy" ? <Pill active={vaultOn}>{vaultOn ? "Protetto da password" : "Senza password"}</Pill> : undefined
              }
            />
            {/* Sempre presente: i lettori di schermo annunciano il testo quando cambia. */}
            <p
              role="status"
              className={message ? "mb-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]" : "sr-only"}
            >
              {message}
            </p>
            {content[section]}
          </section>
        ) : null}
      </div>
    </div>
  );
}

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
