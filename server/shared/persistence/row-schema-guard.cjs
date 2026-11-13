// Component: Row-Schema-Guard（PR-111/WP-020）
// @responsible: SQLite JSON 列行级形状守卫——三列（review_actions.action_json／workflow_state.state_json／
//   article_manifests.manifest_json）写入口的 fail-closed 校验单点；schema 单源本文件（最小形状——
//   只锁结构性必填，不穷举字段，历史合法行零兼容风险）。
// @inputs: rowShape 名（"reviewAction"|"workflowState"|"articleManifest"）＋待写对象
// @outputs: 违约抛 ROW_SCHEMA_VIOLATION（status 500，details.rowShape/instancePath/message）；
//   合法静默通过。**放行约定**：undefined（读侧空态）不归本守卫——只在写入口调用。
// @context: 复用机制确认（Master 2026-10-26「为什么不能用复用机制确认技术方向」）——Ajv 引擎沿
//   theschema-loader.cjs 同款构造（严格模式不 coerce）；「声明＝执法」域原则（gate-governance）：
//   schema 在册即被三写入口执法，不存在在册不执法的第二态。导入通道（runtime-state-import）绕过
//   服务层校验直灌——守卫在 store 层拦截（PR-111 真实裸露面）。
"use strict";

const Ajv = require("ajv").default || require("ajv");

// 最小形状：只锁「结构违约即脏行」的字段（服务层语义校验仍归服务层——本守卫是纵深第二道，不重复第一道）
const ROW_SHAPES = {
  reviewAction: {
    type: "object",
    required: ["action", "reviewer", "decidedAt"],
    properties: {
      action: { type: "string", minLength: 1 },
      reviewer: { type: "string", minLength: 1 },
      decidedAt: { type: "string", minLength: 1 },
      // relation_candidate 族走 candidateId；边裁决族走 source/target——两组必填其一（additionalProperties 放行历史扩展字段）
    },
    // kind 可选三态（历史行多无 kind）：kind=relation_candidate ⇒ candidateId 必填；否则（含无 kind）⇒ source/target 必填
    oneOf: [
      { properties: { kind: { const: "relation_candidate" }, candidateId: { type: "string", minLength: 1 } }, required: ["kind", "candidateId"] },
      { properties: { kind: { not: { const: "relation_candidate" } }, source: { type: "string", minLength: 1 }, target: { type: "string", minLength: 1 } }, required: ["source", "target"] },
    ],
  },
  workflowState: {
    type: "object",
    required: ["schemaVersion", "tasks"],
    properties: {
      schemaVersion: { type: "string", minLength: 1 },
      tasks: { type: "array" },
      articles: { type: "array" },
    },
  },
  articleManifest: {
    type: "object",
    required: ["manifestKey"],
    properties: {
      manifestKey: { type: "string", minLength: 1 },
    },
  },
  // WP-172（SPEC-095 §3.5）：动作审批事件流（requested/decided/used 三形态——type+approval_id
  // 结构必填；语义校验归服务层）。在册即被 store 写入口执法（不存在在册不执法的第二态）。
  actionApprovalEvent: {
    type: "object",
    required: ["type", "approval_id"],
    properties: {
      type: { type: "string", enum: ["requested", "decided", "used"] },
      approval_id: { type: "string", minLength: 1 },
    },
  },
};

const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map();
for (const [name, schema] of Object.entries(ROW_SHAPES)) {
  validators.set(name, ajv.compile(schema));
}

/** 写入口守卫：形状违约抛 ROW_SCHEMA_VIOLATION（fail-closed——脏行不得入库，防 journal 重放放大）。 */
function assertRowShape(rowShape, value) {
  const validate = validators.get(rowShape);
  if (!validate) {
    const error = new Error(`未知行形状名：${rowShape}（合法：${[...validators.keys()].join("/")}`);
    error.code = "ROW_SHAPE_UNKNOWN";
    error.status = 500;
    throw error;
  }
  if (!validate(value)) {
    const first = (validate.errors && validate.errors[0]) || {};
    const instancePath = first.instancePath || "";
    // 红队建议#6：oneOf 双败时首条错误可能指向另一分支（kind:"edge" 缺 source/target 却报 candidateId）——
    // message 汇总各分支必填缺失并集，指对修法方向
    const missingProps = [...new Set((validate.errors || []).filter((e) => e.keyword === "required").map((e) => (e.params && e.params.missingProperty) || ""))].filter(Boolean);
    const message = missingProps.length > 1 ? `缺必填（各分支并集）：${missingProps.join("/")}` : (first.message || "形状不符");
    const error = new Error(`行形状违约〔${rowShape}${instancePath}〕：${message}——结构性脏行拒绝入库（journal 重放会放大脏行）`);
    error.code = "ROW_SCHEMA_VIOLATION";
    error.status = 500;
    error.details = { rowShape, instancePath, message, errors: (validate.errors || []).slice(0, 5).map((e) => `${e.instancePath} ${e.message}`) };
    throw error;
  }
}

module.exports = { assertRowShape, ROW_SHAPES };
