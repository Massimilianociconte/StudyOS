// Chiave pubblica VAPID di StudyOS (RFC 8292): base64url del punto P-256 non compresso (65 byte).
// È pubblica: il browser la usa per iscriversi alle push, il Worker per firmarle.
// La chiave privata sta solo nel secret STUDYOS_VAPID_PRIVATE_KEY del Worker.
// Generata da `node scripts/push-keys.mjs` il 2026-11-11: cambiarla invalida le iscrizioni esistenti.
export const VAPID_PUBLIC_KEY = "BH2CD2EeTjxR5A5WV5sphF2LIhXameWMe9vzZqQtkGXV_RdolfmWY6QDHWKm3Wn7vPrcKQV1DqdmG0A_WDIq2Xg";
