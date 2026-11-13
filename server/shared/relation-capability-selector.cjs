// Relation Capability Selector — capability-only registry.
//
// Single centralized module that validates ontology relation_types and
// produces uniform capability entries for all downstream consumers.
//
// All 7 ADR009 fields must be present on every relation type.
// Missing fields throw RELATION_CAPABILITY_INCOMPLETE — no legacy fallback.

const CAPABILITY_FIELDS = [
  "semantic_role",
  "candidate_enabled",
  "fact_encoding",
  "projected",
  "versionable",
  "impact_propagation",
  "legacy_policy",
];

const ALLOWED_SEMANTIC_ROLES = new Set([
  "architecture_skeleton", "article_attachment", "weak_semantic",
  "category_navigation", "historical_compat",
  // 治理语义边（EDGE-RELATION-GOV-001/ADR-012 D3：五治理类型并入 ontology〔bad88e7b〕，词表随批登记补齐。
  // 下游 inImpactSet 仍仅认 architecture_skeleton——治理边不入架构影响面）
  "governance_semantics",
]);
const ALLOWED_FACT_ENCODINGS = new Set([
  "typed_wikilink", "article_association", "wikilink", "derived",
  "category_path", "version_registry", "structured_property", "none",
  // 治理断言编码（同上批：relations.yaml 人工/治理关系，非管线抽取产物）
  "governance_assertion",
]);
const ALLOWED_IMPACT_PROPAGATIONS = new Set(["reverse", "forward", "forward_stop", "none"]);
const ALLOWED_LEGACY_POLICIES = new Set(["keep", "migrate", "delete"]);
const LIFECYCLE_STATUSES = new Set(
  require("../../contracts/object-meta-model.json").layers.status.enums.lifecycle_status.map((entry) => entry.value),
);

// Assertion policy governance (ADR009 G2)
const ALLOWED_DECISION_MODES = new Set([
  "reviewed", "inherit_source_approval", "deterministic", "derived_only", "forbidden",
]);
const ALLOWED_WORKING_PROJECTIONS = new Set(["approved_only", "never"]);
const ALLOWED_SOURCE_KINDS = new Set([
  "typed_wikilink", "article_association", "wikilink", "derived",
  "category_path", "version_registry", "structured_property", "legacy_graph",
  // 真实 extract_graph 管道产出的 source_kind（逐条显式登记，无 wildcard；ADR009 G2 fail-closed 不变）
  "auto-discovered", "plate-product-link", "plate-aggregation", "plate-version-aggregation",
  "document-frontmatter", "entity-wikilink", "multi-source-inference", "version-inference",
  "document-body", "plate-system-aggregation", "team-placeholder",
  // PR-018①（2026-09-14 定性补登记）：审批覆盖通道（extract_graph article-association add/replace 打标，
  // 实测 2 边 DOCUMENTS+APPLIES_TO 带完整 decisionId/candidateSourceHash/admissionBatchId 证据链）
  "article-association-override",
  // 治理断言通道（EDGE-RELATION-GOV-001 D1/D3：relations.yaml 人工/治理关系经 relations-write-service 写入）
  "governance-assertion",
]);
const KNOWN_ASSERTION_PRODUCERS = new Set([
  // WP-170（2026-11-13，Master 裁决B落位）：文章标准化正文实体匹配→DOCUMENTS 候选（reviewed 人审）
  "article-relation-candidates",
  "extract_graph.entity_typed_wikilink",
  "extract_graph.plain_wikilink",
  "extract_graph.derived_mentions",
  "article-association-service.approved_association",
  "category-path-projection.classification",
  "version-registry.has_version",
  "structured-property.symptom_fact",
  "plate-product-projection.association",
  "legacy.uses_emission",
  // 真实 extract_graph 管道的 ruleId producer（ruleId = "extract_graph.{source}"，逐条显式登记）
  "extract_graph.auto-discovered",
  "extract_graph.plate-product-link",
  "extract_graph.plate-aggregation",
  "extract_graph.plate-version-aggregation",
  "extract_graph.document-frontmatter",
  "extract_graph.multi-source-inference",
  "extract_graph.version-inference",
  "extract_graph.plate-system-aggregation",
  "extract_graph.team-placeholder",
  // 治理关系唯一写网关（EDGE-RELATION-GOV-001：repoWrite 原子写＋git 快照＋乐观锁）
  "relations-write-service.governance_assertion",
]);



