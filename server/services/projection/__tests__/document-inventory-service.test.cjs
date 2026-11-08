const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { createDocumentInventoryService } = require("../document-inventory-service.cjs");

function writeEntity(vault, name, content) {
  const dir = path.join(vault, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

function writeDocument(vault, relativePath, content) {
  const file = path.join(vault, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "doc-inventory-"));
  writeEntity(vault, "mysql.md", `---
title: MySQL
architecture-node-id: mysql
arch_component: true
arch_status: approved
status: 有效
arch_category: 存储
arch_layer: data-lake
arch_subdomain: database
module: Content服务
tags: [架构, 存储]
---
# MySQL
支持 BOM 物料清单。
依赖::[[OpenSearch]]
`);
  writeEntity(vault, "client.md", `---
title: AnyShare同步客户端
architecture_node_id: sync-client
arch_component: true
arch_status: approved
status: 有效
arch_category: 终端
arch_layer: application
module: 客户端
tags: 架构
---
文件冲突机制与 MySQL connector。
依赖::[[MySQL]]
[[文件冲突机制]]
`);
  writeEntity(vault, "article.md", `---
title: 排错文章
arch_component: false
status: 有效
tags: [排错]
---
这是 OpenSearch troubleshooting article。
`);
  writeEntity(vault, "bad.md", "---\ntitle: [broken\n---\nbad");
  writeEntity(vault, "literal.md", "---\ntitle: \"['MVP Gateway']\"\narchitecture-node-id: literal\n---\ninvalid");
  return vault;
}

test("reports unavailable when the entity directory is missing", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "doc-empty-"));
  const service = createDocumentInventoryService({ vaultPath: vault });
  await assert.rejects(service.initialize(), (error) => error.code === "DOCUMENT_INDEX_UNAVAILABLE");
  assert.throws(() => service.search({}), (error) => error.code === "DOCUMENT_INDEX_UNAVAILABLE");
});

test("rebuilds to a legal empty snapshot when governed directories exist but are empty (ADR063)", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "doc-empty-legal-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库", "wiki", "sources"), { recursive: true });
  const service = createDocumentInventoryService({ vaultPath: vault });
  const status = await service.initialize();
  assert.strictEqual(status.totalDocuments, 0);
  assert.strictEqual(status.invalidDocuments, 0);
  assert.strictEqual(service.search({}).summary.totalDocuments, 0);
  writeEntity(vault, "back.md", "---\ntitle: Back\narch_component: false\nstatus: 有效\n---\n恢复内容");
  const rebuilt = await service.rebuild();
  assert.strictEqual(rebuilt.totalDocuments, 1);
});

test("builds a validated snapshot and keeps invalid documents out", async (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const service = createDocumentInventoryService({ vaultPath: vault });
  const status = await service.initialize();
  assert.strictEqual(status.totalDocuments, 3);
  assert.strictEqual(status.invalidDocuments, 2);
  const overview = service.search({});
  assert.strictEqual(overview.results.length, 0);
  assert.strictEqual(overview.summary.totalDocuments, 3);
  assert(overview.availableFilters.tags.some((item) => item.value === "架构" && item.count === 2));
});

test("searches title, frontmatter, body and wikilink targets", async (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const service = createDocumentInventoryService({ vaultPath: vault });
  await service.initialize();
  assert.strictEqual(service.search({ keyword: "BOM" }).summary.totalResults, 1);
  assert.strictEqual(service.search({ keyword: "文件冲突" }).results[0].nodeId, "sync-client");
  assert.strictEqual(service.search({ keyword: "troubleshooting" }).summary.totalResults, 1);
  assert.strictEqual(service.search({ keyword: "OpenSearch" }).summary.totalResults, 2);
});

test("applies OR within facets, AND across facets, and self-excluding counts", async (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const service = createDocumentInventoryService({ vaultPath: vault });
  await service.initialize();
  const result = service.search({
    arch_category: ["存储", "终端"],
    arch_layer: ["application"],
  });
  assert.deepStrictEqual(result.results.map((item) => item.nodeId), ["sync-client"]);
  const categories = Object.fromEntries(result.availableFilters.arch_category.map((item) => [item.value, item.count]));
  assert.strictEqual(categories["终端"], 1);
  assert.strictEqual(categories["存储"], undefined);
});

