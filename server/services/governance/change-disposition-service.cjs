// @responsible: 编排变更处置候选、冲突持久化、结构化裁决消费与写入门禁。
// @inputs: affectedVersions、候选规则、ConflictStore、DecisionConsumer
// @outputs: sourceRevision、候选、冲突、逐组件决定和聚合写入状态
// @context: Governance

const crypto = require("node:crypto");
const { createChangeDispositionCandidateService, CHANGE_DISPOSITION_RULES } = require("./change-disposition-candidate-service.cjs");
// 推理冲突检测与结构化裁决消费属于 governance 拥有的检查契约，通过 options 注入（组合根接线），
// 本 analysis 服务不直接 import governance 模块。

function fingerprint(candidates) {
  const canonical = candidates.map((item) => ({
    conclusionKey: item.conclusionKey,
    effect: item.effect,
    evidence: item.evidence,
    ruleId: item.ruleId,
    scope: item.scope,
    subjectNodeId: item.subjectNodeId,
  }));
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function groupBySubject(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.subjectNodeId}\0${candidate.conclusionKey}`;
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }
  return groups;
}

function automaticDecision(candidates, sourceRevision) {
  const effects = [...new Set(candidates.map((item) => item.effect))];
  if (effects.length !== 1) return null;
  return {
    decision: "select_effect",
    selectedEffect: effects[0],
    selectedRuleIds: candidates.map((item) => item.ruleId),
    reasonCode: "UNCONTESTED_RULE_RESULT",
    sourceRevision,
  };
}

function aggregateStatus(results) {
  const statuses = new Set(results.map((item) => item.status));
  for (const status of ["stale", "conflicted", "blocked", "review_required", "change_required", "waived"]) if (statuses.has(status)) return status;
  return "clear";
}

function createChangeDispositionService(options = {}) {
  const candidateService = options.candidateService || createChangeDispositionCandidateService();
  const conflictDetector = options.conflictDetector;
  const conflictStore = options.conflictStore || null;
  const decisionConsumer = options.decisionConsumer;
  if (typeof conflictDetector !== "function" || !decisionConsumer || typeof decisionConsumer.consume !== "function") {
    throw new Error("createChangeDispositionService requires injected conflictDetector and decisionConsumer ports");
  }

  function evaluate(input = {}) {
    const candidates = candidateService.produce(input);
    const sourceRevision = fingerprint(candidates);
    if (candidates.length === 0) return { sourceRevision, candidates: [], conflicts: [], results: [], status: "clear", writeAllowed: true };

    const existing = conflictStore && typeof conflictStore.list === "function" ? conflictStore.list() : [];
    const detected = conflictDetector({ rules: CHANGE_DISPOSITION_RULES, candidateConclusions: candidates, existing })
      .map((conflict) => ({ ...conflict, sourceRevision }));
    if (detected.length && conflictStore && typeof conflictStore.upsertDetected === "function") conflictStore.upsertDetected(detected);
    const persisted = conflictStore && typeof conflictStore.list === "function" ? conflictStore.list() : detected;
    const persistedByKey = new Map(persisted.map((item) => [`${item.subjectNodeId}\0${item.conclusionKey}`, item]));
    const results = [];
    for (const [key, subjectCandidates] of groupBySubject(candidates)) {
      const conflict = persistedByKey.get(key);
      const legacyDecision = conflict && conflict.status === "resolved" ? conflict.decision : null;
      const decision = conflict
        ? legacyDecision && legacyDecision.sourceRevision !== sourceRevision ? legacyDecision : null
        : automaticDecision(subjectCandidates, sourceRevision);
      const consumed = decisionConsumer.consume({ candidates: subjectCandidates, decision, sourceRevision });
      results.push({
        subjectNodeId: subjectCandidates[0].subjectNodeId,
        conclusionKey: subjectCandidates[0].conclusionKey,
        status: consumed.status,
        effect: consumed.effect,
        writeAllowed: consumed.writeAllowed,
        reasonCode: consumed.reasonCode,
        decisionKind: conflict ? "legacy-audit" : "automatic",
        conflictId: conflict ? conflict.conflictId : null,
      });
    }
    const status = aggregateStatus(results);
    return {
      sourceRevision,
      candidates,
      conflicts: detected.map((item) => ({ conflictId: item.conflictId, subjectNodeId: item.subjectNodeId, conclusionKey: item.conclusionKey, status: item.status, sourceRevision })),
      results: results.sort((left, right) => left.subjectNodeId.localeCompare(right.subjectNodeId)),
      status,
      writeAllowed: results.every((item) => item.writeAllowed === true),
    };
  }

  function assertWriteAllowed(evaluation) {
    return decisionConsumer.assertWriteAllowed(evaluation);
  }

  return { evaluate, assertWriteAllowed };
}

module.exports = { createChangeDispositionService, fingerprint };
