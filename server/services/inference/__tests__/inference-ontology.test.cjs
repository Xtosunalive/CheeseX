const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { buildInferenceOntology } = require("../inference-ontology.cjs");
const { createInferenceEngine } = require("../inference-engine.cjs");
const { buildCapabilityRegistry, CAPABILITY_FIELDS } = require("../../../shared/relation-capability-selector.cjs");
const { assertionPoliciesFor, withAssertionPolicies } = require("../../../shared/__tests__/assertion-policy-fixture.cjs");
const NON_APPROVED_STATUSES = require("../../../../contracts/object-meta-model.json")
  .layers.status.enums.lifecycle_status.map((entry) => entry.value).filter((status) => status !== "approved");

// ── Capability-mode fixture (simulates staging vault with all 7 fields) ──
function capabilityOntology() {
  const relation_types = {
    DEPENDS_ON:    { direction: "A → B", weight_default: 1,    semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "keep" },
    DOCUMENTS:     { direction: "A → B", weight_default: 0.8,  semantic_role: "article_attachment",   candidate_enabled: true,  fact_encoding: "article_association", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
    REFERENCES:    { direction: "双向", weight_default: 0.8,  semantic_role: "weak_semantic",        candidate_enabled: false, fact_encoding: "wikilink", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
    MENTIONS:      { direction: "A → B", weight_default: 0.2,  semantic_role: "weak_semantic",        candidate_enabled: false, fact_encoding: "derived",  projected: false, versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
    BELONGS_TO:    { direction: "A → B", weight_default: 0.8,  semantic_role: "category_navigation",  candidate_enabled: false, fact_encoding: "category_path", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
    APPLIES_TO:    { direction: "A → B", weight_default: 0.8,  semantic_role: "article_attachment",   candidate_enabled: true,  fact_encoding: "article_association", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
    HAS_VERSION:   { direction: "A → B", weight_default: 0.8,  semantic_role: "category_navigation",  candidate_enabled: false, fact_encoding: "version_registry", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
    HAS_SYMPTOM:   { direction: "A → B", weight_default: 0.8,  semantic_role: "article_attachment",   candidate_enabled: false, fact_encoding: "structured_property", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
    USES:          { direction: "A → B", weight_default: 0.8,  semantic_role: "historical_compat",    candidate_enabled: false, fact_encoding: "none",     projected: false, versionable: false, impact_propagation: "none",         legacy_policy: "delete" },
    RELATED:       { direction: "A → B", weight_default: 0.3,  semantic_role: "weak_semantic",        candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
    BACKS_UP:      { direction: "A → B", weight_default: 0.7,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
    STORES_IN:     { direction: "A → B", weight_default: 0.8,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
    CONNECTS_TO:   { direction: "A → B", weight_default: 0.7,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "forward_stop",  legacy_policy: "migrate" },
    INDEXES:       { direction: "A → B", weight_default: 0.8,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
    ENCRYPTS:      { direction: "A → B", weight_default: 0.8,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
    ASSOCIATED_WITH:{ direction: "A → B", weight_default: 0.8, semantic_role: "category_navigation",  candidate_enabled: false, fact_encoding: "derived",  projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
  };
  return {
    relation_types: withAssertionPolicies(relation_types),
    inference_rules: [
      { name: "transitive_dependency", pattern: "A -[DEPENDS_ON]-> B -[DEPENDS_ON]-> C", output: "A -[DEPENDS_ON]-> C (inferred)" },
      { name: "document_covers_related", pattern: "D -[DOCUMENTS]-> A -[REFERENCES]-> B", output: "D -[REFERENCES]-> B (inferred)" },
    ],
  };
}

// ── Legacy-mode fixture (no capability fields; simulates current real Vault) ──
function legacyOntology() {
  const relation_types = {
    DEPENDS_ON:    { direction: "A → B", weight_default: 1,    requires_review: false },
    DOCUMENTS:     { direction: "A → B", weight_default: 0.8,  requires_review: false },
    REFERENCES:    { direction: "双向", weight_default: 0.8,  requires_review: false },
    MENTIONS:      { direction: "A → B", weight_default: 0.2,  requires_review: false },
    BELONGS_TO:    { direction: "A → B", weight_default: 0.8,  requires_review: false },
    APPLIES_TO:    { direction: "A → B", weight_default: 0.8,  requires_review: false },
    HAS_VERSION:   { direction: "A → B", weight_default: 0.8,  requires_review: false },
    HAS_SYMPTOM:   { direction: "A → B", weight_default: 0.8,  requires_review: false },
    USES:          { direction: "A → B", weight_default: 0.8,  requires_review: false },
    RELATED:       { direction: "A → B", weight_default: 0.3,  requires_review: true },
    BACKS_UP:      { direction: "A → B", weight_default: 0.7,  requires_review: true, is_legacy: true },
    STORES_IN:     { direction: "A → B", weight_default: 0.8,  requires_review: false },
    CONNECTS_TO:   { direction: "双向", weight_default: 0.7,  requires_review: false, is_legacy: true },
    INDEXES:       { direction: "A → B", weight_default: 0.8,  requires_review: false },
    ENCRYPTS:      { direction: "A → B", weight_default: 0.8,  requires_review: false, is_legacy: true },
    ASSOCIATED_WITH:{ direction: "A → B", weight_default: 0.8, requires_review: false },
  };
  return { relation_types, inference_rules: [] };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("normalizes all 16 formal relations in capability mode", () => {
  const result = buildInferenceOntology(capabilityOntology());
  assert.equal(result.relations.size, 16);
  assert.equal(result.meta.relation_consumer_mode, "capability");
  assert.equal(result.meta.total_relations, 16);

  // capability mode: all non-deleted relations registered (15 of 16, USES excluded)
  const registered = [...result.relations.values()].filter((r) => r.registeredForInference);
  assert.equal(registered.length, 15, `expected 15 registered (all except USES), got ${registered.length}`);

  // USES is not registered for inference (legacy_policy=delete)
  assert.equal(result.relations.get("USES").registeredForInference, false);
  assert.equal(result.relations.get("USES").legacy, true);
});

test("rejects ontology missing capability fields with RELATION_CAPABILITY_INCOMPLETE", () => {
  assert.throws(
    () => buildInferenceOntology(legacyOntology()),
    (err) => err.code === "RELATION_CAPABILITY_INCOMPLETE"
  );
});

test("capability mode is the only supported mode", () => {
  const cap = buildInferenceOntology(capabilityOntology());
  assert.equal(cap.meta.relation_consumer_mode, "capability");
});

test("normalizes declared inference rules as reasoning rules", () => {
  const result = buildInferenceOntology(capabilityOntology());
  assert.deepEqual(result.rules.map((rule) => rule.id), ["transitive_dependency", "document_covers_related"]);
  assert.ok(result.rules.every((rule) => rule.scope === "reasoning"));
});

for (const lifecycle_status of [undefined, "approved"]) {
  test(`纯单元：${lifecycle_status} 新 kind 无旧 pattern/output 时跳过，旧规则仍注册`, () => {
    const raw = capabilityOntology();
    const expected = buildInferenceOntology(raw).rules;
    raw.inference_rules.unshift({ id: "f", kind: "class_membership", when: {}, then: {}, lifecycle_status });
    assert.deepEqual(buildInferenceOntology(raw).rules, expected);
  });
}

for (const kind of ["class_membership", "unregistered_kind", ""]) {
  test(`纯单元：kind=${JSON.stringify(kind)} 即使复用旧 ID 和 pattern/output 也不执行`, () => {
    const raw = capabilityOntology();
    const query = {
      graph: {
        nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
        connections: [
          ["a", "b", "DEPENDS_ON"], ["b", "c", "DEPENDS_ON"],
          ["d", "a", "DOCUMENTS"], ["a", "c", "REFERENCES"],
        ].map(([from, to, relationType]) => ({ from, to, relationType, confidence: 1, reviewStatus: "approved" })),
      },
      seedNodeIds: ["a"],
    };
    const legacy = createInferenceEngine({ ontology: buildInferenceOntology(raw) }).infer(query);
    assert.deepEqual(legacy.inferredEdges.map((edge) => edge.inferenceRule), raw.inference_rules.map((rule) => rule.name));
    const typed = raw.inference_rules.map((rule) => ({ ...rule, kind }));
    raw.inference_rules = typed;
    const normalized = buildInferenceOntology(raw);
    assert.deepEqual(createInferenceEngine({ ontology: normalized }).infer(query).inferredEdges, []);
    assert.deepEqual(normalized.rules, []);
    raw.inference_rules.push(...typed.map(({ kind, ...rule }) => rule));
    assert.equal(buildInferenceOntology(raw).rules.length, 2, "新 kind 不占用旧规则 ID");
  });
}

// 纯单元：每例独立对象，经真实 buildInferenceOntology 入口验证生命周期。
for (const lifecycle_status of NON_APPROVED_STATUSES) {
  test(`${lifecycle_status} 规则退出注册：完整、预留及无名称规则均在必填和重名校验前跳过`, () => {
    const raw = capabilityOntology();
    raw.inference_rules[0].lifecycle_status = "approved";
    raw.inference_rules.unshift(
      { ...raw.inference_rules[0], lifecycle_status },
      { id: "future_rule", kind: "classification", class_id: "Document", when: {}, then: {}, lifecycle_status },
      { lifecycle_status },
    );
    const result = buildInferenceOntology(raw);
    assert.deepEqual(result.rules.map((rule) => rule.id), ["transitive_dependency", "document_covers_related"]);
    assert.ok(result.rules.every((rule) => rule.scope === "reasoning"));
  });

  for (const field of ["pattern", "output"]) {
    test(`${lifecycle_status} 规则恢复 approved 后重新校验必填 ${field}`, () => {
      const raw = capabilityOntology();
      const rule = { ...raw.inference_rules[0], lifecycle_status };
      const validValue = rule[field];
      delete rule[field];
      raw.inference_rules = [rule];
      assert.deepEqual(buildInferenceOntology(raw).rules, []);

      rule.lifecycle_status = "approved";
      assert.throws(() => buildInferenceOntology(raw), {
        code: "INVALID_ONTOLOGY",
        message: `inference_rules[0].${field}: required non-empty string`,
      });
      rule[field] = " \t ";
      assert.throws(() => buildInferenceOntology(raw), {
        code: "INVALID_ONTOLOGY",
        message: `inference_rules[0].${field}: required non-empty string`,
      });
      rule[field] = validValue;
      assert.deepEqual(buildInferenceOntology(raw).rules, [{
        id: rule.name,
        scope: "reasoning",
        pattern: rule.pattern,
        output: rule.output,
        description: "",
      }]);
    });
  }

  test(`${lifecycle_status} 关系经 buildInferenceOntology 退出 relations，预留关系无需能力字段`, () => {
    const raw = capabilityOntology();
    raw.relation_types.DEPENDS_ON.lifecycle_status = lifecycle_status;
    raw.relation_types.FUTURE_RELATION = { lifecycle_status, transitive: true, inverse_of: "DEPENDS_ON" };
    raw.relation_types.REFERENCES.lifecycle_status = "approved";
    const result = buildInferenceOntology(raw);
    assert.equal(result.relations.has("DEPENDS_ON"), false);
    assert.equal(result.relations.has("FUTURE_RELATION"), false);
    assert.equal(result.relations.get("REFERENCES").registeredForInference, true);
    assert.deepEqual([...result.relations.keys()], Object.keys(raw.relation_types)
      .filter((type) => type !== "DEPENDS_ON" && type !== "FUTURE_RELATION").sort());
    assert.equal(result.meta.total_relations, 15);
    assert.equal(result.meta.registered_for_inference, 14);
  });
}

for (const lifecycle_status of ["unknown", "APPROVED", " approved ", "", null, false, 0, [], {}]) {
  test(`非法规则生命周期 ${JSON.stringify(lifecycle_status)} 被拒绝而非跳过或按缺省注册`, () => {
    const raw = capabilityOntology();
    for (const rule of [{ lifecycle_status }, { id: "f", kind: "class_membership", lifecycle_status }]) {
      raw.inference_rules = [rule];
      assert.throws(() => buildInferenceOntology(raw), {
        code: "INVALID_ONTOLOGY",
        message: /inference_rules\[0\]\.lifecycle_status: unsupported value/,
      });
    }
  });
}

test("规则和关系缺省生命周期与显式 approved 的注册结果一致", () => {
  const raw = capabilityOntology();
  const defaultResult = buildInferenceOntology(raw);
  for (const rule of raw.inference_rules) rule.lifecycle_status = "approved";
  for (const relation of Object.values(raw.relation_types)) relation.lifecycle_status = "approved";
  assert.deepEqual(buildInferenceOntology(raw), defaultResult);
  assert.equal(defaultResult.rules.length, 2);
  assert.equal(defaultResult.relations.size, 16);
});

test("rejects duplicate rules and invalid structured relation values", () => {
  const duplicate = capabilityOntology();
  duplicate.inference_rules.push({ name: "transitive_dependency", pattern: "x", output: "y" });
  assert.throws(() => buildInferenceOntology(duplicate), /duplicate inference rule/);

  const invalidWeight = capabilityOntology();
  invalidWeight.relation_types.DEPENDS_ON.weight_default = [0.8];
  assert.throws(() => buildInferenceOntology(invalidWeight), /weight_default/);

  const invalidBoolean = capabilityOntology();
  invalidBoolean.relation_types.DEPENDS_ON.projected = "true";
  assert.throws(() => buildInferenceOntology(invalidBoolean), /projected: required boolean/);

  const invalidPropagation = capabilityOntology();
  invalidPropagation.relation_types.DEPENDS_ON.impact_propagation = "sideways";
  assert.throws(() => buildInferenceOntology(invalidPropagation), /impact_propagation: unsupported value/);
});

test("characterizes the configured real Vault ontology as capability", { skip: !process.env.VAULT_PATH }, () => {
  const vaultPath = process.env.VAULT_PATH;
  const ontologyPath = path.basename(vaultPath) === "知识库"
    ? path.join(vaultPath, "TheSchema", "ontology.yaml")
    : path.join(vaultPath, "知识库", "TheSchema", "ontology.yaml");
  const raw = YAML.parse(fs.readFileSync(ontologyPath, "utf-8"));
  const result = buildInferenceOntology(raw);
  assert.equal(result.meta.relation_consumer_mode, "capability");
});

test("capability registry throws RELATION_CAPABILITY_INCOMPLETE when fields are missing", () => {
  const partial = {
    DEPENDS_ON: { direction: "A → B", weight_default: 1, semantic_role: "architecture_skeleton" },
    RELATED:    { direction: "A → B", weight_default: 0.3 },
  };
  assert.throws(
    () => buildCapabilityRegistry({ relation_types: partial }),
    (err) => err.code === "RELATION_CAPABILITY_INCOMPLETE" && err.details.absent.length > 0
  );
});

test("capability registry produces capability mode when all fields are present", () => {
  const registry = buildCapabilityRegistry(capabilityOntology());
  assert.equal(registry.mode, "capability");
  assert.equal(registry.meta.relation_consumer_mode, "capability");
});

test("keeps unknown relations visible but marks them unregistered for inference when legacy_policy=delete", () => {
  const raw = capabilityOntology();
  raw.relation_types.CUSTOM_DELETED = { direction: "A → B", weight_default: 0.5, semantic_role: "weak_semantic", candidate_enabled: false, fact_encoding: "none", projected: false, versionable: false, impact_propagation: "none", legacy_policy: "delete", assertion_policies: assertionPoliciesFor("USES") };
  const result = buildInferenceOntology(raw);
  assert.equal(result.relations.get("CUSTOM_DELETED").registeredForInference, false);
});

test("risk classification: STORES_IN=data, BACKS_UP=recovery, INDEXES=searchability, ENCRYPTS=confidentiality", () => {
  const registry = buildCapabilityRegistry(capabilityOntology());
  assert.equal(registry.relations.get("STORES_IN").riskKind, "data");
  assert.equal(registry.relations.get("BACKS_UP").riskKind, "recovery");
  assert.equal(registry.relations.get("INDEXES").riskKind, "searchability");
  assert.equal(registry.relations.get("ENCRYPTS").riskKind, "confidentiality");
  assert.equal(registry.relations.get("DEPENDS_ON").riskKind, "dependency");
});
