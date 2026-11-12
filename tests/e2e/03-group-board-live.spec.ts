import { channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { ACROSS, LIVE, addNote, boardRow, createGroup, detailTab, joinWithCode, readInviteCode } from "./support/app";

test("03 la bacheca del gruppo arriva in tempo reale ai membri, nei due sensi", async ({ alice, bob, tag }) => {
  const groupName = `Biochimica ${tag}`;
  const aliceNote = `Domande dell'ultimo appello ${tag}`;
  const bobNote = `Riassunto capitolo 4 ${tag}`;

  const aliceGroups = channelMark(alice, "studyos-groups:");
  const bobGroups = channelMark(bob, "studyos-groups:");
  const aliceDetail = await createGroup(alice.page, groupName);
  const code = await readInviteCode(alice.page, aliceDetail);
  const bobDetail = await joinWithCode(bob.page, code, groupName);
  // Tutti e due seguono il gruppo in tempo reale prima della prima aggiunta (il canale di Bob nasce
  // quando entra: ciò che arriva prima dell'iscrizione lo riprenderebbe solo il controllo dei 5 minuti).
  await waitForChannel(alice, "studyos-groups:", aliceGroups);
  await waitForChannel(bob, "studyos-groups:", bobGroups);
  await detailTab(bobDetail, "Bacheca");
  await detailTab(aliceDetail, "Bacheca");
  await expect(bobDetail.getByText(/^La bacheca è vuota/)).toBeVisible();

  // Alice aggiunge: Bob, con il gruppo aperto, la vede comparire senza ricaricare.
  await addNote(alice.page, groupName, aliceNote);
  await expect(boardRow(aliceDetail, aliceNote)).toContainText("Nota · aggiunto da alice");
  await expect(boardRow(bobDetail, aliceNote)).toBeVisible(LIVE);
  await expect(boardRow(bobDetail, aliceNote)).toContainText("Nota · aggiunto da alice");
  // Un membro non può fissare o eliminare ciò che ha aggiunto un altro.
  await expect(boardRow(bobDetail, aliceNote).getByRole("button", { name: "Fissa in alto" })).toHaveCount(0);

  // Bob aggiunge la sua nota e poi la fissa in alto: Alice vede l'una e l'altra cosa dal vivo.
  await addNote(bob.page, groupName, bobNote);
  await expect(boardRow(aliceDetail, bobNote)).toBeVisible(LIVE);
  await expect(boardRow(aliceDetail, bobNote).getByRole("button", { name: "Fissa in alto" })).toBeVisible();

  await boardRow(bobDetail, bobNote).getByRole("button", { name: "Fissa in alto" }).click();
  await expect(boardRow(bobDetail, bobNote).getByRole("button", { name: "Togli dai fissati" })).toBeVisible();
  await expect(boardRow(bobDetail, bobNote).getByRole("alert")).toHaveCount(0);

  await expect(boardRow(aliceDetail, bobNote).getByRole("button", { name: "Togli dai fissati" })).toBeVisible(LIVE);
  // La nota fissata sale in cima alla bacheca di Alice.
  await expect(aliceDetail.getByRole("listitem").first()).toContainText(bobNote);

  // Il fissaggio viene dal server: resta anche dopo un ricaricamento di Alice.
  await alice.page.reload();
  await expect(alice.page.getByRole("button", { name: new RegExp(`${groupName}.*1 fissato in bacheca`) })).toBeVisible(ACROSS);
});
