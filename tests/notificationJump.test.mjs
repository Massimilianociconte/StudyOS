import test from "node:test";
import assert from "node:assert/strict";
import { notificationJump, shareInviteNotificationId } from "../src/lib/notificationJump.ts";
import { notificationIdOf } from "../src/lib/eventReminders.ts";
import { linkedUiChange } from "../src/lib/uiLinks.ts";
import { isNullableString, oneOf } from "../src/lib/uiState.ts";
import { QUICK_ADD_TEXT, SEARCH_TEXT, VIEW_ERROR_TEXT } from "../src/lib/labels.ts";

const AT = "2026-11-12T17:30:00.000Z";
const base = { id: "notif-x", kind: "system", title: "", body: "", createdAt: AT };
const SHARING_TABS = ["mine", "received", "invites", "history"];

test("notificationJump: un invito a condividere apre «Inviti», una condivisione ricevuta «Condivisi con me»", () => {
  const invite = notificationJump({ ...base, id: shareInviteNotificationId("inv-1"), linkView: "sharing" });
  assert.equal(invite.view, "sharing");
  assert.deepEqual(invite.writes, [["sharing.tab", "invites", "tab"]]);
  // Stesso id che shareSync dà alla notifica dell'invito.
  assert.equal(shareInviteNotificationId("inv-1"), "notif-share-invite-inv-1");

  const grant = notificationJump({ ...base, id: "notif-share-grant-9", linkView: "sharing" });
  assert.deepEqual(grant.writes, [["sharing.tab", "received", "tab"]]);
  // I valori scritti passano il validatore della scheda in SharingView.
  for (const jump of [invite, grant]) assert.ok(oneOf(...SHARING_TABS)(jump.writes[0][1]));
});

test("notificationJump: «Sei entrato nel gruppo» apre quel gruppo, anche con Gruppi già aperto", () => {
  const jump = notificationJump({ ...base, linkView: "groups", linkGroupId: "g-1" });
  assert.equal(jump.view, "groups");
  assert.deepEqual(jump.writes, [["groups.open", "g-1", "tab"]]);
  // Gruppi aperto senza gruppo aperto (visto: null): il valore nuovo si applica.
  assert.deepEqual(linkedUiChange("g-1", null, isNullableString), { seen: "g-1", apply: true });
});

test("notificationJump: un promemoria porta il Calendario sul giorno dell'evento", () => {
  // Mezzogiorno locale del giorno: vale in qualsiasi fuso di chi esegue i test.
  const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
  const id = notificationIdOf(`ev-1@2026-11-12#0d10m@${Date.parse(AT)}`);
  const jump = notificationJump({ ...base, id, linkView: "calendar" });
  assert.equal(jump.view, "calendar");
  assert.deepEqual(jump.writes, [["calendar.cursor", noon(2026, 11, 12), "tab"]]);
  // «7 giorni prima» alle 9: scatta il 19 novembre, il Calendario va al 26 (il giorno dell'esame).
  const early = notificationIdOf(`series_ab-1@2026-11-26#7d0m0900@${Date.parse("2026-11-19T08:00:00.000Z")}`);
  assert.deepEqual(notificationJump({ ...base, id: early, linkView: "calendar", createdAt: "2026-11-19T08:00:00.000Z" }).writes, [
    ["calendar.cursor", noon(2026, 11, 26), "tab"]
  ]);
  // Id senza giorno leggibile: il giorno dell'avviso; data non leggibile: niente cursore.
  const odd = notificationIdOf("chiave-strana");
  assert.deepEqual(notificationJump({ ...base, id: odd, linkView: "calendar" }).writes, [["calendar.cursor", AT, "tab"]]);
  assert.deepEqual(notificationJump({ ...base, id: odd, linkView: "calendar", createdAt: "?" }).writes, []);
  // Un'altra notifica del Calendario che non è un promemoria non sposta il giorno.
  assert.deepEqual(notificationJump({ ...base, id: "notif-cal", linkView: "calendar" }).writes, []);
});

test("notificationJump: senza sezione collegata non porta da nessuna parte", () => {
  assert.deepEqual(notificationJump(base), { view: null, writes: [] });
});

test("testi condivisi: conferma dell'aggiunta rapida, esame da decidere, errore di sezione", () => {
  assert.equal(QUICK_ADD_TEXT.saved("event", "  Lezione di Anatomia "), "Evento aggiunto al Calendario («Lezione di Anatomia»).");
  assert.equal(QUICK_ADD_TEXT.saved("subject", ""), "Materia creata: la trovi in Materie.");
  assert.match(QUICK_ADD_TEXT.saved("file", "slide.pdf"), /Materiali/);
  assert.match(SEARCH_TEXT.examDateToDecide, /da decidere/);
  // La categoria delle Impostazioni si chiama «Copia di sicurezza», non «Backup».
  assert.match(VIEW_ERROR_TEXT.body, /Impostazioni → Copia di sicurezza/);
});
