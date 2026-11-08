// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// @responsible: 校验并规范化关系候选的三元组、证据和稳定身份哈希。
const crypto = require("node:crypto");
const { resolveAssertionPolicy } = require("../../shared/relation-capability-selector.cjs");
const { SNAPSHOT_HASH_PATTERN } = require("../../shared/version-contract.cjs"); // seq195：sha256 形状单源（审计族 R 收敛）

function contractError(code, message, details) {
  const error = new Error(message);
  Object.assign(error, { code, status: 422 });
  if (details !== undefined) error.details = details;
  return error;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw contractError("RELATION_CANDIDATE_INVALID", `${field} must be non-empty`);
  return value.trim();
}

function optionalRevision(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, field);
}

function requiredHash(value, field) {
  const normalized = requiredText(value, field);
  if (!SNAPSHOT_HASH_PATTERN.test(normalized)) throw contractError("RELATION_CANDIDATE_INVALID", `${field} must be sha256:<64 hex>`);
  return normalized;
}

function requiredEnum(value, field, allowed) {
  const normalized = requiredText(value, field);
  if (!allowed.includes(normalized)) throw contractError("RELATION_CANDIDATE_INVALID", `${field} must be one of: ${allowed.join(", ")}`);
  return normalized;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function identity(prefix, value) {
  return `${prefix}-${hash(value).slice(7)}`;
}

function normalizeEvidence(raw, path) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw contractError("RELATION_EVIDENCE_INVALID", `${path} must be an object`);
  const evidence = {
    sourceKind: requiredText(raw.sourceKind, `${path}.sourceKind`),
    producer: requiredText(raw.producer, `${path}.producer`),
    coordinate: requiredText(raw.coordinate, `${path}.coordinate`),
    sourcePath: optionalRevision(raw.sourcePath, `${path}.sourcePath`),
    snippet: optionalRevision(raw.snippet, `${path}.snippet`),
    contentHash: requiredHash(raw.contentHash, `${path}.contentHash`),
    sourceRevision: requiredText(raw.sourceRevision, `${path}.sourceRevision`),
    ruleRevision: optionalRevision(raw.ruleRevision, `${path}.ruleRevision`),
    modelRevision: optionalRevision(raw.modelRevision, `${path}.modelRevision`),
    policyRevision: optionalRevision(raw.policyRevision, `${path}.policyRevision`),
  };
  evidence.evidenceId = identity("relev", evidence);
  if (raw.evidenceId && raw.evidenceId !== evidence.evidenceId) {
    throw contractError("RELATION_EVIDENCE_ID_MISMATCH", `${path}.evidenceId does not match evidence content`);
  }
  return evidence;
}

function normalizeTriple(raw, index, registry) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw contractError("RELATION_TRIPLE_INVALID", `triples[${index}] must be an object`);
  if (raw.approved === true || raw.reviewStatus === "approved") throw contractError("RELATION_CANDIDATE_AUTO_APPROVAL", "candidate evidence cannot be approved automatically");
  const triple = {
    sourceNodeId: requiredText(raw.sourceNodeId, `triples[${index}].sourceNodeId`),
    relationType: requiredText(raw.relationType, `triples[${index}].relationType`),
    targetNodeId: requiredText(raw.targetNodeId, `triples[${index}].targetNodeId`),
    direction: requiredEnum(raw.direction || "outgoing", `triples[${index}].direction`, ["outgoing", "incoming", "bidirectional"]),
    relationTypeStatus: requiredEnum(raw.relationTypeStatus || "unknown", `triples[${index}].relationTypeStatus`, ["known", "unknown"]),
    sourceEndpointStatus: requiredEnum(raw.sourceEndpointStatus || "known", `triples[${index}].sourceEndpointStatus`, ["known", "unknown"]),
    targetEndpointStatus: requiredEnum(raw.targetEndpointStatus || "known", `triples[${index}].targetEndpointStatus`, ["known", "unknown"]),
    evidence: (Array.isArray(raw.evidence) ? raw.evidence : []).map((item, evidenceIndex) => normalizeEvidence(item, `triples[${index}].evidence[${evidenceIndex}]`)),
  };
  if (triple.evidence.length === 0) throw contractError("RELATION_EVIDENCE_MISSING", `triples[${index}].evidence must not be empty`);
  triple.assertionPolicyStatus = "unregistered";
  // WP-006 第1项（candidate_enabled 接线——结构式）：该类型声明「不可机器荐候选」时，
  // 候选合同在 API 边界直接拒收（422）——死开关复活为执法闸，声明=执法。
  if (registry && registry.relations instanceof Map) {
    const capability = registry.relations.get(triple.relationType);
    if (capability && capability.candidateEnabled === false) {
      throw contractError("RELATION_CANDIDATE_TYPE_DISABLED",
        `triples[${index}].relationType "${triple.relationType}" 声明 candidate_enabled=false——该类型不允许机器产出关系候选（ontology.yaml 该类型条目）`);
    }
  }
  if (registry && triple.relationTypeStatus === "known") {
    const statuses = triple.evidence.map((evidence) => {
      try { resolveAssertionPolicy(registry, triple.relationType, evidence.sourceKind, evidence.producer); return "matched"; }
      catch (error) { if (error.code === "RELATION_ASSERTION_POLICY_UNKNOWN") return "unregistered"; throw error; }
    });
    triple.assertionPolicyStatus = statuses.every((status) => status === "matched") ? "matched" : "unregistered";
  }
  triple.tripleId = identity("reltri", {
    sourceNodeId: triple.sourceNodeId,
    relationType: triple.relationType,
    targetNodeId: triple.targetNodeId,
    direction: triple.direction,
  });
  if (raw.tripleId && raw.tripleId !== triple.tripleId) throw contractError("RELATION_TRIPLE_ID_MISMATCH", `triples[${index}].tripleId does not match triple content`);
  return triple;
}

