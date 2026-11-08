// dashboard-architecture.test.cjs — architecture scope route response tests
// PR-085：经 route-harness（Fastify inject）走完整传输层；断言口径不变（status/封套/data 字段）。
const fs = require("fs");
const os = require("os");
const path = require("path");
const dashboardRoutes = require("../dashboard-routes.cjs");
const sas = require("../../services/projection/semantic-architecture-service.cjs");
const mgs = require("../../services/projection/master-graph-service.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

var passed = 0, failed = 0;
function assertEq(a, e, l) { if (a === e) passed++; else { console.error("FAIL: " + l + " — expected " + JSON.stringify(e) + ", got " + JSON.stringify(a)); failed++; } }
function assert(c, l) { if (c) passed++; else { console.error("FAIL: " + l); failed++; } }

const TOPOLOGY = "GET /api/dashboard/topology";

// Fixture: a small master graph with entity nodes
var FIXTURE_MASTER_GRAPH = {
  _format_version: "1.0",
  nodes: [
    { id: "api-gateway", label: "API Gateway", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
    { id: "payment-service", label: "Payment Service", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
    { id: "order-service", label: "Order Service", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
    { id: "domain-1", label: "Core", category: "业务域", labels: ["BusinessDomain"], properties: { name: "核心域" } },
  ],
  connections: [
    { from: "api-gateway", to: "payment-service", relationType: "DEPENDS_ON", properties: {} },
    { from: "payment-service", to: "order-service", relationType: "DEPENDS_ON", properties: {} },
  ],
};

var SA_FIXTURE = {
  components: [
    { id: "api-gateway" },
    { id: "ghost-service" }, // not in master graph → should appear in missingSeeds
  ],
  updatedAt: "2026-07-13T12:00:00Z",
  version: "1.0",
};

// Create temp vault with master_graph.json for pruneToSubgraph
var vault = fs.mkdtempSync(path.join(os.tmpdir(), "dash-arch-test-"));
var anyshare = path.join(vault, ".ledger");
fs.mkdirSync(anyshare, { recursive: true });
fs.writeFileSync(path.join(anyshare, "master_graph.json"), JSON.stringify(FIXTURE_MASTER_GRAPH), "utf-8");

mgs.setVaultPath(vault);

// Stub SAS functions so they don't need real vault paths
var origGetComponentIds = sas.getComponentIds;
var origValidateFreshness = sas.validateFreshness;
sas.getComponentIds = function () {
  return ["api-gateway", "ghost-service"];
};
sas.validateFreshness = function () {
  return { fresh: true, ageHours: 0.5, updatedAt: "2026-07-13T12:00:00Z", version: "1.0" };
};

function harnessWith(deps) {
  const h = createRouteHarness();
  dashboardRoutes.register(h.registerRoute, deps);
  return h;
}

(async function main() {
  var h = harnessWith({
    readMasterGraph: function () { return FIXTURE_MASTER_GRAPH; },
    readSemanticArchitecture: function () { return SA_FIXTURE; },
    vaultPath: vault,
  });

  // Test 1: architecture scope exposes missingSeeds from pruneToSubgraph
  var res = await h.call(TOPOLOGY, "/api/dashboard/topology?scope=architecture");
  assertEq(res.statusCode, 200, "architecture route → 200");
  assert(res.body !== null, "architecture route → body is not null");
  assert(res.body.success === true, "architecture route → success true");
  assert(res.body.data !== undefined, "architecture route → data present");
  assert(res.body.data.scope === "architecture", "architecture route → scope=architecture");
  assert(Array.isArray(res.body.data.missingSeeds), "architecture route → missingSeeds is an array");
  assertEq(res.body.data.missingSeeds.length, 1, "architecture route → missingSeeds has 1 entry (ghost-service)");
  assertEq(res.body.data.missingSeeds[0], "ghost-service", "architecture route → missingSeeds contains ghost-service");
  assertEq(res.body.data.seedCount, 2, "architecture route → seedCount=2 (from componentIds length)");
  assert(Array.isArray(res.body.data.seedComponentIds), "architecture route → seedComponentIds is array");
  assertEq(res.body.data.seedComponentIds.length, 2, "architecture route → seedComponentIds has 2 entries (api-gateway + ghost-service)");

  // Test 2: architecture scope exposes implicitPaths
  var res2 = await h.call(TOPOLOGY, "/api/dashboard/topology?scope=architecture");
  assert(Array.isArray(res2.body.data.implicitPaths), "architecture route → implicitPaths is array");

  // Test 3: architecture scope exposes unresolvedPairs
  var res3 = await h.call(TOPOLOGY, "/api/dashboard/topology?scope=architecture");
  assert(Array.isArray(res3.body.data.unresolvedPairs), "architecture route → unresolvedPairs is array");

  // Test 4: architecture scope exposes dataFreshness
  var res4 = await h.call(TOPOLOGY, "/api/dashboard/topology?scope=architecture");
  assert(res4.body.data.dataFreshness !== undefined, "architecture route → dataFreshness present");
  assert(typeof res4.body.data.dataFreshness.fresh === "boolean", "architecture route → dataFreshness.fresh is boolean");

  // Test 5: architecture scope when SA is null → 零值 200（PR-081 修正向：无 SA 数据是合法
  // 空数据态，各组件显示 0；此前 404 属编外码且被前端渲染成错误横幅——Master 2026-10-20 裁定）
  {
    // PR-084：替身模拟读侧唯一咽喉契约——无数据返回注册表零值形状（永不返 null），
    // 与实现同源取 contracts/frozen-artifacts.registry.json 的 sa 槽零值。
    var SA_ZERO = require("../../../contracts/frozen-artifacts.registry.json").artifacts.sa.zeroValue;
    var temp_sas = require("../../services/projection/semantic-architecture-service.cjs");
    var orig2 = temp_sas.getComponentIds;
    temp_sas.getComponentIds = function () { return []; };
    var h2 = harnessWith({
      readMasterGraph: function () { return FIXTURE_MASTER_GRAPH; },
      readSemanticArchitecture: function () { return JSON.parse(JSON.stringify(SA_ZERO)); },
      vaultPath: vault,
    });
    var res5 = await h2.call(TOPOLOGY, "/api/dashboard/topology?scope=architecture");
    assertEq(res5.statusCode, 200, "architecture route → 200 when SA is null (空数据零值载荷)");
    assert(res5.body.success === true, "architecture route → success true when SA is null");
    assertEq(res5.body.data.seedCount, 0, "architecture route → seedCount=0 when SA is null");
    assertEq(res5.body.data.returnedNodes, 0, "architecture route → returnedNodes=0 when SA is null");
    assertEq(res5.body.data.topology.nodes.length, 0, "architecture route → empty topology nodes");
    assert(Array.isArray(res5.body.data.taxonomyTree), "architecture route → taxonomyTree still present");
    temp_sas.getComponentIds = orig2;
    await h2.close();
  }

  // Test 6: full scope response
  var res6 = await h.call(TOPOLOGY, "/api/dashboard/topology?scope=full");
  assertEq(res6.statusCode, 200, "full scope route → 200");
  assertEq(res6.body.data.scope, "full", "full scope route → scope=full");

  // Test 7: invalid scope returns 400
  var res7 = await h.call(TOPOLOGY, "/api/dashboard/topology?scope=invalid");
  assertEq(res7.statusCode, 400, "invalid scope route → 400");

  // Test 7.5: 空图 → 200 零值载荷（PR-081 全量落地：空数据是合法空态，NOT_INITIALIZED 404
  // 编外码退役——Master 2026-10-26「空库就显示各项0就行了啊要什么指引」；与架构范围 PR-084 同构）
  {
    var hEmpty = harnessWith({
      readMasterGraph: function () { return null; },
      readSemanticArchitecture: function () { return SA_FIXTURE; },
      vaultPath: vault,
    });
    var resEmpty = await hEmpty.call(TOPOLOGY, "/api/dashboard/topology?scope=full");
    assertEq(resEmpty.statusCode, 200, "full scope empty graph → 200（NOT_INITIALIZED 退役）");
    assertEq(resEmpty.body.data.totalNodes, 0, "empty graph → totalNodes=0");
    assertEq(resEmpty.body.data.topology.nodes.length, 0, "empty graph → topology.nodes 空");
    assertEq(resEmpty.body.data.topology.edges.length, 0, "empty graph → topology.edges 空");
    assert(Array.isArray(resEmpty.body.data.taxonomyTree), "empty graph → taxonomyTree 是数组");
    assertEq(resEmpty.body.data.gaps.length, 0, "empty graph → gaps 空");
    // 架构范围同批受益：主图空不再 404，零值形状自然出全零载荷
    var resEmptyArch = await hEmpty.call(TOPOLOGY, "/api/dashboard/topology?scope=architecture");
    assertEq(resEmptyArch.statusCode, 200, "architecture scope empty master graph → 200");
    assertEq(resEmptyArch.body.data.totalNodes, 0, "architecture empty → totalNodes=0");
    await hEmpty.close();
  }

  // Test 8: dashboard 恒活读工作投影，formalConsumer 不再进入消费链（ADR067 #1775 契约迁移）
  {
    var pins = 0;
    var vaultCalls = 0;
    var live = harnessWith({
      readMasterGraph: function () { vaultCalls++; return FIXTURE_MASTER_GRAPH; },
      readSemanticArchitecture: function () { vaultCalls++; return SA_FIXTURE; },
      getResolvedGapIds: function () { return new Set(["runtime-only"]); },
      vaultPath: vault,
      formalConsumer: {
        withPinnedRelease: function () { pins++; return {}; },
      },
    });
    var liveRes = await live.call(TOPOLOGY, "/api/dashboard/topology?scope=full");
    assertEq(liveRes.statusCode, 200, "dashboard live-read → 200");
    assertEq(pins, 0, "dashboard live-read → formalConsumer never pinned (ADR067)");
    assert(vaultCalls > 0, "dashboard live-read → worktree sources actually read");
    assertEq(liveRes.body.success, true, "dashboard live-read → success true");
    assertEq(liveRes.body.data.dataSource, "worktree", "dashboard live-read → dataSource=worktree");
    assertEq(liveRes.body.data.freshness, undefined, "dashboard live-read → no freshness key (ADR067)");
    assertEq(liveRes.body.data.releaseId, undefined, "dashboard live-read → no releaseId identity");
    assert(typeof liveRes.body.data.workingRevision === "string", "dashboard live-read → workingRevision present");
    await live.close();
  }

  // Test 9: 无 Release（formalConsumer 抛 NO_CURRENT_RELEASE）dashboard 仍活读成功——
  // fail-closed 语义已随 ADR067 从 dashboard 退役（正式存档只服务审计/版本对照）
  {
    var canaryPins = 0;
    var noRelease = harnessWith({
      readMasterGraph: function () { return FIXTURE_MASTER_GRAPH; },
      readSemanticArchitecture: function () { return SA_FIXTURE; },
      vaultPath: vault,
      formalConsumer: { withPinnedRelease: function () { canaryPins++; var error = new Error("missing"); error.code = "NO_CURRENT_RELEASE"; error.status = 404; throw error; } },
    });
    var res9 = await noRelease.call(TOPOLOGY, "/api/dashboard/topology?scope=full");
    assertEq(res9.statusCode, 200, "dashboard without Release → 200 (ADR067 live-read)");
    assertEq(canaryPins, 0, "dashboard without Release → formal branch never entered");
    assertEq(res9.body.success, true, "dashboard without Release → success true");
    assertEq(res9.body.data.dataSource, "worktree", "dashboard without Release → dataSource=worktree");
    assertEq(res9.body.data.freshness, undefined, "dashboard without Release → no freshness key");
    await noRelease.close();
  }

  await h.close();
  // Restore SAS stubs
  sas.getComponentIds = origGetComponentIds;
  sas.validateFreshness = origValidateFreshness;

  // Cleanup
  fs.rmSync(vault, { recursive: true, force: true });

  console.log("dashboard-architecture tests: " + passed + " passed, " + failed + " failed");
  if (!process.env.VITEST) process.exit(failed > 0 ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
