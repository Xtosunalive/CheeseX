const assert = require("assert");
const test = require("node:test");
const kgRoutes = require("../kg-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

// PR-085：经 route-harness（Fastify inject）——路径参数直接写在 url 里（框架解码），res.body 为已解析封套
function invoke(h, key, url) {
  return h.request(key, { url });
}

function registerWith(service, extra = {}) {
  const handlers = createRouteHarness();
  kgRoutes.register(handlers.registerRoute, {
    readSemanticArchitecture: () => null,
    readMasterGraph: () => null,
    documentInventoryService: service,
    ...extra,
  });
  return handlers;
}

function successResult(params) {
  return {
    filters: params,
    summary: { totalResults: 0, totalNodes: 0, totalDocuments: 0, nodesWithDocuments: 0, nodesWithoutDocuments: 0 },
    availableFilters: {}, results: [], limit: params.limit, offset: params.offset, generatedAt: new Date().toISOString(),
  };
}

test("registers search and decodes comma-separated facets", async () => {
  let received = null;
  const handlers = registerWith({ search(params) { received = params; return successResult(params); } });
  const response = await invoke(handlers, "GET /api/kg/search-documents", "/api/kg/search-documents?arch_layer=service,gateway&limit=20&offset=2&includeRelations=false");
  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(received.arch_layer, ["service", "gateway"]);
  assert.strictEqual(received.limit, 20);
  assert.strictEqual(received.offset, 2);
  assert.strictEqual(received.includeRelations, false);
  assert.strictEqual(response.body.success, true);
});

test("rejects invalid query parameters", async () => {
  const handlers = registerWith({ search() { throw new Error("must not execute"); } });
  for (const query of ["arch_component=maybe", "limit=0", "limit=201", "offset=-1", "includeDocuments=x"]) {
    const response = await invoke(handlers, "GET /api/kg/search-documents", `/api/kg/search-documents?${query}`);
    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.body.error_code, "INVALID_QUERY");
  }
});

test("validates nodeId and maps not-found errors", async () => {
  const service = { getNodeDocuments() { const error = new Error("missing"); error.code = "NODE_NOT_FOUND"; throw error; } };
  const handlers = registerWith(service);
  const blank = await invoke(handlers, "GET /api/kg/node-documents", "/api/kg/node-documents");
  assert.strictEqual(blank.statusCode, 400);
  const missing = await invoke(handlers, "GET /api/kg/node-documents", "/api/kg/node-documents?nodeId=missing");
  assert.strictEqual(missing.statusCode, 404);
  assert.strictEqual(missing.body.error_code, "NODE_NOT_FOUND");
});

test("maps unavailable and rebuild-in-progress errors", async () => {
  const unavailable = new Error("not ready"); unavailable.code = "DOCUMENT_INDEX_UNAVAILABLE";
  const busy = new Error("busy"); busy.code = "INDEX_REBUILD_IN_PROGRESS";
  const handlers = registerWith({ search() { throw unavailable; }, rebuild() { throw busy; } });
  const search = await invoke(handlers, "GET /api/kg/search-documents", "/api/kg/search-documents?keyword=x");
  assert.strictEqual(search.statusCode, 503);
  const rebuild = await invoke(handlers, "POST /api/kg/rebuild-index", "/api/kg/rebuild-index");
  assert.strictEqual(rebuild.statusCode, 409);
});

test("returns rebuild evidence", async () => {
  const result = { totalDocuments: 3, invalidDocuments: 1, generatedAt: new Date().toISOString() };
  const handlers = registerWith({ rebuild: async () => result });
  const response = await invoke(handlers, "POST /api/kg/rebuild-index", "/api/kg/rebuild-index");
  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(response.body.data, result);
});

test("registers canonical document search, detail, and rebuild routes", async () => {
  const document = { documentId: "article:ART-001", title: "Article" };
  const service = {
    searchDocuments: (params) => ({ filters: params, summary: { totalResults: 1 }, availableFilters: {}, documents: [document], limit: 50, offset: 0, generatedAt: "now" }),
    getDocument: (documentId) => ({ document: { ...document, documentId }, generatedAt: "now" }),
    rebuild: async () => ({ totalDocuments: 1, invalidDocuments: 0, generatedAt: "now" }),
  };
  const handlers = registerWith(service);
  const search = await invoke(handlers, "GET /api/documents/search", "/api/documents/search?keyword=Article");
  assert.strictEqual(search.statusCode, 200);
  assert.strictEqual(search.body.data.documents[0].documentId, "article:ART-001");
  const detail = await invoke(handlers, "GET /api/documents/:documentId", "/api/documents/article%3AART-001");
  assert.strictEqual(detail.body.data.document.documentId, "article:ART-001");
  const rebuild = await invoke(handlers, "POST /api/documents/index/rebuild", "/api/documents/index/rebuild");
  assert.strictEqual(rebuild.statusCode, 200);
});

