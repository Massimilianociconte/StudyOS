import { channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { ACROSS, LIVE, createGroup, detailTab, goTo, groupDialog, joinWithCode, memberRows, readInviteCode } from "./support/app";
import { psql } from "./support/stack";

test("05 Bob esce dal gruppo e Alice vede «ha lasciato il gruppo» nella cronologia", async ({ alice, bob, db, tag }) => {
  const groupName = `Genetica ${tag}`;

  const aliceGroups = channelMark(alice, "studyos-groups:");
  const aliceDetail = await createGroup(alice.page, groupName);
  await waitForChannel(alice, "studyos-groups:", aliceGroups);
  const code = await readInviteCode(alice.page, aliceDetail);
  const bobDetail = await joinWithCode(bob.page, code, groupName);
  await detailTab(aliceDetail, "Membri");
  await expect(memberRows(aliceDetail)).toHaveCount(2, ACROSS);

  // Alice tiene aperta la cronologia: la voce di uscita deve arrivare dal vivo.
  await detailTab(aliceDetail, "Cronologia");
  const leftEntry = aliceDetail.getByRole("listitem").filter({ hasText: /bob\s+ha lasciato il gruppo/ });
  await expect(leftEntry).toHaveCount(0);

  // Bob: dettaglio del gruppo → «Esci dal gruppo» → conferma.
  await bobDetail.getByRole("button", { name: "Esci dal gruppo" }).click();
  await expect(bobDetail.getByText(`Uscire da "${groupName}"?`, { exact: false })).toBeVisible();
  await bobDetail.getByRole("button", { name: "Esci dal gruppo" }).click();
  await expect(groupDialog(bob.page, groupName)).toBeHidden();
  await expect(bob.page.getByText(`Hai lasciato il gruppo "${groupName}".`)).toBeVisible();
  await expect(bob.page.getByRole("button", { name: new RegExp(groupName) })).toHaveCount(0);

  // Alice: la voce scritta dal server compare una sola volta, e i membri tornano a uno.
  await expect(leftEntry).toHaveCount(1, LIVE);
  await detailTab(aliceDetail, "Membri");
  await expect(memberRows(aliceDetail)).toHaveCount(1, ACROSS);
  await expect(aliceDetail.getByText("1 membro", { exact: true })).toBeVisible();

  // Lato server: una sola voce di uscita, scritta dal trigger (non dall'app di Bob prima di uscire).
  expect(
    psql(
      db,
      `select count(*) from public.studyos_group_activity a join public.studyos_groups g on g.id = a.group_id
        where g.name = '${groupName.replace(/'/g, "''")}' and a.text = 'ha lasciato il gruppo'`
    )
  ).toBe("1");

  // Bob non ritrova il gruppo neanche dopo un ricaricamento.
  await bob.page.reload();
  await goTo(bob.page, "Gruppi");
  await expect(bob.page.getByRole("heading", { name: "Ancora nessun gruppo" })).toBeVisible(ACROSS);
});
