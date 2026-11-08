// seq209-field-label-ssot：字段中文名全库唯一事实源（ESM 载体，前后端共用）
// 载体形态照抄 seq208 的 shared/date-contract.mjs：后端 node≥22 require(esm) 直吃；前端 vite 原生 import；
// checker 零 npm 依赖。零新机制（不新增接口、不构建期导入 JSON、不引第三方）。
//
// 【为什么必须按域分段】title 在实体域叫「实体名称」、在文章域叫「标题」——两个叫法都对，
// 对使用者是两个意思。历史 bug 正是实体/文章混装成一张平表，导致看架构组件时显示了「标题」。
// 消费方一律按自己所处的域取（显式传 domain）；无法确定域的兜底链路走 entity → article 序。
//
// 例外豁免：本文件是字段中文名单源定义处。其余任何文件不得再写字面量中文名
// （防新增立法：src/test/field-labels-ssot.test.ts）。

/** 实体域（frontmatter 实体页属性 + 实体合规检查字段） */
const ENTITY = {
  title: "实体名称",
  "architecture-node-id": "架构组件身份",
  arch_component: "激活为架构组件",
  arch_layer: "架构分层",
  arch_category: "实体类别",
  arch_subdomain: "子域",
  arch_since: "组件有效期起点",
  arch_until: "组件有效期终点",
  arch_version_overrides: "版本属性覆盖",
  module: "产品模块",
  status: "状态",
  date: "创建日期",
  updated: "最后更新日期",
  tags: "标签",
  aliases: "别名",
};

/** 文章域（frontmatter 文章属性 + 文章修复表单字段） */
const ARTICLE = {
  title: "标题",
  article_id: "文章标识",
  product: "产品",
  version: "产品版本",
  module: "产品模块",
  article_type: "知识文章类型",
  "doc-type": "文档类型",
  "category-path": "知识域目录",
  // PR-151：字典必填两字段入文章域。arch_layer UI 名取「架构分层」——与实体域同键同名＋term-const 词表一致
  //（fields.yaml label「架构层级」为 schema 侧文档名，实体页既有分歧先例维持）；arch_category 文章侧用字典名「业务分类」。
  arch_layer: "架构分层",
  arch_category: "业务分类",
  tags: "标签",
  // body（正文）只出现在文章域诊断（A10），没有 control、不进补齐表单；补齐表单用显式清单
  // （CandidateFieldForm 的 COMPLETABLE_FIELDS / article-workflow 的契约键序），故多这一项不影响表单形状。
  body: "正文",
};

export const FIELD_LABELS = { entity: ENTITY, article: ARTICLE };

/**
 * 字段中文名唯一读取入口。
 * @param {unknown} field 字段名（技术键）
 * @param {"entity" | "article" | undefined} domain 显式域；省略时按 entity → article 兜底序（混域展示链路）
 * @returns {string} 中文名；空/非法输入回 ""，未登记字段回字段名本身（不吞信息，由调用方兜底）
 */
export function fieldLabel(field, domain) {
  if (typeof field !== "string" || !field.trim()) return "";
  if (domain) {
    const table = FIELD_LABELS[domain];
    return (table && table[field]) || field;
  }
  return ENTITY[field] || ARTICLE[field] || field;
}
