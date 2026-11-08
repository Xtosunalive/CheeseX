// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Component: review 裁决账本分离测试（F3 / seq156，ADR054 D2）
// @responsible: 验证关系裁决只写 review_actions 账本——master_graph 字节不变（重建零损耗、lineage 回补需求消失）；
//               消费端读图时从账本合并 reviewStatus（账本优先、图内存量 fallback）。
// @inputs: 临时 Vault（master_graph.json + review_actions.json）
// @outputs: 单元测试断言
// @context: Vault

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const reviewRoutes = require("../review-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：kg/review 已动作化
const { mergeReviewStatus } = require("../../shared/review-status-projection.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

// PR-085：经 route-harness（Fastify inject）走完整传输层——契约推导校验→handler→封套；res.payload 为已解析封套
async function invoke(h, body) {
  return h.call("POST /api/kg/review", undefined, body);
}

function setupVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "review-ledger-"));
  setupActionRuntime({ vaultPath: vault }); // WP-048 W1-B：kg.review 已动作化
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });
  const conn = { edgeId: "api|db|DEPENDS_ON|||", from: "api", to: "db", relationType: "DEPENDS_ON", sourceFile: "", properties: { reviewStatus: "pending" } };
  const graph = { nodes: [{ id: "api", label: "API" }, { id: "db", label: "DB" }], connections: [conn] };
  fs.writeFileSync(path.join(vault, ".ledger", "master_graph.json"), JSON.stringify(graph, null, 2), "utf8");
  // SPEC-012 WP-A：裁决账本（review_actions）迁 runtime-state store——不再预写 vault json（空 store 即空账本）
  return { vault, graphPath: path.join(vault, ".ledger", "master_graph.json") };
}

function register(vault) {
  const handler = createRouteHarness();
  reviewRoutes.register(handler.registerRoute, {
    vaultPath: vault,
    readMasterGraph: () => JSON.parse(fs.readFileSync(path.join(vault, ".ledger", "master_graph.json"), "utf8")),
  });
  return handler;
}

test("T1 裁决后 master_graph 字节不变（裁决只进账本）+ 账本追加完整记录（含 assertedBy，K-P1-2）", async () => {
  const { vault, graphPath } = setupVault();
  try {
    const handler = register(vault);
    const before = fs.readFileSync(graphPath, "utf8");
    const res = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "approved", reason: "测试批准" });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(fs.readFileSync(graphPath, "utf8"), before, "master_graph.json 不得因裁决被改写（ADR054 D2）");
    const actions = getRuntimeStateStore(vault).review.list();
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "approved");
    assert.equal(actions[0].reviewer, "local-architect");
    assert.ok(actions[0].decidedAt);
    // K-P1-2：人工身份由服务端落盘（actorType 硬编码 "human"），闸门归属校验的数据源。
    assert.deepEqual(actions[0].assertedBy, { actorId: "local-architect", actorType: "human" });
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T1b 负例（K-P1-2 硬约束）：客户端传入 actorType/assertedBy 一律被忽略——服务端硬编码 human", async () => {
  const { vault } = setupVault();
  try {
    const handler = register(vault);
    // 攻击形态：客户端自称机器/人类/带伪造身份对象——路由必须全部忽略。
    // PR-085 第 1 步起：契约 ReviewRequest 为闭合 schema（additionalProperties:false），伪造身份字段在传输层即被 400 拒绝，
    // 请求根本到不了 handler、账本零记录——比「进 handler 再忽略」更强的构造性防线（授权绝不来自请求参数）。
    const res = await invoke(handler, {
      edgeId: "api|db|DEPENDS_ON|||", action: "approved",
      actorType: "rule", assertedBy: { actorId: "impersonator", actorType: "rule" },
    });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.equal(res.payload.error_code, "VALIDATION_ERROR");
    assert.ok(res.payload.details.errors.some((e) => /additional properties/.test(e)), "须指明多余字段违约");
    const actions = getRuntimeStateStore(vault).review.list();
    assert.equal(actions.length, 0, "伪造身份请求不得落账");
    // 合法请求：身份一律由服务端决定（assertedBy 固定为 operator-context 身份 + human）
    const legit = await invoke(handler, { edgeId: "api|db|DEPENDS_ON|||", action: "approved" });
    assert.equal(legit.statusCode, 200, JSON.stringify(legit.payload));
    assert.deepEqual(
      getRuntimeStateStore(vault).review.list()[0].assertedBy,
      { actorId: "local-architect", actorType: "human" },
      "actorType 必须由服务端决定",
    );
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test("T2 消费端合并：mergeReviewStatus 账本优先——图内 pending + 账本 approved → approved（身份随账本传播，K-P1-2）", () => {
  const graph = { connections: [{ edgeId: "e1", properties: { reviewStatus: "pending" } }] };
  const merged = mergeReviewStatus(graph, [{
    edgeId: "e1", action: "approved", decidedAt: "2026-09-06T00:00:00Z",
    assertedBy: { actorId: "local-architect", actorType: "human" },
  }]);
  assert.equal(merged.connections[0].reviewStatus, "approved");
  // K-P1-2：账本身份传播到边顶层（闸门 assertionActorType 读取链含 relation 顶层）。
  assert.deepEqual(merged.connections[0].assertedBy, { actorId: "local-architect", actorType: "human" });
});

test("T3 消费端合并：无账本记录 → fail-closed 回退 pending + assertedBy 必须清除（不残留机器身份，K-P1-1/K-P1-2）", () => {
  // 预置边带上一轮残留的 assertedBy（模拟图内存量身份）——无账本记录时必须 delete，
  // 否则残留身份成为新的 fail-open 通道（无身份记录的边借残留身份过 APPROVAL_NOT_HUMAN）。
  const graph = {
    connections: [
      { edgeId: "e1", properties: { reviewStatus: "approved" }, assertedBy: { actorId: "stale", actorType: "human" } },
      { edgeId: "e2" },
    ],
  };
  const merged = mergeReviewStatus(graph, []);
  assert.equal(merged.connections[0].reviewStatus, "pending", "图内存量 approved 不再兜底（K-P1-1 fail-closed）");
  assert.equal(merged.connections[1].reviewStatus, "pending", "无任何记录默认 pending");
  assert.equal(merged.connections[0].assertedBy, undefined, "无账本记录时残留 assertedBy 必须被清除（K-P1-2）");
  assert.equal(merged.connections[1].assertedBy, undefined, "无记录边不得有身份");
});

test("T4 消费端合并：同 edge 多条记录取 decidedAt 最新（驳回后重批以最新为准）——身份同样以最新记录为准", () => {
  const graph = { connections: [{ edgeId: "e1" }] };
  const merged = mergeReviewStatus(graph, [
    { edgeId: "e1", action: "approved", decidedAt: "2026-09-06T01:00:00Z", assertedBy: { actorId: "old", actorType: "human" } },
    { edgeId: "e1", action: "rejected", decidedAt: "2026-09-06T02:00:00Z" },
  ]);
  assert.equal(merged.connections[0].reviewStatus, "rejected");
  // 最新记录（rejected）不带身份 → 旧记录身份不得残留。
  assert.equal(merged.connections[0].assertedBy, undefined, "身份以最新账本记录为准，旧记录身份不残留");
});

test("T5 负例：不存在的 edgeId → 404（存在性校验保持）", async () => {
  const { vault } = setupVault();
  try {
    const handler = register(vault);
    const res = await invoke(handler, { edgeId: "nope", action: "approved" });
    assert.equal(res.statusCode, 404);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});
