// @responsible: 消费结构化推理裁决并映射为处置状态与写入许可。
const EFFECT_TO_STATUS = { ASSERT: "change_required", WAIVE: "waived", BLOCK: "blocked", SUSPEND: "review_required" };

function consumerError(code, message, status = 409, details) {
  const error = new Error(`${code}: ${message}`); error.code = code; error.status = status; error.details = details; return error;
}

function validDecision(decision) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return false;
  if (!["select_effect", "select_rules", "defer", "reopen"].includes(decision.decision)) return false;
  if (decision.decision === "select_effect" && !["ASSERT", "WAIVE", "BLOCK", "SUSPEND"].includes(decision.selectedEffect)) return false;
  if (decision.selectedRuleIds !== undefined && (!Array.isArray(decision.selectedRuleIds) || decision.selectedRuleIds.some((item) => typeof item !== "string" || !item.trim()))) return false;
  return typeof decision.sourceRevision === "string" && decision.sourceRevision.trim().length > 0;
}

function createInferenceDecisionConsumer() {
  function consume({ candidates = [], decision = null, sourceRevision = null } = {}) {
    if (!Array.isArray(candidates)) throw consumerError("INVALID_DECISION_INPUT", "candidates must be an array", 400);
    const effects = [...new Set(candidates.map((item) => item && item.effect).filter(Boolean))];
    const conflict = effects.includes("ASSERT") && (effects.includes("WAIVE") || effects.includes("BLOCK"));
    if (decision && !validDecision(decision)) throw consumerError("INVALID_STRUCTURED_DECISION", "结构化裁决格式不合法", 400);
    if (decision && sourceRevision && decision.sourceRevision !== sourceRevision) return { status: "stale", effect: null, writeAllowed: false, conflict, reasonCode: "SOURCE_NOT_FRESH" };
    if (conflict && (!decision || decision.decision !== "select_effect")) return { status: "conflicted", effect: null, writeAllowed: false, conflict, reasonCode: "RULES_CONFLICT" };
    if (!decision || decision.decision === "defer" || decision.decision === "reopen") return { status: "review_required", effect: null, writeAllowed: false, conflict, reasonCode: "DECISION_REQUIRED" };
    const effect = decision.selectedEffect || (candidates.find((item) => decision.selectedRuleIds?.includes(item.ruleId)) || {}).effect;
    if (!EFFECT_TO_STATUS[effect]) throw consumerError("INVALID_STRUCTURED_DECISION", "裁决没有可执行 effect", 400);
    return { status: EFFECT_TO_STATUS[effect], effect, writeAllowed: effect !== "BLOCK" && effect !== "SUSPEND", conflict, reasonCode: decision.reasonCode || "STRUCTURED_DECISION" };
  }
  function assertWriteAllowed(result) {
    if (!result || result.writeAllowed !== true) throw consumerError("REASONING_CONFLICT_UNRESOLVED", "推理裁决未允许当前写入动作", 409, { status: result && result.status, reasonCode: result && result.reasonCode });
    return result;
  }
  return { consume, assertWriteAllowed };
}

module.exports = { createInferenceDecisionConsumer, validDecision, EFFECT_TO_STATUS };
