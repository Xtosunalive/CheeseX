// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const pendingReviewRoutes = require("../pending-review-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");
const snapshot = require("../../shared/working-artifact-snapshot.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");

// SPEC-012 wave-2 图族：主图真身迁 derived-index.db——种子种 store 原文行（scopeKey=vault，
// 字节与旧文件种子同构——workingRevision 断言口径不变）
function seedGraph(vault, graph) {
  getDerivedIndexStore(vault).artifacts.put("master_graph", `${JSON.stringify(graph, null, 2)}`);
}

async function invoke(h) {
  const res = await h.call("GET /api/kg/pending-review");
  await h.close();
  return res;
}

test("pending review binds graph bytes and reads each repeated owner once per request", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pending-review-route-"));
  try {
    const ownerPath = path.join(vault, "知识库", "wiki", "entities", "api.md");
    fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
    fs.writeFileSync(ownerPath, "# API\n", "utf8");
    seedGraph(vault, {
      nodes: [{ id: "api", label: "API" }, { id: "db", label: "DB" }],
      connections: [
        { from: "api", to: "db", relationType: "DEPENDS_ON", sourceFile: "知识库/wiki/entities/api.md", reviewStatus: "pending" },
        { from: "api", to: "db", relationType: "CONNECTS_TO", sourceFile: "知识库/wiki/entities/api.md", reviewStatus: "pending" },
      ],
    });
    let graphReads = 0;
    let ownerReads = 0;
    const handler = createRouteHarness();
    pendingReviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readGraphArtifact(scopeKey) { graphReads += 1; return snapshot.readMasterGraphArtifact(scopeKey); },
      readBytesArtifact(file) { ownerReads += 1; return snapshot.readBytesArtifact(file); },
    });

    const response = await invoke(handler);
    assert.equal(response.statusCode, 200);
    assert.equal(graphReads, 1);
    assert.equal(ownerReads, 1);
    assert.match(response.body.data.workingRevision, /^sha256:[a-f0-9]{64}$/);
    assert.equal(response.body.data.edges.length, 2);
    assert.equal(response.body.data.edges[0].sourceRevision, response.body.data.edges[1].sourceRevision);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

// PR-045：读侧前置——pending 边携带 blockers（与写门 409 同一 openBlockersForEdge）与端点类型 labels；
// 用户不必点批准吃 409 才知道被拦，文档节点不再被抹成与普通实体无异。
test("PR-045 读侧前置：pending 边携带 blockers 与端点类型 labels", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pending-review-pr045-"));
  try {
    seedGraph(vault, {
      nodes: [
        { id: "doc-article-deploy", label: "部署手册", labels: ["Document"] },
        { id: "api", label: "API" },
        { id: "db", label: "DB" },
      ],
      connections: [
        { edgeId: "doc-article-deploy|api|DOCUMENTS|||", from: "doc-article-deploy", to: "api", relationType: "DOCUMENTS", reviewStatus: "pending" },
        { edgeId: "api|db|DEPENDS_ON|||", from: "api", to: "db", relationType: "DEPENDS_ON", reviewStatus: "pending" },
      ],
    });
    const handler = createRouteHarness();
    pendingReviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readGraphArtifact: snapshot.readMasterGraphArtifact,
      readBytesArtifact: snapshot.readBytesArtifact,
      listOpenIssues: () => [
        { issueId: "anom-doc", issueKind: "missing_entity", status: "open", proposedAction: { entityId: "doc-article-deploy" } },
        { issueId: "anom-closed", issueKind: "missing_entity", status: "closed", proposedAction: { entityId: "db" } },
      ],
    });
    const response = await invoke(handler);
    assert.equal(response.statusCode, 200);
    const docEdge = response.body.data.edges.find((e) => e.source === "doc-article-deploy");
    assert.deepEqual(docEdge.sourceLabels, ["Document"], "文档端点应透传类型 labels");
    assert.deepEqual(docEdge.targetLabels, []);
    assert.deepEqual(docEdge.blockers, [{ entityId: "doc-article-deploy", issueId: "anom-doc", issueKind: "missing_entity" }], "open 缺实体问题应前置为 blockers");
    const normalEdge = response.body.data.edges.find((e) => e.source === "api");
    assert.deepEqual(normalEdge.sourceLabels, []);
    assert.deepEqual(normalEdge.blockers, [], "closed 问题不阻断（与写门同判）");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("pending review returns NOT_FOUND without inventing a working revision", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pending-review-missing-"));
  try {
    const handler = createRouteHarness();
    pendingReviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
    });
    const response = await invoke(handler);
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.error_code, "NOT_FOUND");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("三级回退：sourceFile 空时从节点 file_path 解析并写回", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pending-review-fallback-"));
  try {
    const ownerPath = path.join(vault, "知识库", "raw", "precleaned", "强制入主.md");
    fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
    fs.writeFileSync(ownerPath, "# 强制入主\n", "utf8");
    seedGraph(vault, {
      nodes: [{ id: "doc-article-强制入主", label: "强制入主", properties: { file_path: "知识库/raw/precleaned/强制入主.md" } }, { id: "ecms-cluster", label: "ECMS集群" }],
      connections: [
        { from: "doc-article-强制入主", to: "ecms-cluster", relationType: "REFERENCES", sourceFile: "", properties: { source: "document-body", reviewStatus: "pending" } },
      ],
    });
    const handler = createRouteHarness();
    pendingReviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readGraphArtifact: snapshot.readMasterGraphArtifact,
      readBytesArtifact: snapshot.readBytesArtifact,
    });
    const response = await invoke(handler);
    assert.equal(response.statusCode, 200);
    const edge = response.body.data.edges[0];
    assert.equal(edge.sourceFile, "知识库/raw/precleaned/强制入主.md", "应从节点 file_path 解析并写回 sourceFile");
    assert.match(edge.sourceRevision, /^sha256:[a-f0-9]{64}$/, "应补 sourceRevision");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

