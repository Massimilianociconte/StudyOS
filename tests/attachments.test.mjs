import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  CACHE_LIMIT_BYTES,
  FALLBACK_MIME,
  FILES_BUCKET,
  FILE_ACCEPT,
  FILE_MIME_TYPES,
  MAX_FILE_BYTES,
  allowedMime,
  checkNewFile,
  decodeDataUrl,
  encodeDataUrl,
  hasFile,
  isSafeObjectId,
  materialFileState,
  objectPath,
  planCacheEviction,
  planFileWork,
  retryDelay,
  sanitizeFileName,
  storageErrorText,
  uploadMime,
  withLocalFile,
  withStoredFile,
  BACKUP_FILES_LIMIT_BYTES,
  FILE_RETENTION_MS,
  backgroundStamp,
  objectFate,
  orphanCopyFate,
  planBackupFiles,
  pullTransition,
  sealingAction,
  sharedDownloadName
} from "../src/lib/attachments.ts";
import { FILE_TEXT } from "../src/lib/labels.ts";
import { publicAttachment } from "../src/agent/project.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// File dei materiali fuori dal JSON sincronizzato (docs/superpowers/specs/2026-11-12-attachments-storage-design.md).

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const UID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

// ─── Limiti e tipi ───────────────────────────────────────────────────────────

test("bucket: stesso nome, stesso limite (25 MB) e stessi tipi in storage.sql e nell'app", () => {
  const sql = read("supabase/storage.sql");
  assert.equal(FILES_BUCKET, "studyos-files");
  assert.match(sql, /values \('studyos-files', 'studyos-files', false, 26214400, null\)\s*on conflict \(id\) do nothing;/);
  assert.match(sql, /set\s+public = false,\s+file_size_limit = 26214400,/);
  assert.equal(MAX_FILE_BYTES, 26214400);
  const list = sql.slice(sql.indexOf("allowed_mime_types = array["), sql.indexOf("]::text[]"));
  const types = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(types, [...FILE_MIME_TYPES, FALLBACK_MIME]);
  for (const type of types) assert.doesNotMatch(type, /html|svg|javascript|ecmascript|\/xml|x-msdownload|x-sh\b/, type);
});

test("tipi: alias dei browser, parametri, estensione quando il tipo manca; mai HTML, SVG o eseguibili", () => {
  assert.equal(allowedMime("foto.jpg", "image/jpg"), "image/jpeg");
  assert.equal(allowedMime("audio", "audio/mp3"), "audio/mpeg");
  assert.equal(allowedMime("note.txt", "text/plain; charset=utf-8"), "text/plain");
  assert.equal(allowedMime("appunti.md", ""), "text/markdown");
  assert.equal(allowedMime("FOTO.HEIC", undefined), "image/heic");
  assert.equal(allowedMime("pagina.html", "text/html"), null);
  assert.equal(allowedMime("logo.svg", "image/svg+xml"), null);
  assert.equal(allowedMime("setup.exe", "application/x-msdownload"), null);
  assert.equal(allowedMime("script.js", ""), null);
  assert.equal(uploadMime("vecchio.xyz", "application/x-strano"), FALLBACK_MIME, "file incorporati di prima: si caricano lo stesso");
  assert.equal(uploadMime("dispense.pdf", "application/pdf"), "application/pdf");
  assert.doesNotMatch(FILE_ACCEPT, /html|svg|\.js\b|\.exe/);
  assert.match(FILE_ACCEPT, /application\/pdf/);
  assert.match(FILE_ACCEPT, /\.docx/);
});

