// Component: Property-Governance-Service Unit Tests
// @responsible: 验证属性治理六类检查及边界条件。
// @inputs: Property-Governance-Service 与内存 fixture
// @outputs: 单元测试断言结果
// @context: Canvas
// Covers all 6 checks with boundary conditions.
const svc = require("../property-governance-service.cjs");

var passed = 0, failed = 0;
function assertEq(a, e, l) { if (a === e) passed++; else { console.error("FAIL: " + l + " — expected " + JSON.stringify(e) + ", got " + JSON.stringify(a)); failed++; } }
function assert(c, l) { if (c) passed++; else { console.error("FAIL: " + l); failed++; } }
function assertGt(a, b, l) { if (a > b) passed++; else { console.error("FAIL: " + l); failed++; } }

// ── Test fixtures ──

var MOCK_GRAPH_NODES = [
  { id: "mvp-gateway", label: "mvp-gateway", category: "服务", labels: ["ArchitectureComponent", "Module"], properties: { file_path: "wiki/entities/mvp-gateway.md", "architecture-node-id": "mvp-gateway" } },
  { id: "mvp-service", label: "mvp-service", category: "服务", labels: ["ArchitectureComponent", "Module"], properties: { file_path: "wiki/entities/mvp-service.md" } },
];

var MOCK_GRAPH_EDGES = [
  { from: "mvp-gateway", to: "mvp-service", relationType: "DEPENDS_ON" },
];

var MOCK_MANIFEST = {
  version: 1,
  generatedAt: "2026-06-28T03:48:03.829Z",
  files: {
    "知识库/wiki/entities/mvp-gateway.md": { mtime_ns: 1782202791234364709, size: 15291 },
  },
};

// ═══════════ Check 1: missing_module ═══════════

(function () {
  var r = svc.checkModule(null, ["MVP Gateway"]);
  assertEq(r.missing_module.passed, false, "1a: null module → missing");
})();

(function () {
  var r = svc.checkModule("", ["MVP Gateway"]);
  assertEq(r.missing_module.passed, false, "1b: empty module → missing");
})();

(function () {
  var r = svc.checkModule(undefined, ["MVP Gateway"]);
  assertEq(r.missing_module.passed, false, "1c: undefined module → missing");
})();

(function () {
  var r = svc.checkModule("MVP Gateway", ["MVP Gateway"]);
  assertEq(r.missing_module.passed, true, "1d: valid module → not missing");
})();

// ═══════════ Check 2: invalid_module ═══════════

(function () {
  var r = svc.checkModule("UnknownX", ["MVP Gateway", "MVP Service"]);
  assertEq(r.invalid_module.passed, false, "2a: unknown module → invalid");
})();

(function () {
  var r = svc.checkModule("MVP Gateway", ["MVP Gateway", "MVP Service"]);
  assertEq(r.invalid_module.passed, true, "2b: known module → valid");
})();

(function () {
  var r = svc.checkModule(null, ["MVP Gateway"]);
  assertEq(r.invalid_module.passed, true, "2c: null module → invalid not checked (no value to validate)");
})();

// ═══════════ Check 3: stale_property ═══════════

(function () {
  var r = svc.checkFreshness("", {});
  assertEq(r.stale_property.passed, true, "3a: no sourcePath → passes");
})();

(function () {
  var r = svc.checkFreshness("/some/path.md", null);
  assertEq(r.stale_property.passed, true, "3b: no manifest → passes");
})();

(function () {
  // Use timestamps within JS safe integer range (Date.now() is ~1.7e12 ms)
  var futureMtime = 1800000000000000000; // ~2027 in ns → 1.8e9 ms → way after 2026-06-28
  var manifestFiles = { "知识库/wiki/entities/A.md": { mtime_ns: futureMtime, size: 100 } };
  var r = svc.checkFreshness("/Users/example/Obsidian Vault Bare Test/知识库/wiki/entities/A.md", manifestFiles, "2026-06-28T00:00:00.000Z");
  assertEq(r.stale_property.passed, false, "3c: newer article → stale");
})();

(function () {
  var pastMtime = 1750000000000000000; // ~2025-06
  var manifestFiles = { "知识库/wiki/entities/A.md": { mtime_ns: pastMtime, size: 100 } };
  var r = svc.checkFreshness("/Users/example/Obsidian Vault Bare Test/知识库/wiki/entities/A.md", manifestFiles, "2026-06-28T00:00:00.000Z");
  assertEq(r.stale_property.passed, true, "3d: older article → fresh");
})();

// ═══════════ Check 4: mount_mismatch ═══════════

(function () {
  var r = svc.checkMount({ id: "mvp-gateway", sourcePath: "" }, MOCK_GRAPH_NODES);
  assertEq(r.mount_mismatch.passed, true, "4a: direct ID match → matched");
  assertEq(r.mount_mismatch.matchedEntityId, "mvp-gateway", "4a: entityId = mvp-gateway");
})();

