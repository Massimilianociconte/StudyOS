import { channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { LIVE, createGroup, detailTab, joinWithCode, readInviteCode } from "./support/app";

test("08 un appello aggiunto da Alice arriva a Bob dal vivo e la scelta di Bob resta sua", async ({ alice, bob, tag }) => {
  const groupName = `Appelli ${tag}`;
  const course = `Biochimica ${tag}`;

  const aliceGroups = channelMark(alice, "studyos-groups:");
  const aliceDetail = await createGroup(alice.page, groupName);
  await waitForChannel(alice, "studyos-groups:", aliceGroups);
  const code = await readInviteCode(alice.page, aliceDetail);
  const bobExams = channelMark(bob, "studyos-group-exams:");
  const bobDetail = await joinWithCode(bob.page, code, groupName);
  await detailTab(bobDetail, "Appelli");
  // Bob segue gli appelli del gruppo dal vivo prima che Alice scriva.
  await waitForChannel(bob, "studyos-group-exams:", bobExams);

  // Alice: scheda «Appelli» → «Aggiungi un appello», corso scritto a mano, data di oggi.
  await detailTab(aliceDetail, "Appelli");
  await aliceDetail.getByRole("button", { name: "Aggiungi un appello" }).click();
  const form = alice.page.getByRole("dialog", { name: "Nuovo appello del gruppo" });
  await form.getByLabel("Scegli una tua materia o scrivi il nome del corso.").fill(course);
  await form.getByRole("button", { name: /^Data/ }).click();
  await alice.page.getByRole("button", { name: "Oggi", exact: true }).last().click();
  await form.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(alice.page.getByText("Appello aggiunto al gruppo.")).toBeVisible();

  // Bob lo vede comparire senza ricaricare e lo sceglie per sé.
  const bobChoose = bobDetail.getByRole("button", { name: new RegExp(`^Scegli: .*${course}`) });
  await expect(bobChoose).toBeVisible(LIVE);
  await bobChoose.click();
  await expect(bobDetail.getByRole("button", { name: new RegExp(`^Scelto: .*${course}`) })).toBeVisible();

  // Il piano è personale: per Alice l'appello resta da scegliere.
  const aliceRow = aliceDetail.getByRole("button", { name: new RegExp(`^(Scegli|Scelto): .*${course}`) });
  await expect(aliceRow).toHaveAccessibleName(new RegExp(`^Scegli: .*${course}`));
});
