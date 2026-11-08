// Component: Enums-Loader Unit Tests
// @responsible: 验证 enums 规则集加载、默认值和异常输入处理。
// @inputs: Enums-Loader 与内存 enums fixture
// @outputs: 单元测试断言结果
// @context: Canvas
const { buildRuleSet, validateCategoryPath } = require("../enums-loader.cjs");

var passed = 0;
var failed = 0;

function assertEq(actual, expected, label) {
  if (actual === expected) {
    passed++;
    return;
  }
  failed++;
  console.error("FAIL: " + label + " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}

function runSuite() {
  var configured = buildRuleSet({
    architecture_projection: {
      projected_relation_types: ["DEPENDS_ON", "RELATED"],
      wikilink_type_labels: {
        "依赖": "DEPENDS_ON",
        "关联": "RELATED",
      },
    },
  });
  assertEq(configured.wikilinkTypeLabels["关联"], "RELATED", "configured 关联 mapping");
  assertEq(configured.wikilinkTypeLabels["连接"], undefined, "configured map does not silently merge fallback");
  assertEq(configured.projectedRelationTypes.join(","), "DEPENDS_ON,RELATED", "projected relation types stay distinct from ontology registry");

  var articleRules = buildRuleSet({ domains: { ops: "运维", ref: "参考" }, subdomains: { ops: ["maintain", "deploy"], ref: ["architecture"] } });
  assertEq(articleRules.categoryPaths.join(","), "ops:maintain,ops:deploy,ref:architecture", "PR-046→WP-040 category paths derive colon pairs (two-segment closed part)");

  var missingConfig = buildRuleSet({ architecture_projection: {} });
  assertEq(Object.keys(missingConfig.wikilinkTypeLabels).length, 0, "missing config does not invent wikilink mappings");
  assertEq(missingConfig.wikilinkTypeLabels["关联"], undefined, "missing config has no 关联 fallback");

  // ADR-006：arch_categories 派生视图（矩阵非空→并集；空→回退主表）
  var matrixDerived = buildRuleSet({
    arch_categories: ["终端", "服务", "存储"],
    subdomain_constraints: {
      workload: { allowed_categories: ["服务", "存储"] },
      edge: { allowed_categories: ["终端", "基础设施"] },
    },
  });
  assertEq(matrixDerived.archCategories.join(","), "服务,存储,终端,基础设施", "ADR-006 matrix union derives archCategories (declared list shadowed)");

  var matrixFallback = buildRuleSet({ arch_categories: ["终端", "服务", "存储", "基础设施", "安全"] });
  assertEq(
    matrixFallback.archCategories.join(","),
    "终端,服务,存储,基础设施,安全",
    "ADR-006 empty matrix falls back to declared arch_categories (real-vault shape: subdomain_constraints is a reserved slot)"
  );

  var matrixOnly = buildRuleSet({ subdomain_constraints: { workload: { allowed_categories: ["服务"] } } });
  assertEq(matrixOnly.archCategories.join(","), "服务", "ADR-006 matrix without declared list still derives");

  var dirtyMatrix = buildRuleSet({
    arch_categories: ["服务"],
    subdomain_constraints: {
      a: { allowed_categories: [" 服务 ", "", "终端"] },
      b: { allowed_categories: ["服务", "存储"] },
      c: { allowed_categories: "not-an-array" },
    },
  });
  assertEq(dirtyMatrix.archCategories.join(","), "服务,终端,存储", "ADR-006 union trims, skips empties, dedupes, tolerates malformed policy");

  // ── PR-046→WP-040（Master 2026-10-29「2A」）：validateCategoryPath 两段式结构化校验（topic 段退役）──
  var catRules = buildRuleSet({ domains: { ops: "运维", ref: "参考" }, subdomains: { ops: ["maintain", "deploy"], ref: ["architecture"] } });
  assertEq(validateCategoryPath("ops:maintain", catRules), null, "valid two-segment path passes");
  assertEq(validateCategoryPath("ref:architecture", catRules), null, "second domain pair passes");
  assertEq(validateCategoryPath("", catRules) !== null, true, "empty value rejected");
  assertEq(validateCategoryPath("ops.maintain", catRules) !== null, true, "legacy dot two-segment rejected (dual-caliber ban)");
  assertEq(validateCategoryPath("ops:maintain:nginx-502", catRules) !== null, true, "third segment rejected (topic retired)");
  assertEq(validateCategoryPath("prodX:maintain", catRules) !== null, true, "unknown domain rejected");
  assertEq(validateCategoryPath("ops:unknown", catRules) !== null, true, "unknown subdomain rejected");
  assertEq(validateCategoryPath("ops:", catRules) !== null, true, "missing subdomain rejected");
  assertEq(validateCategoryPath("ops:maintain:x:y", catRules) !== null, true, "extra segments rejected");
  assertEq(validateCategoryPath("troubleshoot:maintain", catRules) !== null, true, "historical troubleshoot domain rejected");
  assertEq(validateCategoryPath("ops:troubleshoot", catRules) !== null, true, "historical troubleshoot subdomain rejected");
  assertEq(validateCategoryPath("ops:maintain", null) !== null, true, "missing ruleSet fail-closed (domain never matches)");
  var emptyRules = buildRuleSet({});
  assertEq(validateCategoryPath("ops:maintain", emptyRules) !== null, true, "unconfigured enums fail-closed");
}

runSuite();

if (failed > 0) {
  console.error("Enums-Loader tests failed: " + failed + " failed, " + passed + " passed");
  process.exit(1);
}

console.log("Enums-Loader tests passed: " + passed + " passed, 0 failed");
