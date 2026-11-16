// Tema e colori seguono l'account. La scelta di Impostazioni › Aspetto va nelle preferenze sincronizzate;
// le impostazioni del dispositivo ne tengono una copia per l'avvio, la schermata di blocco e la guardia
// delle schede (lì le preferenze non ci sono ancora). Prima stavano solo nel browser: un altro dispositivo
// o browser, l'app installata sulla schermata Home o lo spazio liberato dal browser ripartivano dal tema
// predefinito.
import type { PaletteName, Preferences, ThemeMode, UserSettings } from "../types";

// Record per avere un errore di compilazione se si aggiunge un tema o una palette senza elencarli.
const THEME_MODES: Record<ThemeMode, true> = { light: true, dark: true, focus: true };
const PALETTES: Record<PaletteName, true> = { aurora: true, milk: true, space: true, university: true, forest: true, sunset: true, graphite: true };

// Solo chiavi proprie: "toString" o "__proto__" non sono temi.
export const isThemeMode = (value: unknown): value is ThemeMode => typeof value === "string" && Object.hasOwn(THEME_MODES, value);
export const isPaletteName = (value: unknown): value is PaletteName => typeof value === "string" && Object.hasOwn(PALETTES, value);

export type AppearancePatch = { themeMode?: unknown; palette?: unknown };

/** Solo i valori validi della scelta (una riga storta o di un'altra versione non cambia il tema). */
export const validLook = (patch: AppearancePatch | undefined): { themeMode?: ThemeMode; palette?: PaletteName } => ({
  ...(isThemeMode(patch?.themeMode) ? { themeMode: patch.themeMode } : {}),
  ...(isPaletteName(patch?.palette) ? { palette: patch.palette } : {})
});

/**
 * Tema scelto su questo dispositivo quando non seguiva ancora l'account: da copiare nell'account una
 * volta, dopo una sincronizzazione (preferenze aggiornate). null se l'account ha già una scelta, o se qui
 * c'è il tema predefinito: un telefono mai personalizzato non deve coprire il tema scelto sul computer.
 */
export const lookToMigrate = (
  settings: Pick<UserSettings, "themeMode" | "palette">,
  preferences: Pick<Preferences, "themeMode" | "palette"> | undefined,
  defaults: Pick<UserSettings, "themeMode" | "palette">
): { themeMode: ThemeMode; palette: PaletteName } | null => {
  const account = validLook(preferences);
  if (account.themeMode || account.palette) return null;
  if (settings.themeMode === defaults.themeMode && settings.palette === defaults.palette) return null;
  return { themeMode: settings.themeMode, palette: settings.palette };
};

/**
 * Le impostazioni del dispositivo con il tema dell'account sopra. Lo stesso oggetto se non cambia nulla
 * (account senza scelta, o uguale): così chi confronta i riferimenti non salva a vuoto.
 */
export const lookFromAccount = (settings: UserSettings, preferences: Pick<Preferences, "themeMode" | "palette"> | undefined): UserSettings => {
  const look = validLook(preferences);
  const themeMode = look.themeMode ?? settings.themeMode;
  const palette = look.palette ?? settings.palette;
  if (themeMode === settings.themeMode && palette === settings.palette) return settings;
  return { ...settings, themeMode, palette, updatedAt: new Date().toISOString() };
};
