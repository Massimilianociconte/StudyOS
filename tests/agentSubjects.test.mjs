// Materie e agenti: niente doppioni anche se l'agente non cerca prima (la regola è nello strumento, non
// solo nella descrizione), stesse regole dei campi dell'app, unione dei doppioni già salvati.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { findAgentTool } from "../src/agent/catalog.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { catalogLinkChoice, catalogLinkPatch } from "../src/lib/catalogLink.ts";

const base = { createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", archived: false, tags: [] };
const subject = (id, name, teacher = "", extra = {}) => ({ ...base, id, name, teacher, cfu: 6, semester: "", status: "active", color: "#336699", icon: "BookOpen", notes: "", ...extra });

const ANAT_COURSE = "barb-26-27-anatomia-dell-uomo";
const FISIO_COURSE = "barb-26-27-principi-di-fisiologia";

const seed = (subjects) => {
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects,
    exams: [],
    topics: [],
    tasks: [{ ...base, id: "k1", title: "Quiz", subjectId: "anat-agent", status: "todo" }],
    events: [],
    sessions: [],
    attachments: [],
    goals: [],
    notes: [],
    reminders: [],
    examPlans: []
  });
  useSharedStore.setState({ given: [] });
};

beforeEach(() =>
  seed([
    subject("anat-barb", "Anatomia dell'uomo", "Cappelletti Graziella", { universityCourseId: ANAT_COURSE, icon: `barb:${ANAT_COURSE}` }),
    subject("pat", "Patologia", "Gandellini Paolo")
  ])
);

test("crea materia: doppione certo rifiutato con l'id da usare, niente creato", async () => {
  const result = await executeAgentTool("studyos_create_subject", { name: "  anatomia DELL'UOMO " });
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict");
  assert.equal(result.data.reason, "duplicate");
  assert.equal(result.data.existing.id, "anat-barb");
  assert.equal(result.data.existing.linkedToCatalog, true);
  assert.equal(useStudyStore.getState().subjects.length, 2);
});

test("crea materia: probabile doppione fermo finché la persona non conferma che è diversa", async () => {
  const similar = await executeAgentTool("studyos_create_subject", { name: "Anatomia Umana", teacher: "Graziella Cappelletti" });
  assert.equal(similar.code, "conflict");
  assert.equal(similar.data.reason, "similar");
  assert.deepEqual(similar.data.candidates.map((item) => item.id), ["anat-barb"]);
  assert.equal(useStudyStore.getState().subjects.length, 2);
  // Anche senza docente: «umana» = «dell'uomo».
  assert.equal((await executeAgentTool("studyos_create_subject", { name: "Anatomia umana" })).data.reason, "similar");
  const confirmed = await executeAgentTool("studyos_create_subject", { name: "Anatomia Umana", confirmDistinct: true });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.data.similar.map((item) => item.id), ["anat-barb"]);
  const created = useStudyStore.getState().subjects.find((item) => item.id === confirmed.data.id);
  assert.equal(created.cfu, 6, "CFU come l'app, non 0");
});

