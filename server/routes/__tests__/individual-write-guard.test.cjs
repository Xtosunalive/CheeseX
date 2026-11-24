// WP-228（SPEC-101 §3.4-1）：个体通道写执法测试——守卫注入后，create/update/retire
// 对不该经通用个体通道的类一律 422 INDIVIDUAL_CHANNEL_FORBIDDEN（details.reason 点名判据），
// config 是只读动作不套写守卫；放行类照常透传 service；守卫缺省（既有测试族形态）行为不变。
// 真库矩阵（六类抽样）在 compile-type-catalog.test.cjs 的 individualWriteAllowed 段钉住。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRouteHarness, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const { registerIndividualExecutors } = require("../../shared/individual-executors.cjs");
const { register } = require("../individual-routes.cjs");

const FIXTURE_ONTOLOGY = `
node_types:
  Notebook:
    display_name: 记事本
    data_properties:
      title:
        required: true
action_types:
  individuals.config:
    http_route: GET /api/individuals/:classId/config
    executor: generic:config
    required_roles: []
  individuals.create:
    http_route: POST /api/individuals/:classId
    executor: generic:create
    required_roles: []
  individuals.update:
    http_route: PUT /api/individuals/:classId/:individualId
    executor: generic:update
    required_roles: []
  individuals.retire:
    http_route: POST /api/individuals/:classId/:individualId/retire
    executor: generic:retire
    required_roles: []
`;

function buildRuntime(writeGuard) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp228-guard-"));
  const dir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ontology.yaml"), FIXTURE_ONTOLOGY);
  fs.writeFileSync(path.join(dir, "enums.yaml"), "modules: {}\n");
  fs.writeFileSync(path.join(dir, "fields.yaml"), JSON.stringify({ schema_version: 2, keys: {}, classes: {} }));
  setupActionRuntime({ vaultPath });
  const harness = createRouteHarness();
  const calls = [];
  const service = new Proxy({}, { get: (_t, prop) => (...args) => { calls.push(prop); return { ok: true, args, classId: args[0] }; } });
  const factory = require("../../shared/action-execution-factory.cjs");
  registerIndividualExecutors({
    service,
    registerActionExecutor: (id, fn) => factory.registerActionExecutor(id, fn),
    uiConfigFor: (classId) => ({ classId, fields: [] }),
    ...(writeGuard !== undefined ? { writeGuard } : {}),
  });
  register((method, pathname, handler, actionId) => harness.registerRoute(method, pathname, handler, actionId), { uiConfigFor: (classId) => ({ classId, fields: [] }) });
  return { harness, calls, vaultPath };
}

test("守卫拒绝：storage 非 markdown-individual 的类，三个写口全 422 且 reason 点名，config 仍可读", async () => {
  const { harness, calls, vaultPath } = buildRuntime((classId) => (classId === "KnowledgeArticle"
    ? { allowed: false, reason: "TYPE_STORAGE_NOT_INDIVIDUAL" }
    : { allowed: true, reason: null }));
  try {
    for (const [key, call] of [
      ["POST /api/individuals/:classId", { params: { classId: "KnowledgeArticle" }, body: { fields: { title: "x" } } }],
      ["PUT /api/individuals/:classId/:individualId", { params: { classId: "KnowledgeArticle", individualId: "n1" }, body: { fields: { title: "x" }, expectedRevision: "r" } }],
      ["POST /api/individuals/:classId/:individualId/retire", { params: { classId: "KnowledgeArticle", individualId: "n1" }, body: { expectedRevision: "r" } }],
    ]) {
      const res = await harness.request(key, call);
      assert.equal(res.status, 422, `${key} 应 422（实得 ${res.status}:${res.body?.error_code}）`);
      assert.equal(res.body.error_code, "INDIVIDUAL_CHANNEL_FORBIDDEN");
      assert.equal(res.body.details.reason, "TYPE_STORAGE_NOT_INDIVIDUAL");
    }
    const cfg = await harness.request("GET /api/individuals/:classId/config", { params: { classId: "KnowledgeArticle" } });
    assert.equal(cfg.status, 200, "只读 config 不得被个体写守卫误拦");
    assert.deepEqual(calls, [], "被拒写类不得触达 service");
  } finally {
    teardownActionRuntime();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("守卫放行：markdown-individual 类照常透传 service（含 config）", async () => {
  const { harness, calls, vaultPath } = buildRuntime(() => ({ allowed: true, reason: null }));
  try {
    const res = await harness.request("POST /api/individuals/:classId", { params: { classId: "Notebook" }, body: { fields: { title: "x" } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(calls.includes("create"));
    const cfg = await harness.request("GET /api/individuals/:classId/config", { params: { classId: "Notebook" } });
    assert.equal(cfg.status, 200);
  } finally {
    teardownActionRuntime();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("守卫缺省：不注入 writeGuard 时行为不变（既有测试族形态）", async () => {
  const { harness, calls, vaultPath } = buildRuntime();
  try {
    const res = await harness.request("POST /api/individuals/:classId", { params: { classId: "Notebook" }, body: { fields: { title: "x" } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(calls.includes("create"));
  } finally {
    teardownActionRuntime();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});