test("supports relation queries, incoming relations and pagination", async (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const service = createDocumentInventoryService({ vaultPath: vault });
  await service.initialize();
  const reverse = service.search({ wikilinkTarget: "MySQL", relationType: ["依赖"] });
  assert.strictEqual(reverse.results[0].nodeId, "sync-client");
  const mysql = service.getNodeDocuments("mysql");
  assert.strictEqual(mysql.result.relatedByNodes[0].target, "sync-client");
  const paged = service.search({ status: "有效", limit: 1, offset: 1 });
  assert.strictEqual(paged.results.length, 1);
  assert.strictEqual(paged.summary.totalResults, 3);
  assert.throws(() => service.search({ limit: 201 }), (error) => error.code === "INVALID_QUERY");
});

test("preserves the previous snapshot when rebuild fails", async (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const service = createDocumentInventoryService({ vaultPath: vault });
  await service.initialize();
  fs.renameSync(path.join(vault, "知识库", "wiki", "entities"), path.join(vault, "entities-away"));
  await assert.rejects(service.rebuild(), (error) => error.code === "DOCUMENT_INDEX_UNAVAILABLE");
  assert.strictEqual(service.search({ keyword: "BOM" }).summary.totalResults, 1);
});

test("mutable inventory ignores workflow pointers and formal article snapshots", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "doc-canonical-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  writeDocument(vault, "知识库/wiki/entities/gateway.md", "---\ntitle: Gateway\narchitecture-node-id: gateway\nmodule: 网关\n---\nEntity");
  const approvedRaw = "---\ntitle: Gateway Guide\narticle_id: ART-001\nproduct: AnyShare\nversion: 7.0.6.8\nmodule: 网关\narticle_type: 最佳实践\ndoc-type: 用户手册\n---\nArticle";
  writeDocument(vault, "知识库/raw/precleaned/article.md", approvedRaw);
  writeDocument(vault, "知识库/wiki/articles/ART-001/hash.md", approvedRaw);
  writeDocument(vault, ".ledger/article-upload-tasks.json", JSON.stringify({
    articles: [{
      articleId: "ART-001",
      currentApprovedVersion: { snapshotPath: "知识库/wiki/articles/ART-001/hash.md" },
      currentStandardVersion: { snapshotPath: "知识库/wiki/articles/ART-001/hash.md" },
    }],
  }));
  writeDocument(vault, "知识库/wiki/sources/source.md", "---\ntitle: Source\n---\nSource");
  writeDocument(vault, "知识库/wiki/overview/overview.md", "# Overview");
  writeDocument(vault, "知识库/wiki/queries/query.md", "# Query");
  writeDocument(vault, "知识库/wiki/comparisons/compare.md", "# Compare");
  writeDocument(vault, "知识库/wiki/todo/todo.md", "# Todo");

  const service = createDocumentInventoryService({
    vaultPath: vault,
    getGraph: () => ({
      nodes: [{ id: "gateway", properties: {} }, { id: "doc-art-001", properties: { article_id: "ART-001" } }],
      connections: [{ from: "doc-art-001", to: "gateway", relationType: "DOCUMENTS" }],
    }),
  });
  const status = await service.initialize();
  assert.strictEqual(status.totalDocuments, 6);
  const result = service.searchDocuments({ keyword: "Gateway", limit: 20, offset: 0 });
  assert.strictEqual(result.summary.totalResults, 1);
  assert.deepStrictEqual(result.documents.map((document) => document.documentId), ["entity:gateway"]);
  assert.throws(() => service.getDocument("article:ART-001"), (error) => error.code === "DOCUMENT_NOT_FOUND");
  assert.strictEqual(service.getDocument("path:知识库/wiki/overview/overview.md").document.graphStatus, "pending-extraction");
  assert.strictEqual(service.getDocumentsByGraphNodeIds(["gateway"]).length, 1);
});

