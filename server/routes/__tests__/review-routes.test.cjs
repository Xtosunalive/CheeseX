// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const reviewRoutes = require("../review-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：kg/review 已动作化
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

// PR-085：经 route-harness（Fastify inject）走完整传输层——契约推导校验→handler→封套；res.payload 为已解析封套
async function invoke(h, body) {
  return h.call("POST /api/kg/review", undefined, body);
}

function setupVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "review-routes-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-pin-"); // Master 加固批：镜像写通道钉 /tmp
  setupActionRuntime({ vaultPath: vault }); // WP-048 W1-B：kg.review 已动作化（审计/动作事件落本夹具库）
  const graphDir = path.join(vault, ".ledger");
  fs.mkdirSync(graphDir, { recursive: true });
  const graph = {
    nodes: [{ id: "api", label: "API" }, { id: "db", label: "DB" }],
    connections: [
      { edgeId: "api|db|DEPENDS_ON|||", from: "api", to: "db", relationType: "DEPENDS_ON", sourceFile: "", properties: { reviewStatus: "pending" } },
    ],
  };
  fs.writeFileSync(path.join(graphDir, "master_graph.json"), JSON.stringify(graph, null, 2), "utf8");
  // SPEC-012 WP-A：裁决账本（review_actions）迁 runtime-state store——不再预写 vault json（空 store 即空账本）
  return { vault, graph };
}

test("POST /api/kg/review 批准：裁决只写账本（master_graph 字节不变，approved 由读取端合并）+ 写审计", async () => {
  const { vault, graph } = setupVault();
  try {
    const handler = createRouteHarness();
    reviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readMasterGraph: () => JSON.parse(fs.readFileSync(path.join(vault, ".ledger", "master_graph.json"), "utf8")),
    });
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "approved", reason: "测试批准" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.reviewStatus, "approved");
    // F3（seq156，ADR054 D2）：master_graph 不再被裁决改写（字节不变）；审批凭据（reviewer/decidedAt）随账本记录
    const graphRaw = fs.readFileSync(path.join(vault, ".ledger", "master_graph.json"), "utf8");
    assert.equal(JSON.parse(graphRaw).connections[0].properties.reviewStatus, "pending", "图内状态保持原样（裁决只进账本）");
    // 审计追加（runtime-state store）
    const actions = getRuntimeStateStore(vault).review.list();
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "approved");
    assert.equal(actions[0].reason, "测试批准");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("POST /api/kg/review 不存在的 edgeId → 404 EDGE_NOT_FOUND", async () => {
  const { vault } = setupVault();
  try {
    const handler = createRouteHarness();
    reviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readMasterGraph: () => JSON.parse(fs.readFileSync(path.join(vault, ".ledger", "master_graph.json"), "utf8")),
    });
    const res = await invoke(handler, { edgeId: "missing|edge|||", action: "approved" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.error_code, "EDGE_NOT_FOUND");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("POST /api/kg/review 非法 action → 400 VALIDATION_ERROR", async () => {
  const { vault } = setupVault();
  try {
    const handler = createRouteHarness();
    reviewRoutes.register(handler.registerRoute, {
      vaultPath: vault,
      readMasterGraph: () => JSON.parse(fs.readFileSync(path.join(vault, ".ledger", "master_graph.json"), "utf8")),
    });
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "maybe" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error_code, "VALIDATION_ERROR");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

function registerWithIssues(issues) {
  const handler = createRouteHarness();
  reviewRoutes.register(handler.registerRoute, {
    vaultPath: issues.vault,
    readMasterGraph: () => JSON.parse(fs.readFileSync(path.join(issues.vault, ".ledger", "master_graph.json"), "utf8")),
    listOpenIssues: () => issues.list,
  });
  return handler;
}

test("POST /api/kg/review 边端点存在 open missing_entity blocker → 409 RELATION_REVIEW_BLOCKED（不得批准）", async () => {
  const { vault } = setupVault();
  try {
    // 红灯（S8/场景⑫）：Document 节点 "api" 存在 open missing_entity blocker，
    // approve 必须被拒（当前实现 200 approved 进 approved 态）。
    const handler = registerWithIssues({
      vault,
      list: [
        { issueId: "missing-entity-api", issueKind: "missing_entity", status: "open", title: "缺知识实体", proposedAction: { type: "entity-repair", entityId: "api" } },
      ],
    });
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "approved", reason: "测试批准" });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error_code, "RELATION_REVIEW_BLOCKED");
    assert.equal(res.payload.details.blockers[0].issueId, "missing-entity-api");
    // master_graph 不得被改写
    const updated = JSON.parse(fs.readFileSync(path.join(vault, ".ledger", "master_graph.json"), "utf8"));
    assert.notEqual(updated.connections[0].properties.reviewStatus, "approved");
    // 审计不得追加（runtime-state store）
    const actions = getRuntimeStateStore(vault).review.list();
    assert.equal(actions.length, 0);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("POST /api/kg/review 边端点命中 unrecognized_entity unresolvedTargets → 409 RELATION_REVIEW_BLOCKED", async () => {
  const { vault } = setupVault();
  try {
    const handler = registerWithIssues({
      vault,
      list: [
        { issueId: "unrecognized-api", issueKind: "unrecognized_entity", status: "open", title: "未知实体", proposedAction: { type: "entity-relation-repair", sourceKey: "a.md", unresolvedTargets: ["api"] } },
      ],
    });
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "approved" });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error_code, "RELATION_REVIEW_BLOCKED");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("POST /api/kg/review blocker 存在时 rejected 仍允许", async () => {
  const { vault } = setupVault();
  try {
    const handler = registerWithIssues({
      vault,
      list: [
        { issueId: "missing-entity-api", issueKind: "missing_entity", status: "open", proposedAction: { type: "entity-repair", entityId: "api" } },
      ],
    });
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "rejected", reason: "测试驳回" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.reviewStatus, "rejected");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("POST /api/kg/review 已关闭 blocker 不阻断批准", async () => {
  const { vault } = setupVault();
  try {
    const handler = registerWithIssues({
      vault,
      list: [
        { issueId: "missing-entity-api", issueKind: "missing_entity", status: "closed", proposedAction: { type: "entity-repair", entityId: "api" } },
      ],
    });
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "approved", reason: "测试批准" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.reviewStatus, "approved");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
