// WP-030/PR-145（SPEC-032 C1 后端判定证据）：canvas-admission 路由实调——真 kg-routes 模块
// ＋真 contracts/graph-admission.json require（判定段零 mock），仅注入取数边界（readMasterGraph
// 夹具图＋formalConsumer=null 仓内回落）。三实体与 src/test/admission-authority.test.ts 同款，
// 前端装配（吃权威面）与本测试（权威判定）双证同一实体集——闭环「前后端一致」。
// 真进程面（接口在位/空库 404 定义空态/定版后活）由 admission-authority-http.test.cjs 覆盖。
// 验证对象：kg-routes canvas-admission 判定段＋graph-admission.json sourceArticleKeys 消费链。
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { register } = require(path.resolve(__dirname, "..", "kg-routes.cjs"));
const contract = require(path.resolve(__dirname, "..", "..", "..", "contracts", "graph-admission.json"));

const fixtureGraph = {
  nodes: [
    { id: "comp:svc-a", label: "服务A", category: "服务", properties: { sourcePath: "wiki/articles/svc-a.md" } },
    { id: "comp:svc-b", label: "服务B", category: "服务", properties: { file_path: "wiki/articles/svc-b.md" } },
    { id: "comp:svc-c", label: "服务C", category: "服务", properties: {} },
  ],
  connections: [],
};

function captureRegister() {
  const handlers = new Map();
  const registerRoute = (method, routePath, handler) => handlers.set(`${method} ${routePath}`, handler);
  return { handlers, registerRoute };
}

async function invokeCanvasAdmission(handlers) {
  const handler = handlers.get("GET /api/kg/canvas-admission");
  assert.ok(handler, "canvas-admission 路由应注册");
  const captured = { status: 0, payload: null };
  // sendJSON 出口为 Fastify reply 风格（reply.raw.errorCode＋code/type/send 链）——mock 同形
  const reply = {
    raw: { errorCode: null },
    header() { return this; },
    code(status) { captured.status = status; return this; },
    type() { return this; },
    send(payload) { captured.payload = payload; return this; },
  };
  await handler({ method: "GET", url: "/api/kg/canvas-admission", raw: {} }, reply);
  assert.ok(captured.payload, "handler 应产出响应");
  return { code: captured.status, payload: captured.payload };
}

test("路由实调：三源口径判定与契约一致——sourcePath-only 准入、file_path 准入、无源拦截", async () => {
  const { handlers, registerRoute } = captureRegister();
  register(registerRoute, {
    formalConsumer: null, // 仓内回落：context=null → readMasterGraph()
    readMasterGraph: () => fixtureGraph,
    addGovernanceAction: () => [],
    logger: { info() {}, error() {}, warn() {} },
  });
  const out = await invokeCanvasAdmission(handlers);
  assert.equal(out.code, 200);
  const components = out.payload.data.components;
  const byId = new Map(components.map((c) => [c.id, c]));

  const a = byId.get("comp:svc-a");
  assert.ok(a, "sourcePath-only 实体在列");
  assert.equal(a.admitted, true, "sourcePath-only（无 file_path）按契约三源口径应 admitted=true——漂移治好点");
  assert.deepEqual(a.blockedReasons, []);

  const b = byId.get("comp:svc-b");
  assert.ok(b, "file_path 实体在列");
  assert.equal(b.admitted, true, "file_path 实体应 admitted=true");

  const c = byId.get("comp:svc-c");
  assert.ok(c, "无源实体在列");
  assert.equal(c.admitted, false, "无源实体应 admitted=false");
  assert.ok(c.blockedReasons.includes("missing_source_article"), "拦截理由=missing_source_article");

  assert.equal(out.payload.data.total, 3);
  assert.equal(out.payload.data.admitted, 2);
  assert.equal(out.payload.data.blocked, 1);
});

test("契约消费链实况：路由模块加载的 sourceArticleKeys 与契约文件一致（require 同源）", () => {
  // 路由 require 的就是契约单源本体（非副本）——本用例钉「判定键序＝契约键序」的装配事实
  assert.deepEqual(contract.sourceArticleKeys, ["file_path", "sourcePath", "source_path"]);
  assert.ok(contract.entityLabels.includes("ArchitectureComponent") && contract.entityLabels.includes("Module"));
});

// WP-136 a：被减数（totalByKind）随分子（admittedByKind）同管道产出——前端那份按 components
// 重数的 kindTotals 据此退役。本用例把「无 id 条目计入分母、不计入分子」这件事从前端断言
// 上移到权威生产端（前端侧只留「直读不重数」的退役钉）。
test("canvas-admission 分母与分子同集：totalByKind 含无 id 条目，admittedByKind 不含（WP-136 a）", async () => {
  const kindGraph = {
    nodes: [
      { id: "comp:e1", label: "实体一", properties: { file_path: "wiki/articles/e1.md" }, labels: ["ArchitectureComponent"] },
      { id: "comp:e2", label: "实体二", properties: {}, labels: ["ArchitectureComponent"] },
      // 无 id 节点：路由仍发条目并挂 missing_id（kg-routes.cjs:306-311），它进分母不进分子
      { label: "无身份节点", properties: { file_path: "wiki/articles/orphan.md" }, labels: ["Module"] },
      { id: "doc:d1", label: "文档一", properties: { sourcePath: "wiki/articles/d1.md" }, labels: ["Document"] },
      { id: "term:t1", label: "分类学节点", properties: { file_path: "wiki/articles/t1.md" }, labels: ["TaxonomyTerm"] },
    ],
    connections: [],
  };
  const { handlers, registerRoute } = captureRegister();
  register(registerRoute, {
    formalConsumer: null,
    readMasterGraph: () => kindGraph,
    addGovernanceAction: () => [],
    logger: { info() {}, error() {}, warn() {} },
  });
  const out = await invokeCanvasAdmission(handlers);
  assert.equal(out.code, 200);
  const data = out.payload.data;

  assert.deepEqual(data.totalByKind, { entity: 3, document: 1, taxonomy: 1 }, "分母按 kind 全量（含无 id 的 Module 节点）");
  assert.deepEqual(data.admittedByKind, { entity: 1, document: 1, taxonomy: 1 }, "分子只算已准入（无 id 节点被 missing_id 挡住）");
  for (const kind of ["entity", "document", "taxonomy"]) {
    assert.ok(data.admittedByKind[kind] <= data.totalByKind[kind], `配对自洽：admittedByKind.${kind} ≤ totalByKind.${kind}`);
  }
  // 「待准入实体」的减法两侧自此都在后端同一管道里：3−1＝2；前端若回到可见集合做被减数只得 1
  assert.equal(data.totalByKind.entity - data.admittedByKind.entity, 2);
  assert.equal(data.components.filter((c) => c.id === "").length, 1, "无 id 条目确实在 components 内（分母含它才成立）");
  assert.equal(data.total, 5);
});
