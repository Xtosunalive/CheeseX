// field-rule-declarations —— F 族字段校验规则声明（代码内单源；Master 2026-10-27「做就做彻底」裁定）
//
// 降档裁定：F 族（实体 frontmatter 字段校验）从运行时规则台账（entity-readiness-rules.json + 生命周期
// 通道）降档为代码内声明——业界对位（Zod/Pydantic/Jakarta 注解）：字段校验规则长在代码里，git 管版本，
// 不配生命周期仪式。registry 只留真规则（B 族正文关系检查）+ 信号立规通道。
//
// 纪律：
// - 本文件是 F 族唯一声明处；id/message/severity/gates 逐字节保留搬入前口径（问题台/修复写门/
//   E2E 断言引用 ruleId，口径不变=测试零迁移）。
// - 单字段事实（必填/值域）与 fields.yaml 的字段字典语义同源（字典管表单元数据，此处管校验执行）；
//   跨字段/跨实体约束（唯一性/版本序/政策矩阵）本就只能在代码表达。
// - 改规则=改本文件+发版；severity 翻转史上 0 次（2026-10-27 盘点），不需要运行时切换。
// - node --watch 生效链照旧：改本文件自动重启（与改 JSON 声明时代行为等价）。
"use strict";

/** F 族 19 条：实体 frontmatter 字段校验（从 entity-readiness-rules.json rules[] 逐字节迁入） */
const FIELD_RULES = [
  {
   "id": "F01",
   "field": "title",
   "group": "identity",
   "check": "required",
   "severity": "error",
   "message": "实体名称（title）是必填字段",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "required": true,
   "dimension": "completeness",
 },
  {
   "id": "F02",
   "field": "architecture-node-id",
   "group": "identity",
   // ADR-016 §二／SPEC-046 I2：消费方不得对 ID 做 split／正则解析——身份只欠不撞与不变，形状不入裁决
   "check": "required",
   "severity": "error",
   "message": "架构组件身份（architecture-node-id）是必填字段，当前值：{actual}",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "required": true,
   "dimension": "completeness",
   // D-1（WP-108）：不可修改从代码里的裸 if 升成声明——服务端拒写与前端只读渲染同读这一位
   "immutable": true,
 },
  {
   "id": "F02b",
   "field": "architecture-node-id",
   "group": "identity",
   "check": "unique-id",
   "severity": "error",
   "message": "架构组件身份「{actual}」已被其他实体使用，全库必须唯一——已被：{holders}",
   "gates": [
     "pipeline.stage-0-5",
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
   ],
   "dimension": "uniqueness",
 },
  {
   "id": "F02c",
   "field": "title",
   "group": "identity",
   "check": "unique-title",
   "severity": "error",
   "message": "实体名称「{actual}」与其他实体重复，全库必须唯一（同义名可用 aliases 声明，当前未启用）",
   "gates": [],
   "dimension": "uniqueness",
 },
  {
   "id": "F03",
   "field": "arch_component",
   "group": "identity",
   "check": "exact-true",
   "severity": "error",
   "message": "激活为架构组件必须显式设为 true",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "required": true,
   "dimension": "validity",
 },
  {
   "id": "F04",
   "field": "arch_layer",
   "group": "spatial",
   "check": "enum-ref",
   "enumKey": "archLayers",
   "aliasKey": "layerAliases",
   "severity": "warn",
   "onEmpty": "warn",
   "message": "架构分层「{actual}」不在注册表层名单中",
   "emptyMessage": "建议填写架构分层（arch_layer）",
   "gates": [],
   "dimension": "validity",
 },
  {
   "id": "F05",
   "field": "arch_category",
   "group": "spatial",
   "check": "enum-ref",
   "enumKey": "archCategories",
   "aliasKey": "categoryAliases",
   "severity": "warn",
   "onEmpty": "warn",
   "message": "实体类别「{actual}」不在注册表类别名单中",
   "emptyMessage": "建议填写实体类别（arch_category）",
   "gates": [],
   "dimension": "validity",
 },
  {
   "id": "F05b",
   "field": "arch_category",
   "group": "spatial",
   "check": "subdomain-policy",
   "severity": "error",
   "message": "子域「{subdomain}」不允许实体类别「{actual}」，该子域允许：{expected}",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "validity",
 },
  {
   "id": "F06",
   "field": "arch_subdomain",
   "group": "spatial",
   "check": "enum-ref",
   "enumKey": "subdomainIds",
   "aliasKey": "subdomainAliases",
   "severity": "warn",
   "onEmpty": "warn",
   "message": "子域（arch_subdomain）取值「{actual}」无效",
   "emptyMessage": "建议填写子域（arch_subdomain）",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "validity",
 },
  {
   "id": "F07",
   "field": "arch_since",
   "group": "version",
   "check": "semver",
   "severity": "error",
   "onEmpty": "warn",
   "message": "组件有效期起点格式无效：{actual}（示例：7.0.6）",
   "emptyMessage": "建议填写组件有效期起点（arch_since）",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "validity",
 },
  {
   "id": "F08",
   "field": "arch_until",
   "group": "version",
   "check": "semver",
   "severity": "error",
   "message": "组件有效期终点格式无效：{actual}（示例：7.5.0，长期有效可留空）",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "validity",
 },
  {
   "id": "F09",
   "field": "arch_since/arch_until",
   "group": "version",
   "check": "semver-order",
   "severity": "error",
   "message": "组件有效期起点（{since}）必须早于或等于组件有效期终点（{until}）——组件可以只在单个版本有效（两个填同一版本）",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "consistency",
 },
  {
   "id": "F10",
   "field": "arch_version_overrides",
   "group": "version",
   "check": "array-entry-semver",
   "severity": "error",
   "message": "版本属性覆盖第 {index} 项的 version 无效：{actual}（应为 semver）",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "validity",
 },
  {
   "id": "F11",
   "field": "module",
   "group": "organization",
   "check": "enum-ref",
   "enumKey": "moduleNames",
   "severity": "warn",
   "onEmpty": "warn",
   "message": "产品模块「{actual}」不在注册表模块名单中",
   "emptyMessage": "建议填写产品模块（module）",
   "gates": [],
   "dimension": "validity",
 },
  {
   "id": "F12",
   "field": "date",
   "group": "temporal",
   "check": "date",
   "severity": "error",
   "message": "创建日期（date）缺失或格式无效（应为 YYYY-MM-DD）——系统托管字段，出现异常说明文件疑被绕过系统手改",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "required": true,
   "dimension": "completeness",
   "system": true,
   "sentinel": true,
 },
  {
   "id": "F13",
   "field": "updated",
   "group": "temporal",
   "check": "date",
   "severity": "error",
   "onEmpty": "warn",
   "message": "最后更新日期格式无效：{actual}（应为 YYYY-MM-DD）——系统托管字段，出现异常说明文件疑被绕过系统手改",
   "emptyMessage": "建议由系统自动维护最后更新日期（updated）——手工置空疑为绕过系统手改",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "dimension": "validity",
   "system": true,
   "sentinel": true,
 },
  {
   "id": "F15",
   "field": "status",
   "group": "temporal",
   "check": "enum-ref",
   "enumKey": "statuses",
   "severity": "error",
   "message": `状态（status）缺失或取值无效（当前值：{actual}）——受控值域：${require("./status-transition-guard.cjs").STATUS_MACHINE.values.join("/")}；迁移须走审批状态机`, // WP-049 余量批：值域从状态机单源派生
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "required": true,
   "dimension": "validity",
   "system": true,
   "sentinel": true,
   "transitionCheck": true,
 },
  {
   "id": "F16",
   "field": "tags",
   "group": "content",
   "check": "array-nonempty",
   "severity": "error",
   "message": "标签（tags）是必填字段，请至少填写一个标签（可多个，使用列表保存）",
   "gates": [
     "entity-repair.apply-create",
     "entity-repair.preview-edit",
     "pipeline.stage-0-5",
   ],
   "required": true,
   "dimension": "completeness",
 },
  {
   "id": "F17",
   "field": "aliases",
   "group": "identity",
   "check": "alias-collision",
   "severity": "warn",
   "message": "别名「{actual}」与其他实体冲突：{owners}——别名不得撞他人正名，也不得与其他别名互相撞（同义名请归并到唯一持有者）",
   "gates": [],
   "dimension": "uniqueness",
 }
];

/**
 * 文章族写门字段声明（WP-110／D-1 收口批）——与 F 族同文件同纪律：字段级校验长在代码里、git 管版本，
 * 不进 registry 生命周期通道（2026-10-27 降档裁定）。本表只管「写门上什么不可改」；
 * 文章域必填清单与字段→枚举键映射的事实源仍是 contracts/entity-readiness-rules.json 的 article 段。
 * 三处消费方共读：写门拒（entity-repair-service 文章分支）、能力位（article-compliance-service finding）、
 * 前端只读（EntityRepairDrawer 经 finding.editable）。
 * 不并入 FIELD_RULES：该数组被 write-gate-policy 与 Ajv 引擎按「实体 frontmatter 校验规则」消费，
 * 文章族条目混入会让引擎对实体也长出 article_id 检查（跨族污染）。
 */
const ARTICLE_GATE_RULES = [
  {
    "field": "article_id",
    "check": "immutable",
    "severity": "error",
    // 文案逐字节保留迁移前服务端裸 if 的原话——对外语义零变化（WP-110 non_goals 第 1 条）
    "message": "不允许重命名已有 article_id",
    "immutable": true,
  },
];

module.exports = { FIELD_RULES, ARTICLE_GATE_RULES };
