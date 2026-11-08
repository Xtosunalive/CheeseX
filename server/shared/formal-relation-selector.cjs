// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Stateless formal-consumer relation filtering. Assertion semantics remain
// authoritative in the ontology registry; this module only applies them.
const { resolveAssertionPolicy } = require("./relation-capability-selector.cjs");

const ALLOWED_STATUSES = {
  reviewed: new Set(["approved"]),
  inherit_source_approval: new Set(["approved", "inherited_approved"]),
  deterministic: new Set(["approved", "deterministic"]),
};

// 无 ruleId 边（管道不产出 ruleId）的 producer 语义是确定的：逐条显式兜底，非 wildcard
// （规则 32：fail-closed 语义不变）。值对齐 ontology 现有政策的 producer：
// - entity-wikilink → DEPENDS_ON typed_wikilink 政策 producer（KNOWN_ASSERTION_PRODUCERS 已含）
// - document-body → REFERENCES wikilink 政策 producer（ontology.yaml REFERENCES 政策，KNOWN_ASSERTION_PRODUCERS 已含）
// - multi-source-inference → 自身 ruleId 命名规则 "extract_graph.{source}"（Step 2 白名单已登记）
const SOURCE_KIND_DEFAULT_PRODUCERS = {
  "entity-wikilink": "extract_graph.entity_typed_wikilink",
  "document-body": "extract_graph.plain_wikilink",
  "multi-source-inference": "extract_graph.multi-source-inference",
};

function objectValue(value) {
  // WP-050 D1：内容对象统一 null 原型——保留名（constructor 族）作字段名/别名直取不可表达，
  // 回落 evidenceValue=undefined → REQUIRED_EVIDENCE_MISSING（正式消费闸门不再被绕过）
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.assign(Object.create(null), value);
  }
  return Object.create(null);
}

function text(...values) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return value ? value.trim() : "";
}

function relationType(relation) {
  return text(relation.relationType, relation.type, relation.relation_type);
}

function assertionInput(relation) {
  const properties = objectValue(relation.properties);
  const assertion = objectValue(relation.assertion || properties.assertion);
  const evidenceList = Array.isArray(assertion.evidence)
    ? assertion.evidence.filter((item) => item && typeof item === "object")
    : Array.isArray(relation.evidence)
      ? relation.evidence.filter((item) => item && typeof item === "object")
      : [];
  // WP-050 D1：evidence 合并产物同样 null 原型（展开会重引原型——逐键回填）；
  // evidenceList 逐项经 objectValue（数组元素原为裸对象，保留名可命中）
  const evidence = objectValue({
    ...objectValue(properties.evidence),
    ...objectValue(relation.evidence),
    ...objectValue(assertion.evidence),
  });
  // relation 同为容器（裸对象）——null 原型化后保留名不可命中（WP-050 D1）
  return { assertion, evidence, evidenceList: evidenceList.map(objectValue), properties, relation: objectValue(relation) };
}

