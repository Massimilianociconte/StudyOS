#!/usr/bin/env node
// Un agente dello scenario D di learning-stress.mjs, in un processo suo (come un hub in un altro
// Durable Object): legge le schede, aspetta l'istante comune, poi le modifica tutte in una chiamata
// e crea una scheda con una externalRef condivisa. Parametri in STRESS_AGENT (JSON); stampa l'esito.
import { createCloudRunner } from "../../src/agent/cloudRunner.ts";

const input = JSON.parse(process.env.STRESS_AGENT ?? "{}");
const runner = createCloudRunner({ url: input.url, key: input.key });
const grant = { secret: input.secret, timeZone: "Europe/Rome" };
const text = (value) => [{ type: "text", text: value }];

const read = await runner.run(grant, "studyos_get_flashcards", { ids: input.ids });
if (!read.ok) {
  console.log(JSON.stringify({ error: read.error }));
  process.exit(1);
}
await new Promise((resolve) => setTimeout(resolve, Math.max(0, input.startAt - Date.now())));
const [edit, create] = [
  await runner.run(grant, "studyos_save_flashcards", {
    cards: read.data.items.map((card) => ({ id: card.id, expectedRevision: card.revision, back: text(input.back) }))
  }),
  await runner.run(grant, "studyos_save_flashcards", {
    deckId: input.deckId,
    cards: [{ externalRef: input.ref, front: text(`Stessa chiave ${input.back}`), back: text(input.back) }]
  })
];
console.log(JSON.stringify({
  edit: (edit.data?.items ?? []).map((item) => ({ id: item.id, status: item.status })),
  editError: edit.ok ? null : edit.error,
  create: create.data?.items?.[0]?.status ?? create.error
}));
