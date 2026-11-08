// @responsible: 字段中文名在**后端**层的覆盖（test:node 发现）
// @inputs: shared/field-labels.mjs（唯一源）+ contracts/entity-readiness-rules.json（字段登记）+ article-compliance-service
// @outputs: node:test 断言
//
// 为什么要有这一层：此前字典只有前端 vitest 覆盖（src/test/field-labels-ssot.test.ts），
// test:node 侧引用 shared/field-labels.mjs 的测试数为 0——后端链路改坏了没人报。
// 本文件三条：①require(esm) 通路真的通；②字典覆盖契约登记的全部字段（缺一个就静默退化成英文键）；
// ③后端真实下发的 finding.label ≡ 字典（证明后端是从字典取的，不是另抄一份）。
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { FIELD_LABELS, fieldLabel } = require("../../../../shared/field-labels.mjs");
const rules = require("../../../../contracts/entity-readiness-rules.json");
const { checkArticleCompliance } = require("../article-compliance-service.cjs");

const HAS_CJK = /[一-龥]/;

describe("字段中文名 · 后端层覆盖（test:node）", () => {
  it("require(esm) 通路：.cjs 能直接读到 shared/field-labels.mjs", () => {
    assert.equal(typeof fieldLabel, "function");
    assert.equal(fieldLabel("arch_layer", "entity"), "架构分层");
    assert.equal(fieldLabel("title", "article"), "标题");
    // 域分段：title 在两域不同义，缺省域走实体域
    assert.equal(fieldLabel("title"), "实体名称");
  });

  it("契约登记的字段在字典里都有中文名（缺一个就会静默退化成英文键名）", () => {
    for (const key of Object.keys(rules.fields || {})) {
      const label = (FIELD_LABELS.entity || {})[key];
      assert.ok(typeof label === "string" && HAS_CJK.test(label), `实体域字段「${key}」在字典里没有中文名（界面会退化成英文键）`);
    }
    for (const key of Object.keys((rules.article || {}).fields || {})) {
      if (key === "$comment") continue;
      const label = (FIELD_LABELS.article || {})[key];
      assert.ok(typeof label === "string" && HAS_CJK.test(label), `文章域字段「${key}」在字典里没有中文名（界面会退化成英文键）`);
    }
  });

  it("文章域诊断下发的 finding.label ≡ 字典（后端是从字典取的，不是另抄一份）", () => {
    const result = checkArticleCompliance(
      {
        sourcePath: "知识库/raw/precleaned/backend-label-probe.md",
        title: "", articleId: "", product: "", version: "", module: "",
        articleType: "", docType: "", categoryPath: "", tags: [], hasBody: false,
      },
      {},
    );
    const checks = (result.groups || []).reduce((acc, g) => acc.concat(g.checks || []), []);
    assert.ok(checks.length >= 10, `检查项只有 ${checks.length} 条，诊断链路可能没跑起来`);
    for (const c of checks) {
      const expected = (FIELD_LABELS.article || {})[c.field];
      assert.ok(expected, `字段「${c.field}」不在字典里`);
      assert.equal(c.label, expected, `${c.ruleId}（${c.field}）的 label 与字典不一致`);
    }
  });
});