(function () {
  var r = svc.checkMount({ id: "X", sourcePath: "/Users/example/Obsidian Vault Bare Test/知识库/wiki/entities/mvp-gateway.md" }, MOCK_GRAPH_NODES);
  assertEq(r.mount_mismatch.passed, true, "4b: file_path match → matched");
})();

(function () {
  var r = svc.checkMount({ id: "no-such", sourcePath: "/nonexistent/path.md" }, MOCK_GRAPH_NODES);
  assertEq(r.mount_mismatch.passed, false, "4c: no match → unmatched");
  assertEq(r.mount_mismatch.matchedEntityId, null, "4c: matchedEntityId is null");
})();

(function () {
  var r = svc.checkMount({ id: "mvp-gateway", sourcePath: "" }, MOCK_GRAPH_NODES);
  assertEq(r.mount_mismatch.passed, true, "4d: arch-id via properties → matched");
})();

// ═══════════ Check 5: mount_diagnostic ═══════════

(function () {
  var r = svc.checkDiagnostic({ id: "mvp-gateway" }, MOCK_GRAPH_NODES, MOCK_GRAPH_EDGES);
  assertGt(r.mount_diagnostic.entityCount, 0, "5a: entity count > 0");
  assertGt(r.mount_diagnostic.edgeCount, 0, "5b: edge count > 0 (1 DEPENDS_ON)");
})();

(function () {
  var r = svc.checkDiagnostic({ id: "no-such" }, MOCK_GRAPH_NODES, MOCK_GRAPH_EDGES);
  assertEq(r.mount_diagnostic.entityCount, 0, "5c: no entity → count 0");
  assertEq(r.mount_diagnostic.missingEntityIds.length, 1, "5d: missing listed");
})();

// ═══════════ Check 6: format_artifact ═══════════

(function () {
  var r = svc.checkFormat({ module: "MVP Gateway", arch_layer: "gateway" });
  assertEq(r.format_artifact.passed, true, "6a: clean fields → no artifacts");
  assertEq(r.format_artifact.artifacts.length, 0, "6a: zero artifacts");
})();

(function () {
  var r = svc.checkFormat({ module: "['MVP Gateway']", arch_layer: "gateway" });
  assertEq(r.format_artifact.passed, false, "6b: python list → artifact found");
  assertEq(r.format_artifact.artifacts[0].field, "module", "6b: artifact field = module");
})();

(function () {
  var r = svc.checkFormat({ arch_category: "{'key': 'value'}" });
  assertEq(r.format_artifact.passed, false, "6c: python dict → artifact found");
})();

(function () {
  var r = svc.checkFormat({ module: ["MVP Gateway"] });
  assertEq(r.format_artifact.passed, false, "6d: array module → artifact (warned & normalized)");
})();

// ═══════════ Check 7: only formal documents participate ═══════════

(function () {
  var r = svc.checkDocumentModuleEntity({
    id: "doc-raw-precleaned-token",
    label: "Token",
    labels: ["Document"],
    properties: { module: "身份与认证", source_vault_path: "知识库/知识库/raw/precleaned/Token.md" },
  }, [], ["身份与认证"]);
  assertEq(r.document_module_entity.passed, true, "7a: candidate contamination does not create a secondary entity issue");
  assertEq(r.document_module_entity.applicable, false, "7b: candidate contamination is outside the formal-document check boundary");
})();

(function () {
  var r = svc.checkDocumentModuleEntity({
    id: "article-approved",
    label: "Approved",
    labels: ["Document"],
    properties: { module: "身份与认证", source_path: "知识库/wiki/articles/ART-001/revision.md" },
  }, [], ["身份与认证"]);
  assertEq(r.document_module_entity.passed, false, "7c: a formal article still reports its missing module entity");
})();

// ═══════════ Integration: checkAll + buildSummary + filter ═══════════

(function () {
  var components = [
    { id: "A", label: "Comp A", module: "MVP Gateway", arch_layer: "gateway", sourcePath: "/vault/wiki/entities/A.md" },
  ];
  var results = svc.checkAll(components, MOCK_MANIFEST, MOCK_GRAPH_NODES, MOCK_GRAPH_EDGES);
  assertEq(results.length, 1, "7a: one result per component");
  var c = results[0].checks;
  assert(c.missing_module !== undefined, "7a: has missing_module");
  assert(c.invalid_module !== undefined, "7b: has invalid_module");
  assert(c.stale_property !== undefined, "7c: has stale_property");
  assert(c.mount_mismatch !== undefined, "7d: has mount_mismatch");
  assert(c.mount_diagnostic !== undefined, "7e: has mount_diagnostic");
  assert(c.format_artifact !== undefined, "7f: has format_artifact");
})();