function normalizeRelationCandidate(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw contractError("RELATION_CANDIDATE_INVALID", "relationCandidate must be an object");
  if (raw.winnerTripleId) throw contractError("RELATION_CANDIDATE_AUTO_WINNER", "relation candidates cannot declare an automatic winner");
  if (raw.candidateStatus === "rejected") throw contractError("RELATION_CANDIDATE_AUTO_REJECTION", "rejected status must come from Git Proposal metadata");
  const triples = (Array.isArray(raw.triples) ? raw.triples : []).map((item, index) => normalizeTriple(item, index, options.registry));
  if (triples.length === 0) throw contractError("RELATION_TRIPLE_MISSING", "relationCandidate.triples must not be empty");
  const pairKeys = new Set(triples.map((triple) => [triple.sourceNodeId, triple.targetNodeId].sort().join("\0")));
  if (pairKeys.size !== 1) throw contractError("RELATION_CONFLICT_GROUP_MISMATCH", "all triples in a candidate must share one node pair");
  const pair = [...pairKeys][0].split("\0");
  const conflictGroupId = identity("relgrp", pair);
  if (raw.conflictGroupId && raw.conflictGroupId !== conflictGroupId) throw contractError("RELATION_CONFLICT_GROUP_ID_MISMATCH", "conflictGroupId does not match the node pair");
  const evidence = triples.flatMap((triple) => triple.evidence);
  const uniqueEvidence = [...new Map(evidence.map((item) => [item.evidenceId, item])).values()];
  const tripleIds = triples.map((triple) => triple.tripleId).sort();
  const candidateId = identity("relcand", { conflictGroupId, tripleIds });
  const evidenceSetHash = hash(uniqueEvidence.map((item) => ({ evidenceId: item.evidenceId, contentHash: item.contentHash })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
  const uniqueSources = [...new Map(uniqueEvidence.map((item) => [`${item.sourcePath}\0${item.sourceRevision}`, { sourcePath: item.sourcePath, sourceRevision: item.sourceRevision }])).values()];
  const sourceSetHash = hash(uniqueSources.sort((a, b) => `${a.sourcePath}:${a.sourceRevision}`.localeCompare(`${b.sourcePath}:${b.sourceRevision}`)));
  const candidateHash = hash({ candidateId, conflictGroupId, tripleIds, evidenceSetHash, sourceSetHash });
  if (raw.candidateId && raw.candidateId !== candidateId) throw contractError("RELATION_CANDIDATE_ID_MISMATCH", "candidateId does not match candidate triples");
  for (const [field, value] of [["evidenceSetHash", evidenceSetHash], ["sourceSetHash", sourceSetHash], ["candidateHash", candidateHash]]) {
    if (raw[field] && raw[field] !== value) throw contractError("RELATION_CANDIDATE_HASH_MISMATCH", `${field} does not match candidate content`);
  }
  const hasUnknown = triples.some((triple) => triple.relationTypeStatus === "unknown" || triple.sourceEndpointStatus === "unknown" || triple.targetEndpointStatus === "unknown" || triple.assertionPolicyStatus === "unregistered");
  const requestedStatus = raw.candidateStatus || (hasUnknown ? "review_required" : "open");
  if (!["open", "review_required", "rejected"].includes(requestedStatus)) throw contractError("RELATION_CANDIDATE_STATUS_INVALID", `unsupported candidateStatus: ${requestedStatus}`);
  return { candidateId, candidateHash, conflictGroupId, candidateStatus: requestedStatus, evidenceSetHash, sourceSetHash, triples };
}

module.exports = { normalizeRelationCandidate, contractError, hash };
