// Component: Field-Policy（字段白名单谓词单点）
// @responsible: 实体/文章两域字段白名单的唯一声明与判定——诊断/写门/渲染三个 view 的字段域从这里派生
//   （PR-250 → WP-138 R2，方案决策卡《单源收口四替换-2026-11-07》§2 R2）
// @inputs: contracts/entity-readiness-rules.json（fields 段＝实体受管字段声明；article 段＝文章域字段声明）
//          ＋ server/shared/field-rule-declarations.cjs（F 族声明表——别名写通道锚定 F17；2026-11-07 自 services 迁入修正 ADR-004 反向 require）
// @outputs: 谓词 canEdit/canRepair/canRender ＋ 四个 view 字段集常量
// @context: Sync（纯函数、零 IO；契约与声明表的 require 是构建期已入库事实，非运行时读取）
//
// ── 三个 view 是不同的语义面，差异原样保留、不强行合一（PR-250 三处白名单错位的根即在此）──
// 1. 诊断 view（canEdit / DIAGNOSIS_FIELDS，14 项）＝诊断侧现值通道键域＋能力位基线。
//    不含 aliases：诊断对别名只做 F17 防撞标注，不持现值通道——「写门接受 aliases、诊断侧不含」
//    的语义差是历史裁决（复核 C2，WP-110），不是抄漏，禁止在此"补齐"。
// 2. 写门 view（canRepair / ENTITY_WRITE_FIELDS 15 项、ARTICLE_WRITE_FIELDS 11 项）＝修复 changes
//    接受键域。实体域＝诊断 ∪ 别名写通道；文章域＝契约 article.fields 键 − body。
// 3. 渲染 view（canRender / RENDER_FIELDS，21 项）＝修复抽屉字段行可见域＝两域写门并集。
//    可见性＝字段 ∈ 本域（受管字段一律成行，含只读行）；可改性＝检查上的 editable 能力位
//    （WP-110/D-1a 判据分离，消费方 repairable-fields.ts）。
//
// 派生关系（单一事实源，抄本零容忍）：
//   DIAGNOSIS_FIELDS      = keys(READINESS.fields)                        —— 与路由 CREATE 分支同一 fields 段
//   ENTITY_WRITE_FIELDS   = DIAGNOSIS_FIELDS ∪ 别名写通道（锚定 F17 声明）
//   ARTICLE_WRITE_FIELDS  = keys(READINESS.article.fields) − 正文（body）
//   RENDER_FIELDS         = ENTITY_WRITE_FIELDS ∪ ARTICLE_WRITE_FIELDS
"use strict";

const READINESS = require("../../contracts/entity-readiness-rules.json");
const { FIELD_RULES } = require("./field-rule-declarations.cjs");

// ── view 字段集（派生，无手抄清单）──

// 契约键卫生：以 $ 开头的键是 JSON 注释元数据（如 article.fields.$comment），不是字段——
// 差分实测发现 article.fields 内嵌 $comment，不过滤会混进写门（12≠11）。
const IS_FIELD_KEY = (key) => typeof key === "string" && key.length > 0 && key.charAt(0) !== "$";

// 诊断 view：契约 fields 段键序（14 项——与 entity-compliance-declarative-engine.RULE_FIELDS 同一段）
const DIAGNOSIS_FIELDS = new Set(Object.keys(READINESS.fields || {}).filter(IS_FIELD_KEY));

// 别名写通道：锚定 F 族声明表的 aliases 规则（F17）——声明表撤掉别名诊断，本通道随之关闭（fail-closed）。
// 这是策略声明不是自由字面量：aliases 的写通道资格由 FIELD_RULES 在场性背书。
const ALIAS_WRITE_CHANNEL = FIELD_RULES.some((rule) => rule.field === "aliases") ? ["aliases"] : [];

// 写门 view·实体域：诊断 ∪ 别名写通道（15 项）
const ENTITY_WRITE_FIELDS = new Set([...DIAGNOSIS_FIELDS, ...ALIAS_WRITE_CHANNEL]);

// 正文域字段：不是 frontmatter 修复对象（契约 article.fields 同段以「无 control 占位登记」声明同一语义；
// 文章修复写门只接受 frontmatter 键，正文另有通道）。
const ARTICLE_CONTENT_FIELDS = ["body"];

// 写门 view·文章域：契约 article.fields 键 − 正文 − $ 注释键（11 项）
const ARTICLE_WRITE_FIELDS = new Set(
  Object.keys((READINESS.article && READINESS.article.fields) || {}).filter(
    (field) => IS_FIELD_KEY(field) && ARTICLE_CONTENT_FIELDS.indexOf(field) < 0
  )
);

// 渲染 view：两域写门并集（21 项）
const RENDER_FIELDS = new Set([...ENTITY_WRITE_FIELDS, ...ARTICLE_WRITE_FIELDS]);

/** @typedef {"entity" | "article"} FieldDomainView */
/** @typedef {{ domain?: FieldDomainView }} FieldPolicyCtx */

/**
 * 诊断侧 view：字段是否在诊断现值通道键域内（能力位基线；immutable 收敛由消费方按现值叠加——
 * 见 entity-compliance-service.decorateFindings 的 D-1 语义）。
 * @param {string} field 字段名
 * @param {FieldPolicyCtx} [_ctx] 诊断 view 仅实体域；文章域诊断能力位由 article-compliance-service
 *   经 ARTICLE_GATE_RULES 输出，不经本谓词
 * @returns {boolean}
 */
function canEdit(field, _ctx) {
  return DIAGNOSIS_FIELDS.has(field);
}

/**
 * 写门侧 view：修复 changes 是否接受该键（repair-service.validateChanges 的白名单判定）。
 * @param {string} field 字段名
 * @param {FieldPolicyCtx} [ctx] domain 缺省按实体域（写门历史上实体先立，文章分支显式传域）
 * @returns {boolean}
 */
function canRepair(field, ctx) {
  const domain = ctx && ctx.domain === "article" ? "article" : "entity";
  return domain === "article" ? ARTICLE_WRITE_FIELDS.has(field) : ENTITY_WRITE_FIELDS.has(field);
}

/**
 * 渲染门槛 view：修复抽屉字段行是否可见。缺省＝跨域并集（与历史前端渲染门槛逐字段等价——
 * 旧 EDITABLE 集合即为两域写门并集，21 项）；显式传域按该域写门判定。
 * @param {string} field 字段名
 * @param {FieldPolicyCtx} [ctx]
 * @returns {boolean}
 */
function canRender(field, ctx) {
  if (ctx && ctx.domain === "article") return ARTICLE_WRITE_FIELDS.has(field);
  if (ctx && ctx.domain === "entity") return ENTITY_WRITE_FIELDS.has(field);
  return RENDER_FIELDS.has(field);
}

module.exports = {
  canEdit,
  canRepair,
  canRender,
  DIAGNOSIS_FIELDS,
  ENTITY_WRITE_FIELDS,
  ARTICLE_WRITE_FIELDS,
  RENDER_FIELDS,
};
