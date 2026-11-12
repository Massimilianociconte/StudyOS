import { ACCOUNTS, expect, signInOn, test } from "./support/fixtures";
import { ACROSS, cloudBadge, createTask, goTo, ownTask, sharedSection, waitSynced } from "./support/app";

test("01 due account accedono e i dati personali restano separati", async ({ alice, bob, newDevice, tag }) => {
  const aliceTask = `Solo di Alice ${tag}`;
  const bobTask = `Solo di Bob ${tag}`;

  // Ognuno vede il proprio account.
  await expect(cloudBadge(alice.page)).toHaveAccessibleName(new RegExp(ACCOUNTS.alice.email));
  await expect(cloudBadge(bob.page)).toHaveAccessibleName(new RegExp(ACCOUNTS.bob.email));

  await createTask(alice.page, aliceTask);
  await createTask(bob.page, bobTask);
  await waitSynced(alice.page);
  await waitSynced(bob.page);

  // Un secondo dispositivo di Alice riceve dal cloud la sua attività e non quella di Bob:
  // la separazione non dipende dal fatto che nulla sia stato inviato.
  const aliceTablet = await newDevice(ACCOUNTS.alice);
  await signInOn(aliceTablet);
  await goTo(aliceTablet.page, "Attività");
  await expect(ownTask(aliceTablet.page, aliceTask)).toBeVisible(ACROSS);
  await expect(aliceTablet.page.getByText(bobTask)).toHaveCount(0);

  // Dopo un ricaricamento (dati letti da IndexedDB e poi riallineati col cloud) ognuno vede solo i suoi.
  for (const [device, mine, theirs] of [
    [alice, aliceTask, bobTask],
    [bob, bobTask, aliceTask]
  ] as const) {
    await device.page.reload();
    await goTo(device.page, "Attività");
    await waitSynced(device.page);
    await expect(ownTask(device.page, mine)).toBeVisible();
    await expect(device.page.getByText(theirs)).toHaveCount(0);
    await expect(sharedSection(device.page)).toHaveCount(0);
  }
});