// ── Helpers ────────────────────────────────────────────────────────────

function fail(message) {
  const error = new Error(message);
  error.code = "INVALID_ONTOLOGY";
  throw error;
}

function requiredText(value, path) {
  if (typeof value !== "string" || !value.trim()) fail(`${path}: required non-empty string`);
  return value.trim();
}

function requiredBoolean(value, path) {
  if (typeof value !== "boolean") fail(`${path}: required boolean`);
  return value;
}

function requiredEnum(value, path, allowed) {
  const normalized = requiredText(value, path);
  if (!allowed.has(normalized)) {
    fail(`${path}: unsupported value "${normalized}"`);
  }
  return normalized;
}

function optionalNumber(value, _path, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function optionalString(value, _path, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

// ── Detection ───────────────────────────────────────────────────────────

function hasAllCapabilityFields(relationDef) {
  return CAPABILITY_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(relationDef, field));
}

// ── Registry builder ────────────────────────────────────────────────────

function buildCapabilityEntry(type, raw) {
  const semanticRole = requiredEnum(raw.semantic_role, `relation_types.${type}.semantic_role`, ALLOWED_SEMANTIC_ROLES);
  const impactPropagation = requiredEnum(raw.impact_propagation, `relation_types.${type}.impact_propagation`, ALLOWED_IMPACT_PROPAGATIONS);
  const legacyPolicy = requiredEnum(raw.legacy_policy, `relation_types.${type}.legacy_policy`, ALLOWED_LEGACY_POLICIES);
  const factEncoding = requiredEnum(raw.fact_encoding, `relation_types.${type}.fact_encoding`, ALLOWED_FACT_ENCODINGS);
  const direction = optionalString(raw.direction || (raw.source_types && raw.target_types ? "单向" : ""), `relation_types.${type}.direction`, "单向");
  const weight = optionalNumber(raw.weight_default, `relation_types.${type}.weight_default`, 1);
  const assertionPolicies = validateAssertionPolicies(type, raw.assertion_policies);

  // All non-deleted relations are registered for inference. Traversal mode
  // (reverse/forward/suspend) is determined by impact_propagation + candidateEnabled.
  const registeredForInference = legacyPolicy !== "delete";
  const inImpactSet = semanticRole === "architecture_skeleton";

  return {
    type,
    semanticRole,
    impactPropagation,
    legacyPolicy,
    direction,
    weight,
    bidirectional: direction.includes("双向"),
    candidateEnabled: requiredBoolean(raw.candidate_enabled, `relation_types.${type}.candidate_enabled`),
    projected: requiredBoolean(raw.projected, `relation_types.${type}.projected`),
    versionable: requiredBoolean(raw.versionable, `relation_types.${type}.versionable`),
    factEncoding,
    assertionPolicies,
    requiresReview: assertionPolicies.some((policy) => policy.decisionMode === "reviewed"),
    registeredForInference,
    inImpactSet,
    // Risk classification per ADR009 R11-R15
    riskKind: semanticRole === "architecture_skeleton"
      ? (type === "STORES_IN" ? "data" : type === "BACKS_UP" ? "recovery" : type === "INDEXES" ? "searchability" : type === "ENCRYPTS" ? "confidentiality" : "dependency")
      : null,
  };
}



function validateBaseFields(type, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`relation_types.${type}: must be object`);
  const weight = raw.weight_default;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
    fail(`relation_types.${type}.weight_default: must be finite number 0..1`);
  }
  requiredText(raw.direction, `relation_types.${type}.direction`);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Build a capability registry from parsed ontology YAML.
 *
 * @param {object} rawOntology — parsed ontology.yaml content
 * @returns {{ mode: 'capability', relations: Map<string, object>, meta: object }}
 */
