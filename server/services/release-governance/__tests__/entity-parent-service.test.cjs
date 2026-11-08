// entity-parent-service 网关校验回归（PR-091 关账固化——2026-10-22 按复用机制「网关约束」口径裁定 (a)：
// 实体 frontmatter 的 schema 引用一致性由实体写网关写时拒，schema 门禁不扩面〔版图已定性内容域〕）。
// 钉扎四条网关拒绝语义：自引用／未知父／非实体目标／成环——任一回归即红。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createEntityParentService } = require("../entity-parent-service.cjs");

// 单元层（Adapter 语义注入——真实 vault 集成由 e2e 实体流覆盖）：
// 图：node-a（entity）→ node-b（entity）→ node-c（entity）；node-d（document 类型，非实体）。
function makeService(extraIds = new Set()) {
  const ids = new Set(["node-a", "node-b", "node-c", "node-d", ...extraIds]);
  const types = new Map([["node-d", "Document"], ["node-a", "Entity"], ["node-b", "Entity"], ["node-c", "Entity"]]);
  return createEntityParentService({
    vaultPath: "/tmp/cheeseh-pr091-fixture",
    readEntityIds: () => ids,
    readEntityType: (id) => types.get(id) || "Entity",
    logger: { info() {}, error() {} },
  });
}

test("绿：合法父子（已知实体目标）＋解除父（null → action remove）", () => {
  const svc = makeService();
  assert.deepEqual(svc.validateParent("node-a", "node-b"), { valid: true, action: "set" });
  assert.deepEqual(svc.validateParent("node-a", null), { valid: true, action: "remove" });
});

test("红证：自引用被网关拒（SELF_REFERENCE）", () => {
  assert.throws(() => makeService().validateParent("node-a", "node-a"), (e) => e.code === "SELF_REFERENCE");
});

test("红证：悬空引用被网关拒（UNKNOWN_PARENT——PR-091 核心语义：parent_id 指向不存在实体即 blocker）", () => {
  assert.throws(() => makeService().validateParent("node-a", "ghost-node"), (e) => e.code === "UNKNOWN_PARENT");
});

test("红证：非实体目标被网关拒（NON_ENTITY_TARGET——Document 不能当父）", () => {
  assert.throws(() => makeService().validateParent("node-a", "node-d"), (e) => e.code === "NON_ENTITY_TARGET");
});