function evidenceValue(input, field) {
  const camel = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const aliases = [field, camel];
  if (field === "source_coordinate") aliases.push("coordinate");
  if (field === "source_revision") aliases.push("sourceHash", "source_hash", "candidateSourceHash"); // 管道真实字段（PR-018③：article-association-override 边以 candidateSourceHash 承载源修订）
  if (field === "target_identity") aliases.push("target", "to", "targetNodeId");
  const containers = [input.evidence, input.assertion, input.properties, input.relation, ...input.evidenceList];
  for (const container of containers) {
    for (const key of aliases) {
      const value = container[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  if (field === "source_coordinate") {
    for (const container of containers) {
      // 管道真实字段 inputCoordinates：数组，取第一个含 "#line" 的项（extract_graph props.inputCoordinates）
      const coordinates = container.inputCoordinates;
      if (Array.isArray(coordinates)) {
        const lineItem = coordinates.find((item) => typeof item === "string" && item.includes("#line"));
        if (lineItem) return lineItem;
      }
      // 多源推断边：sources[].file（源文件路径即坐标）
      const sources = container.sources;
      if (Array.isArray(sources) && sources.length > 0 && sources[0] && typeof sources[0] === "object") {
        const file = text(sources[0].file);
        if (file) return file;
      }
      const sourcePath = text(container.sourcePath, container.sourceFile, container.path);
      const lineNumber = container.lineNumber ?? container.line_number;
      if (sourcePath && Number.isInteger(lineNumber) && lineNumber > 0) return `${sourcePath}#line:${lineNumber}`;
    }
  }
  return undefined;
}

function assertionActorType(relation, input) {
  // 归属者类型（human / rule / importer）写在边的 assertedBy 上。
  // 机器（extract_graph 等规则）自盖 approved 时 actorType === "rule"，
  // 人工裁决链路写入 actorType === "human"。闸门据此区分「谁批的」。
  const containers = [input.assertion, input.properties, relation];
  for (const container of containers) {
    const assertedBy = container && container.assertedBy;
    if (assertedBy && typeof assertedBy === "object" && typeof assertedBy.actorType === "string") {
      return assertedBy.actorType;
    }
  }
  return undefined;
}

function freshnessStatus(relation, input) {
  const freshness = relation.freshness ?? input.assertion.freshness ?? input.properties.freshness;
  return text(typeof freshness === "string" ? freshness : freshness?.status);
}

function approvalStatus(relation, input) {
  return text(
    relation.assertionStatus,
    relation.approvalStatus,
    relation.sourceApprovalStatus,
    relation.reviewStatus,
    input.assertion.status,
    input.properties.assertionStatus,
    input.properties.approvalStatus,
    input.properties.reviewStatus,
  );
}

function inspectFormalRelation(registry, relation, consumer) {
  if (!registry?.relations || !relation || typeof relation !== "object") {
    return { allowed: false, reason: "INVALID_INPUT" };
  }
  const normalizedConsumer = text(consumer);
  if (!normalizedConsumer) return { allowed: false, reason: "CONSUMER_MISSING" };
  const input = assertionInput(relation);
  const type = relationType(relation);
  // 字段层回退链：理想命名（sourceKind/source_kind）优先，管道真实字段（properties.source）兜底。
  // input.properties 即 objectValue(relation.properties)，两处同源、逐条显式，无 wildcard。
  const sourceKind = text(
    input.assertion.sourceKind, input.assertion.source_kind,
    input.properties.sourceKind, input.properties.source_kind,
    relation.sourceKind, relation.source_kind,
    input.properties.source, relation.properties?.source,
  );
  // producer 回退链：ruleId 是管道真实 producer 字段；无 ruleId 的 3 类边按 source_kind 显式兜底。
  const producer = text(
    input.assertion.producer, input.properties.producer, relation.producer,
    input.properties.ruleId,
  ) || SOURCE_KIND_DEFAULT_PRODUCERS[sourceKind] || "";
  let policy;
  try { policy = resolveAssertionPolicy(registry, type, sourceKind, producer); }
  catch (error) { return { allowed: false, reason: "ASSERTION_POLICY_UNRESOLVED", errorCode: error.code || "UNKNOWN" }; }

  if (policy.workingProjection !== "approved_only" || !policy.formalConsumers.includes(normalizedConsumer)) {
    return { allowed: false, reason: "CONSUMER_NOT_ALLOWED", policy };
  }
  const freshness = freshnessStatus(relation, input);
  // Freshness 是「源变化导致过期」的信号（freshness-state-machine.md：计算函数，非写入字段）。
  // 管道 extract_graph 从当前源文件生成边时不打 freshness——无该字段 = 无过期信号（边是当前投影），
  // 不得当作「不新鲜」过滤。只有明确 stale（源 revision 已变化）才阻断；fresh/缺失 均放行，
  // 由后续审批状态与证据完整性继续判定。
  if (freshness === "stale") return { allowed: false, reason: "RELATION_NOT_FRESH", policy, freshness };
  const status = approvalStatus(relation, input);
  if (!ALLOWED_STATUSES[policy.decisionMode]?.has(status)) {
    return { allowed: false, reason: "APPROVAL_STATUS_NOT_ALLOWED", policy, status: status || "unknown" };
  }
  // K-P0-4：reviewed 决策模式下，approved 必须由人类裁决（assertedBy.actorType === "human"）。
  // 机器自盖 approved（actorType === "rule" 或缺失）不再等同人审放行；deterministic /
  // inherit_source_approval 等非人审依赖类放行路径保持原逻辑不变。
  if (policy.decisionMode === "reviewed" && status === "approved") {
    const actorType = assertionActorType(relation, input);
    if (actorType !== "human") {
      return { allowed: false, reason: "APPROVAL_NOT_HUMAN", policy, status, actorType: actorType || "unknown" };
    }
  }
  const missingEvidence = policy.requiredEvidence.filter((field) => evidenceValue(input, field) === undefined);
  if (missingEvidence.length > 0) return { allowed: false, reason: "REQUIRED_EVIDENCE_MISSING", policy, missingEvidence };
  if ([relation.sourceEndpointStatus, relation.targetEndpointStatus].some((value) => value === "unknown")) {
    return { allowed: false, reason: "ENDPOINT_UNKNOWN", policy };
  }
  return { allowed: true, reason: "ALLOWED", policy };
}

function selectFormalRelations(registryOrInput, relations, consumer) {
  const input = arguments.length === 1 && registryOrInput && !registryOrInput.relations?.get
    ? registryOrInput
    : { registry: registryOrInput, relations, consumer };
  if (!Array.isArray(input.relations)) return [];
  return input.relations.filter((relation) => inspectFormalRelation(input.registry, relation, input.consumer).allowed);
}

// evidenceValue 一并导出：供校验侧（scripts/quality/check-data-chain.mjs）按本体 required_evidence
// 断言边的证据完整性，避免校验器另造一份「本体字段名 → 边字段名」映射（规则 8 配置单源化）。
module.exports = { inspectFormalRelation, selectFormalRelations, evidenceValue };