function buildCapabilityRegistry(rawOntology) {
  if (!rawOntology || typeof rawOntology !== "object" || Array.isArray(rawOntology)) {
    fail("ontology: must be object");
  }
  const rawRelations = rawOntology.relation_types;
  if (!rawRelations || typeof rawRelations !== "object" || Array.isArray(rawRelations)) {
    fail("relation_types: must be object");
  }

  const relations = new Map();

  for (const type of Object.keys(rawRelations).sort()) {
    const raw = rawRelations[type];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`relation_types.${type}: must be object`);
    const lifecycleStatus = raw.lifecycle_status === undefined ? "approved" : raw.lifecycle_status;
    if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) fail(`relation_types.${type}.lifecycle_status: unsupported value "${lifecycleStatus}"`);
    if (lifecycleStatus !== "approved") continue;
    validateBaseFields(type, raw);
    if (!hasAllCapabilityFields(raw)) {
      const absent = CAPABILITY_FIELDS.filter((f) => !Object.prototype.hasOwnProperty.call(raw, f));
      const error = new Error(`relation_types.${type}: missing capability fields: ${absent.join(", ")}`);
      error.code = "RELATION_CAPABILITY_INCOMPLETE";
      error.details = { type, absent };
      throw error;
    }
    relations.set(type, buildCapabilityEntry(type, raw));
  }

  const impactEdgeTypes = new Set();
  for (const [type, entry] of relations) {
    if (entry.inImpactSet) impactEdgeTypes.add(type);
  }

  const meta = {
    relation_consumer_mode: "capability",
    total_relations: relations.size,
    registered_for_inference: [...relations.values()].filter((e) => e.registeredForInference).length,
    in_impact_set: impactEdgeTypes.size,
  };

  return { mode: "capability", relations, impactEdgeTypes, meta };
}

/**
 * Get a typed relation entry for inference traversal decisions.
 * Returns null if the relation type is unknown or deleted.
 */
function getInferenceEntry(registry, type) {
  const entry = registry.relations.get(type);
  if (!entry) return null;
  if (entry.legacyPolicy === "delete") return null;
  return entry;
}

/**
 * Check whether an edge type is eligible for impact analysis traversal.
 */
function isImpactEdge(registry, type) {
  return registry.impactEdgeTypes.has(type);
}

// ── Assertion policy validation (ADR009 G2) ─────────────────────────

function assertionFail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Validate assertion_policies array for a relation type.
 * Returns normalized policy entries or throws on violations.
 */
function validateAssertionPolicies(type, policies) {
  if (!Array.isArray(policies) || policies.length === 0) {
    assertionFail(
      "ASSERTION_POLICY_MISSING",
      `relation_types.${type}: assertion_policies must be a non-empty array`,
    );
  }

  const seen = new Set();
  const validated = [];

  for (let i = 0; i < policies.length; i++) {
    const p = policies[i];
    if (!p || typeof p !== "object") {
      assertionFail(
        "ASSERTION_POLICY_INVALID",
        `relation_types.${type}.assertion_policies[${i}]: must be object`,
      );
    }

    const sourceKind = typeof p.source_kind === "string" ? p.source_kind.trim() : "";
    const producer = typeof p.producer === "string" ? p.producer.trim() : "";
    const decisionMode = typeof p.decision_mode === "string" ? p.decision_mode.trim() : "";
    // WP-006 6a：working_projection 派生只读——手写字段已从 ontology.yaml/schema 退役（消灭镜像双份事实源）。
    // 派生函数关系（原装载校验钉死的同一映射）：derived_only/forbidden→never；其余→approved_only。
    const workingProjection = (decisionMode === "derived_only" || decisionMode === "forbidden") ? "never" : "approved_only";

    if (!sourceKind || !ALLOWED_SOURCE_KINDS.has(sourceKind)) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_SOURCE_KIND",
        `relation_types.${type}.assertion_policies[${i}].source_kind: unsupported "${sourceKind}"`,
      );
    }

    if (!producer) {
      assertionFail(
        "ASSERTION_POLICY_INVALID",
        `relation_types.${type}.assertion_policies[${i}].producer: required non-empty string`,
      );
    }

    if (!KNOWN_ASSERTION_PRODUCERS.has(producer)) {
      assertionFail(
      "ASSERTION_POLICY_UNKNOWN_PRODUCER",
      `relation_types.${type}.assertion_policies[${i}].producer: unknown producer "${producer}"`,
      );
    }

    if (!decisionMode || !ALLOWED_DECISION_MODES.has(decisionMode)) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_DECISION_MODE",
        `relation_types.${type}.assertion_policies[${i}].decision_mode: unsupported "${decisionMode}"`,
      );
    }

    // Duplicate detection by (source_kind, producer)
    const key = `${sourceKind}::${producer}`;
    if (seen.has(key)) {
      assertionFail(
        "ASSERTION_POLICY_DUPLICATE",
        `relation_types.${type}: duplicate assertion policy (source_kind=${sourceKind}, producer=${producer})`,
      );
    }
    seen.add(key);

    if (!Array.isArray(p.required_evidence)) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_EVIDENCE",
        `relation_types.${type}.assertion_policies[${i}].required_evidence: required array`,
      );
    }
    if (!Array.isArray(p.formal_consumers)) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_CONSUMERS",
        `relation_types.${type}.assertion_policies[${i}].formal_consumers: required array`,
      );
    }

    const requiredEvidence = p.required_evidence;
    const formalConsumers = p.formal_consumers;
    const nonPublishingMode = decisionMode === "derived_only" || decisionMode === "forbidden";
    if (!nonPublishingMode && requiredEvidence.length === 0) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_EVIDENCE",
        `relation_types.${type}.assertion_policies[${i}].required_evidence: must be non-empty for ${decisionMode}`,
      );
    }
    if (workingProjection === "never" && formalConsumers.length > 0) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_CONSUMERS",
        `relation_types.${type}.assertion_policies[${i}].formal_consumers: must be empty when working_projection=never`,
      );
    }
    if (workingProjection === "approved_only" && formalConsumers.length === 0) {
      assertionFail(
        "ASSERTION_POLICY_INVALID_CONSUMERS",
        `relation_types.${type}.assertion_policies[${i}].formal_consumers: must be non-empty when working_projection=approved_only`,
      );
    }

    validated.push({
      sourceKind,
      producer,
      decisionMode,
      workingProjection,
      requiredEvidence,
      formalConsumers,
    });
  }

  return validated;
}

