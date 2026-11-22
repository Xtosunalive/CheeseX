// WP-209（SPEC-100 批 3）：个体存储投影测试。
// 层级：单元（DDL 派生）＋真实集成（:memory: 库真 DDL/DML＋temp vault 文件扫描重建）＋双轮删库门禁。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const { openPersistenceDb } = require("../../shared/persistence/sqlite-adapter.cjs");
const { createIndividualProjectionService, sanitizeIdent } = require("../ontology/individual-projection-service.cjs");
const { createIndividualCrudService } = require("../ontology/individual-crud-service.cjs");
const { initVaultIO, resetVaultIO } = require("../../shared/vault-io.cjs");

const BINDINGS = (extra = {}) => (classId) => ({
  class_id: classId,
  data_properties: {
    question: { binding: { required: true }, type: "text" },
    weight: { type: "integer", ...(extra.weight || {}) },
    ...Object.fromEntries(Object.entries(extra.fields || {}).map(([k, v]) => [k, { type: v }])),
  },
});

function makeService({ extraBindings = {}, vaultPath } = {}) {
  const db = openPersistenceDb({ path: ":memory:" });
  const service = createIndividualProjectionService({
    vaultPath: vaultPath || fs.mkdtempSync(path.join(os.tmpdir(), "wp209-proj-")),
    db,
    logger: null,
    bindingsResolver: BINDINGS(extraBindings),
  });
  return { db, service };
}

test("DDL 派生：列＝storageFields 派生（类型映射 NUMERIC）＋基建列＋索引；标识符净化", () => {
  const { db, service } = makeService();
  const { table, columns } = service.ensureSchema("FaqCard");
  assert.equal(table, "individuals_FaqCard");
  const names = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  for (const base of ["individual_id", "title", "lifecycle_status", "created", "updated", "fields_json"]) {
    assert.ok(names.includes(base), `基建列 ${base}`);
  }
  assert.ok(names.includes("f_question"), "字段列 f_question");
  assert.ok(names.includes("f_weight"), "字段列 f_weight");
  const weightType = db.prepare(`PRAGMA table_info(${table})`).all().find((r) => r.name === "f_weight").type;
  assert.equal(weightType, "NUMERIC", "integer→NUMERIC 映射");
  assert.deepEqual(columns, ["f_question", "f_weight"]);
  assert.equal(sanitizeIdent("custom field-x"), "custom_field_x", "空格/连字符净化");
});

test("upsert／retire 同步：行如实反映个体状态", () => {
  const { db, service } = makeService();
  const fm = { individual_id: "faq-1", title: "问题一", lifecycle_status: "active", created: "t0", updated: "t1", question: "什么是投影？", weight: 3 };
  service.upsert("FaqCard", fm);
  let row = db.prepare("SELECT * FROM individuals_FaqCard WHERE individual_id = ?").get("faq-1");
  assert.equal(row.lifecycle_status, "active");
  assert.equal(row.f_question, "什么是投影？");
  assert.equal(row.f_weight, 3);
  assert.equal(JSON.parse(row.fields_json).question, "什么是投影？", "fields_json 无损");
  service.markRetired("FaqCard", "faq-1", "t2");
  row = db.prepare("SELECT * FROM individuals_FaqCard WHERE individual_id = ?").get("faq-1");
  assert.equal(row.lifecycle_status, "retired");
});

test("新字段加列（ALTER ADD COLUMN）——类绑定演进自动跟表", () => {
  const { db, service } = makeService();
  service.ensureSchema("FaqCard");
  const withAnswer = makeService({ extraBindings: { fields: { answer: "text" } }, vaultPath: undefined });
  // 同库同服务换绑定源：直接以第二绑定闭包重跑 ensureSchema
  const resolved = BINDINGS({ fields: { answer: "text" } })("FaqCard");
  const service2 = createIndividualProjectionService({
    vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "wp209-proj2-")),
    db,
    logger: null,
    bindingsResolver: () => resolved,
  });
  const { columns } = service2.ensureSchema("FaqCard");
  assert.ok(columns.includes("f_answer"), "新字段列已加");
  const names = db.prepare("PRAGMA table_info(individuals_FaqCard)").all().map((r) => r.name);
  assert.ok(names.includes("f_answer"));
  void withAnswer;
});

test("双轮删库重建：DELETE 全表后 rebuildAll 两轮均完整恢复＋幽灵行剪除", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp209-rebuild-"));
  initVaultIO({ vaultPath, gitLedger: { scheduleLedger() {} } });
  const crud = createIndividualCrudService({ vaultPath, logger: null, loadFields: () => ({}) });
  crud.setBindingsResolver(BINDINGS());
  const { db, service } = { db: openPersistenceDb({ path: ":memory:" }), service: null };
  const proj = createIndividualProjectionService({ vaultPath, db, logger: null, bindingsResolver: BINDINGS() });
  crud.setProjectionPort(proj);
  const a = crud.create({ classId: "FaqCard", fields: { question: "q1", weight: 1 } });
  crud.create({ classId: "FaqCard", fields: { question: "q2", weight: 2 } });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM individuals_FaqCard").get().c, 2, "CRUD 同步两行");

  for (let round = 1; round <= 2; round += 1) {
    db.exec("DELETE FROM individuals_FaqCard"); // 删库（投影可丢弃）
    const out = proj.rebuildAll();
    assert.equal(out.rows, 2, `第 ${round} 轮重建恢复 2 行`);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM individuals_FaqCard").get().c, 2);
  }
  // 幽灵剪除：文件删除后重建即剪行
  fs.rmSync(path.join(vaultPath, "知识库", "wiki", "individuals", "FaqCard", `${a.individualId}.md`));
  proj.rebuildAll();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM individuals_FaqCard").get().c, 1, "幽灵行已剪");
  resetVaultIO();
});

