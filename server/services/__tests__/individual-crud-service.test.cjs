// WP-208（SPEC-100 批 2）：通用个体 CRUD 引擎测试。
// 层级：单元＋真实集成（临时库 initVaultIO 真写真读——文件存在/内容读回/git 即账通道同产线）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const { createIndividualCrudService } = require("../ontology/individual-crud-service.cjs");
const { initVaultIO, readVault, resetVaultIO } = require("../../shared/vault-io.cjs");

function makeEnv() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp208-individuals-"));
  initVaultIO({ vaultPath, gitLedger: { scheduleLedger() {} } }); // 测试账车 no-op（真通道同签名）
  const loadFields = () => ({
    classes: {
      article: { properties: [{ name: "title" }] },
      entity: { properties: [{ name: "question" }, { name: "faq_id" }, { name: "answer" }] },
    },
  });
  const bindings = (classId) => {
    const props = classId === "KnowledgeArticle"
      ? { title: { binding: { required: true } }, article_id: {} }
      : { question: { binding: { required: true } }, answer: {}, faq_id: {} };
    return { class_id: classId, data_properties: props };
  };
  const service = createIndividualCrudService({ vaultPath, logger: null, loadFields });
  service.setBindingsResolver(bindings);
  return { vaultPath, service, bindings };
}

test.afterEach(() => resetVaultIO());

test("create：缺必填拒 422（fail-closed）；齐备时 vault 出现个体 markdown 且 frontmatter 齐全", () => {
  const { vaultPath, service } = makeEnv();
  assert.throws(() => service.create({ classId: "FaqCard", fields: { answer: "x" } }), (e) => e.code === "INDIVIDUAL_FIELDS_INVALID", "缺必填 question 拒");
  assert.throws(() => service.create({ classId: "FaqCard", fields: { question: "q", unknownField: 1 } }), (e) => e.code === "INDIVIDUAL_FIELDS_INVALID", "白名单外字段拒");
  const out = service.create({ classId: "FaqCard", fields: { question: "什么是派生？", answer: "从本体自动生成" } });
  const abs = path.join(vaultPath, out.path);
  assert.ok(fs.existsSync(abs), "文件真实落盘");
  const fm = YAML.parse(fs.readFileSync(abs, "utf8").split("---\n")[1]);
  assert.equal(fm.class_id, "FaqCard");
  assert.equal(fm.lifecycle_status, "active");
  assert.equal(fm.question, "什么是派生？");
  assert.ok(fm.individual_id, "个体 ID 已铸造");
});

test("update：乐观锁——旧 revision 拒 409，正确 revision 过且内容更新", () => {
  const { service } = makeEnv();
  const created = service.create({ classId: "FaqCard", fields: { question: "q1", answer: "a1" } });
  assert.throws(() => service.update({ classId: "FaqCard", individualId: created.individualId, fields: { answer: "a2" }, expectedRevision: "sha256:stale" }), (e) => e.code === "INDIVIDUAL_REVISION_CONFLICT", "旧 revision 拒");
  const updated = service.update({ classId: "FaqCard", individualId: created.individualId, fields: { answer: "a2" }, expectedRevision: created.revision });
  const back = service.read("FaqCard", created.individualId);
  assert.equal(back.fields.answer, "a2");
  assert.notEqual(back.revision, created.revision);
  assert.ok(updated.revision);
});

test("retire：lifecycle_status 翻转非硬删——list 不再返回、update 拒 409、文件仍在", () => {
  const { vaultPath, service } = makeEnv();
  const created = service.create({ classId: "FaqCard", fields: { question: "q" } });
  const abs = path.join(vaultPath, created.path);
  assert.equal(service.list("FaqCard").length, 1);
  service.retire({ classId: "FaqCard", individualId: created.individualId, expectedRevision: created.revision });
  assert.ok(fs.existsSync(abs), "退役非硬删（文件仍在）");
  assert.deepEqual(service.list("FaqCard"), [], "list 不再返回退役个体");
  const current = service.read("FaqCard", created.individualId); // 先读最新 revision——过期 revision 属并发冲突（409），退役态断言用现行 revision
  assert.throws(() => service.update({ classId: "FaqCard", individualId: created.individualId, fields: { question: "x" }, expectedRevision: current.revision }), (e) => e.code === "INDIVIDUAL_RETIRED");
});

test("list：目录缺席返回空数组（空数据态合法）", () => {
  const { service } = makeEnv();
  assert.deepEqual(service.list("NeverSeen"), []);
});

test("读通道：readVault 签发的凭据与服务端 revision 同源（PR-083 同源实证）", () => {
  const { vaultPath, service } = makeEnv();
  const created = service.create({ classId: "FaqCard", fields: { question: "q" } });
  const viaReadVault = readVault(path.join(vaultPath, created.path));
  assert.equal(viaReadVault.sha256, created.revision, "contentRevision 单源");
});

// 读侧路径隔离：HTTP 解码后的类参数也必须经过与写侧相同的校验。
test("list：拒绝越界类参数，不泄露 wiki 上级 Markdown", () => {
  const { service, vaultPath } = makeEnv();
  const wiki = path.join(vaultPath, "知识库", "wiki");
  fs.mkdirSync(path.join(wiki, "individuals"), { recursive: true });
  fs.writeFileSync(path.join(wiki, "private.md"), "---\ntitle: private\n---\n");
  for (const classId of ["..", "../", "..\\", "/tmp", ""]) {
    assert.throws(() => service.list(classId), (e) => e.code === "INDIVIDUAL_CLASS_INVALID");
  }
  assert.deepEqual(service.list("FaqCard"), []);
});
