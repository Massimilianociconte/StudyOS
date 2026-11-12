import { ACCOUNTS, channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { ACROSS, LIVE, createTask, goTo, ownTask, sharedSection, waitSynced } from "./support/app";

test("04 Alice condivide le attività con Bob, Bob modifica, Alice revoca e Bob perde l'accesso con l'avviso giusto", async ({ alice, bob, tag }) => {
  const original = `Ripassare gli enzimi ${tag}`;
  const editedByBob = `Ripassare enzimi e coenzimi ${tag}`;
  const lateEdit = `Modifica arrivata tardi ${tag}`;

  await createTask(alice.page, original);
  await waitSynced(alice.page);

  // Alice: Condivisione → Condividi → solo «Attività», «Può modificare», invito per l'email di Bob.
  await goTo(alice.page, "Condivisione");
  await alice.page.getByRole("button", { name: "Condividi", exact: true }).first().click();
  const share = alice.page.getByRole("dialog", { name: "Condividi" });
  await share.getByRole("checkbox", { name: /^Calendario/ }).uncheck();
  await share.getByRole("checkbox", { name: /^Attività/ }).check();
  await share.getByLabel("Email (facoltativa)").fill(ACCOUNTS.bob.email);
  await share.getByRole("group", { name: "Permesso" }).getByRole("button", { name: "Può modificare" }).click();
  await share.getByRole("button", { name: "Crea l'invito" }).click();
  await expect(share.getByText(/^Invito pronto: Attività \(Può modificare\)/)).toBeVisible();
  const link = await share.getByTitle(/#condividi=/).getAttribute("title");
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#condividi=/);
  await share.getByRole("button", { name: "Fatto" }).click();
  await expect(share).toBeHidden();

  // Bob apre il link: l'invito si apre in Condivisione → Inviti; accetta.
  await bob.page.goto(link!);
  const accept = bob.page.getByRole("button", { name: /^Accetta l'invito di / });
  await expect(accept).toBeVisible(ACROSS);
  await expect(bob.page.getByText(/vuole condividere con te$/)).toBeVisible();
  const bobSharing = channelMark(bob, "studyos-sharing:");
  await accept.click();
  await expect(bob.page.getByText(/^Fatto: ora vedi Attività \(Può modificare\)/)).toBeVisible(ACROSS);
  // Il canale della condivisione si rifà per seguire anche i dati di Alice.
  await waitForChannel(bob, "studyos-sharing:", bobSharing);

  // Bob trova l'attività di Alice in «Condivisi con te», separata dalle sue, e la modifica.
  await goTo(bob.page, "Attività");
  const shared = sharedSection(bob.page).getByRole("button", { name: new RegExp(original) });
  await expect(shared).toBeVisible(ACROSS);
  await expect(ownTask(bob.page, original)).toHaveCount(0);
  await shared.click();
  let drawer = bob.page.getByRole("dialog", { name: original });
  await expect(drawer.getByText(/le modifiche arrivano subito anche a/)).toBeVisible();
  await drawer.getByLabel("Titolo").fill(editedByBob);
  await drawer.getByRole("button", { name: "Salva" }).click();
  await expect(drawer).toBeHidden();
  await expect(sharedSection(bob.page).getByRole("button", { name: new RegExp(editedByBob) })).toBeVisible();

  // Alice vede la modifica di Bob tra le sue attività, senza ricaricare.
  await goTo(alice.page, "Attività");
  await expect(ownTask(alice.page, editedByBob)).toBeVisible(LIVE);
  await expect(ownTask(alice.page, original)).toHaveCount(0);

  // Bob riapre l'elemento e inizia un'altra modifica; intanto Alice smette di condividere.
  await sharedSection(bob.page).getByRole("button", { name: new RegExp(editedByBob) }).click();
  drawer = bob.page.getByRole("dialog", { name: editedByBob });
  await drawer.getByLabel("Titolo").fill(lateEdit);

  await goTo(alice.page, "Condivisione");
  await alice.page.getByRole("button", { name: /^Smetti di condividere Attività con / }).click();
  await alice.page.getByRole("button", { name: "Smetti di condividere", exact: true }).click();
  await expect(alice.page.getByText(/^Fatto: .* non vede più «Attività»\.$/)).toBeVisible();

  // Bob salva: la modifica non passa e lo dice chiaramente (elemento non più condiviso o permesso tolto).
  await drawer.getByRole("button", { name: "Salva" }).click();
  const goneHere = drawer.getByRole("alert").filter({ hasText: "Questo elemento non è più condiviso con te." });
  const deniedNotice = bob.page.getByText(/^Non hai più il permesso di modificare i dati di .+: la modifica non è stata salvata\.$/);
  await expect(goneHere.or(deniedNotice)).toBeVisible(ACROSS);
  test.info().annotations.push({
    type: "avviso",
    description: (await goneHere.isVisible()) ? "nel dettaglio: elemento non più condiviso" : "in alto: permesso tolto (rifiuto del server)"
  });
  if (await drawer.isVisible()) {
    await drawer.getByRole("button", { name: "Annulla" }).click();
    await drawer.getByRole("button", { name: "Scarta le modifiche" }).click();
    await expect(drawer).toBeHidden();
  }

  // L'attività di Alice sparisce da Bob; da Alice resta quella modificata da Bob, non quella tardiva.
  await expect(sharedSection(bob.page)).toHaveCount(0, LIVE);
  await expect(bob.page.getByText(lateEdit)).toHaveCount(0);
  await goTo(bob.page, "Condivisione");
  await bob.page.getByRole("group", { name: "Schede della condivisione" }).getByRole("button", { name: "Condivisi con me" }).click();
  await expect(bob.page.getByText("Nessuno condivide con te, per ora")).toBeVisible();

  await goTo(alice.page, "Attività");
  await expect(ownTask(alice.page, editedByBob)).toBeVisible();
  await expect(alice.page.getByText(lateEdit)).toHaveCount(0);
});
