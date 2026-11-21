// WP-208（SPEC-100 批 2）：通用个体面 HTTP 全链路测试——真执行工厂（前置/审计 decisions 流水）
// ＋真 vault 写。层级：HTTP／端到端单批（route-harness 同产线装配）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRouteHarness, setupActionRuntime, teardownActionRuntime } = require("./helpers/route-harness.cjs");
const { createIndividualCrudService } = require("../../services/ontology/individual-crud-service.cjs");
const { registerIndividualExecutors } = require("../../shared/individual-executors.cjs");
const { registerIndividualRoutes } = require("../individual-routes.cjs");

const GENERIC_ONTOLOGY = `
node_types:
  FaqCard:
    data_properties:
      question: {}
      faq_id: {}
action_types:
  individuals.create:
    http_route: POST /api/individuals/:classId
    executor: generic:create
    required_roles: []
  individuals.list:
    http_route: GET /api/individuals/:classId
    executor: generic:list
    required_roles: []
  individuals.read:
    http_route: GET /api/individuals/:classId/:individualId
    executor: generic:read
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

function makeVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp208-http-"));
  const dir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ontology.yaml"), GENERIC_ONTOLOGY);
  fs.writeFileSync(path.join(dir, "enums.yaml"), "modules: {}\n");
  return vaultPath;
}

test("generic:create 经执行工厂 HTTP 全链路：创建→读回→退役→list 清零", async () => {
  const vaultPath = makeVault();
  setupActionRuntime({ vaultPath });
  const harness = createRouteHarness();
  const service = createIndividualCrudService({
    vaultPath,
    logger: null,
    loadFields: () => ({ classes: { entity: { properties: [{ name: "question" }, { name: "faq_id" }, { name: "answer" }] } } }),
  });
  service.setBindingsResolver((classId) => ({ class_id: classId, data_properties: { question: { binding: { required: true } }, answer: {}, faq_id: {} } }));
  registerIndividualExecutors({ service, registerActionExecutor: (id, fn) => {
    // 经测试注入口挂进工厂同源注册表（与产线 registerActionExecutor 同函数族）
    require("../../shared/action-execution-factory.cjs").registerActionExecutor(id, fn);
  } });
  require("../individual-routes.cjs").register((method, pathname, handler, actionId) => harness.registerRoute(method, pathname, handler, actionId));

  const created = await harness.request("POST /api/individuals/:classId", { params: { classId: "FaqCard" }, body: { fields: { question: "什么是通用执行器？", answer: "一份代码服务所有类" } } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const individualId = created.body.data.individualId;
  assert.ok(individualId, "个体 ID 已铸造");

  const read = await harness.request("GET /api/individuals/:classId/:individualId", { params: { classId: "FaqCard", individualId } });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.fields.question, "什么是通用执行器？");
  const revision = read.body.data.revision;

  const updated = await harness.request("PUT /api/individuals/:classId/:individualId", { params: { classId: "FaqCard", individualId }, body: { fields: { answer: "更新后的答案" }, expectedRevision: revision } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  const retired = await harness.request("POST /api/individuals/:classId/:individualId/retire", { params: { classId: "FaqCard", individualId }, body: { expectedRevision: updated.body.data.revision } });
  assert.equal(retired.status, 200);

  const list = await harness.request("GET /api/individuals/:classId", { params: { classId: "FaqCard" } });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data, [], "退役后 list 清零");

  // 审计面：执行工厂 decisions 流水已落（individuals.create 事件在案）
  const journal = path.join(vaultPath, ".ledger", "decisions.jsonl");
  const audit = fs.existsSync(journal) ? fs.readFileSync(journal, "utf8") : "";
  assert.ok(audit.includes("individuals.create"), "执行工厂审计流水已落（可追溯口径）");
  teardownActionRuntime();
});

test("缺必填字段经 HTTP 拒 422（fail-closed 全链路不假绿）", async () => {
  const vaultPath = makeVault();
  setupActionRuntime({ vaultPath });
  const harness = createRouteHarness();
  const service = createIndividualCrudService({ vaultPath, logger: null, loadFields: () => ({}) });
  service.setBindingsResolver((classId) => ({ class_id: classId, data_properties: { question: { binding: { required: true } } } }));
  registerIndividualExecutors({ service, registerActionExecutor: (id, fn) => require("../../shared/action-execution-factory.cjs").registerActionExecutor(id, fn) });
  require("../individual-routes.cjs").register((method, pathname, handler, actionId) => harness.registerRoute(method, pathname, handler, actionId));
  const res = await harness.request("POST /api/individuals/:classId", { params: { classId: "FaqCard" }, body: { fields: {} } });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  teardownActionRuntime();
});