test("keeps legacy document routes registered as compatibility adapters", async () => {
  const service = {
    search: () => successResult({ limit: 50, offset: 0 }),
    getNodeDocuments: () => ({ result: { nodeId: "gateway", documents: [] }, generatedAt: "now" }),
  };
  const handlers = registerWith(service);
  assert(handlers.routes.has("GET /api/kg/search-documents"));
  assert(handlers.routes.has("GET /api/kg/node-documents"));
  assert(handlers.routes.has("POST /api/kg/rebuild-index"));
});

test("formal document routes pin once, return Release identity and block rebuild without Vault fallback", async () => {
  let pins = 0;
  let vaultCalls = 0;
  const releaseId = `release-${"c".repeat(64)}`;
  const sourceCommit = "d".repeat(40);
  const formalInventory = {
    searchDocuments: () => ({ documents: [], releaseId, sourceCommit }),
    getDocument: () => ({ document: { documentId: "doc" }, releaseId, sourceCommit }),
    search: () => ({ results: [], releaseId, sourceCommit }),
    getNodeDocuments: () => ({ result: { nodeId: "a", documents: [] }, releaseId, sourceCommit }),
  };
  const handlers = registerWith({
    searchDocuments() { vaultCalls += 1; }, getDocument() { vaultCalls += 1; },
    search() { vaultCalls += 1; }, getNodeDocuments() { vaultCalls += 1; }, rebuild() { vaultCalls += 1; },
  }, { formalConsumer: { withPinnedRelease(callback) { pins += 1; return callback({ documentInventory: formalInventory }); } } });
  for (const [key, url, params] of [
    ["GET /api/documents/search", "/api/documents/search", {}],
    ["GET /api/documents/:documentId", "/api/documents/doc", { documentId: "doc" }],
    ["GET /api/kg/search-documents", "/api/kg/search-documents", {}],
    ["GET /api/kg/node-documents", "/api/kg/node-documents?nodeId=a", {}],
  ]) {
    const res = await invoke(handlers, key, url);
    const data = res.body.data;
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(data.releaseId, releaseId);
    assert.strictEqual(data.sourceCommit, sourceCommit);
    if (key === "GET /api/documents/search") {
      // WP-070 R5（展示类）：正式库空结果 → 200＋availability 指引（契约单源逐字），不当错误
      const { guidanceFor } = require("../../shared/availability-view.cjs");
      assert.deepEqual(data.availability, { empty: true, kinds: ["formal-release-empty"], hints: [guidanceFor("formal-release-empty")] });
    }
  }
  const rebuild = await invoke(handlers, "POST /api/documents/index/rebuild", "/api/documents/index/rebuild");
  assert.strictEqual(rebuild.statusCode, 409);
  assert.strictEqual(rebuild.body.error_code, "RELEASE_INDEX_IMMUTABLE");
  assert.strictEqual(pins, 4);
  assert.strictEqual(vaultCalls, 0);
});

test("formal kg query replaces raw semantic dependencies with policy-filtered Release relations", async () => {
  let pins = 0;
  let vaultCalls = 0;
  const releaseId = `release-${"1".repeat(64)}`;
  const sourceCommit = "2".repeat(40);
  const handlers = registerWith({}, {
    readSemanticArchitecture() { vaultCalls += 1; throw new Error("must not read Vault semantic projection"); },
    readMasterGraph() { vaultCalls += 1; throw new Error("must not read Vault graph"); },
    formalConsumer: {
      withPinnedRelease(callback) {
        pins += 1;
        return callback({
          releaseId, sourceCommit,
          readSemanticArchitecture: () => ({
            product: "Product", version: "1.0.0", components: [], layers: [],
            dependencies: [{ from: "pending", to: "hidden", relationType: "DEPENDS_ON" }],
          }),
          readMasterGraph: (consumer) => {
            assert.strictEqual(consumer, "relation_search");
            return { nodes: [], connections: [{ edgeId: "approved", from: "a", to: "b", relationType: "DEPENDS_ON" }] };
          },
        });
      },
    },
  });
  const response = await invoke(handlers, "GET /api/kg/query", "/api/kg/query?type=all");
  const data = response.body.data;
  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(data.dependencies.map((edge) => edge.edgeId), ["approved"]);
  assert.strictEqual(data.releaseId, releaseId);
  assert.strictEqual(data.sourceCommit, sourceCommit);
  assert.strictEqual(pins, 1);
  assert.strictEqual(vaultCalls, 0);
});

