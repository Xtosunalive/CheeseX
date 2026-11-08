const assert = require("assert");
const test = require("node:test");

const { createNodeIdResolver } = require("../node-id-resolver.cjs");

const nodes = [
  { id: "api-gateway", label: "API Gateway", properties: { architecture_node_id: "gateway-main" } },
  { id: "auth-service", label: "Auth Service", properties: { "architecture-node-id": "auth-main" } },
  { id: "entity-content", label: "Content Service", properties: {} },
  { id: "content-service", label: "Content Service Runtime", properties: {} },
  { id: "ecms-service", label: "ECMS Service", properties: {} },
  { id: "ecms-gateway", label: "ECMS Gateway", properties: {} },
  { id: "duplicate-a", label: "Duplicate", properties: {} },
  { id: "duplicate-b", label: "Duplicate", properties: {} },
];

const edges = [
  { from: "ecms-service", to: "api-gateway" },
  { from: "ecms-service", to: "auth-service" },
  { from: "ecms-gateway", to: "auth-service" },
];

test("精确等值命中：节点键与架构身份", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  assert.strictEqual(resolver.resolveNodeId("api-gateway"), "api-gateway");
  assert.strictEqual(resolver.resolveNodeId("gateway-main"), "api-gateway");
  assert.strictEqual(resolver.resolveNodeId("auth-main"), "auth-service");
});

// WP-107 D2：身份比较只用整串等值（SPEC-046 I2／ADR-016 §二）——折叠互认属"消费方按形状解析 ID"。
// 名称查找（按笔记标题链接）仍承认，但命中方式必须报出来，供上游把"猜的线"显示成猜的。
test("ID 不再折叠互认：仅大小写／标点不同的两个身份是两个身份", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  assert.strictEqual(resolver.resolveNodeId("AUTH-SERVICE"), null, "大小写不同的 ID 不得认成 auth-service");
  assert.strictEqual(resolver.resolveNodeId("api_gateway"), null, "标点差异不得被折叠成 api-gateway");
  assert.strictEqual(resolver.resolveNodeId("GATEWAY-MAIN"), null, "架构身份同样只判等值");
  assert.strictEqual(resolver.resolveNodeId("api-gateway"), "api-gateway", "正对照：精确等值照旧命中");
  assert.strictEqual(resolver.resolveNodeId("gateway-main"), "api-gateway", "正对照：架构身份精确等值照旧命中");
});

test("按名称命中可以，但 via 必须报 label（等值命中报 id/arch-id）", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  assert.deepStrictEqual(resolver.resolveNodeRef("auth service"), { nodeId: "auth-service", via: "label" }, "标题大小写不敏感属名称查找，须标 label");
  assert.deepStrictEqual(resolver.resolveNodeRef("API Gateway"), { nodeId: "api-gateway", via: "label" });
  assert.deepStrictEqual(resolver.resolveNodeRef("api-gateway"), { nodeId: "api-gateway", via: "id" });
  assert.deepStrictEqual(resolver.resolveNodeRef("auth-main"), { nodeId: "auth-service", via: "arch-id" });
  assert.deepStrictEqual(resolver.resolveNodeRef("nope-nothing"), { nodeId: null, via: null });
});

test("撞名与未知值都不猜：同名多节点、无命中一律 null", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  assert.strictEqual(resolver.resolveNodeId("Duplicate"), null, "两个节点共用标题时不任挑一个");
  assert.strictEqual(resolver.resolveNodeId("   "), null);
});

test("影响分析种子剥前缀（查询面，保留）", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  assert.strictEqual(resolver.anchorImpactSeed("entity-api-gateway").nodeId, "api-gateway");
  assert.strictEqual(resolver.anchorImpactSeed("system-auth-service").nodeId, "auth-service");
});

test("影响分析种子仍可用候选与度数（那是用户查询面，不改图连线判据）", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  assert.deepStrictEqual(resolver.anchorImpactSeed("ecms"), {
    nodeId: "ecms-service",
    remappedFrom: "ecms",
  });
});

test("resolves a unique fuzzy impact seed after punctuation normalization", () => {
  const resolver = createNodeIdResolver([
    ...nodes,
    { id: "test-pipeline-verification", label: "test-pipeline-verification", properties: { title: "管线端到端验证节点" } },
  ], edges);
  assert.deepStrictEqual(resolver.anchorImpactSeed("test.."), {
    nodeId: "test-pipeline-verification",
    remappedFrom: "test..",
  });
  assert.deepStrictEqual(resolver.anchorImpactSeed("端到端验证"), {
    nodeId: "test-pipeline-verification",
    remappedFrom: "端到端验证",
  });
  assert.deepStrictEqual(resolver.anchorImpactSeed("service"), {
    nodeId: null,
    remappedFrom: null,
  });
});

test("rejects non-string and blank identifiers", () => {
  const resolver = createNodeIdResolver(nodes, edges);
  for (const value of [null, undefined, [], {}, "   "]) {
    assert.strictEqual(resolver.resolveNodeId(value), null);
    assert.deepStrictEqual(resolver.anchorImpactSeed(value), { nodeId: null, remappedFrom: null });
  }
});