test("fail-open：投影端口抛错不阻断个体主写（破坏实验）", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp209-failopen-"));
  initVaultIO({ vaultPath, gitLedger: { scheduleLedger() {} } });
  const crud = createIndividualCrudService({ vaultPath, logger: null, loadFields: () => ({}) });
  crud.setBindingsResolver(BINDINGS());
  crud.setProjectionPort({ upsert: () => { throw new Error("投影炸了"); }, markRetired: () => { throw new Error("投影炸了"); } });
  const created = crud.create({ classId: "FaqCard", fields: { question: "主写仍成功" } });
  assert.ok(fs.existsSync(path.join(vaultPath, created.path)), "markdown 主写不受投影故障影响");
  resetVaultIO();
});

test("temp vault 真链路：CRUD 经投影端口落行（引擎→端口→DDL→DML）", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp209-e2e-"));
  initVaultIO({ vaultPath, gitLedger: { scheduleLedger() {} } });
  const crud = createIndividualCrudService({ vaultPath, logger: null, loadFields: () => ({}) });
  crud.setBindingsResolver(BINDINGS());
  const db = openPersistenceDb({ path: ":memory:" });
  const proj = createIndividualProjectionService({ vaultPath, db, logger: null, bindingsResolver: BINDINGS() });
  crud.setProjectionPort(proj);
  const created = crud.create({ classId: "FaqCard", fields: { question: "真链路", weight: 9 } });
  const row = db.prepare("SELECT * FROM individuals_FaqCard WHERE individual_id = ?").get(created.individualId);
  assert.ok(row, "投影行在案");
  assert.equal(row.f_question, "真链路");
  resetVaultIO();
});

test("合法类名净化碰撞时投影行保持各自归属，旧常见表名保持兼容", () => {
  const { db, service } = makeService();
  const classes = ["FaqCard", "Foo-Bar", "Foo_Bar", "_Foo", "Foo", "foo", "A".repeat(70), "A".repeat(69) + "B"];
  for (const classId of classes) {
    service.upsert(classId, { class_id: classId, individual_id: "same", title: classId, question: classId });
  }
  assert.equal(service.tableName("FaqCard"), "individuals_FaqCard");
  assert.equal(new Set(classes.map((id) => service.tableName(id).toLowerCase())).size, classes.length);
  for (const classId of classes) {
    const row = db.prepare(`SELECT title FROM ${service.tableName(classId)} WHERE individual_id = ?`).get("same");
    assert.equal(row.title, classId);
  }
  db.close();
});

test("连字符类双轮完整重建仍保留真表，目录删除才剪除投影", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp209-hyphen-"));
  const classes = ["Only-Hyphen", "Foo-Bar", "Foo_Bar", "_Foo", "Foo"];
  for (const classId of classes) {
    const dir = path.join(vaultPath, "知识库/wiki/individuals", classId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "same.md"), `---\n${YAML.stringify({ class_id: classId, individual_id: "same", question: classId })}---\n`);
  }
  for (let round = 0; round < 2; round += 1) {
    const { db, service } = makeService({ vaultPath });
    assert.equal(service.rebuildAll().rows, classes.length);
    assert.equal(service.rebuildAll().rows, classes.length);
    for (const classId of classes) {
      assert.equal(db.prepare(`SELECT f_question FROM ${service.tableName(classId)}`).get().f_question, classId);
    }
    const dir = path.join(vaultPath, "知识库/wiki/individuals/Only-Hyphen");
    const moved = path.join(vaultPath, "kept-hyphen");
    fs.renameSync(dir, moved);
    service.rebuildAll();
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(service.tableName("Only-Hyphen")), undefined);
    fs.renameSync(moved, dir);
    db.close();
  }
});

test("存量有行投影表按原类认领，重新装配后归属仍稳定", () => {
  const { db, service } = makeService();
  service.upsert("FaqCard", { class_id: "FaqCard", individual_id: "kept", question: "原记录" });
  db.exec("DELETE FROM individual_projection_owners");
  const resumed = createIndividualProjectionService({
    vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "wp209-adopt-")),
    db, bindingsResolver: BINDINGS(),
  });
  assert.equal(resumed.tableName("FaqCard"), "individuals_FaqCard");
  resumed.upsert("faqcard", { class_id: "faqcard", individual_id: "kept", question: "另一类" });
  assert.equal(db.prepare("SELECT f_question FROM individuals_FaqCard").get().f_question, "原记录");
  assert.notEqual(resumed.tableName("faqcard").toLowerCase(), resumed.tableName("FaqCard").toLowerCase());
  db.close();
});