/**
 * Resolve an assertion policy by (relation_type, source_kind, producer).
 * Returns the single matching policy entry or throws when no policy matches.
 * Production wildcard fallback is forbidden by ADR009 G2.
 */
function resolveAssertionPolicy(registry, type, sourceKind, producer) {
  const entry = registry.relations.get(type);
  const matches = entry?.assertionPolicies?.filter(
    (policy) => policy.sourceKind === sourceKind && policy.producer === producer,
  ) ?? [];
  if (matches.length > 1) {
    assertionFail(
      "RELATION_ASSERTION_POLICY_AMBIGUOUS",
      `relation_types.${type}: multiple assertion policies match source_kind=${sourceKind}, producer=${producer}`,
    );
  }
  if (matches.length === 0) {
    assertionFail(
      "RELATION_ASSERTION_POLICY_UNKNOWN",
      `relation_types.${type}: no assertion policy for source_kind=${sourceKind}, producer=${producer}`,
    );
  }
  return matches[0];
}


// ── WP-006 6b：能力字段消费锚点（写时准入执法依据——声明必须带着活消费点出生）──
// 形态：{ 字段: [{ module: 仓内相对路径, token: 该模块必须包含的消费标记 }] }。
// 结构闭环：新增能力字段必须同笔登记消费锚点（写路径对无锚点字段 422 拒写）；锚点失效
// （消费模块被删/标记被移）同样拒写——「声明了没兑现」在写入瞬间物理不可能（P0 公理⑤）。
// 非能力字段白名单：本体的非治理属性（描述/端点/置信参数），不属接线对账面。
const fs = require("node:fs");
const path = require("node:path");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CAPABILITY_FIELD_CONSUMERS = {
  semantic_role: [
    { module: "server/shared/relation-capability-selector.cjs", token: "inImpactSet" },
    { module: "server/services/release-governance/formal-knowledge-consumer-service.cjs", token: "inImpactSet" },
  ],
  candidate_enabled: [{ module: "server/services/governance/relation-candidate-contract.cjs", token: "candidateEnabled" }],
  impact_propagation: [{ module: "server/services/inference/inference-engine.cjs", token: "impactPropagation" }],
  legacy_policy: [{ module: "server/shared/relation-capability-selector.cjs", token: "legacyPolicy" }],
  versionable: [{ module: "server/services/schema-manager/dependencies-write-service.cjs", token: "versionable" }],
  fact_encoding: [{ module: "server/shared/relation-capability-selector.cjs", token: "factEncoding" }],
  projected: [{ module: "server/services/release-governance/complete-release-artifact-service.cjs", token: "projected" }],
  // WP-049 余量批：两字段消费点＝前端本体注册表生成器（数据上升随批登记——锚点门禁执法面）
  aliases: [{ module: "scripts/generate-ontology-registry.mjs", token: "aliases" }],
  graph_database: [{ module: "scripts/generate-ontology-registry.mjs", token: "graph_database" }],
  weight_default: [{ module: "server/services/schema-manager/schema-validators.cjs", token: "weight_default" }],
  direction: [{ module: "server/shared/relation-capability-selector.cjs", token: "bidirectional" }],
  decision_mode: [
    { module: "scripts/vault-py/graph/extract_graph.py", token: "decision_mode" },
    { module: "server/shared/formal-relation-selector.cjs", token: "decisionMode" },
  ],
  source_kind: [{ module: "scripts/vault-py/graph/extract_graph.py", token: "source_kind" }],
  producer: [{ module: "server/shared/relation-capability-selector.cjs", token: "KNOWN_ASSERTION_PRODUCERS" }],
  required_evidence: [{ module: "server/shared/relation-capability-selector.cjs", token: "requiredEvidence" }],
  formal_consumers: [{ module: "server/shared/relation-capability-selector.cjs", token: "formalConsumers" }],
};

