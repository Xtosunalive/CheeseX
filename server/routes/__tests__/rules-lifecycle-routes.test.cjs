// Component: Rules-Lifecycle-Routes Tests（SPEC-008 §3.1/3.2 路由层）
// @responsible: GET 台账 / POST propose|retire|非法动作 / 错误契约（409 封印透传）。
// @inputs: routes + mock service（真实 service 已有专项测试——路由层测接线）；经 route-harness（Fastify inject）走完整传输层
// @outputs: node:test 断言
const assert = require("node:assert/strict");
const test = require("node:test");
const routes = require("../rules-lifecycle-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// WP-048 W1-A：POST 已动作化——文件级工厂运行时（审计落临时库）
setupActionRuntime({ vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "rules-lifecycle-actions-")) });

test("路由：GET 台账 200；POST propose/retire 200；非法动作 400；封印 409 透传", async () => {
  const h = createRouteHarness();
  const calls = [];
  routes.register(h.registerRoute, {
    rulesLifecycleService: {
      listRules: () => ({ rules: [{ id: "F06", severity: "error", sealed: true }], total: 1, revision: "sha256:x" }),
      proposeRule: (p) => { calls.push(["propose", p]); return { rule: { id: "F18", severity: "warn" }, snapshot: "s" }; },
      retireRule: (p) => { calls.push(["retire", p]); return { rule: { id: "F18", severity: "info" } }; },
    },
  });
  const list = await h.call("GET /api/rules/lifecycle");
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.data.total, 1);

  const prop = await h.call("POST /api/rules/lifecycle", undefined, { action: "propose", check: "enum-ref", field: "module" });
  assert.equal(prop.statusCode, 200, JSON.stringify(prop.body));
  assert.equal(prop.body.data.rule.id, "F18");

  const ret = await h.call("POST /api/rules/lifecycle", undefined, { action: "retire", id: "F18" });
  assert.equal(ret.statusCode, 200, JSON.stringify(ret.body));

  const bad = await h.call("POST /api/rules/lifecycle", undefined, { action: "promote" });
  assert.equal(bad.statusCode, 400);
  assert.ok(["UNSUPPORTED_RULE_ACTION", "VALIDATION_ERROR"].includes(bad.body.error_code), JSON.stringify(bad.body));

  // 非法 JSON：PR-085 第 1 步起由传输层拒绝——原路由自有码 INVALID_JSON 随手写解析退役，统一 VALIDATION_ERROR（契约已同步摘除 INVALID_JSON）
  const malformed = await h.request("POST /api/rules/lifecycle", { rawBody: "{not json" });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.body.error_code, "VALIDATION_ERROR");
});

test("路由：service 缺席 → 503", async () => {
  const h = createRouteHarness();
  routes.register(h.registerRoute, {});
  const r = await h.call("GET /api/rules/lifecycle");
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.error_code, "RULES_SERVICE_UNAVAILABLE");
});

test("路由：service 抛 409（存量封印）→ status/error_code 透传", async () => {
  const h = createRouteHarness();
  const err = new Error("存量规则 F06 的变更属波4 范围");
  err.code = "RULE_SEALED_UNTIL_WAVE4"; err.status = 409; err.details = { wave: 4 };
  routes.register(h.registerRoute, {
    rulesLifecycleService: { listRules: () => ({}), proposeRule: () => { throw err; }, retireRule: () => ({}) },
  });
  const r = await h.call("POST /api/rules/lifecycle", undefined, { action: "propose", id: "F06", check: "x", field: "y" });
  assert.equal(r.statusCode, 409, JSON.stringify(r.body));
  assert.equal(r.body.error_code, "RULE_SEALED_UNTIL_WAVE4");
  assert.deepEqual(r.body.details, { wave: 4 });
});
