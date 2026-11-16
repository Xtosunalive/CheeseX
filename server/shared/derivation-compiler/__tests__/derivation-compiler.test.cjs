"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");
const { compileClassDerivation } = require("../derivation-compiler.cjs");
const { assembleDerivedRoutes } = require("../index.cjs");

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const ontology = yaml.parse(
  fs.readFileSync(path.join(repoRoot, "data/theschema/ontology.yaml"), "utf8")
);
const fields = yaml.parse(
  fs.readFileSync(path.join(repoRoot, "data/theschema/fields.yaml"), "utf8")
);

test("文章类编译：正确生成路由、字段、UI配置", () => {
  const compiled = compileClassDerivation(ontology, fields, "KnowledgeArticle", {
    deterministic: true,
  });
  assert.equal(compiled.classId, "KnowledgeArticle");
  assert.deepEqual(compiled.uiConfig.inheritanceChain, ["Document", "KnowledgeArticle"]);
  assert.equal(compiled.apiRoutes.length, 10);
  assert.ok(compiled.storageFields.some((f) => f.fieldName === "title" && f.required));
  assert.equal(compiled.uiConfig.actionIds.length, 10);
});

test("编译确定性：同输入两次产物完全一致", () => {
  const first = compileClassDerivation(ontology, fields, "KnowledgeArticle");
  const changed = structuredClone(ontology);
  changed.action_types["articles.status"].required_roles = ["review"];
  const revised = compileClassDerivation(changed, fields, "KnowledgeArticle");
  const second = compileClassDerivation(ontology, fields, "KnowledgeArticle");
  assert.deepEqual(first, second);
  assert.notEqual(first.version, revised.version);
  assert.equal(first.apiRoutes.find((route) => route.actionId === "articles.status").pathTemplate, "/api/articles/:id/status");
});

test("编译产物不包含手写逻辑，全部来自本体单源", () => {
  const compiled = compileClassDerivation(ontology, fields, "KnowledgeArticle", {
    deterministic: true,
  });
  for (const route of compiled.apiRoutes) {
    assert.ok(route.actionId);
    assert.ok(route.executor);
    assert.ok(Array.isArray(route.requiredRoles));
  }
});

test("真实 Fastify 注册使用路径参数并拒绝接管异主入口", async () => {
  const app = require("fastify")();
  try {
    const compiled = compileClassDerivation(ontology, fields, "KnowledgeArticle");
    const configuration = {
      compiled,
      registerRoute: (method, url, handler) => app.route({ method, url, handler }),
      executeAction: ({ actionId, request }) => ({ actionId, params: request.params }),
      hasExecutor: () => true,
    };
    const rejected = assembleDerivedRoutes(configuration);
    assert.throws(() => rejected.bind("GET", "/api/articles/:id/status", () => null), /与既有入口冲突/);
    assert.throws(() => rejected.finish(), /与既有入口冲突/);
    const { bind, finish } = assembleDerivedRoutes(configuration);
    bind("GET", "/api/articles/:id/status", () => null, "articles.status");
    finish();
    const response = await app.inject({ url: "/api/articles/article-sample/status" });
    assert.deepEqual(response.json(), { actionId: "articles.status", params: { id: "article-sample" } });
  } finally {
    await app.close();
  }
});
