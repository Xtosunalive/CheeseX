// Component: Entity-Compliance-Service Unit Tests
// @responsible: 验证 entity 合规规则、索引、汇总和过滤行为。
// @inputs: Entity-Compliance-Service 与内存 fixture
// @outputs: 单元测试断言结果
// @context: Canvas
// Covers F01-F16 + F02b + F02c + B01-B04 + indexes + summary + filter.
const svc = require("../entity-compliance-service.cjs");
const engine = require("../entity-compliance-declarative-engine.cjs");
const { ruleDiag } = require("../../../../scripts/quality/__tests__/helpers/entity-rule-tester.cjs");
const { checkArticleCompliance } = require("../../article-workflow/article-compliance-service.cjs");
const { describe, it } = require("node:test");

var passed = 0, failed = 0;
function assertEq(a, e, l) { if (a === e) passed++; else { console.error("FAIL: " + l + " — expected " + JSON.stringify(e) + ", got " + JSON.stringify(a)); failed++; } }
function assert(c, l) { if (c) passed++; else { console.error("FAIL: " + l); failed++; } }

// ── Helpers ──

function mkDoc(fm, body) {
  return { sourcePath: "/vault/wiki/entities/test-comp.md", fileName: "test-comp.md", frontmatter: fm || {}, body: body || "" };
}

function fullRuleSet() {
  return {
    archLayers: ["external", "gateway", "application", "service", "cloud-native", "data-lake", "foundation", "crosscutting"],
    archCategories: ["终端", "服务", "存储", "基础设施", "安全"],
    statuses: ["灰度", "在线", "退役", "已驳回"],
    moduleNames: ["Ceph", "Kubernetes", "MySQL", "认证服务", "OSS网关"],
    layerAliases: { "data": "data-lake", "infra": "cloud-native" },
    categoryAliases: { "storage": "存储", "backend": "服务", "infra": "基础设施" },
    wikilinkTypeLabels: { "依赖": "DEPENDS_ON", "连接": "CONNECTS_TO", "存储": "STORES_IN", "备份": "BACKS_UP", "索引": "INDEXES", "加密": "ENCRYPTS", "关联": "RELATED" },
  };
}

var rs = fullRuleSet();

