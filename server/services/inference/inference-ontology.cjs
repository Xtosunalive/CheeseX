// @responsible: 将原始本体规范化为关系能力注册表和推理规则。
// Pure normalization boundary for ontology-driven inference.
// Consumers call buildInferenceOntology(rawOntology), which internally
// routes through the relationship capability selector for capability-mode
// normalization. Missing capability fields throw RELATION_CAPABILITY_INCOMPLETE.

const { buildCapabilityRegistry } = require("../../shared/relation-capability-selector.cjs");

const LIFECYCLE_STATUSES = new Set(
  require("../../../contracts/object-meta-model.json").layers.status.enums.lifecycle_status
    .map((entry) => entry.value),
);

function fail(message) {
  const error = new Error(message);
  error.code = "INVALID_ONTOLOGY";
  throw error;
}

function requiredText(value, path) {
  if (typeof value !== "string" || !value.trim()) fail(`${path}: required non-empty string`);
  return value.trim();
}

function optionalBoolean(value, path) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(`${path}: must be boolean`);
  return value;
}

function normalizeRelation(type, capabilityEntry) {
  // All relation semantics are now derived from the capability entry.
  // The legacy FORMAL_RELATION_MODES A/B/C/D map has been removed.
  const { semanticRole, impactPropagation, direction, weight, bidirectional, candidateEnabled, registeredForInference } = capabilityEntry;

  return {
    type,
    // Capability-driven fields replacing the old A/B/C/D mode codes
    semanticRole,
    impactPropagation,
    direction,
    weight,
    bidirectional,
    requiresReview: capabilityEntry.requiresReview,
    legacy: capabilityEntry.legacyPolicy === "delete",
    registeredForInference,
    candidateEnabled,
    // Backward-compatible field kept for consumers that still check mode directly
    mode: null,
  };
}

function normalizeRules(rawRules) {
  if (rawRules === undefined) return [];
  if (!Array.isArray(rawRules)) fail("inference_rules: must be array");
  const seen = new Set();
  const rules = [];
  for (let index = 0; index < rawRules.length; index++) {
    const raw = rawRules[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`inference_rules[${index}]: must be object`);
    const lifecycleStatus = raw.lifecycle_status === undefined ? "approved" : raw.lifecycle_status;
    if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) fail(`inference_rules[${index}].lifecycle_status: unsupported value "${lifecycleStatus}"`);
    if (lifecycleStatus !== "approved" || raw.kind !== undefined) continue;
    const id = requiredText(raw.id || raw.name, `inference_rules[${index}].name`);
    if (seen.has(id)) fail(`duplicate inference rule: ${id}`);
    seen.add(id);
    rules.push({
      id,
      scope: "reasoning",
      pattern: requiredText(raw.pattern, `inference_rules[${index}].pattern`),
      output: requiredText(raw.output, `inference_rules[${index}].output`),
      description: typeof raw.description === "string" ? raw.description.trim() : "",
    });
  }
  return rules;
}

function buildInferenceOntology(rawOntology) {
  if (!rawOntology || typeof rawOntology !== "object" || Array.isArray(rawOntology)) fail("ontology: must be object");

  const registry = buildCapabilityRegistry(rawOntology);
  const relations = new Map();

  for (const [type, capabilityEntry] of registry.relations) {
    relations.set(type, normalizeRelation(type, capabilityEntry));
  }

  return {
    relations,
    rules: normalizeRules(rawOntology.inference_rules),
    meta: {
      relation_consumer_mode: registry.meta.relation_consumer_mode,
      total_relations: registry.meta.total_relations,
      registered_for_inference: registry.meta.registered_for_inference,
    },
    // Embedded registry for impact analysis and other consumers
    _capabilityRegistry: registry,
  };
}

module.exports = { buildInferenceOntology };
