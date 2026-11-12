import test from "node:test";
import assert from "node:assert/strict";
import { fileToDataUrl, MAX_EMBEDDED_FILE_BYTES } from "../src/lib/files.ts";

test("un allegato troppo grande è rifiutato prima della conversione Base64", async () => {
  await assert.rejects(fileToDataUrl({ size: MAX_EMBEDDED_FILE_BYTES + 1 }), /troppo grande|600 KiB/i);
});

test("copertina: rimpicciolita come le foto del profilo; se resta troppo grande lo dice, senza consigliare link", async () => {
  const { readCoverImage, COVER_TOO_BIG } = await import("../src/lib/files.ts");
  // In Node non c'è il canvas per ridurla: un file grande non può diventare piccolo.
  const big = { type: "image/jpeg", size: MAX_EMBEDDED_FILE_BYTES + 1 };
  await assert.rejects(readCoverImage(big), (error) => error.message === COVER_TOO_BIG && !/link/i.test(error.message));
  await assert.rejects(readCoverImage({ type: "application/pdf", size: 10 }), /immagine/i);
  assert.equal(await readCoverImage(undefined), undefined);
});