// PR-011（#1860）：待审核列表必须合并裁决账本——账本已 approved 的边不得重现 pending、不得重复再批。
// 根因：本路由为绑 workingRevision 裸读图字节（不走 readMasterGraph 出口），遗漏 mergeReviewStatus
// （F3/seq156 只写账本+读侧合并，合并接线漏了本路由）。
test("PR-011 账本已批准的边不得重现于待审核列表", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pending-review-pr011-"));
  try {
    // 图内两条 pending 边；账本已人工批准其中 DEPENDS_ON（ADR054 D2：账本唯一事实源）
    seedGraph(vault, {
      nodes: [{ id: "api", label: "API" }, { id: "db", label: "DB" }],
      connections: [
        { edgeId: "api|db|DEPENDS_ON|||", from: "api", to: "db", relationType: "DEPENDS_ON", reviewStatus: "pending" },
        { edgeId: "api|db|RELATED|||", from: "api", to: "db", relationType: "RELATED", reviewStatus: "pending" },
      ],
    });
    // 真实账本形态：经 runtime-state store 种入（SPEC-012 WP-A 迁出 vault 文件），edgeId = from|to|relationType|||
    getRuntimeStateStore(vault).review.append(
      { edgeId: "api|db|DEPENDS_ON|||", source: "api", target: "db", action: "approved", decidedAt: "2026-09-10T00:00:00Z", reviewer: "local-architect", actor: "human" },
      "2026-09-10T00:00:00Z",
    );
    const handler = createRouteHarness();
    pendingReviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readGraphArtifact: snapshot.readMasterGraphArtifact,
      readBytesArtifact: snapshot.readBytesArtifact,
    });
    const response = await invoke(handler);
    assert.equal(response.statusCode, 200);
    const pendingTypes = response.body.data.edges.map((e) => e.type);
    assert.ok(!pendingTypes.includes("DEPENDS_ON"), "PR-011 FAIL: 账本已批准的 DEPENDS_ON 边仍出现在待审核列表");
    assert.ok(pendingTypes.includes("RELATED"), "PR-011: 真 pending 边 RELATED 应保留");
    assert.equal(response.body.data.approved, 1, "PR-011: approved 计数应为 1（账本合并后）");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
