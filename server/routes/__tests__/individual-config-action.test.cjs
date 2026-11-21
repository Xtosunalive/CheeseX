// WP-213（红队 M1①）：config 端点动作化回归——individuals.config 动作经执行工厂全链路
// （route 字面量入测试树＝action-coverage tripwire 覆盖面；派生 UI 配置语义断言）。
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
  FaqCard:
    data_properties:
      question:
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
`;

const FIELDS_FIXTURE = {
  schema_version: 2,
  keys: { entity: { primary: "individual_id", display: "question" }, article: { primary: "article_id", display: "title" }, faq_card: { primary: "individual_id", display: "question" } },
  classes: {
    entity: { properties: [{ name: "question", display: "问题", type: "string", required: "是", layer: "内容属性", description: "测试夹具属性", value_domain: { source: "free" } }] },
    article: { properties: [{ name: "title", display: "标题", type: "string", required: "是", layer: "内容属性", description: "测试夹具属性", value_domain: { source: "free" } }] },
    FaqCard: { properties: [{ name: "question", display: "问题", type: "string", required: "是", layer: "内容属性", description: "测试夹具属性", value_domain: { source: "free" } }] },
  },
};

test("config 端点动作化：GET /api/individuals/:classId/config 经执行工厂返回派生 UI 配置", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp213-config-"));
  const dir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ontology.yaml"), FIXTURE_ONTOLOGY);
  fs.writeFileSync(path.join(dir, "enums.yaml"), "modules: {}\n");
  fs.writeFileSync(path.join(dir, "fields.yaml"), JSON.stringify(FIELDS_FIXTURE));
  setupActionRuntime({ vaultPath });
  const harness = createRouteHarness();
  const uiConfigFor = (classId) => {
    const { readOntology } = require("../../services/schema-manager/ontology-write-service.cjs");
    const resolved = require("../../shared/ontology-inheritance-resolver.cjs").resolveClassInheritance(readOntology(vaultPath).data, classId, require("../../shared/vocab-load-port.cjs").loadVocabBundle(vaultPath, { files: ["fields"] }).files.fields.data);
    return {
      classId,
      fields: Object.entries(resolved.data_properties || {}).map(([name, def]) => ({
        name,
        display: "问题",
        required: Boolean(def.binding && def.binding.required === true),
        type: String(def.type || "text"),
        declared: true,
      })),
      actions: { create: "POST /api/individuals/{classId}", list: "", read: "", update: "", retire: "" },
    };
  };
  registerIndividualExecutors({ service: {}, registerActionExecutor: (id, fn) => require("../../shared/action-execution-factory.cjs").registerActionExecutor(id, fn), uiConfigFor });
  register((method, pathname, handler, actionId) => harness.registerRoute(method, pathname, handler, actionId));
  return harness.request("GET /api/individuals/:classId/config", { params: { classId: "FaqCard" } }).then((res) => {
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.classId, "FaqCard");
    assert.deepEqual(res.body.data.fields.map((f) => [f.name, f.required]), [["question", true]], "绑定 required 透传（单层 binding——批 6 修后形状）");
    assert.equal(res.body.data.actions.create, "POST /api/individuals/{classId}", "generic:* 动作路由表随 config 供给");
    teardownActionRuntime();
  });
});
