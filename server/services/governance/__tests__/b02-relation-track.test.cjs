// Component: B02/B04 出口轨道回归测试（规则生命周期第 2 步·裁决 4）
// @responsible: 看守「B02/B04 违规 → relation_conflict 轨道」的真实接线——
//   2026-10-08 审计发现 collector:72 读 finding.unresolvedLinks/unknownRelations，
//   而声明式引擎实际产 unresolvedTargets（引擎 runBodyDiagnostics :296），键名错配
//   导致实体侧 relation_conflict 轨道为死代码，B02/B04 违规错落 missing_field 通用出口。
// @context: 先红后绿实证——本测试在修复前应红（错落 missing_field），修复后绿。
const assert = require("node:assert/strict");
const test = require("node:test");

const { runBodyDiagnostics } = require("../../entity-compliance/entity-compliance-declarative-engine.cjs");
const { buildEntityIndexes } = require("../../entity-compliance/entity-compliance-service.cjs");

// 引擎真实产出形态（来自 runBodyDiagnostics：B02 失败时 unresolvedTargets 数组）
function makeEntityWithBrokenLink() {
  return {
    fileName: "api.md",
    frontmatter: { title: "API 服务", "architecture-node-id": "api", arch_component: true },
    body: "依赖::[[不存在的数据库]]",
    sourcePath: "知识库/wiki/entities/api.md",
  };
}

test("B02 违规：引擎产 unresolvedTargets（信号层契约——修复的前提事实）", () => {
  const entity = makeEntityWithBrokenLink();
  const indexes = buildEntityIndexes([entity]);
  const diags = runBodyDiagnostics(entity.body, { wikilinkTypeLabels: { "依赖": "DEPENDS_ON" } }, indexes);
  const b02 = diags.find((d) => d.ruleId === "B02");
  assert.ok(b02, "B02 诊断存在");
  assert.equal(b02.passed, false, "B02 不通过");
  assert.ok(Array.isArray(b02.unresolvedTargets) && b02.unresolvedTargets.length === 1, "引擎产 unresolvedTargets");
  // 反证：引擎不产 unresolvedLinks/unknownRelations（键名错配的根因锚点）
  assert.equal(b02.unresolvedLinks, undefined);
  assert.equal(b02.unknownRelations, undefined);
});

test("B02 违规：collector 走 relation_conflict 轨道（出口层契约——修复目标）", () => {
  const { createAnomalyIssueCollector } = require("../../governance/anomaly-issue-collector.cjs");
  const { isWorkbenchIssueFinding } = require("../../entity-compliance/entity-compliance-service.cjs");
  const { runAllDiagnostics, diagnosticToFinding } = require("../../entity-compliance/entity-compliance-declarative-engine.cjs");

  const entity = makeEntityWithBrokenLink();
  const indexes = buildEntityIndexes([entity]);
  const ruleSet = { wikilinkTypeLabels: { "依赖": "DEPENDS_ON" } };
  // 走真实转换链：引擎诊断 → finding（与 scanAndCheck 同构，非自造夹具）
  const findings = runAllDiagnostics(entity, ruleSet, indexes).map(diagnosticToFinding);
  const b02Finding = findings.find((f) => f.ruleId === "B02");
  assert.ok(b02Finding && b02Finding.passed === false, "B02 finding 存在且失败");

  const collected = [];
  const collect = createAnomalyIssueCollector({
    vaultPath: "/tmp/unused",
    logger: { warn() {} },
    scanAndCheck: () => ({ results: [{ sourceKey: "知识库/wiki/entities/api.md", entityId: "api", sourceRevision: "sha256:" + "1".repeat(64), groups: [{ label: "body", checks: [b02Finding] }] }] }),
    scanDraftSources: () => [],
    isWorkbenchIssueFinding,
    findUnmanagedEntityCandidates: () => [],
    listRelationTargetOptions: () => [],
    articleAssociationService: { list: () => ({ revision: "r", decisions: [], articles: [], componentOptions: [], versionOptions: [] }) },
    conflictStore: { list: () => [] },
    relationRuleSet: ruleSet,
    relationRegistry: null,
    graphProvenanceService: { collectMissingRelationLineage: () => [] },
  });
  for (const issue of collect().issues) collected.push(issue);
  const relationTrack = collected.filter((i) => i.issueKind === "relation_conflict");
  assert.ok(relationTrack.length >= 1, "B02 违规走 relation_conflict 轨道（修复前错落 missing_field——本断言先红）");
  const rel = relationTrack[0];
  assert.equal(rel.relationCandidate.triples.length, 1, "关系候选三元组 1 条");
  assert.equal(rel.relationCandidate.triples[0].targetNodeId, "不存在的数据库");
});

test("B04 违规：未知类型走 relation_conflict 轨道（完整 link 载荷）", () => {
  const { createAnomalyIssueCollector } = require("../../governance/anomaly-issue-collector.cjs");
  const { runAllDiagnostics, diagnosticToFinding } = require("../../entity-compliance/entity-compliance-declarative-engine.cjs");
  const { buildEntityIndexes } = require("../../entity-compliance/entity-compliance-service.cjs");

  const entity = {
    fileName: "api.md",
    frontmatter: { title: "API 服务", "architecture-node-id": "api", arch_component: true },
    body: "自定义关系::[[database]]",
    sourcePath: "知识库/wiki/entities/api.md",
  };
  const indexes = buildEntityIndexes([{ fileName: "database.md", frontmatter: { title: "Database", "architecture-node-id": "database" }, body: "" }]);
  const ruleSet = { wikilinkTypeLabels: { "依赖": "DEPENDS_ON" } }; // 自定义关系未注册
  const findings = runAllDiagnostics(entity, ruleSet, indexes).map(diagnosticToFinding);
  const b04 = findings.find((f) => f.ruleId === "B04");
  assert.ok(b04 && b04.passed === false, "B04 finding 存在且失败");
  assert.ok(Array.isArray(b04.unknownRelations) && b04.unknownRelations.length === 1, "B04 携带完整 link 载荷（裁决4引擎补发）");
  assert.equal(b04.unknownRelations[0].type, "自定义关系");
  assert.equal(b04.unknownRelations[0].target, "database");

  const collect = createAnomalyIssueCollector({
    vaultPath: "/tmp/unused",
    logger: { warn() {} },
    scanAndCheck: () => ({ results: [{ sourceKey: "知识库/wiki/entities/api.md", entityId: "api", sourceRevision: "sha256:" + "1".repeat(64), groups: [{ label: "body", checks: [b04] }] }] }),
    scanDraftSources: () => [],
    isWorkbenchIssueFinding: () => true,
    findUnmanagedEntityCandidates: () => [],
    listRelationTargetOptions: () => [],
    articleAssociationService: { list: () => ({ revision: "r", decisions: [], articles: [], componentOptions: [], versionOptions: [] }) },
    conflictStore: { list: () => [] },
    relationRuleSet: ruleSet,
    relationRegistry: null,
    graphProvenanceService: { collectMissingRelationLineage: () => [] },
  });
  const relationTrack = collect().issues.filter((i) => i.issueKind === "relation_conflict");
  assert.ok(relationTrack.length === 1, "B04 违规走 relation_conflict 轨道（修复前错落 missing_field）");
  const triple = relationTrack[0].relationCandidate.triples[0];
  assert.equal(triple.relationTypeStatus, "unknown", "未知类型三元组状态=unknown");
  assert.ok(triple.evidence.length >= 1 && triple.evidence[0].coordinate === "line:1", "证据坐标来自引擎 link 载荷");
});
