import { channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { ACROSS, goTo, waitSynced } from "./support/app";
import type { Page } from "@playwright/test";

const learnTab = (page: Page, name: "Raccolte" | "Andamento") =>
  page.getByRole("group", { name: "Sezioni del ripasso" }).getByRole("button", { name, exact: true }).click();

test("09 Alice crea una raccolta e la condivide; Bob la ripassa e le risposte restano di ciascuno", async ({ alice, bob, tag }) => {
  const deckTitle = `Enzimi ${tag}`;
  const front = `Cosa abbassa un enzima? ${tag}`;
  const back = `L'energia di attivazione ${tag}`;

  // Alice: Ripasso → Nuova raccolta (si apre da sola) → Nuova flashcard con fronte e retro.
  await goTo(alice.page, "Ripasso");
  await learnTab(alice.page, "Raccolte");
  await alice.page.getByRole("button", { name: "Nuova raccolta" }).click();
  const deckEditor = alice.page.getByRole("dialog", { name: "Nuova raccolta" });
  await deckEditor.getByLabel("Titolo").fill(deckTitle);
  await deckEditor.getByRole("button", { name: "Salva" }).click();
  await expect(deckEditor).toBeHidden();
  const deck = alice.page.getByRole("dialog", { name: deckTitle });
  await expect(deck).toBeVisible();
  await deck.getByRole("button", { name: "Nuova flashcard" }).click();
  const cardEditor = alice.page.getByRole("dialog", { name: "Nuova flashcard" });
  await cardEditor.getByRole("group", { name: "Fronte · Testo 1" }).getByRole("textbox", { name: "Testo" }).fill(front);
  await cardEditor.getByRole("group", { name: "Retro · Testo 1" }).getByRole("textbox", { name: "Testo" }).fill(back);
  await cardEditor.getByRole("button", { name: "Salva" }).click();
  await expect(cardEditor).toBeHidden();
  await expect(deck.getByText(front)).toBeVisible();
  await alice.page.keyboard.press("Escape");
  await expect(deck).toBeHidden();
  await waitSynced(alice.page);

  // Alice: Condivisione → Condividi → solo «Flashcard e quiz», «Può vedere», invito con link.
  await goTo(alice.page, "Condivisione");
  await alice.page.getByRole("button", { name: "Condividi", exact: true }).first().click();
  const share = alice.page.getByRole("dialog", { name: "Condividi" });
  await share.getByRole("checkbox", { name: /^Calendario/ }).uncheck();
  await share.getByRole("checkbox", { name: /^Flashcard e quiz/ }).check();
  await share.getByRole("group", { name: "Permesso" }).getByRole("button", { name: "Può vedere" }).click();
  await share.getByRole("button", { name: "Crea l'invito" }).click();
  await expect(share.getByText(/^Invito pronto: Flashcard e quiz \(Può vedere\)/)).toBeVisible();
  const link = await share.getByTitle(/#condividi=/).getAttribute("title");
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#condividi=/);
  await share.getByRole("button", { name: "Fatto" }).click();
  await expect(share).toBeHidden();

  // Bob accetta.
  await bob.page.goto(link!);
  const accept = bob.page.getByRole("button", { name: /^Accetta l'invito di / });
  await expect(accept).toBeVisible(ACROSS);
  const bobSharing = channelMark(bob, "studyos-sharing:");
  await accept.click();
  await expect(bob.page.getByText(/^Fatto: ora vedi Flashcard e quiz \(Può vedere\)/)).toBeVisible(ACROSS);
  await waitForChannel(bob, "studyos-sharing:", bobSharing);

  // Bob trova la raccolta di Alice tra quelle condivise, in sola lettura, e la ripassa.
  await goTo(bob.page, "Ripasso");
  await learnTab(bob.page, "Raccolte");
  await expect(bob.page.getByText(/^Condivisa da /).first()).toBeVisible(ACROSS);
  await bob.page.getByRole("button", { name: new RegExp(`^${deckTitle}`) }).click();
  const sharedDeck = bob.page.getByRole("dialog", { name: deckTitle });
  await expect(sharedDeck.getByText("Raccolta condivisa in sola lettura: puoi studiarla o duplicarla.")).toBeVisible();
  await expect(sharedDeck.getByRole("button", { name: "Nuova flashcard" })).toHaveCount(0);
  await sharedDeck.getByRole("button", { name: "Ripassa", exact: true }).click();
  // Il drawer della raccolta e la sessione hanno lo stesso nome: si va avanti a drawer chiuso.
  await expect(sharedDeck).toHaveCount(0);
  const builder = bob.page.getByRole("dialog", { name: "Prepara un ripasso" });
  await builder.getByRole("group", { name: "Quali schede" }).getByRole("button", { name: /^Nuove/ }).click();
  await builder.getByRole("button", { name: "Inizia" }).click();
  const session = bob.page.getByRole("dialog", { name: deckTitle });
  await expect(session.getByText(front)).toBeVisible();
  await expect(session.getByText(/le tue risposte restano solo tue/i)).toBeVisible();
  await session.getByRole("button", { name: "Mostra la risposta" }).click();
  await expect(session.getByText(back)).toBeVisible();
  await session.getByRole("button", { name: "Sbagliata", exact: true }).click();
  await expect(session.getByText("Sessione finita")).toBeVisible();
  await expect(session.getByText("0 corrette · 1 sbagliata · 0 dubbie")).toBeVisible();
  await session.getByRole("button", { name: "Chiudi", exact: true }).last().click();
  await expect(session).toBeHidden();
  await waitSynced(bob.page);

  // La risposta è di Bob: la ritrova dopo un ricaricamento; Alice non la vede nemmeno ricaricando.
  await bob.page.reload();
  await goTo(bob.page, "Ripasso");
  await learnTab(bob.page, "Andamento");
  await expect(bob.page.getByText("Risposte: 1", { exact: true })).toBeVisible(ACROSS);

  await alice.page.reload();
  await goTo(alice.page, "Ripasso");
  await learnTab(alice.page, "Andamento");
  await expect(alice.page.getByText("Risposte: 0", { exact: true })).toBeVisible(ACROSS);
  await learnTab(alice.page, "Raccolte");
  await expect(alice.page.getByRole("button", { name: new RegExp(`^${deckTitle}`) })).toBeVisible();
});
