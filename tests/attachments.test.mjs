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
  withStoredFile
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
  const disable = store.slice(store.indexOf("const removeVault = async"));
  assert.ok(disable.indexOf("unsealLocalFiles(") > 0, "decifrati");
  assert.ok(disable.indexOf("unsealLocalFiles(") < disable.indexOf("db.vault.clear()"), "prima di togliere il vault");
  assert.match(store.slice(store.indexOf("enableVault: (")), /sealLocalFiles\(/);
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