test("nomi: niente percorsi, caratteri di controllo o inversioni del testo; massimo 120 caratteri con l'estensione", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "_.._etc_passwd");
  assert.equal(sanitizeFileName("a\u0000b\u0007c.pdf"), "abc.pdf");
  assert.equal(sanitizeFileName("fattura‮fdp.exe"), "fatturafdp.exe");
  assert.equal(sanitizeFileName('a<b>:c"d|e?f*g.txt'), "a_b__c_d_e_f_g.txt");
  assert.equal(sanitizeFileName("  ..nascosto.txt.  "), "nascosto.txt");
  assert.equal(sanitizeFileName(""), "file");
  assert.equal(sanitizeFileName(undefined), "file");
  const long = sanitizeFileName(`${"x".repeat(300)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".pdf"));
});

test("file nuovo: vuoto, troppo grande, tipo non ammesso, altrimenti nome pulito e tipo", () => {
  assert.deepEqual(checkNewFile({ name: "a.pdf", type: "application/pdf", size: 0 }), { ok: false, error: FILE_TEXT.empty });
  assert.deepEqual(checkNewFile({ name: "a.pdf", type: "application/pdf", size: MAX_FILE_BYTES + 1 }), { ok: false, error: FILE_TEXT.tooBig });
  assert.deepEqual(checkNewFile({ name: "a.html", type: "text/html", size: 10 }), { ok: false, error: FILE_TEXT.typeNotAllowed });
  assert.deepEqual(checkNewFile({ name: "dir/a.pdf", type: "application/pdf", size: MAX_FILE_BYTES }), { ok: true, name: "dir_a.pdf", mime: "application/pdf" });
  assert.match(FILE_TEXT.tooBig, /25 MB/);
  assert.match(FILE_TEXT.limitHint, /25 MB/);
});

test("percorso nel bucket: sempre <uid>/<id>, mai con id o uid strani", () => {
  assert.equal(objectPath(UID, "attachment_m1abc_1234abcd"), `${UID}/attachment_m1abc_1234abcd`);
  assert.throws(() => objectPath("non-uuid", "a1"));
  assert.throws(() => objectPath(UID, "../altro"));
  assert.throws(() => objectPath(UID, "a/b"));
  assert.throws(() => objectPath(UID, ""));
  assert.equal(isSafeObjectId("attachment_x-1"), true);
  assert.equal(isSafeObjectId("a.b"), false);
  // Stessa regola nella funzione SQL di lettura.
  assert.match(read("supabase/storage.sql"), /\/\[A-Za-z0-9_-\]\{1,128\}\$'/);
});

// ─── Data URL ────────────────────────────────────────────────────────────────

test("data URL: andata e ritorno dei byte, anche non base64; null se non è un data URL", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
  const url = encodeDataUrl("application/pdf", bytes);
  const back = decodeDataUrl(url);
  assert.equal(back.mime, "application/pdf");
  assert.deepEqual([...back.bytes], [...bytes]);
  assert.deepEqual([...decodeDataUrl("data:text/plain,ciao%20a").bytes], [...new TextEncoder().encode("ciao a")]);
  assert.equal(decodeDataUrl("data:image/png;base64,***"), null);
  assert.equal(decodeDataUrl("javascript:alert(1)"), null);
  assert.equal(decodeDataUrl(undefined), null);
  assert.equal(encodeDataUrl("", new Uint8Array([1])), "data:application/octet-stream;base64,AQ==");
  // File grandi: niente stack overflow con String.fromCharCode.
  const big = new Uint8Array(3 * 1024 * 1024).fill(65);
  assert.equal(decodeDataUrl(encodeDataUrl("text/plain", big)).bytes.length, big.length);
});

// ─── Stato e piano di lavoro ─────────────────────────────────────────────────

test("stato del materiale: link, incorporato, nel cloud, qui, da caricare, solo qui senza account, altrove", () => {
  const ctx = { signedIn: true, uploading: false };
  assert.equal(materialFileState({ id: "a", externalUrl: "https://x.it" }, undefined, ctx), "link");
  assert.equal(materialFileState({ id: "a", dataUrl: "data:application/pdf;base64,AA" }, undefined, ctx), "embedded");
  assert.equal(materialFileState({ id: "a", storedFile: "cloud" }, undefined, ctx), "cloud");
  assert.equal(materialFileState({ id: "a", storedFile: "cloud" }, { pending: 0 }, ctx), "here");
  assert.equal(materialFileState({ id: "a", storedFile: "local" }, { pending: 1 }, ctx), "queued");
  assert.equal(materialFileState({ id: "a", storedFile: "local" }, { pending: 1 }, { signedIn: true, uploading: true }), "uploading");
  assert.equal(materialFileState({ id: "a", storedFile: "local" }, { pending: 1 }, { signedIn: false, uploading: false }), "guest");
  assert.equal(materialFileState({ id: "a", storedFile: "local" }, undefined, ctx), "elsewhere");
  assert.equal(materialFileState({ id: "a" }, undefined, ctx), "none");
  assert.equal(hasFile({ id: "a", storedFile: "local" }), true);
  assert.equal(hasFile({ id: "a", externalUrl: "https://x.it" }), false);
});

test("piano: migra gli incorporati, carica le copie da caricare, segna i già caricati, tiene le copie senza materiale", () => {
  const attachments = [
    { id: "embedded", dataUrl: "data:application/pdf;base64,AA" },
    { id: "pending", storedFile: "local" },
    { id: "uploaded", storedFile: "local" },
    { id: "cached", storedFile: "cloud" },
    { id: "link", externalUrl: "https://x.it" },
    { id: "elsewhere", storedFile: "local" },
    { id: "otheraccount", storedFile: "cloud" },
    { id: "../bad", dataUrl: "data:text/plain,x" }
  ];
  const files = new Map([
    ["pending", { pending: 1 }],
    ["uploaded", { pending: 0, uploadedFor: UID }],
    ["cached", { pending: 0, uploadedFor: UID }],
    ["otheraccount", { pending: 0, uploadedFor: "11111111-2222-4333-8444-555555555555" }],
    ["gone-cache", { pending: 0, uploadedFor: UID }],
    ["gone-pending", { pending: 1 }]
  ]);
  const plan = planFileWork({ attachments, files, uid: UID });
  assert.deepEqual(plan.migrate, ["embedded"]);
  assert.deepEqual(plan.upload, ["pending", "otheraccount"]);
  assert.deepEqual(plan.markStored, ["uploaded"]);
  assert.deepEqual(plan.dropCache, ["gone-cache"]);
  assert.deepEqual(plan.orphanPending, ["gone-pending"], "mai cancellata: forse il materiale non è ancora tornato");
});

test("piano: dopo un errore l'id aspetta; un incorporato tornato su una riga già caricata si risegna", () => {
  const now = 1_000_000;
  const waiting = planFileWork({
    attachments: [{ id: "a", storedFile: "local" }, { id: "b", dataUrl: "data:x/y;base64,AA" }],
    files: new Map([["a", { pending: 1 }]]),
    uid: UID,
    retryAt: new Map([["a", now + 1], ["b", now + 1]]),
    now
  });
  assert.deepEqual([waiting.upload, waiting.migrate], [[], []]);
  const back = planFileWork({
    attachments: [{ id: "a", storedFile: "cloud", dataUrl: "data:x/y;base64,AA" }],
    files: new Map([["a", { pending: 0, uploadedFor: UID }]]),
    uid: UID
  });
  assert.deepEqual(back.markStored, ["a"]);
});

test("riga dopo il caricamento: senza byte, storedFile cloud, timbro dopo quello salvato; null se il file è cambiato", () => {
  const ahead = new Date(Date.now() + 3_600_000).toISOString();
  const material = { id: "a", name: "x.pdf", dataUrl: "data:application/pdf;base64,AA", updatedAt: ahead, createdAt: ahead, archived: false, tags: [], mimeType: "application/pdf", size: 1, addedAt: ahead, description: "" };
  const next = withStoredFile(material, material.dataUrl);
  assert.equal("dataUrl" in next, false);
  assert.equal(next.storedFile, "cloud");
  assert.ok(Date.parse(next.updatedAt) > Date.parse(ahead));
  assert.equal(withStoredFile({ ...material, dataUrl: "data:application/pdf;base64,BB" }, material.dataUrl), null);
  const local = withLocalFile(material, "application/pdf", 1);
  assert.equal("dataUrl" in local, false);
  assert.equal(local.storedFile, "local");
});

test("cache: via prima le copie meno usate, mai quelle da caricare, fino a stare sotto il limite", () => {
  assert.equal(CACHE_LIMIT_BYTES, 150 * 1024 * 1024);
  const rows = [
    { id: "new", pending: 0, size: 40, usedAt: 30 },
    { id: "old", pending: 0, size: 40, usedAt: 10 },
    { id: "todo", pending: 1, size: 80, usedAt: 0 },
    { id: "mid", pending: 0, size: 40, usedAt: 20 }
  ];
  assert.deepEqual(planCacheEviction(rows, 130), ["old", "mid"]);
  assert.deepEqual(planCacheEviction(rows, 1000), []);
  assert.deepEqual(planCacheEviction(rows, 0), ["old", "mid", "new"]);
});

test("errori dello Storage in italiano; attese crescenti fino a 30 minuti", () => {
  assert.equal(storageErrorText({ message: "Bucket not found" }), FILE_TEXT.storageMissing);
  assert.equal(storageErrorText({ statusCode: "404", message: "x" }), FILE_TEXT.notFound);
  assert.equal(storageErrorText({ message: "Object not found" }), FILE_TEXT.notFound);
  assert.equal(storageErrorText({ statusCode: "413", message: "Payload too large" }), FILE_TEXT.tooBig);
  assert.equal(storageErrorText(new TypeError("Failed to fetch")), FILE_TEXT.offlineNotHere);
  assert.equal(storageErrorText(new Error("boh"), "ripiego"), "ripiego");
  assert.deepEqual([1, 2, 3].map(retryDelay), [30_000, 60_000, 120_000]);
  assert.equal(retryDelay(50), 30 * 60_000);
});

// ─── Store ───────────────────────────────────────────────────────────────────

test("addAttachment: i controlli bloccano prima di salvare qualcosa, e il materiale non porta mai byte", async () => {
  useStudyStore.setState({ loading: true, locked: false, attachments: [] });
  const file = (name, type, size) => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(size) });
  await assert.rejects(useStudyStore.getState().addAttachment(file("x.pdf", "application/pdf", MAX_FILE_BYTES + 1)), { message: FILE_TEXT.tooBig });
  await assert.rejects(useStudyStore.getState().addAttachment(file("x.html", "text/html", 10)), { message: FILE_TEXT.typeNotAllowed });
  assert.equal(useStudyStore.getState().attachments.length, 0);
  const source = read("src/store/useStudyStore.ts");
  const add = source.slice(source.indexOf("addAttachment: async"), source.indexOf("addExternalAttachment: async"));
  assert.doesNotMatch(add, /dataUrl/);
  assert.ok(add.indexOf("saveLocalFile(") > 0 && add.indexOf("saveLocalFile(") < add.indexOf("set((state)"), "prima la copia locale, poi il materiale");
  assert.match(add, /storedFile: "local"/);
  assert.doesNotMatch(source, /fileToDataUrl/);
});

test("markAttachmentsStored: segna solo se il file incorporato è ancora quello caricato; i materiali spariti tornano in missing", async () => {
  const stamp = "2026-11-12T08:00:00.000Z";
  const base = { createdAt: stamp, updatedAt: stamp, archived: false, tags: [], mimeType: "application/pdf", size: 1, addedAt: stamp, description: "" };
  useStudyStore.setState({
    loading: true,
    locked: false,
    attachments: [
      { ...base, id: "a", name: "a.pdf", dataUrl: "data:application/pdf;base64,AA" },
      { ...base, id: "b", name: "b.pdf", dataUrl: "data:application/pdf;base64,NUOVO" },
      { ...base, id: "c", name: "c.pdf", storedFile: "local" }
    ]
  });
  const result = await useStudyStore.getState().markAttachmentsStored([
    { id: "a", dataUrl: "data:application/pdf;base64,AA" },
    { id: "b", dataUrl: "data:application/pdf;base64,VECCHIO" },
    { id: "c" },
    { id: "gone" }
  ]);
  assert.deepEqual(result, { stored: ["a", "c"], missing: ["gone"] });
  const byId = new Map(useStudyStore.getState().attachments.map((item) => [item.id, item]));
  assert.equal(byId.get("a").storedFile, "cloud");
  assert.equal("dataUrl" in byId.get("a"), false);
  assert.equal(byId.get("b").dataUrl, "data:application/pdf;base64,NUOVO", "file cambiato nel frattempo: la riga resta com'è");
  assert.equal(byId.get("c").storedFile, "cloud");
});

// ─── Condivisione e agenti ───────────────────────────────────────────────────

test("storedFile è una chiave protetta ovunque: client, sharing.sql, verifica, agenti locali e remoti", () => {
  assert.match(read("src/lib/sharing.ts"), /PROTECTED_KEY = \/\^\(\?:cover\|dataUrl\|storedFile\|sourceUid\|/);
  const sharing = read("supabase/sharing.sql");
  assert.equal(sharing.split("'^(cover|dataUrl|storedFile|sourceUid|[A-Za-z]*DataUrl|__proto__)$'").length - 1, 3);
  assert.doesNotMatch(sharing, /'\^\(cover\|dataUrl\|sourceUid/);
  assert.match(read("supabase/sharing-verify.sql"), /\^\(cover\|dataUrl\|storedFile\|sourceUid/);
  assert.match(read("src/agent/shared.ts"), /NEVER_KEYS = \/\^\(\?:cover\|dataUrl\|storedFile\|/);
  assert.match(read("src/agent/project.ts"), /HIDDEN_FIELDS = new Set\(\[[^\]]*"storedFile"/);
  const agent = read("supabase/agent.sql");
  assert.match(agent, /i\.payload - 'dataUrl' - 'cover' - 'avatarDataUrl' - 'storedFile'/, "il pull dell'agente remoto non lo dà");
  assert.match(agent, /array\['dataUrl', 'cover', 'avatarDataUrl', 'storedFile'\]/, "il push lo rimette dalla riga attuale");
  assert.match(read("supabase/agent-verify.sql"), /as stored_file_kept_ready/);
});

test("agenti: un materiale con file esce senza byte, percorso o segno del file", () => {
  const out = publicAttachment({
    id: "a1",
    name: "dispense.pdf",
    mimeType: "application/pdf",
    size: 10,
    addedAt: "2026-11-12T00:00:00.000Z",
    description: "",
    updatedAt: "2026-11-12T00:00:00.000Z",
    storedFile: "cloud",
    dataUrl: "data:application/pdf;base64,SEGRETO"
  });
  const packed = JSON.stringify(out);
  assert.equal(packed.includes("storedFile"), false);
  assert.equal(packed.includes("SEGRETO"), false);
  assert.equal(packed.includes(FILES_BUCKET), false);
});

// ─── Bundle, database locale, SQL, viste ─────────────────────────────────────

const sourceFiles = (dir) =>
  readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(new URL(`../${path}`, import.meta.url)).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

test("attachmentSync (supabase-js) arriva solo con import(); i moduli del bundle iniziale non lo importano", () => {
  const dynamic = [];
  for (const path of sourceFiles("src")) {
    const source = read(path);
    assert.doesNotMatch(source, /from "\.{1,2}\/(?:lib\/)?attachmentSync"/, path);
    if (/import\("\.{1,2}\/(?:lib\/)?attachmentSync"\)/.test(source)) dynamic.push(path);
  }
  assert.deepEqual(dynamic.sort(), ["src/App.tsx", "src/components/MaterialFile.tsx", "src/components/SharedItemDrawer.tsx", "src/views/SettingsView.tsx"]);
  for (const path of ["src/lib/attachments.ts", "src/lib/attachmentFiles.ts", "src/lib/attachmentStatus.ts", "src/components/MaterialFile.tsx"]) {
    assert.doesNotMatch(read(path), /from "\.{1,2}\/(?:lib\/)?(?:supabase|cloudSync|shareSync|groupSync)"/, path);
  }
  assert.match(read("src/App.tsx"), /if \(cloudConfigured\) void import\("\.\/lib\/attachmentSync"\)\.then\(\(module\) => module\.initAttachmentSync\(\)\)/);
});

test("Dexie v7: copie locali separate (metadati, byte, eliminazioni in coda)", () => {
  const source = read("src/lib/db.ts");
  assert.match(source, /this\.version\(7\)\.stores\(\{\s*attachmentFiles: "id, pending, usedAt",\s*attachmentBytes: "id",\s*attachmentDeletes: "id"\s*\}\)/);
});

test("vault: i byte locali si cifrano e, prima di togliere il vault, si decifrano", () => {
  const store = read("src/store/useStudyStore.ts");
  const disable = store.slice(store.indexOf("disableVault: async"));
  assert.ok(disable.indexOf("unsealLocalFiles(") > 0, "decifrati");
  assert.ok(disable.indexOf("unsealLocalFiles(") < disable.indexOf("db.vault.clear()"), "prima di togliere il vault");
  assert.match(store.slice(store.indexOf("enableVault: async")), /sealLocalFiles\(/);
  assert.match(store.slice(store.indexOf("unlockVault: async")), /sealLocalFiles\(/);
  const files = read("src/lib/attachmentFiles.ts");
  assert.match(files, /encryptBytesWithKey/);
  assert.match(files, /decryptBytesWithKey/);
});

test("verify.sql: pronto dello spazio file (bucket, lettura, 4 policy), anche senza lo schema storage", () => {
  const verify = read("supabase/verify.sql");
  assert.match(verify, /as files_bucket_ready/);
  assert.match(verify, /as file_policies/);
  assert.match(verify, /as file_read_ready/);
  assert.match(verify, /to_regclass\('storage\.buckets'\) is null then false/);
  const storage = read("supabase/storage.sql");
  for (const policy of ["studyos_files_select", "studyos_files_insert", "studyos_files_update", "studyos_files_delete"]) {
    assert.match(storage, new RegExp(`drop policy if exists ${policy} on storage\\.objects;`));
    assert.match(storage, new RegExp(`create policy ${policy}\\s+on storage\\.objects`));
  }
  assert.equal(storage.split("(storage.foldername(name))[1] = (select auth.uid()::text)").length - 1, 5, "ogni policy: solo la propria cartella");
  assert.match(storage, /security invoker/);
  assert.match(storage, /revoke all on function public\.studyos_can_read_file\(text\) from public, anon;/);
  assert.match(read("supabase/README.md"), /storage\.sql/);
});

test("Impostazioni: backup completo con i file, cancellazioni con i file", () => {
  const view = read("src/views/SettingsView.tsx");
  const exporting = view.slice(view.indexOf("const exportBackup"), view.indexOf("const importBackup"));
  assert.match(exporting, /withFilesForExport\(snapshot\.attachments\)/);
  assert.match(exporting, /scope === "full"/);
  const erase = view.slice(view.indexOf("const eraseData"), view.indexOf("const lockNow"));
  assert.ok(erase.indexOf("eraseAccountData()") < erase.indexOf("eraseAccountFiles()"), "prima le righe, poi i file");
  assert.ok(erase.indexOf("eraseAccountFiles()") < erase.indexOf("requestSync()"));
  assert.match(erase, /resetAllData\(\{ propagate: false, wipeFiles: true \}\)/, "senza account i file esistono solo qui");
});

// ─── Revisione, fix 1 (wave2/R-A5-findings.md) ────────────────────────────────

const syncSource = () => read("src/lib/attachmentSync.ts");
const bodyOf = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

test("H1: un materiale sparito dalla memoria non fa mai togliere l'oggetto né la copia locale", () => {
  const source = syncSource();
  const markStored = bodyOf(source, "const markStored = async", "const uploadLocal");
  assert.doesNotMatch(markStored, /removeObjects|deleteLocalFiles/, "missing: niente rimozioni");
  assert.doesNotMatch(markStored, /missing/);
  // Le uniche rimozioni di oggetti: pulizia (riga eliminata da 90 giorni) e «Cancella anche dall'account».
  const removals = [...source.matchAll(/await removeObjects\(/g)].map((match) => match.index);
  assert.equal(removals.length, 2);
  for (const at of removals) {
    const owner = source.lastIndexOf("const ", at);
    assert.match(source.slice(owner, owner + 40), /const (doomed|cleanupObjects|runPendingErase)/);
  }
  assert.ok(bodyOf(source, "const cleanupObjects", "const runPendingErase").includes('objectFate(states.get(id), now) === "remove"'));
});

test("H1: svuotamento del dispositivo durante un caricamento: controllo prima di ogni scrittura", () => {
  const source = syncSource();
  const pass = bodyOf(source, "const pass = async", "let running");
  assert.match(pass, /const guard = localResetGuard\(\);/);
  assert.match(pass, /guard\(\);/);
  assert.ok(pass.indexOf("pulledFor(uid)") < pass.indexOf("planFileWork("), "primo pull prima del piano");
  assert.ok(pass.indexOf("runPendingErase(uid).catch(") >= 0, "uno svuotamento dell'account che fallisce non ferma la passata");
  assert.match(bodyOf(source, "const uploadLocal = async", "const migrateEmbedded"), /markUploaded\(id, uid, check\)/);
  assert.match(bodyOf(source, "const migrateEmbedded = async", "const checkOrphans"), /await uploadObject\(objectPath\(uid, id\), bytes, type\);\s*check\(\);/);
  assert.match(bodyOf(source, "const checkOrphans = async", "const cleanupObjects"), /deleteLocalFiles\(\[id\], check\)/);
  assert.match(pass, /deleteLocalFiles\(plan\.dropCache, check\)/);
  // Dentro la transazione della copia locale.
  const files = read("src/lib/attachmentFiles.ts");
  assert.match(bodyOf(files, "export const markUploaded", "export const deleteLocalFiles"), /assertNotHalted\(\);\s*check\?\.\(\);/);
  assert.match(bodyOf(files, "export const deleteLocalFiles", "export const forgetMaterialFile"), /assertNotHalted\(\);\s*check\?\.\(\);/);
  // Errori che fermano la passata intera (non contano come errore del file).
  assert.match(source, /const stopsPass = \(error: unknown\) => error instanceof SessionChangedError \|\| error instanceof LocalResetError;/);
});

test("M1: riscrittura in sottofondo con il timbro della riga più 1 ms, mai «adesso»", () => {
  assert.equal(backgroundStamp("2026-11-12T08:00:00.000Z", Date.parse("2026-12-01T00:00:00.000Z")), "2026-11-12T08:00:00.001Z");
  assert.equal(backgroundStamp(undefined, Date.parse("2026-12-01T00:00:00.000Z")), "2026-12-01T00:00:00.000Z");
  assert.equal(backgroundStamp("non una data", 0), new Date(0).toISOString());
  const material = { id: "a", name: "x.pdf", storedFile: "local", updatedAt: "2026-11-12T08:00:00.000Z" };
  assert.equal(withStoredFile(material, undefined, Date.parse("2026-12-01T00:00:00.000Z")).updatedAt, "2026-11-12T08:00:00.001Z");
  // Una modifica vera fatta dopo (anche di 1 ms) resta più recente.
  assert.ok(Date.parse("2026-11-12T08:00:00.002Z") > Date.parse(withStoredFile(material).updatedAt));
});

test("M1: niente riscritture prima del primo pull della sessione per l'account", () => {
  const uid = UID;
  assert.equal(pullTransition(null, { uid, status: "idle", lastSync: "2026-11-01T00:00:00.000Z" }), "none", "lastSync di una sessione di prima: non conta");
  const started = { uid, lastSync: "2026-11-01T00:00:00.000Z" };
  assert.equal(pullTransition(null, { uid, status: "syncing", lastSync: started.lastSync }), "start");
  assert.equal(pullTransition(started, { uid, status: "syncing", lastSync: started.lastSync }), "none");
  assert.equal(pullTransition(started, { uid, status: "idle", lastSync: "2026-11-12T09:00:00.000Z" }), "pulled");
  assert.equal(pullTransition(started, { uid, status: "idle", lastSync: started.lastSync }), "end", "dispositivo svuotato a metà: lastSync uguale");
  assert.equal(pullTransition(started, { uid, status: "error", lastSync: started.lastSync }), "end");
  assert.equal(pullTransition(started, { uid: "altro", status: "idle", lastSync: "2026-11-12T09:00:00.000Z" }), "end", "account cambiato");
  assert.equal(pullTransition(started, { uid: null, status: "idle", lastSync: null }), "end");
  const source = syncSource();
  const open = bodyOf(source, "export const openMaterialFile", "export const downloadMaterialFile");
  assert.match(open, /pulledFor\(uid\)/, "anche la correzione all'apertura aspetta il primo pull");
  assert.match(source, /pulled = \{ uid, guard: syncStart\.guard \}/, "il controllo dello svuotamento parte dall'inizio della sync");
});

test("M2: il server non riporta «local» su una riga viva già «cloud» (push e connettore remoto)", () => {
  const schema = read("supabase/schema.sql");
  const push = bodyOf(schema, "create or replace function public.push_studyos_rows", "$$;");
  assert.ok(push.indexOf("v_payload->>'storedFile' = 'local'") > 0);
  assert.ok(push.indexOf("jsonb_set(v_payload, '{storedFile}', '\"cloud\"')") < push.indexOf("insert into public.studyos_items"), "prima dell'insert");
  assert.match(push, /and not s\.deleted and s\.payload->>'storedFile' = 'cloud'/);
  const agent = read("supabase/agent.sql");
  const loop = bodyOf(agent, "foreach v_key in array array['dataUrl', 'cover', 'avatarDataUrl', 'storedFile'] loop", "end loop;");
  assert.match(loop, /elsif v_key = 'storedFile' and v_payload->>v_key = 'local' and v_current->>v_key = 'cloud'/);
  assert.match(loop, /not coalesce\(v_current_deleted, false\)/);
  assert.match(read("supabase/verify.sql"), /as stored_file_guard_ready/);
});

test("M2 e L4: chi riceve prova a scaricare anche un file «local», con un nome sicuro", () => {
  const drawer = read("src/components/SharedItemDrawer.tsx");
  assert.match(drawer, /\{storedFile \? \(/);
  assert.doesNotMatch(drawer, /storedFile === "local" \? <p/);
  assert.match(drawer, /notUploadedYet: storedFile === "local"/);
  assert.match(drawer, /download=\{sharedDownloadName\(/);
  const shared = bodyOf(syncSource(), "export const downloadSharedFile", "// ─── Cancellazione");
  assert.match(shared, /item\.notUploadedYet \? FILE_TEXT\.sharedNotUploaded : FILE_TEXT\.sharedGone/);
  assert.match(shared, /sharedDownloadName\(item\.name\)/);
  assert.match(shared, /allowedMime\(name, undefined\) \?\? FALLBACK_MIME/, "tipo dal nome sicuro, mai quello dichiarato");
  assert.equal(sharedDownloadName("dispense.pdf"), "dispense.pdf");
  assert.equal(sharedDownloadName("foto.JPG"), "foto.JPG");
  assert.equal(sharedDownloadName("pagina.html"), "pagina.html.bin");
  assert.equal(sharedDownloadName("setup.exe"), "setup.exe.bin");
  assert.equal(sharedDownloadName("../../x.svg"), "_.._x.svg.bin");
  assert.ok(sharedDownloadName("a".repeat(300) + ".exe").length <= 120);
  assert.match(sharedDownloadName("a".repeat(300) + ".exe"), /\.bin$/);
});

test("M3: copia scritta mentre il vault cambia: si sistema; illeggibile: cache via, da caricare segnalata", () => {
  const known = new Set(["old"]);
  assert.equal(sealingAction(undefined, { mode: false }, known), "ok");
  assert.equal(sealingAction(undefined, { mode: true, salt: "now" }, known), "seal");
  assert.equal(sealingAction(undefined, { mode: true }, known), "ok", "bloccato: in chiaro si cifra allo sblocco");
  assert.equal(sealingAction("now", { mode: true, salt: "now" }, known), "ok");
  assert.equal(sealingAction("now", { mode: true }, known), "locked");
  assert.equal(sealingAction("old", { mode: false }, known), "rewrite", "vault tolto durante la scrittura");
  assert.equal(sealingAction("old", { mode: true, salt: "now" }, known), "rewrite", "vault rifatto con un'altra password");
  assert.equal(sealingAction("lost", { mode: false }, known), "lost");
  const files = read("src/lib/attachmentFiles.ts");
  const save = bodyOf(files, "export const saveLocalFile", "const dropUnreadable");
  assert.match(save, /vaultChangedSince\(written\)/, "dopo la scrittura si ricontrolla il vault");
  assert.match(save, /rewritePlain\(id, bytes, written\)/);
  const reader = bodyOf(files, "export const readLocalBytes", "export const touchLocalFile");
  assert.match(reader, /return dropUnreadable\(row\)/);
  assert.match(bodyOf(files, "const dropUnreadable", "export const readLocalBytes"), /if \(row\.pending\) throw new FileUnreadableError\(\);/);
  // Le chiavi tenute in memoria si dimenticano al blocco del vault.
  assert.match(files, /if \(state\.locked && !previous\.locked\) knownKeys\.clear\(\);/);
  assert.match(files, /if \(current\.mode && !current\.key\) knownKeys\.clear\(\);/);
  const source = syncSource();
  assert.match(bodyOf(source, "const pass = async", "let running"), /reconcileLocalSealing\(\)/);
  const open = bodyOf(source, "export const openMaterialFile", "export const downloadMaterialFile");
  assert.match(open, /unreadable = error instanceof FileUnreadableError;/, "copia illeggibile: si prova dall'account");
  assert.match(source, /error instanceof FileUnreadableError\s*\? FILE_TEXT\.unreadable/);
  assert.ok(FILE_TEXT.unreadable.length > 20);
  // Lo store resta com'era (lo cambia la sync del vault).
  assert.doesNotMatch(read("src/store/useStudyStore.ts"), /reconcileLocalSealing/);
});

test("M4: file nella copia di sicurezza entro 100 MB, senza cache; senza file se non si riesce", () => {
  assert.equal(BACKUP_FILES_LIMIT_BYTES, 100 * 1024 * 1024);
  const mb = 1024 * 1024;
  const plan = planBackupFiles(
    [
      { id: "a", size: 40 * mb, storedFile: "cloud" },
      { id: "link", size: 0 },
      { id: "b", size: 50 * mb, storedFile: "local" },
      { id: "c", size: 20 * mb, storedFile: "cloud" },
      { id: "d", size: 10 * mb, storedFile: "cloud" }
    ],
    BACKUP_FILES_LIMIT_BYTES
  );
  assert.deepEqual(plan, { include: ["a", "b", "d"], overLimit: ["c"] });
  const source = syncSource();
  const exporting = bodyOf(source, "export const withFilesForExport", "\n};\n");
  assert.match(exporting, /openMaterialFile\(material, \{ cache: false \}\)/);
  assert.match(exporting, /if \(total \+ blob\.size > limit\)/, "conta la dimensione vera");
  assert.match(bodyOf(source, "export const openMaterialFile", "export const downloadMaterialFile"), /options\.cache !== false/);
  const view = read("src/views/SettingsView.tsx");
  const exportView = bodyOf(view, "const exportBackup", "const importBackup");
  assert.match(exportView, /filesLeftOut = true;/);
  assert.match(exportView, /await save\(plainAttachments\);/, "copia senza file se quella con i file non si crea");
  assert.match(exportView, /SETTINGS_TEXT\.backup\.filesOverLimit\(overLimitFiles\)/);
  assert.match(exportView, /SETTINGS_TEXT\.backup\.filesLeftOut/);
});

test("L1 e L2: oggetti e copie si tolgono solo con la riga eliminata da almeno 90 giorni", () => {
  const now = Date.parse("2026-11-12T00:00:00.000Z");
  const day = 24 * 60 * 60_000;
  assert.equal(FILE_RETENTION_MS, 90 * day);
  const ago = (days) => new Date(now - days * day).toISOString();
  assert.equal(objectFate(null, now), "keep", "riga assente: forse non ancora inviata");
  assert.equal(objectFate(undefined, now), "keep");
  assert.equal(objectFate({ deleted: false, updatedAt: ago(400) }, now), "keep", "riga viva");
  assert.equal(objectFate({ deleted: true, updatedAt: ago(10) }, now), "keep", "si può ancora ripristinare");
  assert.equal(objectFate({ deleted: true, updatedAt: ago(91) }, now), "remove");
  assert.equal(objectFate({ deleted: true, updatedAt: ago(91), deletedAt: ago(5) }, now), "keep", "conta la più recente");
  assert.equal(objectFate({ deleted: true, updatedAt: null, deletedAt: null }, now), "keep", "senza ora: resta");
  assert.equal(orphanCopyFate(null, now), "keep");
  assert.equal(orphanCopyFate({ deleted: false }, now), "keep");
  assert.equal(orphanCopyFate({ deleted: true, updatedAt: ago(3) }, now), "upload", "prima si carica, poi si toglie da qui");
  assert.equal(orphanCopyFate({ deleted: true, updatedAt: ago(120) }, now), "drop");
  const source = syncSource();
  const cleanup = bodyOf(source, "const cleanupObjects", "const runPendingErase");
  assert.match(cleanup, /CLEANUP_EVERY_MS/);
  assert.match(cleanup, /!again\.has\(id\)/, "un materiale tornato intanto resta");
  assert.match(cleanup, /setMeta\(cleanupKey\(uid\)/);
  // Lo stato delle righe: un errore lancia, mai «nessuna riga».
  assert.match(bodyOf(source, "const rowStates", "// ─── Primo pull"), /if \(error\) throw new Error\(error\.message\);/);
  const orphans = bodyOf(source, "const checkOrphans", "const cleanupObjects");
  assert.ok(orphans.indexOf("uploadObject(") < orphans.indexOf("deleteLocalFiles("), "carica prima di togliere");
});

test("L3: la richiesta di svuotare i file dell'account si salva prima di caricare il modulo; un errore non blocca", () => {
  const view = read("src/views/SettingsView.tsx");
  const erase = bodyOf(view, "const eraseData", "const lockNow");
  assert.ok(erase.indexOf("requestAccountFilesErase(uid)") > 0);
  assert.ok(erase.indexOf("requestAccountFilesErase(uid)") < erase.indexOf('import("../lib/attachmentSync")'));
  assert.match(view, /import \{ requestAccountFilesErase \} from "\.\.\/lib\/attachmentFiles";/);
  const files = read("src/lib/attachmentFiles.ts");
  assert.match(files, /export const fileEraseKey = \(uid: string\) => `files:erase:\$\{uid\}`;/);
  const source = syncSource();
  assert.doesNotMatch(source, /const eraseKey/, "una sola chiave, quella di attachmentFiles");
  assert.match(source, /getMeta<string>\(fileEraseKey\(uid\)\)/);
});

test("L5: uscendo con la password dell'app, i file non ancora caricati si eliminano solo con il consenso", () => {
  const panel = read("src/components/CloudPanel.tsx");
  const leave = bodyOf(panel, "const leaveRemovingData", "const handleForcePull");
  assert.ok(leave.indexOf("pendingFilesLeftPlain()") > 0);
  assert.ok(leave.indexOf("window.confirm(FILE_TEXT.leavePendingAsk(") < leave.indexOf("turnOffPushHere()"), "prima di uscire");
  assert.match(leave, /if \(!window\.confirm\(FILE_TEXT\.leavePendingAsk\(plainLeft\.length\)\)\) return;/, "Annulla: resta collegato");
  assert.match(leave, /await deleteLocalFiles\(plainLeft\);/);
  const files = read("src/lib/attachmentFiles.ts");
  assert.match(bodyOf(files, "export const pendingFilesLeftPlain", "export const markUploaded"), /if \(!mode \|\| !key\) return \[\];/);
  assert.match(FILE_TEXT.leavePendingAsk(1), /Un file/);
  assert.match(FILE_TEXT.leavePendingAsk(3), /3 file/);
});

