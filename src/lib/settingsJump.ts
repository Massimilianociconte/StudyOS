// Apre Impostazioni già sulla categoria giusta (es. dal badge dell'account o dai primi passi).
export type SettingsSection = "profilo" | "aspetto" | "account" | "privacy" | "backup" | "agenti" | "dati";

const KEY = "studyos-settings-jump";

/** Da chiamare prima di passare alla vista Impostazioni. */
export const requestSettingsSection = (section: SettingsSection) => {
  try {
    sessionStorage.setItem(KEY, section);
  } catch {
    // storage non disponibile: si apre in cima
  }
};

/** Letta una sola volta da SettingsView al montaggio. */
export const takeSettingsSection = (): SettingsSection | null => {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value as SettingsSection | null;
  } catch {
    return null;
  }
};