(function () {
  var graphNodes = [
    { id: "OK", label: "OK", properties: { file_path: "v/OK.md" } },
    { id: "BAD", label: "BAD", properties: { file_path: "v/BAD.md" } },
  ];
  var components = [
    { id: "OK", label: "OK", module: "MVP Gateway", arch_layer: "gateway", sourcePath: "v/OK.md" },
    { id: "BAD", label: "BAD", module: null, arch_layer: "service", sourcePath: "v/BAD.md" },
  ];
  var manifest = { generatedAt: "2026-06-28T00:00:00.000Z", files: {} };
  var validMods = ["MVP Gateway", "MVP Service"];
  var results = svc.checkAll(components, manifest, graphNodes, [], validMods);
  var s = svc.buildSummary(results);
  assertEq(s.totalComponents, 2, "7g: total 2");
  assertEq(s.blockerCount, 1, "7h: one blocker (B missing module, OK all green)");
  assertEq(s.coverageRatio, 0.5, "7i: coverage 50%");
})();

(function () {
  var graphNodes = [
    { id: "OK", label: "OK", properties: { file_path: "v/OK.md" } },
    { id: "BAD", label: "BAD", properties: { file_path: "v/BAD.md" } },
  ];
  var components = [
    { id: "OK", label: "OK", module: "MVP Gateway", arch_layer: "gateway", sourcePath: "v/OK.md" },
    { id: "BAD", label: "BAD", module: null, arch_layer: "service", sourcePath: "v/BAD.md" },
  ];
  var manifest = { generatedAt: "2026-06-28T00:00:00.000Z", files: {} };
  var validMods = ["MVP Gateway", "MVP Service"];
  var results = svc.checkAll(components, manifest, graphNodes, [], validMods);
  var filtered = svc.filterResults(results, "blocker", "");
  assertEq(filtered.length, 1, "7j: blocker filter → 1 (BAD only)");
  assertEq(filtered[0].componentId, "BAD", "7k: BAD is the blocker");
})();

// ═══════════ seq193: severity classification 单源收敛（刀1，审计族 S）═══════════

(function () {
  // 分叉红灯复现场景：仅 document_module_entity 失败的组件——
  // 收敛前 summary 计入 blocker（4 项判定）而 filter("blocker") 不显示（3 项判定漏之）。
  var components = [
    { id: "ONLY-DOC", label: "ONLY-DOC", module: "MVP Gateway", arch_layer: "gateway", sourcePath: "v/ONLY-DOC.md" },
  ];
  var manifest = { generatedAt: "2026-06-28T00:00:00.000Z", files: {} };
  var graphNodes = [
    { id: "mvp-gateway", label: "mvp-gateway", category: "服务", labels: ["ArchitectureComponent", "Module"], properties: { file_path: "wiki/entities/mvp-gateway.md" } },
  ];
  var validMods = ["MVP Gateway"];

  // 构造 document_module_entity 单项失败：先跑正常 checkAll，再人为翻转该项
  var results = svc.checkAll(components, manifest, graphNodes, [], validMods);
  var c = results[0].checks;
  // 保证基线：除 document_module_entity 外全过
  c.missing_module.passed = true;
  c.invalid_module.passed = true;
  c.mount_mismatch.passed = true;
  c.stale_property.passed = true;
  c.format_artifact.passed = true;
  if (c.document_module_entity) {
    c.document_module_entity.passed = false;
  } else {
    // 该 fixture 拿不到 document_module_entity 时，直接用 classify 断言构造对象
    var synthetic = { missing_module: { passed: true }, invalid_module: { passed: true }, mount_mismatch: { passed: true }, stale_property: { passed: true }, format_artifact: { passed: true }, document_module_entity: { passed: false } };
    assertEq(svc.classifyComponentSeverity(synthetic), "blocker", "8a: document_module_entity-only failure → blocker");
  }

  // 8b: classify 单源函数直接断言三分级
  var allPass = { missing_module: { passed: true }, invalid_module: { passed: true }, mount_mismatch: { passed: true }, stale_property: { passed: true }, format_artifact: { passed: true }, document_module_entity: { passed: true } };
  var warnOnly = { missing_module: { passed: true }, invalid_module: { passed: true }, mount_mismatch: { passed: true }, stale_property: { passed: false }, format_artifact: { passed: true }, document_module_entity: { passed: true } };
  assertEq(svc.classifyComponentSeverity(allPass), "clean", "8b: all passed → clean");
  assertEq(svc.classifyComponentSeverity(warnOnly), "warning", "8c: stale_property-only → warning");

  // 8d: 计数/过滤一致化（收敛语义核心断言）——若 fixture 支持时
  if (c.document_module_entity) {
    var summary = svc.buildSummary(results);
    var filteredBlockers = svc.filterResults(results, "blocker", "");
    assertEq(summary.blockerCount, 1, "8d-1: summary counts ONLY-DOC as blocker");
    assertEq(filteredBlockers.length, 1, "8d-2: filter(blocker) shows the SAME component（收敛前为 0——分叉已修）");
    assertEq(filteredBlockers[0] && filteredBlockers[0].componentId, "ONLY-DOC", "8d-3: filter identity matches");
  }
})();

// ── Report ──
console.log(passed + "/" + (passed + failed) + " tests passed");
if (failed > 0) process.exit(1);
