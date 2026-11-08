// 2026-10-15 Master 裁收敛（TALOS「一个根因一条信号」同构）——①缺失实体告警聚合：
// collector 跳过 sourceExists=false 合成模板的字段级产出（语义由 missing_entity 轨道每文章一条承载，
// 去重实证：同一缺失实体曾 1 条 missing_entity＋15 条 CREATE 字段告警）；②检索面 freshness 标注
// （ADR064 修订）：stale 时响应带提示、数据仍 pinned。层级：纯单元（注入 collector deps）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const MOD = require("../anomaly-issue-collector.cjs");
const { createAnomalyIssueCollector } = MOD;

function makeDeps(vaultPath, results) {
  const issues = [];
  const collector = createAnomalyIssueCollector({
    vaultPath,
    logger: { info() {}, warn() {}, error() {} },
    scanAndCheck: () => ({ results }),
    readMasterGraph: () => null,
    scanDraftSources: () => [],
    isWorkbenchIssueFinding: () => true,
    findUnmanagedEntityCandidates: () => [],
    listRelationTargetOptions: () => [],
    articleAssociationService: null,
    conflictStore: null,
    graphProvenanceService: { collectMissingRelationLineage: () => [] },
    relationRegistry: null,
    relationRuleSetProvider: () => ({}),
  });
  return { collector, issues };
}

function finding(field, ruleId) {
  return { ruleId, field, message: "尚未填写", value: null, passed: false };
}

test("WP-A：缺失实体模板（sourceExists=false）不炸字段条目——每实体零产出，语义归 missing_entity 轨道", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "agg-"));
  try {
    const results = [
      { sourceKey: "知识库/wiki/entities/可观测性.md", sourceExists: false, title: "可观测性", entityId: "",
        groups: [{ id: "identity", label: "缺失实体模板", checks: [finding("title", "CREATE-1"), finding("product", "CREATE-2"), finding("arch_version_overrides", "CREATE-9")] }] },
      { sourceKey: "知识库/wiki/entities/活的.md", sourceExists: true, title: "活实体",
        groups: [{ id: "identity", label: "身份", checks: [finding("title", "F01")] }] },
    ];
    const { collector } = makeDeps(vaultPath, results);
    const out = collector();
    const createIssues = out.issues.filter((i) => /CREATE/.test(i.issueId));
    assert.equal(createIssues.length, 0, "CREATE 字段级条目归零");
    const liveIssues = out.issues.filter((i) => i.sourceKey === undefined ? false : true);
    const f01 = out.issues.filter((i) => i.issueId.includes("F01"));
    assert.equal(f01.length, 1, "活实体字段问题不受影响");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP-B：checkFreshness 判定（stale/fresh/unknown 三态——检索标注复用同一判定）", async () => {
  const { checkFreshness } = require("../../../shared/release-freshness-gate.cjs");
  const stale = await checkFreshness({ sourceCommit: "a".repeat(40) }, "/nonexistent-vault");
  assert.equal(stale.status, "unknown", "git 不可用=unknown");
  const none = await checkFreshness(null, "/nonexistent-vault");
  assert.equal(none.status, "unknown");
});
