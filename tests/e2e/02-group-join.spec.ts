import { channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { ACROSS, LIVE, createGroup, detailTab, goTo, groupDialog, memberRows, readInviteCode } from "./support/app";

test("02 Alice crea un gruppo, Bob entra dal link di invito e tutti e due vedono i due membri", async ({ alice, bob, tag }) => {
  const groupName = `Fisiologia ${tag}`;

  const aliceGroups = channelMark(alice, "studyos-groups:");
  const aliceDetail = await createGroup(alice.page, groupName);
  // Alice segue il nuovo gruppo in tempo reale prima che Bob entri.
  await waitForChannel(alice, "studyos-groups:", aliceGroups);
  const code = await readInviteCode(alice.page, aliceDetail);
  await detailTab(aliceDetail, "Membri");
  await expect(memberRows(aliceDetail)).toHaveCount(1);

  // Bob apre il link (#invito=…): l'app mostra l'anteprima del gruppo e un solo pulsante per entrare.
  await bob.page.goto(`/#invito=${encodeURIComponent(code)}`);
  await goTo(bob.page, "Gruppi");
  const card = bob.page.getByRole("region", { name: "Invito ricevuto" });
  await expect(card.getByRole("heading", { name: groupName })).toBeVisible(ACROSS);
  await expect(card.getByText(/1 membro · gestito da alice/)).toBeVisible();
  await card.getByRole("button", { name: "Entra nel gruppo" }).click();

  const bobDetail = groupDialog(bob.page, groupName);
  await expect(bobDetail).toBeVisible(ACROSS);
  await expect(bob.page.getByText(`Benvenuto in "${groupName}".`)).toBeVisible();
  await detailTab(bobDetail, "Membri");
  await expect(memberRows(bobDetail)).toHaveCount(2);
  await expect(memberRows(bobDetail).filter({ hasText: "bob (tu)" })).toContainText("Membro");
  await expect(memberRows(bobDetail).filter({ hasText: "alice" })).toContainText("Proprietario");

  // Alice, con il gruppo aperto, vede arrivare Bob senza ricaricare.
  await expect(memberRows(aliceDetail)).toHaveCount(2, LIVE);
  await expect(memberRows(aliceDetail).filter({ hasText: "alice (tu)" })).toContainText("Proprietario");
  await expect(memberRows(aliceDetail).filter({ hasText: "bob" })).toContainText("Membro");
  await expect(aliceDetail.getByText("2 membri", { exact: true })).toBeVisible();

  // L'ingresso compare una sola volta nella cronologia (voce scritta dal server).
  await detailTab(aliceDetail, "Cronologia");
  await expect(aliceDetail.getByRole("listitem").filter({ hasText: /bob\s+è entrato nel gruppo/ })).toHaveCount(1, ACROSS);

  // Dopo un ricaricamento il gruppo e i membri restano (verità sul server, non nel cloud personale).
  await bob.page.reload();
  await goTo(bob.page, "Gruppi");
  await expect(bob.page.getByRole("button", { name: new RegExp(`${groupName}\\s*2 membri`) })).toBeVisible(ACROSS);
});
