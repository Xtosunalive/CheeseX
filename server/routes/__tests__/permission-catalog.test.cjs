// WP-211（SPEC-100 批 5）：权限点目录测试。
// 层级：单元＋HTTP（真执行工厂/注册表装配——route-harness 同产线）＋同源对账（目录↔运行时角色门）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRouteHarness, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const { register, buildCatalog } = require("../permission-catalog-routes.cjs");
const { actionRouteRoleFor, getActiveActionSnapshot } = require("../../shared/action-registry.cjs");

const ONTOLOGY = `
node_types: {}
action_types:
  a.plain:
    http_route: PUT /api/schema/ontology
    executor: t.plain
    required_roles: ["admin"]
  a.payload:
    http_route: POST /api/approval/:articleId/transition
    executor: t.payload
    required_roles: ["editor"]
    payload_role_overrides:
      - body_field: decision
        equals: publish
        roles: ["architect"]
`;

function makeVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp211-catalog-"));
  const dir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ontology.yaml"), ONTOLOGY);
  fs.writeFileSync(path.join(dir, "enums.yaml"), "modules: {}\n");
  return vaultPath;
}

test("目录两车道如实分列＋同源自证（含载荷敏感升级语义）", async () => {
  const vaultPath = makeVault();
  setupActionRuntime({ vaultPath });
  const harness = createRouteHarness();
  register((method, pathname, handler) => harness.registerRoute(method, pathname, handler));
  const res = await harness.request("GET /api/permissions/catalog");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const catalog = res.body.data;
  const byId = Object.fromEntries(catalog.actions.map((a) => [a.actionId, a]));
  assert.equal(byId["a.plain"].requiredRoles.join(","), "admin");
  assert.equal(byId["a.payload"].httpRoute, "POST /api/approval/:articleId/transition");
  assert.equal(byId["a.payload"].payloadRoleOverrides.length, 1, "载荷敏感升级入目录");
  assert.ok(catalog.staticRoutes.some((r) => r.route.includes("/api/schema/dependencies/validate")), "静态车道分列");
  // 同源对账：目录角色 ≡ 运行时同一查询口（快照实例直查）
  const snapshot = getActiveActionSnapshot();
  for (const entry of catalog.actions) {
    if (!entry.httpRoute) continue;
    const [method, template] = entry.httpRoute.split(/\s+/);
    const runtime = actionRouteRoleFor(method, template, null, snapshot);
    const expect = byId[entry.actionId].requiredRoles;
    assert.deepEqual(runtime || [], expect || [], `同源：${entry.actionId}`);
  }
  // 载荷敏感语义与运行时一致：decision=publish 时升级为 architect
  const runtimeOverride = actionRouteRoleFor("POST", "/api/approval/:articleId/transition", { decision: "publish" }, snapshot);
  assert.deepEqual(runtimeOverride, ["architect"]);
  assert.deepEqual(byId["a.payload"].payloadRoleOverrides[0].body_field, "decision", "目录承载同一升级语义（键=body_field）");
  teardownActionRuntime();
});

test("纯函数 buildCatalog：排序确定性＋快照缺省容错", () => {
  const catalog = buildCatalog({
    revision: "sha256:x",
    actions: new Map([
      ["b.act", { http_route: "PUT /api/schema/enums", required_roles: [] }],
      ["a.act", { http_route: "PUT /api/schema/ontology", required_roles: ["admin"] }],
    ]),
  });
  assert.deepEqual(catalog.actions.map((a) => a.actionId), ["a.act", "b.act"], "字典序");
  assert.equal(catalog.generatedFrom, "sha256:x");
  const empty = buildCatalog(null);
  assert.deepEqual(empty.actions, []);
  assert.equal(empty.generatedFrom, null);
});
