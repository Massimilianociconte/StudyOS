// Regressione: una nota scritta tra il pull dopo l'ingresso e l'iscrizione del canale dei gruppi
// deve arrivare appena il canale è pronto (ricontrollo anche alla prima iscrizione).
import { channelMark, expect, test, waitForChannel } from "./support/fixtures";
import { addNote, boardRow, createGroup, detailTab, goTo, joinWithCode, readInviteCode } from "./support/app";

test("una nota scritta mentre Bob entra arriva quando il suo canale è pronto", async ({ alice, bob, tag }) => {
  const groupName = `Ingresso ${tag}`;
  const early = `Arrivata prima dell'iscrizione ${tag}`;
  // Rete lenta di Bob: l'iscrizione al canale dei gruppi arriva al server dopo 3 s (come su un telefono in 3G).
  await bob.context.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const text = typeof message === "string" ? message : "";
      if (text.includes("phx_join") && text.includes("studyos-groups:")) setTimeout(() => server.send(message), 3_000);
      else server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  await bob.page.reload();
  await goTo(bob.page, "Gruppi");

  const aliceGroups = channelMark(alice, "studyos-groups:");
  const aliceDetail = await createGroup(alice.page, groupName);
  await waitForChannel(alice, "studyos-groups:", aliceGroups);
  const code = await readInviteCode(alice.page, aliceDetail);
  const bobGroups = channelMark(bob, "studyos-groups:");
  const bobDetail = await joinWithCode(bob.page, code, groupName);
  await detailTab(bobDetail, "Bacheca");
  // Alice aggiunge subito, mentre l'iscrizione di Bob è ancora in viaggio.
  await addNote(alice.page, groupName, early);
  await waitForChannel(bob, "studyos-groups:", bobGroups);
  // Canale pronto, nessun ricaricamento: il ricontrollo alla prima iscrizione porta la nota.
  await expect(boardRow(bobDetail, early)).toBeVisible({ timeout: 20_000 });
});