function runSuite() {
// ═══════════════ Standard article managed entry rules ═══════════════
{
  var articleDoc = { articleId: "article", identitySource: "article_id", title: "Article", sourcePath: "知识库/raw/precleaned/article.md", product: "AnyShare", version: "7.0.6.7", module: "MySQL", articleType: "场景规范", docType: "运维手册", categoryPath: "ops:maintain", tags: ["mysql"], hasBody: true };
  var articleRules = { products: ["AnyShare"], versionsByProduct: { AnyShare: ["7.0.6.7"] }, moduleNames: ["MySQL"], articleTypes: ["场景规范"], docTypes: ["运维手册"], categoryPaths: ["ops:maintain"], domains: { ops: "运维" }, subdomains: { ops: ["maintain"] } };
  var articleResult = checkArticleCompliance(articleDoc, articleRules);
  var articleFindings = Object.fromEntries(articleResult.groups.flatMap(function (group) { return group.checks; }).map(function (item) { return [item.field, item]; }));
  assertEq(articleFindings.product.allowedValues[0], "AnyShare", "article: product options exposed");
  assertEq(articleFindings.version.allowedValuesByProduct.AnyShare[0], "7.0.6.7", "article: versions grouped by product");
  assertEq(articleFindings["category-path"].allowedValues[0], "ops:maintain", "article: category paths exposed (PR-046 colon pairs)");
  assertEq(articleFindings["category-path"].passed, true, "article: two-segment category-path passes A08 (WP-040)");
  var missingRulesResult = checkArticleCompliance(articleDoc, { moduleNames: [], articleTypes: [], docTypes: [], categoryPaths: [], products: [], versionsByProduct: {} });
  var missingManaged = missingRulesResult.groups.flatMap(function (group) { return group.checks; }).filter(function (item) { return ["product", "version", "category-path"].includes(item.field); });
  assert(missingManaged.every(function (item) { return item.passed === false && item.message.includes("未配置录入规则"); }), "article: missing managed rules do not fall back to free text");
}
// ═══════════════ normalizeString ═══════════════
assertEq(svc.normalizeString("hello"), "hello", "ns: string");
assertEq(svc.normalizeString(42), "42", "ns: number");
assertEq(svc.normalizeString(true), "true", "ns: boolean");
assertEq(svc.normalizeString(["a", "b"]), "a", "ns: array");
assertEq(svc.normalizeString([]), "", "ns: empty array");
assertEq(svc.normalizeString(null), "", "ns: null");

// ═══════════════ F01: title ═══════════════
assert(ruleDiag({ title: "My Component" }, "F01").passed, "F01: has title");
assert(!ruleDiag({}, "F01").passed, "F01: missing title");
assertEq(ruleDiag({}, "F01").severity, "error", "F01: severity");

// ═══════════════ F02: architecture-node-id ═══════════════
assert(ruleDiag({ "architecture-node-id": "mvp-gateway" }, "F02").passed, "F02: 常规值仍通过（护栏＝撤形状后不得反向排斥既有合法值）");
assert(!ruleDiag({}, "F02").passed, "F02: 缺键拦截");
assert(!ruleDiag({ "architecture-node-id": "" }, "F02").passed, "F02: 空串拦截（必填＝非空）");
assert(!ruleDiag({ "architecture-node-id": "   " }, "F02").passed, "F02: 纯空白拦截（必填＝至少一个非空白字符）");
assert(ruleDiag({ "architecture-node-id": "NotKebab" }, "F02").passed, "F02: 形状不判——含大写仍过");
assert(ruleDiag({ "architecture-node-id": "grown-测试模块" }, "F02").passed, "F02: 形状不判——含中文仍过（PR-229 真库那条）");
assert(ruleDiag({ "architecture_node_id": "mvp-service" }, "F02").passed, "F02: compat field");

// ═══════════════ F03: arch_component ═══════════════
assert(ruleDiag({ arch_component: true }, "F03").passed, "F03: true");
assert(!ruleDiag({ arch_component: false }, "F03").passed, "F03: false");
assert(!ruleDiag({}, "F03").passed, "F03: missing");
assert(!ruleDiag({ "architecture-node-id": "x", arch_component: false }, "F03").passed, "F03: id but not true");

// ═══════════════ F04: arch_layer ═══════════════
assert(ruleDiag({ arch_layer: "service" }, "F04", {ruleSet: rs}).passed, "F04: valid layer");
assert(ruleDiag({ arch_layer: "data" }, "F04", {ruleSet: rs}).passed, "F04: alias → data-lake");
assert(!ruleDiag({}, "F04", {ruleSet: rs}).passed, "F04: missing");
assert(!ruleDiag({ arch_layer: "bogus" }, "F04", {ruleSet: rs}).passed, "F04: invalid");

// ═══════════════ F05: arch_category ═══════════════
assert(ruleDiag({ arch_category: "服务" }, "F05", {ruleSet: rs}).passed, "F05: valid");
assert(ruleDiag({ arch_category: "storage" }, "F05", {ruleSet: rs}).passed, "F05: alias → 存储");
assert(!ruleDiag({}, "F05", {ruleSet: rs}).passed, "F05: missing");

// ═══════════════ F06: arch_subdomain ═══════════════
assert(ruleDiag({ arch_subdomain: "storage" }, "F06", {ruleSet: { subdomainIds: ["storage"] }}).passed, "F06: configured value");
assert(!ruleDiag({ arch_subdomain: "legacy" }, "F06", {ruleSet: { subdomainIds: ["storage"] }}).passed, "F06: removed value");
// 波4（2026-10-09 Master 快照对账批准）：F06 error→warn——58/59 子域词零使用（蓝图 seed 态），
// error 守零使用词表=过度收紧反模式；降 warn 后野生子域进 discovery 待审，词 verified 后经波3 通道逐词升回
assertEq(ruleDiag({ arch_subdomain: "legacy" }, "F06", {ruleSet: { subdomainIds: ["storage"] }}).severity, "warn", "F06: removed value severity（波4 降档）");
assert(!ruleDiag({}, "F06").passed, "F06: missing — warning");
assertEq(ruleDiag({}, "F06").severity, "warn", "F06: severity");

// ═══════════════ F07: arch_since ═══════════════
assert(ruleDiag({ arch_since: "7.0.0" }, "F07").passed, "F07: valid semver");
assert(!ruleDiag({}, "F07").passed, "F07: missing — warning");
assert(!ruleDiag({ arch_since: "bad" }, "F07").passed, "F07: bad format — blocker");
assertEq(ruleDiag({ arch_since: "bad" }, "F07").severity, "error", "F07: bad=error");

// ═══════════════ F08: arch_until ═══════════════
assert(ruleDiag({}, "F08").passed, "F08: empty info pass");
assert(ruleDiag({ arch_until: "8.0.0" }, "F08").passed, "F08: valid");
assert(!ruleDiag({ arch_until: "bad" }, "F08").passed, "F08: bad format — blocker");

// ═══════════════ F09: since/until interval ═══════════════
assert(ruleDiag({ arch_since: "7.0.0", arch_until: "8.0.0" }, "F09").passed, "F09: valid");
assert(ruleDiag({ arch_since: "7.0.0", arch_until: "7.0.0" }, "F09").passed, "F09: since === until（组件仅在单个版本有效）— #1805 语义修正");
assert(!ruleDiag({ arch_since: "8.0.0", arch_until: "7.0.0" }, "F09").passed, "F09: reversed");
assert(ruleDiag({}, "F09").passed, "F09: both empty — skip");

// ═══════════════ F10: arch_version_overrides ═══════════════
assert(ruleDiag({}, "F10").passed, "F10: empty — info pass");
assert(ruleDiag({ arch_version_overrides: [{ version: "7.5.0" }] }, "F10").passed, "F10: valid");
assertEq(JSON.stringify(ruleDiag({ arch_version_overrides: [{ version: "7.5.0" }] }, "F10").value), JSON.stringify([{ version: "7.5.0" }]), "F10: preserves structured value for repair UI");
assert(!ruleDiag({ arch_version_overrides: "not-array" }, "F10").passed, "F10: not array");
assert(!ruleDiag({ arch_version_overrides: [{ version: "bad" }] }, "F10").passed, "F10: bad version");

// ═══════════════ F11: module ═══════════════
assert(ruleDiag({ module: "Ceph" }, "F11", {ruleSet: rs}).passed, "F11: valid");
assertEq(JSON.stringify(ruleDiag({ module: ["Ceph", "MySQL"] }, "F11", {ruleSet: rs}).value), JSON.stringify(["Ceph", "MySQL"]), "F11: preserves complete module array for repair UI");
assert(!ruleDiag({}, "F11", {ruleSet: rs}).passed, "F11: missing — warning");
var r11 = ruleDiag({ module: "Unknown" }, "F11", {ruleSet: rs});
assertEq(r11.severity, "warn", "F11: unknown still warn");

// ═══════════════ F12: date ═══════════════
assert(ruleDiag({ date: "2025-01-15" }, "F12").passed, "F12: valid");
assert(!ruleDiag({}, "F12").passed, "F12: missing");
assert(!ruleDiag({ date: "01/15/2025" }, "F12").passed, "F12: bad format");

// ═══════════════ F13: updated ═══════════════
assert(!ruleDiag({}, "F13").passed, "F13: missing — warning");
assert(ruleDiag({ updated: "2025-06-01" }, "F13").passed, "F13: valid");
assert(!ruleDiag({ updated: "bad" }, "F13").passed, "F13: bad — blocker");

// ═══════════════ F15: status ═══════════════
assert(ruleDiag({ status: "在线" }, "F15", {ruleSet: rs}).passed, "F15: valid");
assert(!ruleDiag({}, "F15", {ruleSet: rs}).passed, "F15: missing");
assert(!ruleDiag({ status: "草稿" }, "F15", {ruleSet: rs}).passed, "F15: invalid"); // 草稿不在四值域仍 invalid——语义不变

// ═══════════════ F16: tags ═══════════════
assert(ruleDiag({ tags: ["a", "b"] }, "F16").passed, "F16: valid array");
assert(!ruleDiag({}, "F16").passed, "F16: missing");
assert(!ruleDiag({ tags: "string" }, "F16").passed, "F16: string → blocker");
assert(!ruleDiag({ tags: [] }, "F16").passed, "F16: empty → blocker");

// ═══════════════ wikilink extraction ═══════════════
(function() {
  var body = "依赖::[[mvp-gateway]]\n连接::[[ceph|Ceph]]\n[[doc-ref]]";
  var p = svc.extractTypedWikilinks(body);
  assertEq(p.typed.length, 2, "wl: typed count");
  assertEq(p.typed[0].type, "依赖", "wl: type");
  assertEq(p.typed[1].target, "ceph", "wl: alias stripped");
  assertEq(p.typed[0].coordinate, "line:1", "wl: first occurrence coordinate");
  assertEq(p.typed[1].coordinate, "line:2", "wl: second occurrence coordinate");
  assertEq(p.typed[1].snippet, "连接::[[ceph|Ceph]]", "wl: occurrence snippet retained");
  assertEq(p.allTargets.length, 3, "wl: all targets");
})();

// ═══════════════ B01: architecture wikilinks ═══════════════
assert(ruleDiag("依赖::[[A]]", "B01", {isBody: true}).passed, "B01: has typed");
{
  var noTypedRelation = ruleDiag("[[普通文档引用]]", "B01", {isBody: true});
  assert(!noTypedRelation.passed, "B01: bare references are not architecture relations");
  // 2026-09-12 声明重写：B01 失败文案单点声明化（零声明与缺类型同源一条人话）
  assertEq(noTypedRelation.message, "类型化架构关系缺少关系类型", "B01: distinguishes typed relations from bare references");
  assert(noTypedRelation.hint.indexOf("普通 [[target]] 仅表示 Obsidian 引用") >= 0, "B01: explains bare reference semantics");
}
{
  var missingRelationType = ruleDiag("::[[test-pipeline-verification]]", "B01", {isBody: true});
  assert(!missingRelationType.passed, "B01: empty relation type is invalid");
  assertEq(missingRelationType.value, "关系类型为空：test-pipeline-verification", "B01: reports the malformed target");
  assertEq(missingRelationType.message, "类型化架构关系缺少关系类型", "B01: distinguishes malformed typed relation");
  assert(missingRelationType.hint.indexOf("依赖::[[test-pipeline-verification]]") >= 0, "B01: shows a concrete correction example");
}

// ═══════════════ B02: target existence ═══════════════
(function() {
  var idx = { ids: { "mvp-gateway": true }, titleLookup: {}, filenameLookup: {}, duplicateIds: new Set() };
  assert(ruleDiag("依赖::[[mvp-gateway]]", "B02", {isBody: true, indexes: idx}).passed, "B02: target exists");
  assert(!ruleDiag("依赖::[[ghost]]", "B02", {isBody: true, indexes: idx}).passed, "B02: missing");
  assertEq(ruleDiag("依赖::[[ghost]]", "B02", {isBody: true, indexes: idx}).severity, "warn", "B02: severity");
  assertEq(JSON.stringify(ruleDiag("依赖::[[ghost]]", "B02", {isBody: true, indexes: idx}).unresolvedTargets), JSON.stringify(["ghost"]), "B02: exposes exact unresolved targets for repair");
})();

// ═══════════════ B03: doc reference ═══════════════
assert(ruleDiag("关联::[[doc]]", "B03", {isBody: true}).passed, "B03: has 关联");
assert(!ruleDiag("no links", "B03", {isBody: true}).passed, "B03: none — warning");
assert(!svc.isWorkbenchIssueFinding(ruleDiag("no links", "B01", {isBody: true})), "B01 advisory without an executable action stays out of workbench");
assert(!svc.isWorkbenchIssueFinding(ruleDiag("no links", "B03", {isBody: true})), "B03 advisory stays in compliance details");
assert(svc.isWorkbenchIssueFinding(ruleDiag("依赖::[[ghost]]", "B02", {isBody: true, indexes: { ids: {}, titleLookup: {}, filenameLookup: {} }})), "B02 unresolved target remains actionable");

// ═══════════════ B04: type legality ═══════════════
(function() {
  assert(ruleDiag("依赖::[[A]]", "B04", {ruleSet: rs, isBody: true}).passed, "B04: known");
  assert(!ruleDiag("未知::[[A]]", "B04", {ruleSet: rs, isBody: true}).passed, "B04: unknown — error");
  assertEq(ruleDiag("未知::[[A]]", "B04", {ruleSet: rs, isBody: true}).severity, "error", "B04: unknown severity=error");
  assert(ruleDiag("", "B04", {ruleSet: rs, isBody: true}).passed, "B04: empty — pass");
})();

// ═══════════════ buildEntityIndexes ═══════════════
(function() {
  var entities = [
    { sourcePath: "/v/a.md", fileName: "a.md", frontmatter: { "architecture-node-id": "comp-a", title: "Comp A" } },
    { sourcePath: "/v/b.md", fileName: "b.md", frontmatter: { "architecture-node-id": "comp-b", title: "Comp B" } },
    { sourcePath: "/v/a2.md", fileName: "a2.md", frontmatter: { "architecture-node-id": "comp-a", title: "Dup" } },
  ];
  var idx = svc.buildEntityIndexes(entities);
  assert(idx.ids["comp-a"], "idx: comp-a in ids");
  assert(idx.duplicateIds.has("comp-a"), "idx: comp-a duplicate");
  assertEq(!!idx.titleLookup["Comp A"], true, "idx: title lookup");
  assertEq(!!idx.filenameLookup["a.md"], true, "idx: file lookup");
  assertEq(idx.duplicateTitles instanceof Set, true, "idx: duplicateTitles is Set");
  assertEq(idx.duplicateTitles.has("Comp A"), false, "idx: Comp A not duplicate");
})();

// ═══════════════ F02b + F02c: id/title 唯一性 ═══════════════
(function() {
  // F02b: architecture-node-id 重复（已有行为，回归保护）
  var dupIdEntities = [
    mkDoc({ "architecture-node-id": "comp-a", title: "A", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["a"] }),
    mkDoc({ "architecture-node-id": "comp-a", title: "B", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["b"] }),
  ];
  var idxB = svc.buildEntityIndexes(dupIdEntities);
  assert(idxB.duplicateIds.has("comp-a"), "F02b idx: comp-a duplicate");
  var rB = svc.checkEntityCompliance(dupIdEntities[0], rs, idxB);
  var f02b = (rB.groups[0].checks || []).filter(function (f) { return f.ruleId === "F02b"; });
  assertEq(f02b.length, 1, "F02b: 1 finding");
  assertEq(f02b[0].severity, "error", "F02b: severity");
  assertEq(f02b[0].passed, false, "F02b: not passed");

  // F02c: title 重复
  var dupTitleEntities = [
    mkDoc({ "architecture-node-id": "comp-a", title: "Auth Service", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["a"] }),
    mkDoc({ "architecture-node-id": "comp-b", title: "Auth Service", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["b"] }),
  ];
  var idxC = svc.buildEntityIndexes(dupTitleEntities);
  assert(idxC.duplicateTitles.has("Auth Service"), "F02c idx: Auth Service duplicate");
  assertEq(idxC.duplicateIds.has("comp-a"), false, "F02c idx: no id duplicate");
  var rC = svc.checkEntityCompliance(dupTitleEntities[0], rs, idxC);
  var f02c = (rC.groups[0].checks || []).filter(function (f) { return f.ruleId === "F02c"; });
  assertEq(f02c.length, 1, "F02c: 1 finding");
  assertEq(f02c[0].severity, "error", "F02c: severity");
  assertEq(f02c[0].passed, false, "F02c: not passed");
  assertEq(f02c[0].field, "title", "F02c: field");
  assertEq(f02c[0]._group, "identity", "F02c: identity group");

  // F02c: 两个重复 entity 都报（不是只报后到者）
  var rC2 = svc.checkEntityCompliance(dupTitleEntities[1], rs, idxC);
  var f02c2 = (rC2.groups[0].checks || []).filter(function (f) { return f.ruleId === "F02c"; });
  assertEq(f02c2.length, 1, "F02c: both entities report");

  // F02c: title 不重复时不报（无 false positive）
  var uniqueEntities = [
    mkDoc({ "architecture-node-id": "comp-a", title: "API Gateway", arch_component: true, arch_layer: "gateway", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["a"] }),
    mkDoc({ "architecture-node-id": "comp-b", title: "Auth Service", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["b"] }),
  ];
  var idxU = svc.buildEntityIndexes(uniqueEntities);
  assertEq(idxU.duplicateTitles.has("API Gateway"), false, "F02c idx: unique no dup");
  var rU = svc.checkEntityCompliance(uniqueEntities[0], rs, idxU);
  var f02cU = (rU.groups[0].checks || []).filter(function (f) { return f.ruleId === "F02c"; });
  assertEq(f02cU.length, 0, "F02c: no finding when titles unique");

  // F02c: 空 title 不报（不与别人撞空字符串）
  var emptyTitleEntities = [
    mkDoc({ "architecture-node-id": "comp-a", title: "", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["a"] }),
    mkDoc({ "architecture-node-id": "comp-b", title: "", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["b"] }),
  ];
  var idxE = svc.buildEntityIndexes(emptyTitleEntities);
  assertEq(idxE.duplicateTitles.size, 0, "F02c idx: empty title not counted as dup");
})();

// ═══════════════ checkEntityCompliance ═══════════════
(function() {
  var doc = mkDoc({
    title: "Test Service", "architecture-node-id": "test-service",
    arch_component: true, arch_layer: "service", arch_category: "服务",
    date: "2025-01-01", status: "有效", tags: ["test"],
  }, "依赖::[[other]]\n关联::[[doc]]");
  var r = svc.checkEntityCompliance(doc, rs, svc.buildEntityIndexes([doc]));
  assert(r.score > 0, "agg: score");
  assertEq(r.groups.length, 7, "agg: 7 groups");
  assertEq(r.groups[0].id, "identity", "agg: identity group");
  var layerFinding = r.groups[1].checks.filter(function (f) { return f.ruleId === "F04"; })[0];
  var sinceFinding = r.groups[2].checks.filter(function (f) { return f.ruleId === "F07"; })[0];
  var untilFinding = r.groups[2].checks.filter(function (f) { return f.ruleId === "F08"; })[0];
  var intervalFinding = r.groups[2].checks.filter(function (f) { return f.ruleId === "F09"; })[0];
  assertEq(layerFinding.editable, true, "repair: layer is editable");
  assertEq(layerFinding.allowedValues.length, rs.archLayers.length, "repair: layer options exposed");
  assertEq(sinceFinding.editable, true, "repair: arch_since is editable");
  assertEq(untilFinding.editable, true, "repair: arch_until is editable");
  assertEq(intervalFinding.editable, false, "repair: composite interval is not directly editable");
})();

// ═══════════════ checkAllEntities + summary + filter ═══════════════
(function() {
  var docs = [
    mkDoc({ title: "A", "architecture-node-id": "comp-a", arch_component: true, arch_layer: "service", arch_category: "服务", date: "2025-01-01", status: "有效", tags: ["a"] }),
    mkDoc({ title: "B", "architecture-node-id": "comp-b", arch_component: true }),
  ];
  var results = svc.checkAllEntities(docs, rs);
  assertEq(results.length, 2, "all: 2 results");
  assert(results[0].score > results[1].score, "all: score order");

  var s = svc.buildSummary(results);
  assertEq(s.totalEntities, 2, "summary: total");
  assertEq(typeof s.averageScore, "number", "summary: avgScore");

  assertEq(svc.filterResults(results, "all", "comp-a").length, 1, "filter: search");
  results[0].sourceKey = "知识库/wiki/entities/comp-a.md";
  assertEq(svc.filterResults(results, "all", "知识库/wiki/entities/comp-a.md").length, 1, "filter: sourceKey search");
})();

// ═══════════════ Edge cases ═══════════════
(function() {
  var r = svc.checkEntityCompliance(mkDoc({}, ""), rs, svc.buildEntityIndexes([]));
  assert(r.blockerCount > 0, "edge: empty doc has blockers");

  var r2 = svc.checkEntityCompliance({ sourcePath: "", fileName: "", frontmatter: {}, body: "" }, rs, svc.buildEntityIndexes([]));
  assertEq(r2.entityId, "", "edge: no id → empty");

  assertEq(svc.filterResults([], "all", "x").length, 0, "edge: filter empty");
  assertEq(svc.buildSummary([]).totalEntities, 0, "edge: empty summary");
assertEq(svc.buildSummary([]).averageScore, 0, "edge: empty avgScore");

  // ── 批A（PR-229）：身份撤回形状执法——findings 不带形状正则，但必填非空与形状下发管道都在 ──
  (function() {
    var fieldFindings = function (result, field) {
      var out = [];
      (result.groups || []).forEach(function (g) { (g.checks || []).forEach(function (c) { if (c.field === field) out.push(c); }); });
      return out;
    };
    var rEmpty = svc.checkEntityCompliance(mkDoc({ "architecture-node-id": "" }, ""), rs, svc.buildEntityIndexes([]));
    var f02Empty = fieldFindings(rEmpty, "architecture-node-id");
    assert(f02Empty.length > 0 && f02Empty.every(function (f) { return !f.passed; }), "批A: 空身份仍产 F02 阻断");
    assert(f02Empty.every(function (f) { return f.pattern === undefined; }), "批A: 身份 findings 不带形状正则");
    var rFree = svc.checkEntityCompliance(mkDoc({ "architecture-node-id": "grown-测试模块" }, "正文"), rs, svc.buildEntityIndexes([]));
    var f02Passed = fieldFindings(rFree, "architecture-node-id").filter(function (f) { return f.passed; });
    assert(f02Passed.length > 0, "批A: 含中文身份通过（真库那条）");
    assert(f02Passed.every(function (f) { return f.pattern === undefined; }), "批A: 通过态身份也不带形状正则（前端表单不再按 kebab 校验）");
    var schema = engine.buildFrontmatterSchema(rs);
    var idSchema = schema.properties["architecture-node-id"] || {};
    assertEq(idSchema.pattern, "\\S", "批A: 身份 schema 只有非空白谓词，无形状正则（minLength 放过 \"  \"，故不用它）");
    assertEq(idSchema.minLength, undefined, "批A: 身份字段不带长度形状约束");
    assert(schema.required.indexOf("architecture-node-id") >= 0, "批A: 身份仍在必填清单");
    var rBlank = svc.checkEntityCompliance(mkDoc({ "architecture-node-id": "   " }, ""), rs, svc.buildEntityIndexes([]));
    var f02Blank = fieldFindings(rBlank, "architecture-node-id");
    assert(f02Blank.length > 0 && f02Blank.every(function (f) { return !f.passed; }), "批A: 纯空白身份仍产 F02 阻断（写门同判）");
    assertEq(schema.properties.date.pattern, svc.DATE_RE.source, "批A: 形状下发管道未拆（date 字段仍拿单源正则）");
    var rTitle = svc.checkEntityCompliance(mkDoc({ title: "x" }, ""), rs, svc.buildEntityIndexes([]));
    assert(fieldFindings(rTitle, "title").every(function (f) { return f.pattern === undefined; }), "批A: 非形状规则字段不带 pattern");
  })();

  // ── D-1（WP-108）：不可修改升成声明——能力位由服务端下发，前端据此只读 ──
  (function () {
    var { FIELD_RULES } = require("../../../shared/field-rule-declarations.cjs");
    assert(
      FIELD_RULES.some(function (r) { return r.immutable === true && r.field === "architecture-node-id"; }),
      "D-1: 架构身份的 immutable 位在声明表（不在代码里的裸 if）"
    );
    var withId = svc.checkEntityCompliance(mkDoc({ "architecture-node-id": "mysql-primary", title: "T" }, "正文"), rs, svc.buildEntityIndexes([]));
    var idFinding = (withId.groups || []).flatMap(function (g) { return g.checks || []; }).filter(function (c) { return c.field === "architecture-node-id"; })[0];
    assert(idFinding, "D-1: 身份 finding 存在");
    assertEq(idFinding.editable, false, "D-1: 已有非空值的 immutable 字段 → editable=false（前端只读的能力位）");
    var emptyId = svc.checkEntityCompliance(mkDoc({ "architecture-node-id": "", title: "T" }, "正文"), rs, svc.buildEntityIndexes([]));
    var emptyFinding = (emptyId.groups || []).flatMap(function (g) { return g.checks || []; }).filter(function (c) { return c.field === "architecture-node-id"; })[0];
    assertEq(emptyFinding.editable, true, "D-1 反面对照: 值为空时仍可编辑（新建/补齐不能被误锁死）");
    var titleFinding = (withId.groups || []).flatMap(function (g) { return g.checks || []; }).filter(function (c) { return c.field === "title"; })[0];
    assertEq(titleFinding.editable, true, "D-1 反面对照: 未声明 immutable 的字段不受影响");
  })();

  // ── 复核回件 C1＋C4（WP-110 随批）：键形解析单源；能力位键必在场（缺键即前端默认「可编辑」）──
  (function () {
    // C1：蛇形键持有值的记录——能力位与现值通道必须走同一解析器。复核实测：修前能力位如实报锁死，
    // 而 sourceValues 报不出当前值，抽屉因此给出一个提交必被 422 打回的空输入框。
    var snake = svc.checkEntityCompliance(mkDoc({ architecture_node_id: "snake-holder", title: "T" }, "正文"), rs, svc.buildEntityIndexes([]));
    var snakeFinding = (snake.groups || []).flatMap(function (g) { return g.checks || []; }).filter(function (c) { return c.field === "architecture-node-id"; })[0];
    assertEq(snakeFinding.editable, false, "复核 C1: 蛇形键有值同样判锁死");
    assertEq(svc.buildSourceValues({ architecture_node_id: "snake-holder" })["architecture-node-id"], "snake-holder", "复核 C1: 现值通道按同一键形解析器取值（各读一形即红）");
    assertEq(svc.buildSourceValues({ "architecture-node-id": "kebab-holder", architecture_node_id: "other" })["architecture-node-id"], "kebab-holder", "复核 C1 反面对照: kebab 形优先，两形并存不串值");
    // C4：能力位是「创建后不可修改」的下发通道，任何 finding 不得漏键（漏键＝前端默认按可编辑处理）
    var allChecks = (snake.groups || []).flatMap(function (g) { return g.checks || []; });
    assert(allChecks.length > 0, "复核 C4: 诊断面确有 finding（否则下面的完备性断言是空洞通过）");
    assert(allChecks.every(function (c) { return typeof c.editable === "boolean"; }), "复核 C4: 每条 finding 都带 boolean editable");
  })();

  // ── 批B-1 复核回件：持有者名单要排除自身、有界、净空（三条均为复核实测缺陷）──
  (function() {
    var mkEntity = function (fileName, title, id) {
      return { fileName: fileName, sourcePath: "/v/wiki/entities/" + fileName, frontmatter: { title: title, "architecture-node-id": id, arch_component: true }, body: "" };
    };
    var selfDoc = mkEntity("self.md", "自身实体", "dup-id");
    var pool = [selfDoc];
    for (var i = 0; i < 300; i++) pool.push(mkEntity("other-" + i + ".md", "持有者\n换行注入 " + i, "dup-id"));
    var idx = svc.buildEntityIndexes(pool);
    var diag = engine.runAllDiagnostics(selfDoc, {}, idx).filter(function (x) { return x.ruleId === "F02b"; })[0];
    assert(!!diag && diag.passed === false, "批B-1: 同值重复产 F02b 阻断");
    var msg = String(diag.message || "");
    assert(msg.indexOf("自身实体（self.md）") < 0, "批B-1: 名单不得把待判文档自己列为持有者（selfFileName 过滤承重）");
    assert(msg.indexOf("\n") < 0, "批B-1: 持有者标题中的换行被净空，不得伪造多行文案");
    assert(msg.length < 300, "批B-1: 300 个持有者的名单有界（撤上限实测单条 4599 字）");
    assert(/等 300 处/.test(msg), "批B-1: 截断后如实报出总数");
  })();
})();

if (failed > 0) throw new Error("failed: " + failed + ", passed: " + passed);
}

describe("entity-compliance-service", function () {
  it("runs frontmatter/body/index/summary/filter checks", function () {
    runSuite();
  });
});
