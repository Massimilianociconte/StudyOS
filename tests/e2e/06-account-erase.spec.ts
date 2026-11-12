import { ACCOUNTS, expect, signInOn, test } from "./support/fixtures";
import { ACROSS, LIVE, createTask, goTo, openSettings, ownTask, waitSynced } from "./support/app";
import { liveItemCount } from "./support/stack";

test("06 «Cancella anche dall'account» su Bob: i dati spariscono dal cloud e dagli altri dispositivi e non tornano", async ({ bob, newDevice, db, tag }) => {
  const fromPhone = `Esercizi di statistica ${tag}`;
  const fromLaptop = `Relazione di laboratorio ${tag}`;

  // Due dispositivi di Bob, ognuno con un'attività: entrambe arrivano nel cloud.
  await createTask(bob.page, fromPhone);
  await waitSynced(bob.page);
  const laptop = await newDevice(ACCOUNTS.bob);
  await signInOn(laptop);
  await createTask(laptop.page, fromLaptop);
  await expect(ownTask(laptop.page, fromPhone)).toBeVisible(ACROSS);
  await waitSynced(laptop.page);
  await expect.poll(() => liveItemCount(db, ACCOUNTS.bob.email, "task"), ACROSS).toBe(2);

  // Telefono: Impostazioni → Spazio e dati → Cancella tutti i dati → «Cancella anche dall'account».
  await openSettings(bob.page, /Spazio e dati/);
  await bob.page.getByRole("button", { name: "Cancella tutti i dati" }).click();
  const ask = bob.page.getByRole("group", { name: "Cancellare tutti i dati?" });
  await expect(ask.getByText(/Sei collegato al tuo account/)).toBeVisible();
  await ask.getByRole("button", { name: "Cancella anche dall'account" }).click();
  await expect(bob.page.getByText("Dati cancellati da questo dispositivo e dall'account.")).toBeVisible(ACROSS);
  await waitSynced(bob.page);

  // Sul server non resta nessuna attività di Bob, nemmeno quella creata sull'altro dispositivo.
  await expect.poll(() => liveItemCount(db, ACCOUNTS.bob.email, "task"), ACROSS).toBe(0);

  // Il portatile, ancora collegato, perde la sua attività dal vivo e non la rimanda al cloud.
  await goTo(laptop.page, "Attività");
  await expect(ownTask(laptop.page, fromLaptop)).toHaveCount(0, LIVE);
  await expect(ownTask(laptop.page, fromPhone)).toHaveCount(0);
  await waitSynced(laptop.page);

  // Ricaricando il telefono e accedendo da un dispositivo nuovo: niente torna.
  await bob.page.reload();
  await goTo(bob.page, "Attività");
  await waitSynced(bob.page);
  await expect(bob.page.getByRole("heading", { name: "Ancora nessuna attività" })).toBeVisible();

  const fresh = await newDevice(ACCOUNTS.bob);
  await signInOn(fresh);
  await goTo(fresh.page, "Attività");
  await expect(fresh.page.getByRole("heading", { name: "Ancora nessuna attività" })).toBeVisible();
  await expect(fresh.page.getByText(fromPhone)).toHaveCount(0);
  await expect(fresh.page.getByText(fromLaptop)).toHaveCount(0);

  await laptop.page.reload();
  await goTo(laptop.page, "Attività");
  await waitSynced(laptop.page);
  await expect(laptop.page.getByRole("heading", { name: "Ancora nessuna attività" })).toBeVisible();
  expect(liveItemCount(db, ACCOUNTS.bob.email, "task")).toBe(0);
});
