import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExternalUrl, safeDataUrl, safeHref } from "../src/lib/safeUrl.ts";

test("link esterni: solo http(s)/mailto, niente javascript: da backup o sync", () => {
  assert.equal(normalizeExternalUrl("javascript:alert(1)"), null);
  assert.equal(normalizeExternalUrl(" JavaScript:alert(1)"), null);
  assert.equal(normalizeExternalUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(normalizeExternalUrl("vbscript:msgbox"), null);
  assert.equal(normalizeExternalUrl("https://ariel.unimi.it/x"), "https://ariel.unimi.it/x");
  assert.equal(normalizeExternalUrl("www.unimi.it"), "https://www.unimi.it/");
  assert.equal(normalizeExternalUrl("mailto:cl.biol@unimi.it"), "mailto:cl.biol@unimi.it");
  assert.equal(normalizeExternalUrl("appunti"), null);
  assert.equal(safeHref("javascript:alert(1)"), undefined);
});

test("allegati incorporati: solo data URL", () => {
  assert.equal(safeDataUrl("data:application/pdf;base64,AAAA"), "data:application/pdf;base64,AAAA");
  assert.equal(safeDataUrl("javascript:alert(1)"), undefined);
  assert.equal(safeDataUrl(undefined), undefined);
});