// WP-070 R5（展示类·零发布态）：release-reader NO_CURRENT_RELEASE（404）在路由层接住——走工作树活读分支
// （E3 同构）＋no-formal-release 指引，200 不当错误；非该码的错误照常抛出（不吞别的故障）。
test("zero-release: NO_CURRENT_RELEASE is absorbed into 200 + worktree fallback + no-formal-release guidance; other errors still propagate", async () => {
  const { guidanceFor } = require("../../shared/availability-view.cjs");
  const worktreeInventory = { searchDocuments: () => ({ filters: {}, summary: { totalResults: 0 }, availableFilters: {}, documents: [], limit: 50, offset: 0, generatedAt: "now" }) };
  const noRelease = Object.assign(new Error("No current Release"), { code: "NO_CURRENT_RELEASE", status: 404 });
  const handlers = registerWith(worktreeInventory, { formalConsumer: { withPinnedRelease() { throw noRelease; } } });
  const res = await invoke(handlers, "GET /api/documents/search", "/api/documents/search");
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body).slice(0, 200));
  assert.strictEqual(res.body.data.dataSource, "worktree");
  assert.deepEqual(res.body.data.availability, { empty: true, kinds: ["no-formal-release"], hints: [guidanceFor("no-formal-release")] });

  const boom = Object.assign(new Error("pointer corrupt"), { code: "RELEASE_POINTER_INVALID", status: 500 });
  const handlers2 = registerWith(worktreeInventory, { formalConsumer: { withPinnedRelease() { throw boom; } } });
  const res2 = await invoke(handlers2, "GET /api/documents/search", "/api/documents/search");
  assert.strictEqual(res2.statusCode, 500, "非 NO_CURRENT_RELEASE 的错误不得被吞成空列表");
  assert.strictEqual(res2.body.error_code, "RELEASE_POINTER_INVALID");
});

// WP-070 分类列表展示类三分（2026-11-02 实库探针修正）：投影在场零组件→architecture-entities-empty（去实体准入）；
// 投影缺席 SEMANTIC_PROJECTION_NOT_FOUND→semantic-architecture-empty（去冻结版本）；两者各指各的去处，不再混为一谈。
test("classification/list: zero components → entities-empty guidance; missing projection → semantic-architecture-empty guidance", async () => {
  const { guidanceFor } = require("../../shared/availability-view.cjs");
  const inv = { searchDocuments: () => ({ documents: [] }) };
  const zeroComponents = registerWith(inv, { readSemanticArchitecture: () => ({ components: [] }) });
  const r1 = await invoke(zeroComponents, "GET /api/kg/classification/list", "/api/kg/classification/list");
  assert.strictEqual(r1.statusCode, 200);
  assert.deepEqual(r1.body.data.items, []);
  assert.deepEqual(r1.body.data.availability, { empty: true, kinds: ["architecture-entities-empty"], hints: [guidanceFor("architecture-entities-empty")] });
  assert.match(r1.body.data.availability.hints[0], /实体准入/, "零组件指向实体准入，不得指向冻结版本");

  const missing = Object.assign(new Error("not found"), { code: "SEMANTIC_PROJECTION_NOT_FOUND", status: 404 });
  const noProjection = registerWith(inv, { formalConsumer: { withPinnedRelease(cb) { return cb({ releaseId: `release-${"e".repeat(64)}`, sourceCommit: "f".repeat(40), readSemanticArchitecture() { throw missing; } }); } } });
  const r2 = await invoke(noProjection, "GET /api/kg/classification/list", "/api/kg/classification/list");
  assert.strictEqual(r2.statusCode, 200);
  assert.deepEqual(r2.body.data.availability.kinds, ["semantic-architecture-empty"]);
  assert.match(r2.body.data.availability.hints[0], /冻结版本/);

  const populated = registerWith(inv, { readSemanticArchitecture: () => ({ components: [{ id: "svc", module: "m" }] }) });
  const r3 = await invoke(populated, "GET /api/kg/classification/list", "/api/kg/classification/list");
  assert.strictEqual(r3.body.data.items.length, 1);
  assert.deepEqual(r3.body.data.availability, { empty: false, kinds: [], hints: [] });
});
