// Component: Entity-Relation-Patch-Service Tests
// @responsible: 验证结构化关系类型、方向、目标和坐标化正文补丁。
// @inputs: 临时 Vault entity
// @outputs: 单元测试断言
// @context: Vault

const assert = require("assert"); const fs = require("fs"); const os = require("os"); const path = require("path");
const { buildRelationPatch, listRelationTargetOptions, buildEffectiveSuffix, validateVersionRange, parseTypedRelationLine } = require("../entity-relation-patch-service.cjs");
const { loadRuleSetForVault } = require("../../schema-manager/compliance-rule-set-service.cjs");
const YAML = require("yaml");
const { assertionPoliciesFor } = require("../../../shared/__tests__/assertion-policy-fixture.cjs");
const rules = { wikilinkTypeLabels: { "依赖": "depends_on", "关联": "relates_to" }, versionableRelations: new Set(["depends_on"]), allRegisteredVersions: ["7.0.0.0", "7.0.6.7", "8.0.0.0"] };
function entity(dir, name, id, body) { const file = path.join(dir, name + ".md"); fs.writeFileSync(file, `---\ntitle: ${name}\narchitecture-node-id: ${id}\narch_component: true\n---\n\n# ${name}\n${body || ""}`, "utf8"); return file; }
(function run() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "relation-patch-")); const dir = path.join(vault, "知识库", "wiki", "entities"); fs.mkdirSync(dir, { recursive: true });
  try {
    const a = entity(dir, "A", "a", ""); const b = entity(dir, "B", "b", "");
    const articleDir = path.join(vault, "知识库", "raw", "precleaned"); fs.mkdirSync(articleDir, { recursive: true });
    fs.writeFileSync(path.join(articleDir, "Article.md"), "---\ntitle: Article\narticle_id: article-1\n---\n", "utf8");
    assert.deepStrictEqual(listRelationTargetOptions(vault, "a"), [{ id: "b", label: "B" }], "only governed entities are offered as writable relation targets");
    const out = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b" }, ruleSet: rules });
    assert(out.nextRaw.includes("依赖::[[b]]")); assert.deepStrictEqual(out.expectedEdge, { source: "a", target: "b", relationType: "depends_on", direction: "outgoing", operation: "add", versionRange: { since: "", until: "" } });
    assert.strictEqual(out.sourcePath, a); assert(out.sourceCoordinate.fileRevision.startsWith("sha256:"));
    const incoming = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "incoming", targetId: "b" }, ruleSet: rules });
    assert.strictEqual(incoming.sourcePath, b); assert(incoming.nextRaw.includes("依赖::[[a]]")); assert.strictEqual(incoming.expectedEdge.source, "b");
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "未知", direction: "outgoing", targetId: "b" }, ruleSet: rules }), (e) => e.code === "UNSUPPORTED_RELATION_TYPE");
    // 原型同名键：labels[relationType] 原命中原型属性 → 当作已注册放行（写侧穿透）
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "constructor", direction: "outgoing", targetId: "b" }, ruleSet: rules }), (e) => e.code === "UNSUPPORTED_RELATION_TYPE", "constructor 未注册，不得当作合法关系类型");
    fs.appendFileSync(a, "\n关联::[[ghost]]\n", "utf8");
    const retargeted = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "retarget", originalTarget: "ghost", targetId: "b" }, ruleSet: rules });
    assert(retargeted.nextRaw.includes("关联::[[b]]"));
    assert(!retargeted.nextRaw.includes("[[ghost]]"));
    assert.deepStrictEqual(retargeted.bodyPatch, { before: "[[ghost]]", after: "[[b]]" });
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "retarget", originalTarget: "ghost", targetId: "a" }, ruleSet: rules }), (e) => e.code === "SELF_RELATION_NOT_ALLOWED");
    const removed = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "remove-target", originalTarget: "ghost" }, ruleSet: rules });
    assert(!removed.nextRaw.includes("[[ghost]]"));
    assert.deepStrictEqual(removed.bodyPatch, { before: ["关联::[[ghost]]"], after: [] });
    fs.appendFileSync(a, "\n- 关联::[[强制入主]]\n- 关联::[[强制入主]]\n正文提到 [[强制入主]]，不得删除。\n", "utf8");
    const duplicateRemoval = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "remove-target", originalTarget: "强制入主" }, ruleSet: rules });
    assert.deepStrictEqual(duplicateRemoval.bodyPatch, { before: ["- 关联::[[强制入主]]", "- 关联::[[强制入主]]"], after: [] });
    assert(!duplicateRemoval.nextRaw.includes("关联::[[强制入主]]"));
    assert(duplicateRemoval.nextRaw.includes("正文提到 [[强制入主]]，不得删除。"), "ordinary inline wikilinks are preserved");
    fs.appendFileSync(a, "\n[[ghost-two]]\n", "utf8");
    const removedMany = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "remove-targets", originalTargets: ["ghost", "ghost-two"] }, ruleSet: rules });
    assert(!removedMany.nextRaw.includes("[[ghost]]"));
    assert(!removedMany.nextRaw.includes("[[ghost-two]]"));
    assert.deepStrictEqual(removedMany.bodyPatch, { before: ["[[ghost]]", "[[ghost-two]]"], after: [] });
    entity(dir, "B2", "b", "");
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b" }, ruleSet: rules }), (e) => e.code === "RELATION_TARGET_AMBIGUOUS");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  console.log("Entity relation patch tests passed");
})();

