import { expect, test } from "./support/fixtures";
import { ACROSS, goTo, waitSynced } from "./support/app";
import type { Page } from "@playwright/test";

const learnTab = (page: Page, name: "Raccolte" | "Quiz") =>
  page.getByRole("group", { name: "Sezioni del ripasso" }).getByRole("button", { name, exact: true }).click();

test("10 Alice crea un quiz a risposta singola, lo fa in allenamento e il risultato resta dopo un ricaricamento", async ({ alice, tag }) => {
  const page = alice.page;
  const quizTitle = `Biologia cellulare ${tag}`;
  const prompt = `Dove avviene la respirazione cellulare? ${tag}`;

  // Nuovo quiz → si apre da solo per aggiungere le domande.
  await goTo(page, "Ripasso");
  await learnTab(page, "Quiz");
  await page.getByRole("button", { name: "Nuovo quiz" }).first().click();
  const created = page.getByRole("dialog", { name: "Nuovo quiz" });
  await created.getByLabel("Titolo del quiz").fill(quizTitle);
  await created.getByRole("button", { name: "Salva" }).click();
  const editor = page.getByRole("dialog", { name: "Modifica il quiz" });
  await expect(editor).toBeVisible();

  // Nuova domanda: il testo della domanda ha già il suo campo; due risposte, la seconda giusta.
  await editor.getByRole("button", { name: "Nuova domanda" }).click();
  const question = page.getByRole("dialog", { name: "Nuova domanda" });
  await question.getByRole("group", { name: "Domanda · Testo 1" }).getByRole("textbox", { name: "Testo" }).fill(prompt);
  await question.getByRole("textbox", { name: "Risposta A" }).fill("Nel nucleo");
  await question.getByRole("textbox", { name: "Risposta B" }).fill("Nei mitocondri");
  await question.getByRole("radio", { name: "Giusta" }).nth(1).check();
  await question.getByRole("button", { name: "Salva" }).click();
  await expect(question).toBeHidden();
  await expect(editor.getByText("1 domanda")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  // Allenamento: scelta, conferma, esito subito, poi il risultato.
  await page.getByRole("button", { name: "Inizia il quiz" }).first().click();
  const start = page.getByRole("dialog", { name: quizTitle });
  await start.getByRole("radiogroup", { name: "Modalità" }).getByRole("radio", { name: /^Allenamento/ }).click();
  await start.getByRole("button", { name: "Inizia il quiz" }).click();
  const player = page.getByRole("dialog", { name: quizTitle });
  await expect(player.getByText(prompt)).toBeVisible();
  await player.getByRole("radio", { name: /Nei mitocondri/ }).click();
  await player.getByRole("button", { name: "Conferma" }).click();
  await expect(player.getByText(/^Giusta/).first()).toBeVisible();
  await player.getByRole("button", { name: "Concludi" }).click();
  await expect(player.getByText("1 su 1")).toBeVisible();
  await expect(player.getByText("100%")).toBeVisible();
  await player.getByRole("button", { name: "Chiudi", exact: true }).last().click();
  await expect(player).toBeHidden();
  // La scheda del quiz mostra l'ultimo punteggio in evidenza (riquadro «Ultimo»).
  const lastScore = (scope: Page) => scope.getByRole("listitem").filter({ hasText: quizTitle }).getByRole("definition").first();
  await expect(lastScore(page)).toHaveText("100%");
  await waitSynced(page);

  // Il tentativo è salvato: dopo un ricaricamento il punteggio c'è ancora.
  await page.reload();
  await goTo(page, "Ripasso");
  await learnTab(page, "Quiz");
  await expect(lastScore(page)).toHaveText("100%", ACROSS);
});
