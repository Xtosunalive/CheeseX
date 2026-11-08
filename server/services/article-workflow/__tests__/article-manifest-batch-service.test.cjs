// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createArticleManifestBatchService } = require("../article-manifest-batch-service.cjs");
const { createArticleManifestService } = require("../article-manifest-service.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs"); // SPEC-012 wave-2：manifest 行级投影

test("writes manifests for every eligible article source across pages", () => {
  const writes = [];
  const removals = [];
  const articleManifestService = {
    queryArticleSources({ offset }) {
      if (offset === 0) return { items: [
        { sourcePath: "知识库/wiki/entities/MySQL.md" },
        { sourcePath: "知识库/TheSchema/README.md" },
      ] };
      if (offset === 2) return { items: [
        { sourcePath: "知识库/raw/precleaned/强制入主.md" },
      ] };
      return { items: [] };
    },
    isSourceExcluded(sourcePath) {
      return { excluded: sourcePath.includes("TheSchema") || sourcePath.includes("raw/precleaned"), reason: "not formal" };
    },
    removeArticleManifest(sourcePath) { removals.push(sourcePath); return { removed: sourcePath.includes("raw/precleaned") }; },
    writeArticleManifest(sourcePath) {
      writes.push(sourcePath);
      return { written: true };
    },
  };

  const batch = createArticleManifestBatchService({ articleManifestService, pageSize: 2 });
  const result = batch.rebuild();

  assert.deepEqual(writes, ["知识库/wiki/entities/MySQL.md"]);
  assert.deepEqual(removals, ["知识库/TheSchema/README.md", "知识库/raw/precleaned/强制入主.md"]);
  assert.deepEqual(result, { totalSources: 3, written: 1, excluded: 2, removed: 1, orphanRemoved: 0, failed: 0, failures: [] });
});

test("continues after one manifest write fails and returns evidence", () => {
  const articleManifestService = {
    queryArticleSources() {
      return { items: [{ sourcePath: "a.md" }, { sourcePath: "b.md" }] };
    },
    isSourceExcluded() { return { excluded: false }; },
    writeArticleManifest(sourcePath) {
      if (sourcePath === "a.md") throw new Error("bad source");
      return { written: true };
    },
  };

  const result = createArticleManifestBatchService({ articleManifestService }).rebuild();

  assert.equal(result.written, 1);
  assert.equal(result.removed, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failures, [{ sourcePath: "a.md", error: "bad source" }]);
});

test("excludes candidate sources and removes their legacy derived manifests", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-manifest-trust-"));
  const service = createArticleManifestService({ vaultPath, readMasterGraph: () => ({ nodes: [], connections: [] }) });
  const sourcePath = "知识库/raw/precleaned/候选.md";
  // SPEC-012 wave-2：manifest 真身迁 derived-index.db 行级——种行代替种文件
  const store = getDerivedIndexStore(vaultPath);
  store.articleManifests.put("raw/precleaned/候选.md", { manifestKey: "raw/precleaned/候选.md" });

  assert.equal(service.isSourceExcluded(sourcePath).excluded, true);
  assert.throws(() => service.writeArticleManifest(sourcePath), (error) => error.code === "ARTICLE_MANIFEST_SOURCE_EXCLUDED");
  assert.equal(service.removeArticleManifest(sourcePath).removed, true);
  assert.equal(store.articleManifests.get("raw/precleaned/候选.md"), undefined);
  fs.rmSync(vaultPath, { recursive: true, force: true });
});

test("maps approved article relations from lineage coordinates and keeps article identity", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-manifest-lineage-"));
  const articlePath = "知识库/wiki/articles/ART-1/hash.md";
  const entityPath = "知识库/wiki/entities/component.md";
  const graph = {
    nodes: [
      { id: "doc-article-ART-1", label: "文章一", labels: ["Document"], properties: { source_path: articlePath } },
      { id: "component", label: "组件", labels: ["Component"], properties: { file_path: entityPath } },
    ],
    connections: [{
      from: "doc-article-ART-1", to: "component", relationType: "DOCUMENTS", reviewStatus: "approved",
      properties: {
        reviewStatus: "approved", ruleId: "extract_graph.document-mount", ruleRevision: "sha256:rule",
        inputCoordinates: [`vault:${articlePath}#node:doc-article-ART-1`, `vault:${entityPath}#node:component`],
      },
    }],
  };
  const service = createArticleManifestService({ vaultPath, readMasterGraph: () => graph });

  const sources = service.queryArticleSources({ limit: 20, offset: 0 });
  const article = sources.items.find((item) => item.sourcePath === articlePath);
  assert.equal(article.kind, "standard_article");
  assert.equal(article.directRelationCount, 1);

  const manifest = service.generateArticleManifest(articlePath, {});
  assert.equal(manifest.article.articleKind, "standard_article");
  assert.equal(manifest.manifestMode, "relational");
  assert.equal(manifest.extraction.directRelationCount, 1);
  assert.deepEqual(manifest.extraction.relationKeys, ["doc-article-ART-1→component:DOCUMENTS"]);
  fs.rmSync(vaultPath, { recursive: true, force: true });
});
