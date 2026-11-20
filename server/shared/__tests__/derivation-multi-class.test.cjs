// WP-207（SPEC-100 批 1）：多类推广纯函数测试。
// 层级：单元（compileAllClassDerivations／assembleDerivedRoutes 多类计划面——纯函数，无 vault）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { compileAllClassDerivations, assembleDerivedRoutes } = require("../derivation-compiler/index.cjs");

const FIXTURE_FIELDS = {
  classes: {
    article: { properties: [{ name: "title" }, { name: "article_id" }] },
    entity: { properties: [{ name: "question" }, { name: "faq_id" }] },
  },
};

const FIXTURE_ONTOLOGY = {
  node_types: {
    KnowledgeArticle: { data_properties: { title: {} } },
    FaqCard: { data_properties: { question: {}, faq_id: {} } },
    RetiredThing: { lifecycle_status: "retired", data_properties: { x: {} } },
  },
  action_types: {
    "a.ontology": { http_route: "PUT /api/schema/ontology", class_id: "KnowledgeArticle", executor: "e.ontology", required_roles: ["admin"] },
    "a.enums": { http_route: "PUT /api/schema/enums", class_id: "FaqCard", executor: "e.enums", required_roles: [] },
    "a.retired": { http_route: "PUT /api/schema/fields", class_id: "RetiredThing", lifecycle_status: "retired", executor: "e.x" },
  },
};

test("compileAllClassDerivations：approved 类全遍历（retired 剔除），各类路由计划独立成计划", () => {
  const plans = compileAllClassDerivations(FIXTURE_ONTOLOGY, FIXTURE_FIELDS);
  const byId = Object.fromEntries(plans.map((p) => [p.classId, p]));
  assert.deepEqual(plans.map((p) => p.classId).sort(), ["FaqCard", "KnowledgeArticle"], "retired 类剔除");
  assert.ok(byId.KnowledgeArticle.apiRoutes.some((r) => r.actionId === "a.ontology"));
  assert.ok(byId.FaqCard.apiRoutes.some((r) => r.actionId === "a.enums"), "第二类动作入计划——多类推广核心实证");
});

test("compileAllClassDerivations：单类编译失败降级为 error 计划（显式可见不丢类）", () => {
  const broken = {
    node_types: { Bad: { data_properties: null, subClassOf: "不存在" } },
    action_types: {},
  };
  const plans = compileAllClassDerivations(broken, {});
  assert.ok(plans.some((p) => p.classId === "Bad" && p.error), "失败计划带 error 计数可见");
});

test("assembleDerivedRoutes 多类：执行器缺位的额外计划路由入 pendingRoutes 显式不安装；有执行器即安装", () => {
  const installed = [];
  const compiled = { apiRoutes: [{ actionId: "a.main", method: "POST", pathTemplate: "/api/main/:id", executor: "e.ok" }] };
  const additionalPlans = [
    { classId: "FaqCard", apiRoutes: [{ actionId: "a.faqOk", method: "POST", pathTemplate: "/api/faq-ok", executor: "e.ok" }] },
    { classId: "Lazy", apiRoutes: [{ actionId: "a.lazy", method: "POST", pathTemplate: "/api/lazy", executor: "e.missing" }] },
  ];
  const asm = assembleDerivedRoutes({
    compiled,
    additionalPlans,
    registerRoute: (method, p, handler) => installed.push(`${method} ${p}`),
    executeAction: () => {},
    hasExecutor: (id) => id === "e.ok",
  });
  const summary = asm.finish();
  assert.ok(installed.includes("POST /api/main/:id"), "主计划安装");
  assert.ok(installed.includes("POST /api/faq-ok"), "有执行器的额外类计划安装（多类推广生效）");
  assert.ok(!installed.includes("POST /api/lazy"), "缺执行器不安装（不假绿）");
  assert.deepEqual(summary.pendingRoutes.map((p) => p.actionId), ["a.lazy"], "pending 显式可见");
  assert.equal(summary.plannedTotal, 3);
});

test("assembleDerivedRoutes：已绑定安装但执行器缺位＝严格抛（接线 bug 响亮，语义不放松）", () => {
  const asm = assembleDerivedRoutes({
    compiled: { apiRoutes: [{ actionId: "a.main", method: "POST", pathTemplate: "/api/main", executor: "e.missing" }] },
    additionalPlans: [],
    registerRoute: () => {},
    executeAction: () => {},
    hasExecutor: () => false,
  });
  asm.bind("POST", "/api/main", () => {}, "a.main");
  assert.throws(() => asm.finish(), /缺少登记执行器/);
});
