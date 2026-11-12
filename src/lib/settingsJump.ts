// Apre Impostazioni già sulla categoria giusta (es. dal badge dell'account o dai primi passi).
export type SettingsSection = "profilo" | "aspetto" | "account" | "privacy" | "backup" | "agenti" | "dati";

const SECTIONS: readonly SettingsSection[] = ["profilo", "aspetto", "account", "privacy", "backup", "agenti", "dati"];

const isSettingsSection = (value: unknown): value is SettingsSection =>
  typeof value === "string" && (SECTIONS as readonly string[]).includes(value);

const KEY = "studyos-settings-jump";

/** Avvisa Impostazioni se sono già aperte: la categoria cambia subito, senza aspettare il prossimo montaggio. */
export const SETTINGS_JUMP_EVENT = "studyos:settings-jump";

/** Da chiamare prima di passare alla vista Impostazioni. */
export const requestSettingsSection = (section: SettingsSection) => {
  try {
    sessionStorage.setItem(KEY, section);
  } catch {
    // storage non disponibile: vale solo l'evento qui sotto
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<SettingsSection>(SETTINGS_JUMP_EVENT, { detail: section }));
};

/** Letta una sola volta da SettingsView (al montaggio o all'evento). */
export const takeSettingsSection = (): SettingsSection | null => {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSettingsSection(value) ? value : null;
  } catch {
    return null;
  }
};

/** La categoria portata dall'evento, se valida. */
export const settingsSectionFromEvent = (event: Event): SettingsSection | null => {
  const detail = (event as CustomEvent<unknown>).detail;
  return isSettingsSection(detail) ? detail : null;
};
