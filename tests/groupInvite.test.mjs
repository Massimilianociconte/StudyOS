import test from "node:test";
import assert from "node:assert/strict";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
};
const events = [];
globalThis.window = { localStorage: memoryStorage(), dispatchEvent: (event) => events.push(event.type) };
globalThis.Event = class {
  constructor(type) {
    this.type = type;
  }
};

const {
  clearPendingInvite,
  confirmPendingInvite,
  inviteCodeFromText,
  readPendingInvite,
  savePendingInvite,
  telegramShareUrl,
  urlWithoutInvite,
  whatsappShareUrl
} = await import("../src/lib/groupInvite.ts");

test("invito: codice dal link (frammento o query), dal codice o dal messaggio incollato", () => {
  assert.equal(inviteCodeFromText("https://x.github.io/StudyOS/#invito=grp-ab12-cd34"), "GRP-AB12-CD34");
  assert.equal(inviteCodeFromText("https://x.github.io/StudyOS/?invito=GRP-AB12-CD34"), "GRP-AB12-CD34");
  assert.equal(inviteCodeFromText("  grp ab12 cd34 "), "GRP-AB12-CD34");
  const whatsapp = 'Alice ti invita nel gruppo "Fisio".\n\nEntra da qui: https://x.github.io/StudyOS/#invito=GRP-AB12-CD34';
  assert.equal(inviteCodeFromText(whatsapp), "GRP-AB12-CD34");
  assert.equal(inviteCodeFromText("https://x.github.io/StudyOS/#invito=<script>"), null);
  assert.equal(inviteCodeFromText("ciao"), null);
});

test("invito: l'URL pulito toglie solo il codice (i token di Supabase restano)", () => {
  assert.equal(urlWithoutInvite("https://x.io/StudyOS/#invito=GRP-AB12-CD34"), "/StudyOS/");
  assert.equal(urlWithoutInvite("https://x.io/StudyOS/?invito=GRP-AB12-CD34&a=1"), "/StudyOS/?a=1");
  assert.equal(
    urlWithoutInvite("https://x.io/StudyOS/?invito=GRP-AB12-CD34#access_token=abc.def&type=signup"),
    "/StudyOS/#access_token=abc.def&type=signup"
  );
});

test("invito in sospeso: salvato, confermato, mantenuto al ritorno dalla conferma email, scade", () => {
  const t0 = Date.UTC(2026, 9, 8, 10);
  savePendingInvite("grp-ab12-cd34", t0);
  assert.deepEqual(readPendingInvite(t0), { code: "GRP-AB12-CD34", savedAt: t0, confirmed: false });
  confirmPendingInvite(t0 + 1000);
  assert.equal(readPendingInvite(t0 + 2000).confirmed, true);
  // Il link di conferma riporta ?invito= con lo stesso codice: resta confermato.
  savePendingInvite("GRP-AB12-CD34", t0 + 3000);
  assert.equal(readPendingInvite(t0 + 4000).confirmed, true);
  // Un invito diverso riparte da non confermato.
  savePendingInvite("GRP-ZZ99-YY88", t0 + 5000);
  assert.equal(readPendingInvite(t0 + 6000).confirmed, false);
  // Dopo 14 giorni non vale più.
  assert.equal(readPendingInvite(t0 + 5000 + 15 * 24 * 60 * 60 * 1000), null);
  clearPendingInvite();
  assert.equal(readPendingInvite(t0), null);
  assert.ok(events.every((type) => type === "studyos:pending-invite") && events.length >= 4);
});

test("invito: link di condivisione per WhatsApp e Telegram codificati", () => {
  const text = "Entra: https://x.io/#invito=GRP-AB12-CD34";
  assert.equal(whatsappShareUrl(text), `https://wa.me/?text=${encodeURIComponent(text)}`);
  assert.ok(telegramShareUrl("https://x.io/#invito=GRP-AB12-CD34", "Fisio").includes("url=https%3A%2F%2Fx.io%2F%23invito%3DGRP-AB12-CD34"));
});
