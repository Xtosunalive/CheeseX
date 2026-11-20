// WP-207（SPEC-100 批 1）：派生契约段生成器纯函数测试。
// 层级：单元（生成器纯函数 deriveOpenApiSegment／checkParity——真实手写契约做对账底座）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const scriptPath = path.join(__dirname, "..", "..", "..", "scripts", "generate-derivation-contract.mjs");

async function loadGenerator() {
  return import(pathToFileURL(scriptPath).href);
}

const FIXTURE_ONTOLOGY = {
  action_types: {
    "a.body": { http_route: "PUT /api/schema/ontology", class_id: "KnowledgeArticle", executor: "e1", input_schema: { type: "object", properties: { name: { type: "string" } } } },
    "a.nobody": { http_route: "GET /api/schema/enums", class_id: "KnowledgeArticle", executor: "e2" },
    "a.param": { http_route: "POST /api/articles/lifecycle/:articleId/promote", class_id: "KnowledgeArticle", executor: "e3" },
    "a.retired": { http_route: "PUT /api/schema/fields", class_id: "KnowledgeArticle", executor: "e4", lifecycle_status: "retired" },
  },
};

test("deriveOpenApiSegment：只收 approved；:param 转 {param}；input_schema 派生 requestBody；GET 不带 body；路径字典序", async () => {
  const gen = await loadGenerator();
  const segment = gen.deriveOpenApiSegment(FIXTURE_ONTOLOGY);
  const keys = Object.keys(segment.paths);
  assert.deepEqual(keys, ["/api/articles/lifecycle/{articleId}/promote", "/api/schema/enums", "/api/schema/ontology"].sort(), "retired 剔除＋字典序");
  const bodyOp = segment.paths["/api/schema/ontology"].put;
  assert.equal(bodyOp.operationId, "a.body");
  assert.deepEqual(bodyOp.tags, ["KnowledgeArticle"]);
  assert.equal(bodyOp.requestBody.content["application/json"].schema.type, "object", "input_schema 派生 requestBody");
  assert.ok(!segment.paths["/api/schema/enums"].get.requestBody, "GET 不带 body");
  const paramOp = segment.paths["/api/articles/lifecycle/{articleId}/promote"].post;
  assert.equal(paramOp.operationId, "a.param", ":param 转 {param} 后仍命中真实契约路径");
  assert.equal(segment.schema_version, 1);
});

test("checkParity：真实手写契约做底座——在册路由零缺项；编造路由显式 missing", async () => {
  const gen = await loadGenerator();
  const ok = gen.checkParity(gen.deriveOpenApiSegment(FIXTURE_ONTOLOGY));
  assert.deepEqual(ok.missing, [], "夹具路由全部在册（真实契约）");
  const ghost = gen.deriveOpenApiSegment({
    action_types: { "a.ghost": { http_route: "POST /api/not-in-contract", class_id: "X", executor: "e" } },
  });
  const bad = gen.checkParity(ghost);
  assert.deepEqual(bad.missing, ["POST /api/not-in-contract"], "手写契约缺项显式可见（fail-closed 不放松）");
});

test("确定性：同输入两次派生字节一致（--check 字节对拍的前提）", async () => {
  const gen = await loadGenerator();
  const a = JSON.stringify(gen.deriveOpenApiSegment(FIXTURE_ONTOLOGY));
  const b = JSON.stringify(gen.deriveOpenApiSegment(FIXTURE_ONTOLOGY));
  assert.equal(a, b);
});
