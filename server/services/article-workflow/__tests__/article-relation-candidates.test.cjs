"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  GENERATOR, CANDIDATE_RELATION, candidateEdgeId,
  generateRelationCandidates, mergeCandidateEdges, createRelationCandidateEmitter,
} = require(path.join(__dirname, "..", "article-relation-candidates.cjs"));

const WHITELIST = ["DOCUMENTS", "REFERENCES", "APPLIES_TO"]; // 裁决B落位：DOCUMENTS 为首批类型
const ENTITIES = [
  { nodeId: "fixture-component", names: ["Fixture Component", "fixture-component", "FC别名"] },
  { nodeId: "incomplete-component", names: ["Incomplete Component"] },
];

test("白名单内生成候选：正文提及实体→MENTIONS 候选（pending 态＋证据文本＋确定性id）", () => {
  const { edges, skippedOutOfWhitelist } = generateRelationCandidates(
    "正文提到 Fixture Component 组件与 FC别名。", "article-1", ENTITIES, WHITELIST,
  );
  assert.equal(skippedOutOfWhitelist, 0);
  assert.equal(edges.length, 1, "单实体单边（正名或别名首个命中即证提及；去重按实体）");
  for (const edge of edges) {
    assert.equal(edge.type, CANDIDATE_RELATION);
    assert.equal(edge.properties.reviewStatus, "pending");
    assert.equal(edge.properties.source, GENERATOR);
    assert.ok(edge.properties.evidence_text.length >= 2);
  }
  assert.equal(edges[0].target, "fixture-component");
  assert.equal(edges[0].source, "article-1");
});

test("白名单红线：类白名单不含 DOCUMENTS → 零生成（按构造，非过滤）", () => {
  const { edges, skippedOutOfWhitelist } = generateRelationCandidates(
    "正文提到 Fixture Component。", "article-1", ENTITIES, ["REFERENCES", "APPLIES_TO"],
  );
  assert.equal(edges.length, 0);
  assert.ok(skippedOutOfWhitelist >= 1, "留证：白名单缺席被显式记录");
  assert.equal(generateRelationCandidates("x", "a", [], []).edges.length, 0, "空实体集＝零候选（空库态）");
});

test("合并幂等与裁决主权：重复标准化零追加；已裁决边不复活", () => {
  const gen = () => generateRelationCandidates("提到 Fixture Component", "article-1", ENTITIES, WHITELIST).edges;
  const first = mergeCandidateEdges([], [], gen());
  assert.equal(first.added, 1);
  const second = mergeCandidateEdges(first.edges, [], gen());
  assert.equal(second.added, 0, "重复标准化幂等");
  const { stableEdgeId } = require(path.join(__dirname, "..", "..", "..", "shared", "edge-identity.cjs"));
  const decidedId = stableEdgeId(gen()[0]); // 图侧同源身份（六段派生）——账本裁决边不复活
  const afterDecision = mergeCandidateEdges([], [decidedId], gen());
  assert.equal(afterDecision.added, 0, "人工已驳回/批准的候选不复活（账本主权）");
});

test("发射器：；有基底则追加+补文章节点+触发摄取；异常降级不阻断", async () => {
  const events = [];
  const logger = { info(e) { events.push(e); }, warn(e) { events.push(e); } };
  let staged = null;
  let afterStagedCalls = 0;
  const io = {
    readLiveGraph: () => staged,
    writeStagedGraph: (_d, g) => { staged = g; },
    scanEntities: () => [{ frontmatter: { title: "Fixture Component", "architecture-node-id": "fixture-component" }, sourceKey: "fixture-component" }],
    resolveWhitelist: () => WHITELIST,
    readDecidedEdgeIds: () => [],
  };
  const emit = createRelationCandidateEmitter({ vaultPath: "/v", dataDir: "/d", afterStaged: () => { afterStagedCalls += 1; }, logger, io });

  assert.equal((await emit({ body: "提到 Fixture Component", articleId: "a-1" })).staged, false, "空库（活库图缺席）跳过不报错（重试后降级）");
  staged = { _format_version: "1.0", nodes: [{ id: "fixture-component", labels: ["Entity"], properties: {} }], edges: [] };
  const r1 = await emit({ body: "提到 Fixture Component", articleId: "a-1" });
  assert.equal(r1.added, 1);
  assert.equal(afterStagedCalls, 1, "追加后触发摄取/投影");
  assert.ok(staged.nodes.some((n) => n.id === "doc-article-a-1"), "文章节点缺席则补位（py 规范形 doc-article-<slug>——红队P1-3）");
  assert.equal((await emit({ body: "提到 Fixture Component", articleId: "a-1" })).added, 0, "重复标准化零追加");
  io.readLiveGraph = () => { throw new Error("boom"); };
  const degraded = await emit({ body: "x", articleId: "a-2" });
  assert.equal(degraded.staged, false);
  assert.ok(events.some((e) => e.event === "relation-candidates-failed"), "异常留痕降级");
});

// 红队P1-2/P1-3 回归钉：目标类域执法＋规范文章节点挂接
test("P1-2 目标类域：target_types 声明不含 Entity → 零生成并留痕；含 → 放行", () => {
  const base = { body: "提到 Fixture Component", articleNodeId: "doc-article-x", entityIndex: ENTITIES.slice(0, 1) };
  const blocked = generateRelationCandidates(base.body, base.articleNodeId, base.entityIndex, WHITELIST, {
    relationTargetTypes: { DOCUMENTS: ["Concept", "System"] }, targetClassByNode: { "fixture-component": "Entity" },
  });
  assert.equal(blocked.edges.length, 0);
  assert.equal(blocked.skippedOutOfTypeScope, 1, "范围拦截留痕（合同验收条款3）");
  const allowed = generateRelationCandidates(base.body, base.articleNodeId, base.entityIndex, WHITELIST, {
    relationTargetTypes: { DOCUMENTS: ["Entity", "Concept"] }, targetClassByNode: { "fixture-component": "Entity" },
  });
  assert.equal(allowed.edges.length, 1);
  assert.equal(allowed.skippedOutOfTypeScope, 0);
  const unconstrained = generateRelationCandidates(base.body, base.articleNodeId, base.entityIndex, WHITELIST, {});
  assert.equal(unconstrained.edges.length, 1, "关系未声明 target_types＝无该维约束（白名单仍执法）");
});
