// 绿灯阶段（缺陷 N1/S7 修复后）：PUT /api/schema/entity-parent 已挂载，
// 委托 schemaWriteService.writeEntityParent(body)，阻断码 SELF_REFERENCE/UNKNOWN_PARENT/
// NON_ENTITY_TARGET/CYCLE_DETECTED 经错误码透传，契约含该路径。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const routes = require("../ontology-routes.cjs");
const { createRouteHarness, mergeW1aActionTypes, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");


function registerRoutes(schemaWriteService) {
  const h = createRouteHarness();
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "entity-parent-routes-"));
  setupActionRuntime({ vaultPath: vault }); // WP-048 W1-A：entity-parent 已动作化
  routes.register(h.registerRoute, {
    vaultPath: vault,
    schemaWriteService,
  });
  return h;
}

function parentError(code, status = 400) {
  const error = new Error(code);
  Object.assign(error, { code, status });
  return error;
}

(async function run() {
  // 1. 路由已注册（红灯断言「无该端点」的翻转）
  const handlers = registerRoutes({ writeEntityParent: () => ({ category: "entity-parent", affectedFile: "知识库/wiki/entities/child.md" }) });
  assert.ok(handlers.routes.has("PUT /api/schema/entity-parent"), "PUT /api/schema/entity-parent 应已注册");

  // 2. 成功写回：body 原样委托给 writeEntityParent，200 + success envelope
  const calls = [];
  const okHandlers = registerRoutes({
    writeEntityParent: (input) => { calls.push(input); return { category: "entity-parent", affectedFile: "知识库/wiki/entities/child.md" }; },
  });
  const written = await okHandlers.call("PUT /api/schema/entity-parent", undefined, { patch: { childId: "child", parentId: "parent" } });
  assert.equal(written.statusCode, 200);
  assert.equal(written.body.success, true);
  assert.equal(written.body.data.category, "entity-parent");
  assert.deepEqual(calls, [{ patch: { childId: "child", parentId: "parent" } }]);

  // 3. 阻断错误透传：SELF_REFERENCE（entity-parent-service.validateParent 抛出）→ 400 + error_code
  const blocked = registerRoutes({
    writeEntityParent: () => { throw parentError("SELF_REFERENCE", 400); },
  });
  const selfRef = await blocked.call("PUT /api/schema/entity-parent", undefined, { patch: { childId: "a", parentId: "a" } });
  assert.equal(selfRef.statusCode, 400);
  assert.equal(selfRef.body.error_code, "SELF_REFERENCE");

  // 4. 服务不可用 → 503（对齐 ontology PUT 的 SCHEMA_WRITE_UNAVAILABLE 防护）
  const noSvc = registerRoutes({});
  const unavailable = await noSvc.call("PUT /api/schema/entity-parent", undefined, { patch: { childId: "a", parentId: "b" } });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.error_code, "SCHEMA_WRITE_UNAVAILABLE");

  // 5. patch 缺失 → 400（PR-085 第 1 步：契约 requestBody.required=["patch"] 由传输层先行校验 → VALIDATION_ERROR；
  //    handler 的 MISSING_PATCH 自检仅对契约未覆盖的形状可达）
  const missingPatch = await okHandlers.call("PUT /api/schema/entity-parent", undefined, {});
  assert.equal(missingPatch.statusCode, 400);
  assert.equal(missingPatch.body.error_code, "VALIDATION_ERROR");
  assert.ok(missingPatch.body.details.errors.some((e) => /patch/.test(e)), "违约明细须指向 patch");

  // 6. childId 缺失 → 400（契约 patch.required=["childId"] 先行 → VALIDATION_ERROR）
  const missingChild = await okHandlers.call("PUT /api/schema/entity-parent", undefined, { patch: { parentId: "b" } });
  assert.equal(missingChild.statusCode, 400);
  assert.equal(missingChild.body.error_code, "VALIDATION_ERROR");
  assert.ok(missingChild.body.details.errors.some((e) => /childId/.test(e)), "违约明细须指向 childId");

  // 7. 契约含 /api/schema/entity-parent PUT（红灯断言「契约无该路径」的翻转）
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "contracts", "http-api.openapi.json"), "utf8"));
  assert.ok(contract.paths["/api/schema/entity-parent"], "契约应包含 /api/schema/entity-parent");
  assert.ok(contract.paths["/api/schema/entity-parent"].put, "契约应声明 PUT 方法");
  assert.ok(contract.paths["/api/schema/entity-parent"].put.requestBody, "契约应声明 requestBody");
  assert.ok(contract.paths["/api/schema/entity-parent"].put.responses["400"], "契约应声明 400（阻断码）");
  assert.ok(contract.paths["/api/schema/entity-parent"].put.responses["404"], "契约应声明 404（ENTITY_NOT_FOUND）");
  assert.ok(contract.paths["/api/schema/entity-parent"].put.responses["503"], "契约应声明 503（SCHEMA_WRITE_UNAVAILABLE）");

  console.log("entity-parent-routes green-light passed（writeEntityParent 已挂 HTTP 端点 + 契约闭环）");
})().catch((error) => { console.error(error); process.exit(1); });
