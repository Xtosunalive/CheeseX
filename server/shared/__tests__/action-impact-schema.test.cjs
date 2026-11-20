// WP-207（SPEC-100 批 1）：动作影响面（impact）声明形状验收。
// 层级：单元（legislation schema 直验——声明面立法：合法声明过门，未声明合法，坏形状拒收）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const schemaPath = path.join(__dirname, "..", "..", "..", "contracts", "theschema.ontology.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const actionSchema = {
  ...schema.definitions.actionType,
  definitions: schema.definitions,
};

test("impact 合法声明过门：class_id＋operation（枚举）＋fields 必填", () => {
  const ajv = new Ajv();
  const validate = ajv.compile(actionSchema);
  const ok = validate({
    class_id: "KnowledgeArticle",
    http_route: "PUT /api/schema/ontology",
    impact: [{ class_id: "KnowledgeArticle", operation: "modify", fields: ["title", "article_id"], description: "改标题" }],
  });
  assert.equal(validate.errors, null, JSON.stringify(validate.errors));
  assert.ok(ok);
});

test("impact 坏形状拒收：operation 越枚举／缺 fields／多余键", () => {
  const ajv = new Ajv();
  const validate = ajv.compile(actionSchema);
  assert.equal(validate({ http_route: "PUT /api/schema/ontology", impact: [{ class_id: "X", operation: "upsert", fields: ["a"] }] }), false, "operation 越枚举");
  assert.equal(validate({ http_route: "PUT /api/schema/ontology", impact: [{ class_id: "X", operation: "modify" }] }), false, "缺 fields");
  assert.equal(validate({ http_route: "PUT /api/schema/ontology", impact: [{ class_id: "X", operation: "modify", fields: ["a"], extra: 1 }] }), false, "additionalProperties false");
});

test("未声明 impact 合法（声明面可选——未声明不报错）", () => {
  const ajv = new Ajv();
  const validate = ajv.compile(actionSchema);
  assert.ok(validate({ class_id: "KnowledgeArticle", http_route: "PUT /api/schema/ontology" }));
});
