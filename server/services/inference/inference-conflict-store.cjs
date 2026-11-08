// @responsible: 校验、持久化并复核推理规则冲突及其结构化裁决。
// SPEC-012 WP-A：fsImpl 文件缝（.ledger/inference_rule_conflicts.json 裸写，通道外）退役——
// 持久化改经 runtime-state store（整文档单行事务替换）；原 vault-write-baseline 棘轮条目已清零（基线随 WP-J 退役）。
const path = require("node:path");
const { validDecision } = require("./inference-decision-consumer.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

const FORMAT_VERSION = 1;
const VALID_STATUSES = new Set(["unresolved", "resolved"]);
const LITERAL_ARTIFACT = /^\s*(?:\[.*\]|\{.*\})\s*$/s;

function typedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw typedError("INVALID_CONFLICT", `${field} must be non-empty string`);
  const text = value.trim();
  if (LITERAL_ARTIFACT.test(text)) throw typedError("INVALID_CONFLICT", `${field} contains literal artifact`);
  return text;
}

function validateConclusion(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw typedError("INVALID_CONFLICT", `conclusions[${index}] must be object`);
  const effect = requiredText(raw.effect, `conclusions[${index}].effect`);
  if (!["ASSERT", "WAIVE", "BLOCK", "SUSPEND"].includes(effect)) throw typedError("INVALID_CONFLICT", `conclusions[${index}].effect invalid`);
  if (!Array.isArray(raw.evidence) || raw.evidence.some((item) => typeof item !== "string" || LITERAL_ARTIFACT.test(item))) {
    throw typedError("INVALID_CONFLICT", `conclusions[${index}].evidence invalid`);
  }
  return {
    ...raw,
    ruleId: requiredText(raw.ruleId, `conclusions[${index}].ruleId`),
    subjectNodeId: requiredText(raw.subjectNodeId, `conclusions[${index}].subjectNodeId`),
    conclusionKey: requiredText(raw.conclusionKey, `conclusions[${index}].conclusionKey`),
    effect,
    evidence: [...new Set(raw.evidence.map((item) => item.trim()).filter(Boolean))].sort(),
  };
}

function validateConflict(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw typedError("INVALID_CONFLICT", "conflict must be object");
  if (!VALID_STATUSES.has(raw.status)) throw typedError("INVALID_CONFLICT", "status must be unresolved or resolved");
  if (!Array.isArray(raw.ruleIds) || raw.ruleIds.length < 2) throw typedError("INVALID_CONFLICT", "ruleIds must contain at least two ids");
  if (!Array.isArray(raw.conclusions) || raw.conclusions.length < 2) throw typedError("INVALID_CONFLICT", "conclusions must contain at least two items");
  return {
    ...raw,
    conflictId: requiredText(raw.conflictId, "conflictId"),
    code: requiredText(raw.code, "code"),
    subjectNodeId: requiredText(raw.subjectNodeId, "subjectNodeId"),
    conclusionKey: requiredText(raw.conclusionKey, "conclusionKey"),
    ruleIds: [...new Set(raw.ruleIds.map((item, index) => requiredText(item, `ruleIds[${index}]`)))].sort(),
    conclusions: raw.conclusions.map(validateConclusion),
  };
}

function createInferenceConflictStore({ vaultPath, runtimeState, now = () => new Date().toISOString() } = {}) {
  if (typeof vaultPath !== "string" || !vaultPath.trim()) throw typedError("INVALID_CONFLICT_STORE", "vaultPath required");
  const store = (runtimeState || getRuntimeStateStore(vaultPath)).inference;
  const filePath = "runtime-state.db:inference_conflicts"; // 兼容展示字段（观测/日志用）

  function readEnvelope() {
    const raw = store.getEnvelope();
    if (!raw) return { formatVersion: FORMAT_VERSION, generatedAt: now(), conflicts: [] };
    if (raw.formatVersion !== FORMAT_VERSION || !Array.isArray(raw.conflicts)) {
      throw typedError("CONFLICT_STORE_CORRUPT", "invalid envelope schema");
    }
    try { return { ...raw, conflicts: raw.conflicts.map(validateConflict) }; }
    catch (error) { throw typedError("CONFLICT_STORE_CORRUPT", error.message); }
  }

  function writeEnvelope(conflicts) {
    const envelope = { formatVersion: FORMAT_VERSION, generatedAt: now(), conflicts: conflicts.map(validateConflict) };
    store.putEnvelope(envelope);
    return envelope;
  }

  function list() { return readEnvelope().conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId)); }

  function upsertDetected(detected) {
    if (!Array.isArray(detected)) throw typedError("INVALID_CONFLICT", "detected conflicts must be array");
    const current = readEnvelope().conflicts;
    const byId = new Map(current.map((item) => [item.conflictId, item]));
    for (const raw of detected) {
      const next = validateConflict(raw);
      const prior = byId.get(next.conflictId);
      byId.set(next.conflictId, validateConflict({
        ...prior,
        ...next,
        status: prior && prior.status === "resolved" ? "resolved" : "unresolved",
        resolution: prior && prior.status === "resolved" ? prior.resolution : undefined,
        resolvedBy: prior && prior.status === "resolved" ? prior.resolvedBy : undefined,
        resolvedAt: prior && prior.status === "resolved" ? prior.resolvedAt : undefined,
        firstSeenAt: prior && prior.firstSeenAt ? prior.firstSeenAt : now(),
        lastSeenAt: now(),
      }));
    }
    return writeEnvelope([...byId.values()]).conflicts;
  }

  function review(conflictId, request = {}) {
    const id = requiredText(conflictId, "conflictId");
    if (!request || !["resolve", "reopen"].includes(request.action)) throw typedError("INVALID_REVIEW", "action must be resolve or reopen");
    const reviewer = requiredText(request.reviewer, "reviewer");
    if (request.decision !== undefined && !validDecision(request.decision)) throw typedError("INVALID_REVIEW", "structured decision is invalid");
    const conflicts = readEnvelope().conflicts;
    const index = conflicts.findIndex((item) => item.conflictId === id);
    if (index < 0) throw typedError("CONFLICT_NOT_FOUND", "conflict not found");
    if (request.action === "resolve") {
      const legacyResolution = request.resolution === undefined ? undefined : requiredText(request.resolution, "resolution");
      if (!request.decision && !legacyResolution) throw typedError("INVALID_REVIEW", "resolution or structured decision is required");
      if (request.decision && request.decision.sourceRevision !== conflicts[index].sourceRevision) {
        throw typedError("CONFLICT_SOURCE_CHANGED", "conflict evidence changed; reload before deciding");
      }
      conflicts[index] = validateConflict({ ...conflicts[index], status: "resolved", resolution: legacyResolution, decision: request.decision, operatorId: request.operatorId || reviewer, resolutionReason: requiredText(request.reason, "reason"), resolvedBy: reviewer, resolvedAt: now() });
    } else {
      conflicts[index] = validateConflict({ ...conflicts[index], status: "unresolved", resolution: undefined, decision: undefined, resolutionReason: request.reason && request.reason.trim(), resolvedBy: undefined, operatorId: request.operatorId || reviewer, reopenedBy: reviewer, reopenedAt: now() });
    }
    writeEnvelope(conflicts);
    return conflicts[index];
  }

  return { list, upsertDetected, review, filePath };
}

module.exports = { createInferenceConflictStore, FORMAT_VERSION };