test("crea materia: una somiglianza leggera non blocca ma si vede; i campi seguono le regole dell'app", async () => {
  const result = await executeAgentTool("studyos_create_subject", { name: "Patologia molecolare", teacher: "Rossi Mario", icon: "Microscope", semesterOverride: "primo" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.similar.map((item) => item.id), ["pat"]);
  const created = useStudyStore.getState().subjects.find((item) => item.id === result.data.id);
  assert.equal(created.icon, "Microscope");
  assert.equal(created.semesterOverride, "primo");
  assert.equal((await executeAgentTool("studyos_create_subject", { name: "Istologia", color: "rosso" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_create_subject", { name: "   " })).code, "invalid");
});

test("aggiorna materia: rinominare come un'altra è un doppione; l'icona vuota resta quella", async () => {
  const clash = await executeAgentTool("studyos_update_subject", { id: "pat", name: "Anatomia dell'Uomo" });
  assert.equal(clash.code, "conflict");
  assert.equal(clash.data.reason, "duplicate");
  assert.equal(clash.data.existing.id, "anat-barb");
  assert.equal(useStudyStore.getState().subjects.find((item) => item.id === "pat").name, "Patologia");
  assert.equal((await executeAgentTool("studyos_update_subject", { id: "pat", icon: "" })).ok, true);
  assert.equal(useStudyStore.getState().subjects.find((item) => item.id === "pat").icon, "BookOpen");
  assert.equal((await executeAgentTool("studyos_update_subject", { id: "pat", targetGrade: 31 })).ok, true, "30 e lode come nell'app");
  assert.equal((await executeAgentTool("studyos_update_subject", { id: "pat", cfu: 99 })).code, "invalid");
});

test("unisci materie: distruttivo, con conferma; tutto passa a quella che resta", async () => {
  const tool = findAgentTool("studyos_merge_subjects");
  assert.equal(tool.risk, "destructive");
  seed([
    subject("anat-barb", "Anatomia dell'uomo", "Cappelletti Graziella", { universityCourseId: ANAT_COURSE }),
    subject("anat-agent", "Anatomia Umana", "Graziella Cappelletti", { cfu: 0 })
  ]);
  const merged = await executeAgentTool("studyos_merge_subjects", { keepId: "anat-barb", dropId: "anat-agent", confirm: true });
  assert.equal(merged.ok, true);
  assert.equal(merged.data.moved.tasks, 1);
  const after = useStudyStore.getState();
  assert.deepEqual(after.subjects.map((item) => item.id), ["anat-barb"]);
  assert.equal(after.tasks[0].subjectId, "anat-barb");
  assert.equal((await executeAgentTool("studyos_merge_subjects", { keepId: "anat-barb", dropId: "anat-agent", confirm: true })).code, "not_found");
});

test("insegnamenti BARB: collega la materia con lo stesso nome, chiede per quella simile", async () => {
  seed([
    subject("fisio", "Principi di Fisiologia", "Mirko Baruscotti", { cfu: 0 }),
    subject("anat", "Anatomia umana", "Graziella Cappelletti", { notes: "Mie note" })
  ]);
  const first = await executeAgentTool("studyos_add_barb_courses", { ids: [FISIO_COURSE, ANAT_COURSE] });
  assert.equal(first.ok, true);
  assert.deepEqual(first.data.added, []);
  assert.deepEqual(first.data.linked.map((item) => [item.courseId, item.subjectId]), [[FISIO_COURSE, "fisio"]]);
  assert.deepEqual(first.data.needsChoice.map((item) => [item.courseId, item.candidates.map((c) => c.id)]), [[ANAT_COURSE, ["anat"]]]);
  let subjects = useStudyStore.getState().subjects;
  const fisio = subjects.find((item) => item.id === "fisio");
  assert.equal(fisio.universityCourseId, FISIO_COURSE);
  assert.equal(fisio.cfu, 6, "CFU mancanti presi dal catalogo");
  assert.equal(fisio.name, "Principi di Fisiologia", "il nome della persona resta");
  assert.equal(subjects.length, 2);
  // La persona dice che è la stessa: si collega quella.
  const second = await executeAgentTool("studyos_add_barb_courses", { links: [{ courseId: ANAT_COURSE, subjectId: "anat" }] });
  assert.deepEqual(second.data.linked.map((item) => item.subjectId), ["anat"]);
  subjects = useStudyStore.getState().subjects;
  const anat = subjects.find((item) => item.id === "anat");
  assert.equal(anat.universityCourseId, ANAT_COURSE);
  assert.ok(anat.notes.startsWith("Mie note"));
  assert.equal(subjects.length, 2);
  // Ora è collegata: un'altra richiesta la salta.
  assert.deepEqual((await executeAgentTool("studyos_add_barb_courses", { ids: [ANAT_COURSE] })).data.skipped, [ANAT_COURSE]);
});

test("insegnamenti BARB: «new» crea comunque una materia nuova", async () => {
  seed([subject("anat", "Anatomia umana", "Graziella Cappelletti")]);
  const result = await executeAgentTool("studyos_add_barb_courses", { links: [{ courseId: ANAT_COURSE, subjectId: "new" }] });
  assert.equal(result.data.added.length, 1);
  assert.equal(useStudyStore.getState().subjects.length, 2);
});

test("collegamento al catalogo: due materie con lo stesso nome non si scelgono da sole; i campi della persona restano", () => {
  const twins = [subject("a", "Genetica"), subject("b", "genetica")];
  assert.equal(catalogLinkChoice({ name: "Genetica" }, twins).kind, "choose");
  assert.equal(catalogLinkChoice({ name: "Genetica" }, [subject("a", "Genetica", "", { universityCourseId: "c9" })]).kind, "new");
  const patch = catalogLinkPatch(subject("a", "Genetica", "Rossi", { cfu: 9, icon: "Dna", semester: "Primo", notes: "Scheda ufficiale: x" }), {
    universityCourseId: "c1",
    teacher: "Bianchi",
    cfu: 6,
    semester: "secondo",
    icon: "barb:c1",
    color: "#000000",
    tags: ["barb"],
    notes: "Scheda ufficiale: x\nAriel: y"
  });
  assert.deepEqual(patch, { universityCourseId: "c1", teacher: "Rossi", cfu: 9, semester: "Primo", icon: "Dna", tags: ["barb"], notes: "Scheda ufficiale: x\n\nAriel: y" });
});
