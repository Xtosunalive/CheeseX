'use strict';
// Component: Document-Keys（文档装载键源单点——WP-138 R5b／SPEC-087 C-6，ADR-016 §二装载入口）
// @responsible: frontmatter 派生键名的唯一声明处。文档装载宿主（document-load-port.cjs）管
//   「解析与类型化取值」，本模块管「键名字符串从哪来」——十服务消费方（实测 require 面；逻辑聚簇六组）（master-graph-service／
//   文章准入链／version-contract／anomaly-issue-collector／gap-detail-declarations／
//   entity-repair）不得再自写字段名清单（ADR-016 装载入口行「不得自写字段名清单」的兑现位）。
// @inputs: 无（纯常量声明；与 contracts/entity-readiness-rules.json article 段的对账由
//   __tests__/document-keys.test.cjs 钉死，契约仍是表单形状唯一事实源，本模块不复制值域/必填）
// @outputs: ARTICLE／ENTITY／GRAPH 三族冻结键名清单（值＝文档 frontmatter 里的逐字拼写）
// @context: Vault（Sync——纯常量，零 IO 零写面）
//
// 等价替换纪律（WP-138 铁律）：本模块只供给键名字符串，不统一各消费方的回落/判空语义——
//   doc-type／category-path 的双拼写回落（`!== undefined` 链、`||` 链、empty 双查）在消费方
//   原样保留，只把字面量换成此处常量；解析/装载行为与产物逐字节不变。
// 豁免面（非键名，不收口）：identitySource 判别值（document-identity 出参标签集）、用户可见
//   文案与错误码串、图工件结构键（nodes/connections/from/to/labels/properties/reviewStatus/
//   relationType/_format_version——extract_graph 工件 schema，非 frontmatter 字段名）、
//   versions.yaml 注册表键（版本注册表 YAML 面）、labels 值域（词表轴，一期管辖）。

/**
 * 文章域 frontmatter 键（草稿/候选/正式文章同一族）。
 * 「契约 article.fields 在册」12 键与 entity-readiness-rules.json article.fields 键集严格相等
 * （测试钉死，双向）；source_file/date/updated/status 为托管与溯源键——契约表单不收录
 * （date/updated/status 系统托管、source_file 溯源锚），但草稿面真实存在（draft-workflow
 * 自动补全写入）。
 */
const ARTICLE = Object.freeze({
  articleId: 'article_id',
  title: 'title',
  product: 'product',
  version: 'version',
  module: 'module',
  articleType: 'article_type',
  docType: 'doc-type',
  /** legacy 拼写（无连字符）——存量文档双拼写回落，消费方各自保留原回落语义 */
  docTypeLegacy: 'doc_type',
  categoryPath: 'category-path',
  /** legacy 拼写（下划线）——存量文档双拼写回落 */
  categoryPathLegacy: 'category_path',
  tags: 'tags',
  /** 虚拟键：正文非 frontmatter 字段，契约 article.fields 在册（A10 规则记账用） */
  body: 'body',
  archLayer: 'arch_layer',
  archCategory: 'arch_category',
  sourceFile: 'source_file',
  date: 'date',
  updated: 'updated',
  status: 'status',
});

/**
 * 实体域 frontmatter 键（wiki/entities 页面）。
 * 「哪个键不许改」归 field-rule-declarations.cjs 的 immutable 位、「允许提交哪些键」归
 * field-policy.cjs 白名单（WP-138 R2）——本族只声明键名拼写，不复制任何规则语义。
 */
const ENTITY = Object.freeze({
  architectureNodeId: 'architecture-node-id',
  /** legacy 拼写（下划线）——存量文档双拼写回落 */
  architectureNodeIdLegacy: 'architecture_node_id',
  archComponent: 'arch_component',
  archLayer: 'arch_layer',
  archCategory: 'arch_category',
  archSubdomain: 'arch_subdomain',
  archSince: 'arch_since',
  archUntil: 'arch_until',
  archVersionOverrides: 'arch_version_overrides',
  title: 'title',
  module: 'module',
  aliases: 'aliases',
  tags: 'tags',
  date: 'date',
  updated: 'updated',
  status: 'status',
});

/**
 * 图属性键：extract_graph 从 frontmatter 搬进节点 properties 袋的派生键
 * （master_graph.json 的 properties 袋内拼写＝frontmatter 字段名逐字）。
 * 图工件自身结构键（nodes/connections/from/to/...）不在本族——那是生产者工件 schema。
 */
const GRAPH = Object.freeze({
  subdomainId: 'subdomain_id',
  domainId: 'domain_id',
  name: 'name',
});

module.exports = { ARTICLE, ENTITY, GRAPH };