// ── Slice 1: Versioned typed-link contract tests ──────────────────────────

(function runSlice1() {
  // ── buildEffectiveSuffix unit tests ──
  assert.strictEqual(buildEffectiveSuffix("", ""), "", "empty both → no suffix");
  assert.strictEqual(buildEffectiveSuffix("7.0.0", "8.0.0"), " @effective(since=7.0.0, until=8.0.0)", "full range");
  assert.strictEqual(buildEffectiveSuffix("7.0.0", ""), " @effective(since=7.0.0, until=)", "open until");
  assert.strictEqual(buildEffectiveSuffix("", "8.0.0"), " @effective(since=, until=8.0.0)", "open since");
  assert.strictEqual(buildEffectiveSuffix(null, undefined), "", "null/undefined → no suffix");
  assert.strictEqual(buildEffectiveSuffix("", null), "", "empty + null → no suffix");

  // ── validateVersionRange unit tests ──
  const vrOpts = { relationType: "depends_on", versionableRelations: new Set(["depends_on"]), allRegisteredVersions: ["7.0.0.0", "7.0.6.7", "8.0.0.0"] };
  assert.deepStrictEqual(validateVersionRange(null, vrOpts), { since: "", until: "" }, "null range → empty");
  assert.deepStrictEqual(validateVersionRange({ since: "", until: "" }, vrOpts), { since: "", until: "" }, "empty strings → empty");
  assert.deepStrictEqual(validateVersionRange({ since: "7.0.0.0", until: "8.0.0.0" }, vrOpts), { since: "7.0.0.0", until: "8.0.0.0" }, "valid range returned as-is");
  assert.throws(() => validateVersionRange({ since: "8.0.0.0", until: "7.0.0.0" }, vrOpts), (e) => e.code === "VERSION_RANGE_INVERTED");
  assert.throws(() => validateVersionRange({ since: "9.9.9.9", until: "" }, vrOpts), (e) => e.code === "VERSION_NOT_REGISTERED");
  assert.throws(() => validateVersionRange({ since: "not-a-version" }, vrOpts), (e) => e.code === "VERSION_RANGE_INVALID");
  assert.throws(() => validateVersionRange({ since: "7.0.0.0", until: "8.0.0.0" }, { ...vrOpts, relationType: "relates_to" }), (e) => e.code === "VERSION_NOT_ALLOWED");
  assert.throws(() => validateVersionRange({ since: "9.9.9.9", until: "" }, { ...vrOpts, allRegisteredVersions: [] }), (e) => e.code === "VERSION_REGISTRY_UNAVAILABLE");

  const capVault = fs.mkdtempSync(path.join(os.tmpdir(), "relation-rules-cap-"));
  try {
    const schemaDir = path.join(capVault, "知识库", "TheSchema");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "ontology.yaml"), YAML.stringify({ relation_types: {
      DEPENDS_ON: {
        direction: "A -> B", weight_default: 1, semantic_role: "architecture_skeleton",
        candidate_enabled: true, fact_encoding: "typed_wikilink", projected: true,
        versionable: true, impact_propagation: "reverse", legacy_policy: "keep",
        assertion_policies: assertionPoliciesFor("DEPENDS_ON"),
      },
    } }), "utf8");
    const loaded = loadRuleSetForVault(capVault);
    assert.strictEqual(loaded.relationConsumerMode, "capability");
    assert(loaded.wikilinkRelations.has("DEPENDS_ON"), "capability selector retains typed-wikilink write capability");
    assert(loaded.versionableRelations.has("DEPENDS_ON"), "capability selector retains versioned write capability");
  } finally { fs.rmSync(capVault, { recursive: true, force: true }); }

  // ── Integration tests: buildRelationPatch with version range ──
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "relation-patch-s1-")); const dir = path.join(vault, "知识库", "wiki", "entities"); fs.mkdirSync(dir, { recursive: true });
  try {
    const a = entity(dir, "A", "a", ""); const b = entity(dir, "B", "b", "");

    // Test 1: Add with version range
    const withRange = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } }, ruleSet: rules });
    assert(withRange.nextRaw.includes("依赖::[[b]] @effective(since=7.0.0.0, until=8.0.0.0)"), "versioned typed wikilink written");
    assert.deepStrictEqual(withRange.bodyPatch.after, "依赖::[[b]] @effective(since=7.0.0.0, until=8.0.0.0)", "bodyPatch.after includes version suffix");
    assert.deepStrictEqual(parseTypedRelationLine(withRange.bodyPatch.after, rules), { relationType: "depends_on", label: "依赖", targetId: "b", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } });

    // Test 2: Add with empty range → plain wikilink (no suffix)
    entity(dir, "C", "c", "");
    const noRange = buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "c", versionRange: { since: "", until: "" } }, ruleSet: rules });
    assert(noRange.nextRaw.includes("依赖::[[c]]"));
    assert(!noRange.nextRaw.includes("@effective"), "empty range → no @effective suffix");
    assert.deepStrictEqual(noRange.bodyPatch.after, "依赖::[[c]]");

    // Test 3: Non-versionable relation rejects version range
    entity(dir, "D", "d", "");
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "关联", direction: "outgoing", targetId: "d", versionRange: { since: "7.0.0.0" } }, ruleSet: rules }), (e) => e.code === "VERSION_NOT_ALLOWED");

    // Test 4: Inverted range
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "8.0.0.0", until: "7.0.0.0" } }, ruleSet: rules }), (e) => e.code === "VERSION_RANGE_INVERTED");

    // Test 5: Unregistered version
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "9.9.9.9", until: "" } }, ruleSet: rules }), (e) => e.code === "VERSION_NOT_REGISTERED");

    // Test 6: Non-semver format
    assert.throws(() => buildRelationPatch({ vaultPath: vault, sourcePath: a, relationPatch: { operation: "add", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "not-a-version" } }, ruleSet: rules }), (e) => e.code === "VERSION_RANGE_INVALID");

    // Test 7: Replace with version range
    entity(dir, "E", "e", "依赖::[[b]]\n");
    const a2 = entity(dir, "A2", "a2", "依赖::[[b]]\n");
    const replaced = buildRelationPatch({ vaultPath: vault, sourcePath: a2, relationPatch: { operation: "replace", relationType: "依赖", direction: "outgoing", targetId: "e", versionRange: { since: "7.0.0.0", until: "8.0.0.0" } }, ruleSet: rules });
    assert(replaced.nextRaw.includes("依赖::[[e]] @effective(since=7.0.0.0, until=8.0.0.0)"), "replace writes new target with version range");
    assert(!replaced.nextRaw.includes("依赖::[[b]]"), "old target removed");

    // Test 8: Replace of existing versioned line
    const a3 = entity(dir, "A3", "a3", "依赖::[[b]] @effective(since=7.0.0.0, until=8.0.0.0)\n");
    const replacedV2 = buildRelationPatch({ vaultPath: vault, sourcePath: a3, relationPatch: { operation: "replace", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.6.7", until: "8.0.0.0" } }, ruleSet: rules });
    assert(replacedV2.nextRaw.includes("依赖::[[b]] @effective(since=7.0.6.7, until=8.0.0.0)"), "version range updated");
    assert(!replacedV2.nextRaw.includes("since=7.0.0.0"), "old version range gone");

    // Test 9: Remove-target on versioned line → entire line removed
    const a4 = entity(dir, "A4", "a4", "依赖::[[ghost]] @effective(since=7.0.0.0, until=8.0.0.0)\n");
    const rmVersioned = buildRelationPatch({ vaultPath: vault, sourcePath: a4, relationPatch: { operation: "remove-target", originalTarget: "ghost" }, ruleSet: rules });
    assert(!rmVersioned.nextRaw.includes("[[ghost]]"), "versioned line removed");
    assert(!rmVersioned.nextRaw.includes("@effective"), "version suffix removed");

    // Test 10: Open-ended until (only since specified)
    entity(dir, "F", "f", "");
    const openUntil = buildRelationPatch({ vaultPath: vault, sourcePath: a3, relationPatch: { operation: "replace", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "7.0.0.0", until: "" } }, ruleSet: rules });
    assert(openUntil.nextRaw.includes("@effective(since=7.0.0.0, until=)"), "open until");

    // Test 11: Open-ended since (only until specified)
    const openSince = buildRelationPatch({ vaultPath: vault, sourcePath: a3, relationPatch: { operation: "replace", relationType: "依赖", direction: "outgoing", targetId: "b", versionRange: { since: "", until: "8.0.0.0" } }, ruleSet: rules });
    assert(openSince.nextRaw.includes("@effective(since=, until=8.0.0.0)"), "open since");

    // Test 12: Remove operation on versioned line (still works, operation="remove" deletes the matched line)
    const a5 = entity(dir, "A5", "a5", "依赖::[[b]] @effective(since=7.0.0.0, until=8.0.0.0)\n");
    const removedV = buildRelationPatch({ vaultPath: vault, sourcePath: a5, relationPatch: { operation: "remove", relationType: "依赖", direction: "outgoing", targetId: "b" }, ruleSet: rules });
    assert(!removedV.nextRaw.includes("依赖::[[b]]"), "remove operation deletes versioned line");
    assert(!removedV.nextRaw.includes("@effective"), "versioned suffix gone");
    assert.strictEqual(removedV.bodyPatch.after, "", "remove bodyPatch.after is empty");

    // Test 13: Incoming with version range
    entity(dir, "G", "g", "");
    const incomingV = buildRelationPatch({ vaultPath: vault, sourcePath: a3, relationPatch: { operation: "add", relationType: "依赖", direction: "incoming", targetId: "g", versionRange: { since: "7.0.6.7", until: "8.0.0.0" } }, ruleSet: rules });
    assert.strictEqual(path.basename(incomingV.sourcePath), "G.md", "incoming writes to target entity");
    assert(incomingV.nextRaw.includes("依赖::[[a3]] @effective(since=7.0.6.7, until=8.0.0.0)"), "incoming writes versioned wikilink to target");

    // Test 14: No versionRange omitted → defaults to plain wikilink
    const noVRField = buildRelationPatch({ vaultPath: vault, sourcePath: a3, relationPatch: { operation: "replace", relationType: "依赖", direction: "outgoing", targetId: "b" }, ruleSet: rules });
    assert(!noVRField.nextRaw.includes("@effective"), "no versionRange field → plain wikilink");
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  console.log("Slice 1: Versioned typed-link contract tests passed");
})();