test("immutable Release snapshot is the only formal article inventory", () => {
  const service = createDocumentInventoryService({
    releaseSnapshot: {
      generatedAt: "2026-08-11T00:00:00.000Z",
      invalid: [],
      documents: [{
        documentId: "article:ART-REL",
        documentKind: "standard-article",
        articleId: "ART-REL",
        title: "Release Guide",
        sourcePath: "知识库/wiki/articles/ART-REL/hash.md",
        sourceHash: "sha256:release",
        body: "Immutable searchable article",
        searchText: "release guide immutable searchable article",
        tokens: ["release", "guide", "immutable", "searchable", "article"],
        graphNodeIds: [], relations: [], graphStatus: "pending-extraction", tags: [],
      }],
    },
  });
  const result = service.searchDocuments({ keyword: "immutable", limit: 20, offset: 0 });
  assert.strictEqual(result.summary.totalResults, 1);
  assert.strictEqual(result.documents[0].articleId, "ART-REL");
  assert.throws(() => service.rebuildSync(), (error) => error.code === "RELEASE_INDEX_IMMUTABLE");
});

test("filters every value of an array-valued Entity module", () => {
  const service = createDocumentInventoryService({
    releaseSnapshot: {
      generatedAt: "2026-08-12T00:00:00.000Z",
      invalid: [],
      documents: [{
        documentId: "entity:multi-module",
        documentKind: "entity",
        articleId: "",
        title: "Multi Module",
        sourcePath: "知识库/wiki/entities/multi-module.md",
        sourceHash: "sha256:entity",
        searchText: "multi module",
        graphNodeIds: [],
        relations: [],
        graphStatus: "pending-extraction",
        module: ["Alpha", "Beta"],
        tags: [],
      }],
    },
  });
  const result = service.searchDocuments({ module: "Beta", limit: 20, offset: 0 });
  assert.deepStrictEqual(result.documents.map((document) => document.documentId), ["entity:multi-module"]);
  assert.deepStrictEqual(result.availableFilters.module.map((item) => item.value), ["Alpha", "Beta"]);
});

test("rejects duplicate stable document identities without replacing the previous snapshot", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "doc-duplicate-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  writeDocument(vault, "知识库/wiki/entities/a.md", "---\ntitle: A\narchitecture-node-id: duplicate\n---\nA");
  const service = createDocumentInventoryService({ vaultPath: vault });
  await service.initialize();
  writeDocument(vault, "知识库/wiki/entities/b.md", "---\ntitle: B\narchitecture-node-id: duplicate\n---\nB");
  await assert.rejects(service.rebuild(), (error) => error.code === "DUPLICATE_DOCUMENT_ID");
  assert.strictEqual(service.searchDocuments({ keyword: "A" }).summary.totalResults, 1);
});

// 2026-11-01 Master「直接默认全部正式文档」：无筛选词默认列出全部正式文档（分页照旧）——
// 原「无筛选=空页」检索面语义让已发布文档不可见（用户实测：发布后清单页仍只见半成品区）。
test("searchDocuments lists all formal documents by default without filters", async (t) => {
  const { createDocumentInventoryService } = require("../document-inventory-service.cjs");
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-default-list-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  writeDocument(vault, "知识库/wiki/entities/alpha.md", "---\ntitle: Alpha\narchitecture-node-id: alpha\nmodule: m1\n---\nAlpha body");
  writeDocument(vault, "知识库/wiki/entities/beta.md", "---\ntitle: Beta\narchitecture-node-id: beta\nmodule: m1\n---\nBeta body");
  const service = createDocumentInventoryService({ vaultPath: vault });
  await service.initialize();
  const noFilter = service.searchDocuments({ limit: 50, offset: 0 });
  assert.strictEqual(noFilter.summary.totalResults, 2);
  assert.deepStrictEqual(noFilter.documents.map((document) => document.title).sort(), ["Alpha", "Beta"], "无筛选=默认全列");
  const paged = service.searchDocuments({ limit: 1, offset: 0 });
  assert.strictEqual(paged.documents.length, 1, "分页语义照旧");
  const filtered = service.searchDocuments({ keyword: "Beta" });
  assert.deepStrictEqual(filtered.documents.map((document) => document.title), ["Beta"], "关键词过滤语义不变");
});
