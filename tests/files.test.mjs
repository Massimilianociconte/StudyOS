import test from "node:test";
import assert from "node:assert/strict";
import { fileToDataUrl, MAX_EMBEDDED_FILE_BYTES } from "../src/lib/files.ts";

test("un allegato troppo grande è rifiutato prima della conversione Base64", async () => {
  await assert.rejects(fileToDataUrl({ size: MAX_EMBEDDED_FILE_BYTES + 1 }), /troppo grande|600 KiB/i);
});
