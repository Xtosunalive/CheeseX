// Component: Gap-Detail-Declarations — gap 缺口人话文案唯一声明处（WP-031/PR-146，学 field-rule-declarations 先例）。
// @responsible: 五类治理缺口 detail 文案的模板与插值——gap-engine 构造缺口时从这里取，
//   前端不映射不替换（GovernanceTodoTab 的 formatGapDetail 替换表已删——后端下发什么显示什么）。
// @discipline: 修改文案必须同批过 gap-engine.test.cjs 文案断言（用例 14：内部话术禁词）——
//   禁词面：master_graph、labels:、入度+出度、REFERENCES、管道——它们是内部技术物，不出现在用户可见文案。

"use strict";

/** 实体标签集的人话名（labels 值 → 用户语言）——cross_domain_ref 的归属说明用 */
const LABEL_PLAIN_NAMES = Object.assign(Object.create(null), { // WP-050 D1：内容标签（constructor 族）直取不可表达，回落「其他类型」
  BusinessDomain: "业务域",
  Subdomain: "子域",
  Team: "团队",
  Document: "文档",
  Concept: "概念",
  System: "产品系统",
});

function plainLabels(labels) {
  var arr = Array.isArray(labels) ? labels.filter(Boolean) : [];
  if (arr.length === 0) return "其他类型";
  // WP-116 批1：内容标签（labels 值）显式 own 分支（WP-050 执法形态）——表已 null 原型（:10），
  // 此处把「隐式取值＋truthy」收敛为显式 own 判定；在册值回落语义逐字保持（空值仍回落「其他类型」）。
  return arr.map(function (l) { return (Object.hasOwn(LABEL_PLAIN_NAMES, l) && LABEL_PLAIN_NAMES[l]) || "其他类型"; }).join("、");
}

/** 五类缺口 detail 唯一声明处——参数经插值，产出即用户可见文案 */
const GAP_DETAIL = {
  isolated_entity: function (p) {
    return "实体「" + p.label + "」与其他实体没有任何连接关系，处于孤立状态——请补连接或确认其独立有效";
  },
  missing_document_ref: function (p) {
    return "实体「" + p.label + "」没有被任何文档引用——请补一篇引用它的文档";
  },
  low_confidence: function (p) {
    return "「" + p.fromLabel + "」到「" + p.toLabel + "」的依赖关系可信度较低（" + p.confidence.toFixed(2) + "，低于确认线 " + p.threshold.toFixed(2) + "）——请人工复核这条关系";
  },
  dangling_dependency: function (p) {
    return "实体「" + p.fromLabel + "」依赖的「" + p.toLabel + "」还不存在于图谱中——请先建立该实体，或修正这条依赖";
  },
  cross_domain_ref: function (p) {
    return "实体「" + p.fromLabel + "」引用了「" + p.toLabel + "」，但它不是架构实体（属于：" + p.targetKind + "）——跨类引用请确认是否应改为对实体的引用";
  },
};

module.exports = { GAP_DETAIL, plainLabels };
