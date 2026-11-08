// Component: 字段托管+状态机全链路回归（2026-10-08 功能验收）
// @responsible: 看守「date/updated/status 系统托管只读 + status 审批状态机迁移」的端到端行为。
// @context: 指令 16:03——验收四链路：创建→灰度；confirm→verified→在线；reject→退役；reopen→灰度；非法迁移拒。
// 破坏实验语义：每条断言=注入违规必须红（测试失败），行为合规=绿。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createEntityRepairService } = require("../entity-repair-service.cjs");
const { assertTransition, isValidTransition } = require("../../../shared/status-transition-guard.cjs");
const { writeStatusByEvent } = require("../../anomaly/status-event-writer.cjs");

const RULES = {
  archLayers: ["service"], archCategories: ["服务"], statuses: ["灰度", "在线", "退役", "已驳回"],
  moduleNames: ["M"], articleTypes: [], docTypes: [], categoryPaths: [], products: [],
  versionsByProduct: {}, layerAliases: {}, categoryAliases: {}, wikilinkTypeLabels: {},
};

function setupVault(raw) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "field-custody-"));
  const dir = path.join(vault, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "node.md");
  fs.writeFileSync(file, raw, "utf8");
  const service = createEntityRepairService({ vaultPath: vault, ruleSetProvider: () => RULES });
  const sourceKey = "知识库/wiki/entities/node.md";
  const st = fs.statSync(file);
  const crypto = require("node:crypto");
  const sourceRevision = { mtimeMs: st.mtimeMs, size: st.size, contentHash: "sha256:" + crypto.createHash("sha256").update(raw).digest("hex") };
  return { vault, file, service, sourceKey, sourceRevision };
}

const BASE = "---\ntitle: Node\narchitecture-node-id: node-a\narch_component: true\nstatus: 灰度\ndate: 2026-01-01\ntags: [t]\n---\n\n# Node\n";

test("链路①：创建 → status 注入灰度 + date 首写 + 用户提交三字段被忽略", () => {
  const env = setupVault("---\n---\n\n# New\n");
  fs.unlinkSync(env.file);
  const preview = env.service.preview({
    sourceKey: env.sourceKey, createIfMissing: true, initialTitle: "New",
    // 用户故意提交非法托管值——应全被忽略；WP-113 M2 后新建身份不再由人填（自带值会被来源门拒，见写门测试 T1）
    changes: { title: "New", arch_component: true, tags: ["t"], date: "1999-01-01", updated: "1999-01-01", status: "在线" },
  });
  const applied = env.service.apply({ previewId: preview.previewId, confirmed: true });
  const raw = fs.readFileSync(env.file, "utf8");
  const fm = require("../../../shared/yaml-frontmatter.cjs").parseEntityDocument(raw, env.file).frontmatter;
  assert.equal(fm.status, "灰度", "创建注入灰度（用户提交『在线』被忽略）");
  assert.notEqual(fm.date, "1999-01-01", "用户 date 被忽略");
  assert.notEqual(fm.updated, "1999-01-01", "用户 updated 被忽略");
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(fm.date), "date=服务端生成");
  assert.ok(!preview.changedFields.includes("status"), "托管字段不进用户改动集");
  assert.deepEqual(preview.systemManagedChanges, ["date", "updated", "status"]);
});

test("链路②：confirm→verified 事件 → status 置在线（守卫放行 灰度→在线）", () => {
  const env = setupVault(BASE);
  const next = writeStatusByEvent(env.vault, env.sourceKey, "confirm-verified");
  assert.equal(next, "在线", "灰度→在线");
  const fm = require("../../../shared/yaml-frontmatter.cjs").parseEntityDocument(fs.readFileSync(env.file, "utf8"), env.file).frontmatter;
  assert.equal(fm.status, "在线", "落盘验证");
});

test("链路③：reject 事件 → status 置退役", () => {
  const env = setupVault(BASE);
  const next = writeStatusByEvent(env.vault, env.sourceKey, "reject");
  assert.equal(next, "退役", "灰度→退役");
});

test("链路④：reopen 事件 → 退役回灰度（重新提交）", () => {
  const env = setupVault(BASE.replace("status: 灰度", "status: 退役"));
  const next = writeStatusByEvent(env.vault, env.sourceKey, "reopen");
  assert.equal(next, "灰度", "退役→灰度");
});

test("链路⑤：非法迁移被拒——灰度→在线跳过审批（直接手改 frontmatter 场景由 F15 哨兵报）+ 已驳回→在线 守卫拒", () => {
  assert.equal(isValidTransition("灰度", "在线"), true, "合法路径存在（但须事件驱动）");
  assert.equal(isValidTransition("已驳回", "在线"), false, "已驳回→在线 非法");
  assert.equal(isValidTransition("在线", "灰度"), false, "在线→灰度 非法");
  assert.throws(() => assertTransition({ from: "已驳回", to: "在线" }), (e) => e.code === "STATE_TRANSITION_FORBIDDEN");
  // 事件通道走非法迁移：静默不落盘（审计状态不动，等人工复核）
  const env = setupVault(BASE.replace("status: 灰度", "status: 已驳回"));
  const r = writeStatusByEvent(env.vault, env.sourceKey, "confirm-verified");
  assert.equal(r, null, "已驳回→在线 事件被守卫拒（静默不落盘）");
  const fm = require("../../../shared/yaml-frontmatter.cjs").parseEntityDocument(fs.readFileSync(env.file, "utf8"), env.file).frontmatter;
  assert.equal(fm.status, "已驳回", "文件未被改");
});

test("哨兵：手改 date/updated 触发 F12/F13 诊断（格式校验保留）", () => {
  const { checkAllEntities } = require("../entity-compliance-service.cjs");
  const handEdited = { fileName: "x.md", sourceKey: "知识库/wiki/entities/x.md", frontmatter: { title: "X", "architecture-node-id": "x-a", arch_component: true, status: "灰度", date: "手改的日期", tags: ["t"] }, body: "" };
  const results = checkAllEntities([handEdited], { wikilinkTypeLabels: {}, archLayers: [], archCategories: [], subdomainIds: [], moduleNames: [], statuses: ["灰度", "在线", "退役", "已驳回"], formalTags: [] });
  const checks = results.flatMap((r) => (r.groups || []).flatMap((g) => g.checks || []));
  const f12 = checks.find((c) => c.ruleId === "F12");
  assert.ok(f12 && f12.passed === false, "F12 哨兵报手改 date");
  assert.ok(/系统托管|手改/.test(f12.message), "哨兵话术含绕过提示");
});

test("迁移表机核：契约 transitions 与功能指令一致（含已驳回→灰度重提出边——PR-138 死端补齐）", () => {
  const { STATUS_MACHINE } = require("../../../shared/status-transition-guard.cjs");
  assert.deepEqual(STATUS_MACHINE.values, ["灰度", "在线", "退役", "已驳回"]);
  assert.deepEqual(STATUS_MACHINE.transitions["灰度"], ["在线", "退役"]);
  assert.deepEqual(STATUS_MACHINE.transitions["在线"], ["退役"]);
  assert.deepEqual(STATUS_MACHINE.transitions["退役"], ["灰度"]);
  // PR-138：原断言 []（终态）与 guard 头注释「灰度→已驳回→重提灰度 亦合法路径」矛盾——
  // 无出边时 reopen 事件对已驳回文章恒静默不落盘（永久卡死）；按注释意图补出边
  assert.deepEqual(STATUS_MACHINE.transitions["已驳回"], ["灰度"]);
});
