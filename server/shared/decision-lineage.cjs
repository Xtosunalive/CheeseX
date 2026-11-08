const crypto = require("node:crypto");

const FRESHNESS_STATUSES = new Set(["fresh", "stale", "unknown"]);

function lineageError(message, details) {
  const error = new Error(message);
  error.code = "INVALID_DECISION_LINEAGE";
  error.details = details;
  return error;
}

function text(value, field, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw lineageError(`${field} must be a non-empty string`);
  }
  if (typeof value !== "string" || !value.trim()) throw lineageError(`${field} must be a non-empty string`);
  const normalized = value.trim();
  if (/^\s*(?:\[.*\]|\{.*\})\s*$/s.test(normalized)) throw lineageError(`${field} contains a serialized literal artifact`);
  return normalized;
}

function hash(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return text(value, field);
}

function normalizeSource(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw lineageError("source must be an object");
  const sourcePath = text(raw.path || raw.sourcePath, "source.path");
  const coordinate = text(raw.coordinate || `path:${sourcePath}`, "source.coordinate");
  const lineNumber = raw.lineNumber === undefined || raw.lineNumber === null ? null : raw.lineNumber;
  if (lineNumber !== null && (!Number.isInteger(lineNumber) || lineNumber < 1)) throw lineageError("source.lineNumber must be a positive integer or null");
  return {
    kind: text(raw.kind || "vault-document", "source.kind"),
    path: sourcePath,
    contentHash: hash(raw.contentHash || raw.sourceHash, "source.contentHash"),
    lineNumber,
    coordinate,
  };
}

function normalizeRule(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw lineageError("rule must be an object");
  return {
    ruleId: text(raw.ruleId, "rule.ruleId"),
    ruleRevision: hash(raw.ruleRevision, "rule.ruleRevision"),
    reasonCode: text(raw.reasonCode, "rule.reasonCode"),
  };
}

function normalizeScope(raw) {
  // PR-082（Master 2026-10-20 批）：产品身份可选——元层态（无挂载主体）的决策证据
  // 不携带 scope，缺席＝null（下游零生产消费方，实证 2026-10-20）；携带时仍要求非空合法
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw lineageError("scope must be an object");
  return {
    product: text(raw.product, "scope.product"),
    version: text(raw.version, "scope.version"),
  };
}

function normalizeDecision(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw lineageError("decision must be an object");
  const decidedAt = text(raw.decidedAt, "decision.decidedAt");
  if (Number.isNaN(Date.parse(decidedAt))) throw lineageError("decision.decidedAt must be an ISO date");
  return {
    decisionId: text(raw.decisionId, "decision.decisionId"),
    operatorId: text(raw.operatorId, "decision.operatorId"),
    kind: raw.kind === undefined ? "manual" : text(raw.kind, "decision.kind"),
    decidedAt,
  };
}

function normalizeFreshness(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw lineageError("freshness must be an object");
  const status = text(raw.status, "freshness.status");
  if (!FRESHNESS_STATUSES.has(status)) throw lineageError("freshness.status is invalid");
  const checkedAt = text(raw.checkedAt, "freshness.checkedAt");
  if (Number.isNaN(Date.parse(checkedAt))) throw lineageError("freshness.checkedAt must be an ISO date");
  const changedFields = Array.isArray(raw.changedFields) ? raw.changedFields.map((item, index) => text(item, `freshness.changedFields[${index}]`)) : [];
  return { status, checkedAt, changedFields: [...new Set(changedFields)].sort() };
}

function normalizeLineage(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw lineageError("lineage must be an object");
  return {
    source: normalizeSource(raw.source),
    rule: normalizeRule(raw.rule),
    scope: normalizeScope(raw.scope),
    decision: normalizeDecision(raw.decision),
    freshness: normalizeFreshness(raw.freshness),
  };
}

function stableDecisionId(parts) {
  const input = Array.isArray(parts) ? parts : [parts];
  // PR-082：scope 缺席（元层态）时其 part 为 null——hash 只收集在场段，不虚造占位值
  const present = input.filter((item) => item !== undefined && item !== null && item !== "");
  return `decision-${crypto.createHash("sha256").update(present.map((item) => text(item, "decision.id.part")).join("\0")).digest("hex").slice(0, 24)}`;
}

// Stateless decision-evidence builder. Normalizes an input into a full decision lineage,
// filling defaults for decisionId/operator/kind/decidedAt/freshness. Persisting the built
// evidence remains the write-owner's responsibility (governance); this is a pure construct
// contract that analysis consumers may reuse without importing a governance service.
function createDecisionEvidenceService({ now = () => new Date(), operatorId = "local-architect" } = {}) {
  function build(input = {}) {
    const currentTime = now().toISOString();
    const decision = input.decision || {};
    return normalizeLineage({
      source: input.source,
      rule: input.rule,
      scope: input.scope,
      decision: {
        decisionId: decision.decisionId || stableDecisionId([input.source?.coordinate || input.source?.path, input.rule?.ruleId, input.scope?.product, input.scope?.version]),
        operatorId: decision.operatorId || operatorId,
        kind: decision.kind || "automatic",
        decidedAt: decision.decidedAt || currentTime,
      },
      freshness: input.freshness || { status: "fresh", checkedAt: currentTime, changedFields: [] },
    });
  }

  return { build };
}

module.exports = { FRESHNESS_STATUSES, createDecisionEvidenceService, normalizeLineage, normalizeSource, normalizeRule, normalizeScope, normalizeDecision, normalizeFreshness, stableDecisionId };
