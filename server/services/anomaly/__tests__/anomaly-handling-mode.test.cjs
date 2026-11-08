const test = require("node:test");
const assert = require("node:assert/strict");

// 切片1（handling 分型标注）TDD 用例清单：
// 1-12 十二类全覆盖；13 关系冲突双形态；14 未知类型 fail-safe；15 空动作；
// 16 复合来源负例（同源两张卡各自保持）；17 list 接线；18 推理复核裁决语义。
const { createAnomalyWorkbenchService, deriveIssueHandling } = require("../anomaly-workbench-service.cjs");

function issue(kind, extra = {}) {
  return { issueId: `i-${kind}-${Math.random().toString(36).slice(2, 6)}`, issueKind: kind, title: kind, evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/x.md" }], ...extra };
}

test("1-12 十二类全覆盖：各归其位", () => {
  const cases = [
    ["missing_field", { proposedAction: { type: "entity-repair", sourceKey: "s", field: "product" } }, "fix"],
    ["unrecognized_entity", { proposedAction: { type: "entity-relation-repair", sourceKey: "s" } }, "fix"],
    ["version_scope", { proposedAction: { type: "entity-repair", sourceKey: "s", field: "arch_since" } }, "fix"],
    ["missing_entity", { proposedAction: { type: "entity-repair", sourceKey: "s", field: "module_entity" } }, "fix"],
    ["relation_conflict", { proposedAction: { type: "entity-relation-repair", sourceKey: "s" } }, "fix"],
    ["article_association", { proposedAction: { type: "article-association", articleId: "a" } }, "fix"],
    ["stale_source", { proposedAction: { type: "article-association-reload", articleId: "a" } }, "fix"],
    ["missing_lineage", { proposedAction: { type: "derived-graph-repair" } }, "fix"],
    ["pipeline_failure", {}, "operate"],
    ["release_publication_failure", {}, "operate"],
    ["standardization_warning", {}, "note"],
  ];
  for (const [kind, extra, expected] of cases) {
    assert.equal(deriveIssueHandling(issue(kind, extra)), expected, `${kind} 应为 ${expected}`);
  }
});

test("13 关系冲突双形态：带 candidate 裁决 / 不带则修复", () => {
  const withCandidate = issue("relation_conflict", {
    relationCandidate: { candidateId: "c1", candidateStatus: "open", triples: [], conflictGroupId: "g", candidateHash: "h", evidenceSetHash: "e", sourceSetHash: "s" },
    proposedAction: { type: "relation-candidate-review", sourceKey: "s" },
  });
  assert.equal(deriveIssueHandling(withCandidate), "adjudicate");
  const withoutCandidate = issue("relation_conflict", { proposedAction: { type: "entity-relation-repair", sourceKey: "s" } });
  assert.equal(deriveIssueHandling(withoutCandidate), "fix");
});

test("14 未知 issueKind 且无动作 → note（fail-safe 不暗示动作）", () => {
  assert.equal(deriveIssueHandling(issue("some_future_compound_kind", {})), "note");
});

test("15 proposedAction=null 且无 candidate → note", () => {
  assert.equal(deriveIssueHandling(issue("standardization_warning", { proposedAction: null })), "note");
});

test("16 复合来源负例：同一 sourcePath 两张卡（fix+adjudicate）各自保持互不污染", () => {
  const gap = { ...issue("missing_field", { proposedAction: { type: "entity-repair", sourceKey: "知识库/raw/precleaned/a.md", field: "product" } }), evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/a.md" }] };
  const conflict = { ...issue("relation_conflict", { relationCandidate: { candidateId: "c1", candidateStatus: "open", triples: [], conflictGroupId: "g", candidateHash: "h", evidenceSetHash: "e", sourceSetHash: "s" }, proposedAction: { type: "relation-candidate-review", sourceKey: "知识库/raw/precleaned/a.md" } }), evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/a.md" }] };
  assert.equal(deriveIssueHandling(gap), "fix");
  assert.equal(deriveIssueHandling(conflict), "adjudicate");
});

test("18 推理复核动作 → adjudicate", () => {
  assert.equal(deriveIssueHandling(issue("relation_conflict", { proposedAction: { type: "inference-review", conflictId: "x", conclusions: [] } })), "adjudicate");
});

test("17 接线：service.list() 每条 issue 携带 handling（读时派生）", () => {
  const fixture = [
    issue("missing_field", { proposedAction: { type: "entity-repair", sourceKey: "s", field: "product" } }),
    issue("pipeline_failure", {}),
  ];
  const service = createAnomalyWorkbenchService({
    vaultPath: "/tmp/anomaly-handling-test",
    collectIssues: () => fixture,
    getPipelineStatus: () => null,
  });
  const list = service.list();
  assert.equal(list.total, 2);
  for (const item of list.issues) assert.ok(["fix", "adjudicate", "operate", "note"].includes(item.handling), `handling 缺失或非法: ${item.issueKind}`);
  assert.equal(list.issues.find((i) => i.issueKind === "missing_field").handling, "fix");
  assert.equal(list.issues.find((i) => i.issueKind === "pipeline_failure").handling, "operate");
});
