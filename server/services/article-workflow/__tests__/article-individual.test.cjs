"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectArticleIndividual } = require("../article-individual.cjs");

const fields = { fields: [{ name: "title", type: "string" }] };
const article = "---\narticle_id: example-article\ntitle: 示例\narchitecture_associations:\n  - component_id: service-1\n    product: 示例产品\n    version_since: v1\n---\n正文";

function ontology() {
  return {
    node_types: {
      Document: { allows_relations: ["DOCUMENTS", "APPLIES_TO"], data_properties: { title: { required: true } } },
      KnowledgeArticle: { subClassOf: "Document" },
    },
    relation_types: { DOCUMENTS: {}, APPLIES_TO: {} },
  };
}

test("文章个体按正文身份重算，并继承父类属性和关联类型", () => {
  const actual = projectArticleIndividual(article, ontology(), fields);
  assert.deepEqual(actual, {
    articleId: "example-article",
    classId: "KnowledgeArticle",
    properties: { title: "示例" },
    relations: [
      { type: "DOCUMENTS", target: { componentId: "service-1" } },
      { type: "APPLIES_TO", target: { product: "示例产品", version: "v1" } },
    ],
    errors: [],
  });
  assert.deepEqual(projectArticleIndividual(article, ontology(), fields), actual);
});

test("无稳定身份或现役类时保持未归类", () => {
  assert.equal(projectArticleIndividual("草稿", ontology(), fields).classId, null);
  assert.equal(projectArticleIndividual(article, {}, fields).classId, null);
  const definitions = ontology();
  definitions.node_types.KnowledgeArticle.lifecycle_status = "draft";
  const result = projectArticleIndividual(article, definitions, fields);
  assert.equal(result.classId, null);
  assert.equal(result.articleId, "example-article");
});

test("无效标题和被子类白名单排除的关联明确报告", () => {
  const definitions = ontology();
  definitions.node_types.KnowledgeArticle.allows_relations = ["APPLIES_TO"];
  const result = projectArticleIndividual(article.replace("title: 示例", "title: []"), definitions, fields);
  assert.deepEqual(result.errors.map(({ field }) => field), ["title", "architecture_associations"]);
  assert.deepEqual(result.relations.map(({ type }) => type), ["APPLIES_TO"]);
  assert.notEqual(projectArticleIndividual("---\n[\n---\n", definitions, fields).errors.length, 0);
});

test("绑定配置无法执行时显式拒绝", () => {
  const definitions = ontology();
  definitions.node_types.KnowledgeArticle.subClassOf = "Unknown";
  assert.throws(() => projectArticleIndividual(article, definitions, fields), { code: "UNKNOWN_PARENT_CLASS" });
});

// SPEC-095 §3.0「移动后身份稳定」：身份只由正文字节派生，函数不接收路径——
// 换任意来源/路径取同一正文，个体身份与类判定不变
test("移动不改身份：身份由正文字节单源派生，与来源路径无关", () => {
  const moved = projectArticleIndividual("---\narticle_id: example-article\ntitle: 示例\n---\n正文", ontology(), fields);
  const original = projectArticleIndividual(article, ontology(), fields);
  assert.equal(moved.articleId, original.articleId);
  assert.equal(moved.classId, original.classId);
});

// 红队P1-1回归钉：lifecycle_status 枚举外的无法解释值必须报告（不得静默未归类绕过硬校验）；
// 枚举内非 approved 才按 SPEC-095 §3.0 未归类放行
test("lifecycle_status 非法值显式拒绝，合法非现役才未归类", () => {
  const retired = ontology();
  retired.node_types.KnowledgeArticle.lifecycle_status = "retired";
  assert.equal(projectArticleIndividual(article, retired, fields).classId, null, "retired＝未归类放行");
  const bogus = ontology();
  bogus.node_types.KnowledgeArticle.lifecycle_status = "bogus-not-in-enum";
  assert.throws(() => projectArticleIndividual(article, bogus, fields), { code: "INVALID_LIFECYCLE_STATUS" });
  const malformed = ontology();
  malformed.node_types.KnowledgeArticle = "not-a-record";
  assert.throws(() => projectArticleIndividual(article, malformed, fields), { code: "INVALID_ELEMENT_DEFINITION" });
});
