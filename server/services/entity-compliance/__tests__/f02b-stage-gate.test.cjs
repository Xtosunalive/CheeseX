// Component: F02b 执法接线回归（规则生命周期第 2 步·裁决 1；WP-096 扩至写门）
// @responsible: 看守「重复 architecture-node-id 被拦」的两处关口——入图门 Stage 0.5 与实体修复写门。
// @context: 裁决1 A 案原为「只挂 pipeline.stage-0-5，抽屉不挂——单文件判不了唯一性」；该前提在
//   WP-096 解除：写门改为把全库 entity 文档喂进索引（待写那篇以入参版本替换自身），单文件判不了的
//   理由不再成立。PR-232 实测复现旧前提的代价：同身份两笔都能落盘，冲突推迟到入图门才显形。
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// 2026-10-27 降档随迁：F 族声明自 registry 迁代码内（field-rule-declarations.cjs）——守护语义不变
const { FIELD_RULES } = require("../../../shared/field-rule-declarations.cjs");
const rules = { rules: FIELD_RULES };

test("契约声明：F02b gates 同时挂入图门与写门两闸（WP-096 把唯一性提到写入时刻）", () => {
  const f02b = rules.rules.find((r) => r.id === "F02b");
  assert.ok(f02b, "F02b 存在");
  assert.deepEqual(
    [...f02b.gates].sort(),
    ["entity-repair.apply-create", "entity-repair.preview-edit", "pipeline.stage-0-5"].sort(),
    "唯一性门＝入图门＋写门两闸（新建绝对拦、编辑不许新增）"
  );
  assert.equal(f02b.severity, "error");
});

test("端到端：重复代号 → readiness.ready=false 且 errors 含 F02b", () => {
  const svc = require("../../entity-compliance/entity-compliance-service.cjs");
  const routes = require("../../../routes/entity-compliance-routes.cjs");
  const a = { fileName: "a.md", frontmatter: { title: "A", "architecture-node-id": "mysql-primary", arch_component: true }, body: "" };
  const b = { fileName: "b.md", frontmatter: { title: "B", "architecture-node-id": "mysql-primary", arch_component: true }, body: "" };
  const ruleSet = { wikilinkTypeLabels: {}, archLayers: [], archCategories: [], subdomainIds: [], moduleNames: [], statuses: [], formalTags: [] };
  const results = svc.checkAllEntities([a, b], ruleSet);
  results.forEach((r) => { r.architectureIntent = "active"; });
  const readiness = routes.buildReadiness(results);
  assert.equal(readiness.ready, false, "重复代号拦入图");
  assert.ok((readiness.errors || []).some((e) => e.ruleId === "F02b"), "F02b 在 errors 清单");
});

test("零重复时 F02b 不产诊断（唯一性通过即静默）", () => {
  const svc = require("../../entity-compliance/entity-compliance-service.cjs");
  const a = { fileName: "a.md", frontmatter: { title: "A", "architecture-node-id": "mysql-primary", arch_component: true }, body: "" };
  const b = { fileName: "b.md", frontmatter: { title: "B", "architecture-node-id": "mysql-replica", arch_component: true }, body: "" };
  const ruleSet = { wikilinkTypeLabels: {}, archLayers: [], archCategories: [], subdomainIds: [], moduleNames: [], statuses: [], formalTags: [] };
  const results = svc.checkAllEntities([a, b], ruleSet);
  const f02bFindings = results.flatMap((r) => (r.groups || []).flatMap((g) => g.checks || [])).filter((c) => c.ruleId === "F02b" && c.passed === false);
  assert.equal(f02bFindings.length, 0, "零重复无 F02b 违规");
});
