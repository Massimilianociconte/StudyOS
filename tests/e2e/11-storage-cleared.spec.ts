import { expect, test } from "./support/fixtures";
import { createTask, goTo, ownTask, waitSynced } from "./support/app";

// Il browser svuota i dati del sito con la scheda aperta (spazio liberato, pulizia dei dati di
// navigazione). Dexie riapre da solo un database vuoto; la scheda ha ancora tutto in memoria.
// La prima sincronizzazione che segue (i segni di sync spariscono con il database) trovava il cloud
// uguale alla memoria e non scriveva nulla su disco: dopo un ricaricamento il dispositivo restava
// vuoto, perché i pull successivi rileggono solo dall'ultima riga vista meno un minuto (incidente
// Opera, 2026-11-16).
test("11 dati del sito svuotati dal browser con la scheda aperta: dopo la sync e un ricaricamento c'è ancora tutto", async ({ alice, tag }) => {
  test.setTimeout(240_000);
  const page = alice.page;
  const older = `Più vecchia ${tag}`;
  const latest = `Ultima prima dello svuotamento ${tag}`;
  const after = `Dopo lo svuotamento ${tag}`;

  await createTask(page, older);
  await waitSynced(page);
  // Attesa vera, non un timbro finto sul server: la riga deve uscire dal minuto che ogni pull rilegge
  // (CURSOR_OVERLAP_MS in cloudSync.ts). Su Opera le righe perse erano di minuti o giorni prima.
  await page.waitForTimeout(61_000);
  await createTask(page, latest);
  await waitSynced(page);

  // Come «Cancella dati del sito» o lo spazio liberato dal browser: le connessioni aperte si chiudono.
  const origin = new URL(page.url()).origin;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "indexeddb" });
  await cdp.detach();

  // Si continua a usare l'app: la modifica avvia la sincronizzazione (prima sync da capo).
  await createTask(page, after);
  await waitSynced(page);

  await page.reload();
  await goTo(page, "Attività");
  await waitSynced(page);
  await expect(ownTask(page, after)).toBeVisible();
  await expect(ownTask(page, latest)).toBeVisible();
  await expect(ownTask(page, older)).toBeVisible();
});
