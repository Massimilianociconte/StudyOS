// Azioni sull'app vera, con nomi accessibili (ruoli ed etichette in italiano come li vede chi la usa).

import { expect, type Locator, type Page } from "@playwright/test";
import type { TestAccount } from "./accounts";

/** Tempo per ciò che passa da un account all'altro (server + realtime + pull). Nessuna attesa fissa. */
export const ACROSS = { timeout: 30_000 } as const;
/**
 * Ciò che deve arrivare in tempo reale (Supabase Realtime), senza ricaricare: ben sotto il ricontrollo
 * periodico dell'app (30 s per i gruppi «vecchi», 5 min per il resto).
 */
export const LIVE = { timeout: 15_000 } as const;

type Section =
  | "Home"
  | "Calendario"
  | "Attività"
  | "Studio"
  | "Gruppi"
  | "Condivisione"
  | "Impostazioni";

export const mainNav = (page: Page) => page.getByRole("navigation", { name: "Sezioni principali" });

export const openApp = async (page: Page, url = "/") => {
  await page.goto(url);
  await expect(mainNav(page)).toBeVisible();
};

export const goTo = async (page: Page, section: Section) => {
  const item = mainNav(page).getByRole("button", { name: section, exact: true });
  await item.click();
  await expect(item).toHaveAttribute("aria-current", "page");
};

/** Pulsante di stato dell'account nella barra laterale (es. «Sincronizzato: alice@…»). */
export const cloudBadge = (page: Page) => page.getByRole("button", { name: /Apri le impostazioni dell'account\.$/ });

/** Tutto inviato e ricevuto: nessuna modifica in coda, nessuna sincronizzazione in corso. */
export const waitSynced = async (page: Page, timeout = 30_000) => {
  await expect(cloudBadge(page)).toHaveAccessibleName(/^Sincronizzato: /, { timeout });
};

export const openSettings = async (page: Page, category: RegExp) => {
  await goTo(page, "Impostazioni");
  await page.getByRole("navigation", { name: "Categorie di impostazioni" }).getByRole("button", { name: category }).click();
};

/** Accesso dal pannello Account (Impostazioni → Account e sincronizzazione), come una persona. */
export const signIn = async (page: Page, account: TestAccount) => {
  await openSettings(page, /Account e sincronizzazione/);
  await expect(page.getByRole("heading", { name: "Accedi o crea un account" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sei connesso" })).toBeVisible();
  await waitSynced(page);
  await expect(cloudBadge(page)).toHaveAccessibleName(`Sincronizzato: ${account.email}. Apri le impostazioni dell'account.`);
};

/**
 * Nome visibile agli altri (Impostazioni → Profilo e obiettivi → «Il tuo nome»): l'app lo usa per gruppi,
 * bacheca e condivisioni e lo copia nel profilo online. Senza, gli altri vedrebbero «Studente».
 */
export const setDisplayName = async (page: Page, name: string) => {
  await openSettings(page, /Profilo e obiettivi/);
  const field = page.getByLabel("Il tuo nome", { exact: true });
  await field.fill(name);
  await expect(field).toHaveValue(name);
  await waitSynced(page);
};

// ——— Attività ———

/** Elenco delle proprie attività (senza la parte «Condivisi con te»). */
export const ownTask = (page: Page, title: string) =>
  page.locator("[data-task-row]").filter({ hasText: title });

export const sharedSection = (page: Page) => page.getByRole("region", { name: "Condivisi con te" });

export const createTask = async (page: Page, title: string) => {
  await goTo(page, "Attività");
  await page.getByRole("button", { name: "Nuova attività" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nuova attività" });
  await dialog.getByLabel("Titolo").fill(title);
  await dialog.getByRole("button", { name: "Crea attività" }).click();
  await expect(dialog).toBeHidden();
  await expect(ownTask(page, title)).toBeVisible();
};

// ——— Gruppi ———

export const groupDialog = (page: Page, name: string) => page.getByRole("dialog", { name });

export const createGroup = async (page: Page, name: string) => {
  await goTo(page, "Gruppi");
  await page.getByRole("button", { name: /^(Crea un gruppo|Nuovo gruppo)$/ }).first().click();
  const form = page.getByRole("dialog", { name: "Con chi studi?" });
  await form.getByLabel("Nome del gruppo").fill(name);
  await form.getByRole("button", { name: "Crea gruppo" }).click();
  await expect(form).toBeHidden();
  // Si apre il dettaglio del gruppo appena creato.
  const detail = groupDialog(page, name);
  await expect(detail).toBeVisible();
  return detail;
};

/** Codice di invito dal pannello Invita (il proprietario lo legge, come per dettarlo a voce). */
export const readInviteCode = async (page: Page, detail: Locator) => {
  await detail.getByRole("button", { name: "Invita", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Invita i tuoi compagni" });
  // Il gruppo deve essere online prima di far entrare qualcuno.
  await expect(sheet.getByText(/^Gli inviti sono attivi/)).toBeVisible(ACROSS);
  const code = (await sheet.getByRole("region", { name: "Oppure usa il codice del gruppo" }).getByText(/^GRP-[A-Z0-9-]+$/).textContent())?.trim();
  if (!code) throw new Error("Codice di invito non trovato");
  await sheet.getByRole("button", { name: "Chiudi" }).click();
  await expect(sheet).toBeHidden();
  return code;
};

export const joinWithCode = async (page: Page, code: string, groupName: string) => {
  await goTo(page, "Gruppi");
  await page.getByLabel("Codice o link di invito").fill(code);
  await page.getByRole("button", { name: "Entra nel gruppo" }).click();
  const detail = groupDialog(page, groupName);
  await expect(detail).toBeVisible(ACROSS);
  return detail;
};

export const detailTab = async (detail: Locator, tab: "Bacheca" | "Membri" | "Cronologia" | "Appelli" | "Docenti e aule") => {
  const button = detail.getByRole("group", { name: "Sezioni del gruppo" }).getByRole("button", { name: tab, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
};

/** Righe della scheda Membri. */
export const memberRows = (detail: Locator) => detail.getByRole("listitem").filter({ has: detail.page().getByText(/^(Proprietario|Amministratore|Membro)$/) });

export const addNote = async (page: Page, groupName: string, title: string, options: { pinned?: boolean } = {}) => {
  const detail = groupDialog(page, groupName);
  await detail.getByRole("button", { name: "Aggiungi alla bacheca" }).click();
  const form = page.getByRole("dialog", { name: "Cosa vuoi condividere?" });
  await form.getByRole("group", { name: "Cosa aggiungi" }).getByRole("button", { name: "Nota" }).click();
  await form.getByLabel("Titolo").fill(title);
  if (options.pinned) await form.getByLabel("Fissa in alto nella bacheca").check();
  await form.getByRole("button", { name: "Aggiungi alla bacheca" }).click();
  await expect(form).toBeHidden();
};

/** Riga della bacheca con questo titolo. */
export const boardRow = (detail: Locator, title: string) => detail.getByRole("listitem").filter({ hasText: title });