const NON_CAPABILITY_FIELDS = new Set([
  "description", "label_cn", "source_types", "target_types", "weight_range",
  "confidence_prior", "confidence_floor", "requires_review", "is_legacy", "assertion_policies",
  "lifecycle_status", "retirement", "transitive", "inverse_of",
]);

/**
 * WP-006 6b：写时准入——校验本体载荷的能力字段均有在册活消费点。
 * @param {object} rawOntology 本体载荷（relation_types 原始形状，snake_case）
 * @param {{readModule?: (p: string) => string}} deps 注入文件读取（测试可替换）
 * @returns {{ok: boolean, errors: string[]}} 错误信息自带修法指引
 */
function validateCapabilityConsumerAnchors(rawOntology, deps = {}) {
  const readModule = deps.readModule || ((modulePath) => fs.readFileSync(path.join(REPO_ROOT, modulePath), "utf8"));
  const errors = [];
  const checkField = (locator, field) => {
    const anchors = Object.prototype.hasOwnProperty.call(CAPABILITY_FIELD_CONSUMERS, field)
      ? CAPABILITY_FIELD_CONSUMERS[field]
      : undefined;
    if (!Array.isArray(anchors)) {
      if (NON_CAPABILITY_FIELDS.has(field)) return;
      errors.push(`${locator}: 字段「${field}」无在册消费点——新能力字段必须与消费模块同笔登记（server/shared/relation-capability-selector.cjs 的 CAPABILITY_FIELD_CONSUMERS），未登记字段不得写入本体`);
      return;
    }
    for (const anchor of anchors) {
      try {
        const content = readModule(anchor.module);
        if (!content.includes(anchor.token)) {
          errors.push(`${locator}: 字段「${field}」在册消费点失效——${anchor.module} 不含消费标记 "${anchor.token}"（消费代码被移除？修复消费或更新锚点登记）`);
        }
      } catch (_error) {
        errors.push(`${locator}: 字段「${field}」在册消费点模块缺失——${anchor.module}（消费模块被删/改名？修复或更新锚点登记）`);
      }
    }
  };
  const relationTypes = rawOntology && typeof rawOntology === "object" && rawOntology.relation_types ? rawOntology.relation_types : {};
  for (const [type, definition] of Object.entries(relationTypes)) {
    if (!definition || typeof definition !== "object") continue;
    const lifecycleStatus = definition.lifecycle_status === undefined ? "approved" : definition.lifecycle_status;
    if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) {
      errors.push(`relation_types.${type}.lifecycle_status: unsupported value "${lifecycleStatus}"`);
      continue;
    }
    if (lifecycleStatus !== "approved") continue;
    for (const field of Object.keys(definition)) checkField(`relation_types.${type}.${field}`, field);
    const policies = Array.isArray(definition.assertion_policies) ? definition.assertion_policies : [];
    policies.forEach((policy, index) => {
      if (!policy || typeof policy !== "object") return;
      for (const field of Object.keys(policy)) checkField(`relation_types.${type}.assertion_policies[${index}].${field}`, field);
    });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  buildCapabilityRegistry,
  getInferenceEntry,
  isImpactEdge,
  validateAssertionPolicies,
  resolveAssertionPolicy,
  CAPABILITY_FIELDS,
  KNOWN_ASSERTION_PRODUCERS,
  ALLOWED_DECISION_MODES,
  ALLOWED_WORKING_PROJECTIONS,
  ALLOWED_SOURCE_KINDS, CAPABILITY_FIELD_CONSUMERS, validateCapabilityConsumerAnchors, };
