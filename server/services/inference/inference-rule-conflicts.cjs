// @responsible: 按主体与结论键检测相互对立的推理规则结论。
const { createHash } = require("node:crypto");

const EFFECTS = new Set(["ASSERT", "WAIVE", "BLOCK", "SUSPEND"]);

function invalid(message) {
  const error = new Error(message);
  error.code = "INVALID_REASONING_RULE";
  throw error;
}

function stableId(ruleIds, conclusionKey, subjectNodeId) {
  return createHash("sha256")
    .update(`${[...ruleIds].sort().join("\0")}\0${conclusionKey}\0${subjectNodeId}`)
    .digest("hex");
}

function isOpposing(effects) {
  return effects.has("ASSERT") && (effects.has("WAIVE") || effects.has("BLOCK"));
}

function normalizeConclusion(raw, ruleIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("candidate conclusion must be object");
  for (const key of ["ruleId", "subjectNodeId", "conclusionKey", "effect"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) invalid(`${key} must be non-empty string`);
  }
  if (!ruleIds.has(raw.ruleId)) invalid(`unknown reasoning rule: ${raw.ruleId}`);
  if (!EFFECTS.has(raw.effect)) invalid(`unsupported reasoning effect: ${raw.effect}`);
  const evidence = raw.evidence === undefined ? [] : raw.evidence;
  if (!Array.isArray(evidence) || evidence.some((item) => typeof item !== "string")) invalid("evidence must be string array");
  return {
    ruleId: raw.ruleId.trim(),
    subjectNodeId: raw.subjectNodeId.trim(),
    conclusionKey: raw.conclusionKey.trim(),
    effect: raw.effect,
    evidence: [...new Set(evidence.map((item) => item.trim()).filter(Boolean))].sort(),
  };
}

function detectRuleConflicts({ rules = [], candidateConclusions = [], existing = [] } = {}) {
  if (!Array.isArray(rules) || rules.some((rule) => !rule || rule.scope !== "reasoning")) invalid("reasoning rules only");
  const ruleIds = new Set();
  for (const rule of rules) {
    if (typeof rule.id !== "string" || !rule.id.trim() || ruleIds.has(rule.id)) invalid("reasoning rule ids must be unique non-empty strings");
    ruleIds.add(rule.id);
  }
  if (!Array.isArray(candidateConclusions) || !Array.isArray(existing)) invalid("conclusions/existing must be arrays");
  const groups = new Map();
  for (const raw of candidateConclusions) {
    const item = normalizeConclusion(raw, ruleIds);
    const key = `${item.subjectNodeId}\0${item.conclusionKey}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const uniqueKey = `${item.ruleId}\0${item.effect}`;
    const prior = groups.get(key).get(uniqueKey);
    if (prior) prior.evidence = [...new Set([...prior.evidence, ...item.evidence])].sort();
    else groups.get(key).set(uniqueKey, item);
  }
  const existingById = new Map(existing.filter((item) => item && typeof item.conflictId === "string").map((item) => [item.conflictId, item]));
  const conflicts = [];
  for (const conclusionsByKey of groups.values()) {
    const conclusions = [...conclusionsByKey.values()].sort((a, b) => `${a.ruleId}:${a.effect}`.localeCompare(`${b.ruleId}:${b.effect}`));
    const effects = new Set(conclusions.map((item) => item.effect));
    if (!isOpposing(effects)) continue;
    const subjectNodeId = conclusions[0].subjectNodeId;
    const conclusionKey = conclusions[0].conclusionKey;
    const ruleIdsForConflict = [...new Set(conclusions.map((item) => item.ruleId))].sort();
    const conflictId = stableId(ruleIdsForConflict, conclusionKey, subjectNodeId);
    const prior = existingById.get(conflictId) || {};
    conflicts.push({
      ...prior,
      conflictId,
      code: "RULES_CONFLICT",
      subjectNodeId,
      conclusionKey,
      ruleIds: ruleIdsForConflict,
      conclusions,
      status: prior.status === "resolved" ? "resolved" : "unresolved",
    });
  }
  return conflicts.sort((a, b) => `${a.subjectNodeId}:${a.conclusionKey}:${a.conflictId}`.localeCompare(`${b.subjectNodeId}:${b.conclusionKey}:${b.conflictId}`));
}

module.exports = { detectRuleConflicts };
