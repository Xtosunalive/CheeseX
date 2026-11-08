const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const YAML = require("yaml");
const { createArticleAssociationService, applyAction } = require("../article-association-service.cjs");
const { createChangeDispositionService } = require("../../governance/change-disposition-service.cjs");
const { detectRuleConflicts } = require("../../inference/inference-rule-conflicts.cjs");
const { createInferenceDecisionConsumer } = require("../../inference/inference-decision-consumer.cjs");
const { parseEntityDocument, patchFrontmatter } = require("../../../shared/yaml-frontmatter.cjs");
const { initVaultIO, resetVaultIO, writeVault, ABSENT_REVISION } = require("../../../shared/vault-io.cjs"); // WP-075 生产领土态回归钉用

function makeArticleFm(fields, extraLines) {
  var lines = ["---"];
  Object.keys(fields).forEach(function (k) { lines.push(k + ": " + fields[k]); });
  if (extraLines) lines.push(extraLines);
  lines.push("---");
  lines.push("");
  lines.push("# " + (fields.title || "Article"));
  return lines.join("\n") + "\n";
}

function artDoc(articleId, title, sourcePath, sourceHash, product, version, graphNodeIds, associations) {
  return { articleId: articleId, title: title, ownerSourcePath: sourcePath, sourceHash: sourceHash, product: product, version: version, componentIds: graphNodeIds || [], associations: associations || [] };
}
function formalArticleFromFile(vaultPath, name, graphNodeIds) {
  const sourcePath = "知识库/raw/precleaned/" + name;
  const absolute = path.join(vaultPath, ...sourcePath.split("/"));
  const raw = fs.readFileSync(absolute, "utf8");
  const doc = parseEntityDocument(raw, absolute);
  return artDoc(
    doc.frontmatter.article_id,
    doc.frontmatter.title,
    sourcePath,
    `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`,
    String(doc.frontmatter.product),
    String(doc.frontmatter.version),
    graphNodeIds,
    doc.frontmatter.architecture_associations,
  );
}
function writeActiveArticle(vaultPath, name) {
  const dir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), makeArticleFm({ article_id: "ART-1", title: "Guide", product: "AnyShare", version: "7.0", module: "fixture", "doc-type": "用户手册", article_type: "最佳实践", "category-path": "ops.maintain" }), "utf8");
}

test("requires the pinned formal article catalog at composition time", function () {
  assert.throws(
    function () { return createArticleAssociationService({ vaultPath: "/tmp/vault" }); },
    /requires injected listFormalArticles port/,
  );
});

test("maps a formal Release snapshot back to the active candidate source for association writeback", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-association-release-")); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); });
  writeActiveArticle(vaultPath, "guide.md");
  var contentHash = "a".repeat(64);
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () {
      return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:" + contentHash, "AnyShare", "7.0", ["gateway"])] };
    },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: function () { return { products: {} }; },
  });

  var listed = service.list();
  assert.equal(listed.articles.length, 1);
  assert.equal(listed.articles[0].sourcePath, "知识库/raw/precleaned/guide.md");
  var preview = service.preview({ articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: [] });
  assert.equal(preview.article.sourcePath, "知识库/raw/precleaned/guide.md");
});

test("add, remove, and replace produce explicit association sets", function () {
  assert.deepStrictEqual(applyAction(["a"], ["b"], "add"), ["a", "b"]);
  assert.deepStrictEqual(applyAction(["a", "b"], ["a"], "remove"), ["b"]);
  assert.deepStrictEqual(applyAction(["a", "b"], ["c"], "replace"), ["c"]);
});

test("keeps decisions by article id across rename and marks changed content stale", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-association-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "a.md");
  var articleName = "a.md";
  var article = formalArticleFromFile(vaultPath, articleName, ["gateway"]);
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [article] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: function () { return { products: { AnyShare: { versions: [{ id: "7.0", label: "AnyShare 7.0", status: "draft" }] } } }; },
    now: function () { return new Date("2026-07-18T00:00:00.000Z"); },
  });
  assert.deepStrictEqual(service.list().versionOptions, [{ id: "version-anyshare-7-0", label: "AnyShare 7.0", product: "AnyShare", version: "7.0", status: "draft" }]);
  var request = { articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: [] };
  var saved = service.save(service.preview(request).fileRevision, request);
  fs.renameSync(path.join(vaultPath, "知识库/raw/precleaned/a.md"), path.join(vaultPath, "知识库/raw/precleaned/renamed.md"));
  articleName = "renamed.md";
  article = formalArticleFromFile(vaultPath, articleName, ["gateway"]);
  assert.strictEqual(service.list().decisions[0].stale, false);
  article = { ...article, sourceHash: "sha256:changed" };
  assert.strictEqual(service.list().decisions[0].stale, true);
  assert.strictEqual(saved.decisions[0].articleId, "ART-1");
});

test("recovers a legacy decision identity from the approved candidate source path", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-association-identity-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "article_associations.yaml"), YAML.stringify({ schema_version: 1, decisions: [{
    decisionId: "legacy-decision", articleId: "mysql", action: "add", componentIds: ["ops"], versionIds: [],
    candidateSourcePath: "知识库/raw/precleaned/guide.md", candidateSourceHash: "sha256:old", decidedAt: "2026-07-17T00:00:00.000Z",
  }] }));
  writeActiveArticle(vaultPath, "guide.md");
  var article = formalArticleFromFile(vaultPath, "guide.md", ["gateway"]);
  var service = createArticleAssociationService({ vaultPath: vaultPath, listFormalArticles: function () { return { articles: [article] }; }, getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; }, getRegistry: function () { return { products: {} }; } });

  var stale = service.list().decisions[0];
  assert.equal(stale.articleId, "ART-1");
  assert.equal(stale.stale, true);
  assert.equal(stale.lineage.source.coordinate, "article:ART-1");

  var legacyRequest = { articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: [] };
  service.save(service.preview(legacyRequest).fileRevision, legacyRequest);
  var stored = YAML.parse(fs.readFileSync(path.join(schemaDir, "article_associations.yaml"), "utf8"));
  assert.deepEqual(stored.decisions.map(function (item) { return item.articleId; }), ["ART-1", "ART-1"], "legacy audit is retained and canonicalized before append");
});

test("evaluates the shared reasoning gate before writing an association decision", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-association-gate-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "a.md");
  var shared = createChangeDispositionService({ conflictDetector: detectRuleConflicts, decisionConsumer: createInferenceDecisionConsumer() });
  var evaluatedInput = null;
  var assertedStatus = null;
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "a.md", ["gateway"])] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: function () { return { products: { AnyShare: { versions: [{ id: "7.0", label: "AnyShare 7.0", status: "draft" }] } } }; },
    changeDispositionService: {
      evaluate: function (input) { evaluatedInput = input; return shared.evaluate(input); },
      assertWriteAllowed: function (result) { assertedStatus = result.status; return shared.assertWriteAllowed(result); },
    },
  });
  var gateRequest = { articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: ["version-anyshare-7-0"] };
  var result = service.save(service.preview(gateRequest).fileRevision, gateRequest);
  assert.equal(evaluatedInput.affectedVersions[0].version, "7.0");
  assert.equal(assertedStatus, "change_required");
  assert.equal(result.decisions[0].articleId, "ART-1");
});

// ── Phase 4 Slice 1: Current state from article frontmatter ───────────

var FM = {
  guide: makeArticleFm({ article_id: "ART-1", title: "Guide", product: "AnyShare", version: "7.0", module: "fixture", "doc-type": "用户手册", article_type: "最佳实践", "category-path": "ops.maintain" }),
};

test("current associations from article frontmatter architecture_associations", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-fm-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  var extra = "architecture_associations:\n  - association_id: assoc-1\n    product: AnyShare\n    component_id: gateway\n    version_since: 7.0.0.0\n    version_until: 8.0.0.0\n    decision_id: dec-1";
  fs.writeFileSync(path.join(precleanedDir, "guide.md"), makeArticleFm({ article_id: "ART-1", title: "Guide", product: "AnyShare", version: "7.0", module: "fixture", "doc-type": "用户手册", article_type: "最佳实践", "category-path": "ops.maintain" }, extra), "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:one", "AnyShare", "7.0", ["gateway"], [{ association_id: "assoc-1", product: "AnyShare", component_id: "gateway", version_since: "7.0.0.0", version_until: "8.0.0.0", decision_id: "dec-1" }])] }; },
    getGraph: function () { return { nodes: [] }; }, getRegistry: function () { return { products: {} }; },
  });
  var result = service.list();
  assert.ok(result.currentAssociations, "currentAssociations from frontmatter");
  assert.equal(result.currentAssociations.length, 1, "one current association");
  assert.equal(result.currentAssociations[0].association_id, "assoc-1");
  assert.equal(result.currentAssociations[0].component_id, "gateway");
});

test("article without architecture_associations has empty current state", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-no-fm-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  fs.writeFileSync(path.join(precleanedDir, "bare.md"), FM.guide, "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Bare", "知识库/raw/precleaned/bare.md", "sha256:one", "AnyShare", "7.0")] }; },
    getGraph: function () { return { nodes: [] }; }, getRegistry: function () { return { products: {} }; },
  });
  var result = service.list();
  assert.deepStrictEqual(result.currentAssociations, [], "no architecture_associations -> empty current");
});

test("pinned catalog associations remain current independently of centralized YAML audit", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-audit-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  fs.writeFileSync(path.join(precleanedDir, "guide.md"), FM.guide, "utf8");
  var schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "article_associations.yaml"), YAML.stringify({ schema_version: 1, decisions: [{
    decisionId: "old", articleId: "ART-1", action: "add", componentIds: ["old-comp"], versionIds: [],
    candidateSourcePath: "知识库/raw/precleaned/guide.md", candidateSourceHash: "sha256:one", decidedAt: "2026-07-01T00:00:00.000Z",
  }] }));
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:one", "AnyShare", "7.0", [], [{ association_id: "a1", product: "AnyShare" }])] }; },
    getGraph: function () { return { nodes: [] }; }, getRegistry: function () { return { products: {} }; },
  });
  var result = service.list();
  assert.equal(result.currentAssociations.length, 1, "current state comes from the pinned formal catalog");
  assert.equal(result.currentAssociations[0].association_id, "a1");
  assert.ok(result.auditRecords, "audit records present separately");
  assert.equal(result.auditRecords.length, 1, "audit record exists");
});

test("missing YAML does not block list() - current from frontmatter", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-no-yaml-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  var extra = "architecture_associations:\n  - association_id: a1\n    product: AnyShare";
  fs.writeFileSync(path.join(precleanedDir, "guide.md"), makeArticleFm({ article_id: "ART-1", title: "Guide", product: "AnyShare", version: "7.0", module: "fixture", "doc-type": "用户手册", article_type: "最佳实践", "category-path": "ops.maintain" }, extra), "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:one", "AnyShare", "7.0", [], [{ association_id: "a1", product: "AnyShare" }])] }; },
    getGraph: function () { return { nodes: [] }; }, getRegistry: function () { return { products: {} }; },
  });
  var result = service.list();
  assert.equal(result.currentAssociations.length, 1);
  assert.deepStrictEqual(result.auditRecords, []);
  assert.equal(result.auditStatus, "missing");
  assert.match(result.auditError, /不存在/);
});

test("list reads audit records from the pinned Release injection instead of mutable root", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-pinned-audit-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  // 幽灵行过滤（2026-10-15 Master 裁「失效数据直接不显示」）后本测试需活源文件——
  // 保持原意图（审计读 pinned release 而非 mutable root），不测幽灵行显示。
  writeActiveArticle(vaultPath, "guide.md");
  fs.writeFileSync(path.join(schemaDir, "article_associations.yaml"), YAML.stringify({ schema_version: 1, decisions: [{
    decisionId: "mutable-root", articleId: "ART-1", action: "add", componentIds: ["wrong"], versionIds: [],
    candidateSourcePath: "知识库/raw/precleaned/guide.md", candidateSourceHash: "sha256:one", decidedAt: "2026-07-01T00:00:00.000Z",
  }] }));
  var releaseAuditRaw = YAML.stringify({ schema_version: 1, decisions: [{
    decisionId: "pinned-release", articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [],
    candidateSourcePath: "知识库/raw/precleaned/guide.md", candidateSourceHash: "sha256:one", decidedAt: "2026-07-02T00:00:00.000Z",
  }] });
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    readAuditRaw: function () { return releaseAuditRaw; },
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:one", "AnyShare", "7.0")] }; },
    getGraph: function () { return { nodes: [] }; }, getRegistry: function () { return { products: {} }; },
  });

  assert.deepStrictEqual(service.list().auditRecords.map(function (item) { return item.decisionId; }), ["pinned-release"]);
});

test("corrupt audit is reported without hiding current frontmatter and cannot be overwritten", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-corrupt-audit-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "guide.md");
  var articlePath = path.join(vaultPath, "知识库/raw/precleaned/guide.md");
  var raw = fs.readFileSync(articlePath, "utf8");
  fs.writeFileSync(articlePath, patchFrontmatter(raw, { architecture_associations: [{ association_id: "assoc-existing", product: "AnyShare", component_id: "gateway", version_since: "", version_until: "", decision_id: "dec-existing" }] }, {}), "utf8");
  var schemaDir = path.join(vaultPath, "知识库", "TheSchema"); fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "article_associations.yaml"), "decisions: [broken", "utf8");
  var service = createArticleAssociationService({ vaultPath: vaultPath, listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "guide.md")] }; }, getGraph: function () { return { nodes: [{ id: "gateway" }] }; }, getRegistry: function () { return { products: {} }; } });
  var listed = service.list();
  assert.equal(listed.auditStatus, "corrupt");
  assert.equal(listed.currentAssociations.length, 1);
  var request = { articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: [] };
  assert.throws(function () { service.save(service.preview(request).fileRevision, request); }, function (error) { return error.code === "ARTICLE_ASSOCIATION_AUDIT_CORRUPT"; });
});

// ── Phase 4 Slice 2: Atomic writeback to frontmatter ──

test("preview shows before/after and returns fileRevision", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-preview-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  fs.writeFileSync(path.join(precleanedDir, "guide.md"), FM.guide, "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:one", "AnyShare", "7.0", ["derived-ghost"])] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; }, getRegistry: function () { return { products: {} }; },
  });
  var p = service.preview({ articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] });
  assert.equal(p.article.articleId, "ART-1");
  assert.ok(p.fileRevision, "preview returns fileRevision");
  assert.ok(p.fileRevision.startsWith("sha256:"), "fileRevision is sha256");
  assert.deepStrictEqual(p.current.componentIds, [], "preview current state ignores derived graphNodeIds");
});

test("preview rejects component ids outside the current source registry", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-component-validation-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "guide.md");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "guide.md")] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: function () { return { products: {} }; },
  });
  assert.throws(function () {
    service.preview({ articleId: "ART-1", action: "replace", componentIds: ["unknown"], versionIds: [] });
  }, function (error) { return error.code === "COMPONENT_NOT_REGISTERED" && error.status === 422; });
});

test("save writes architecture_associations to frontmatter and appends audit", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-save-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  fs.writeFileSync(path.join(precleanedDir, "guide.md"), FM.guide, "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "guide.md")] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; }, getRegistry: function () { return { products: { AnyShare: { versions: [{ id: "7.0", label: "7.0", status: "released" }, { id: "8.0", label: "8.0", status: "draft" }] } } }; },
    now: function () { return new Date("2026-07-27T00:00:00.000Z"); },
  });
  var request = { articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: ["version-anyshare-7-0"] };
  var p = service.preview(request);
  var saved = service.save(p.fileRevision, request);
  // Verify frontmatter written
  var writtenRaw = fs.readFileSync(path.join(precleanedDir, "guide.md"), "utf8");
  var doc = parseEntityDocument(writtenRaw, path.join(precleanedDir, "guide.md"));
  assert.ok(Array.isArray(doc.frontmatter.architecture_associations), "architecture_associations in frontmatter");
  assert.equal(doc.frontmatter.architecture_associations.length, 1);
  assert.equal(doc.frontmatter.architecture_associations[0].component_id, "gateway");
  assert.equal(doc.frontmatter.architecture_associations[0].product, "AnyShare");
  assert.equal(doc.frontmatter.architecture_associations[0].version_since, "7.0");
  assert.equal(doc.frontmatter.architecture_associations[0].version_until, "8.0");
  assert.ok(doc.frontmatter.architecture_associations[0].decision_id);
  var stableAssociationId = doc.frontmatter.architecture_associations[0].association_id;
  // Verify audit appended
  var schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  var auditRaw = fs.readFileSync(path.join(schemaDir, "article_associations.yaml"), "utf8");
  var audit = YAML.parse(auditRaw);
  assert.equal(audit.decisions.length, 1);
  assert.equal(audit.decisions[0].articleId, "ART-1");
  // Verify reload contract
  var reloaded = service.list();
  assert.equal(reloaded.currentAssociations.length, 1);
  assert.equal(reloaded.currentAssociations[0].component_id, "gateway");
  var repeatPreview = service.preview({ ...request, action: "replace" });
  service.save(repeatPreview.fileRevision, { ...request, action: "replace" });
  assert.equal(service.list().currentAssociations[0].association_id, stableAssociationId, "association id remains stable across decisions");
  assert.equal(service.list().auditRecords.length, 2, "audit log appends decisions instead of replacing history");
});

test("save rejects on file revision mismatch", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-revision-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(precleanedDir, { recursive: true });
  fs.writeFileSync(path.join(precleanedDir, "guide.md"), FM.guide, "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "guide.md")] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; }, getRegistry: function () { return { products: {} }; },
  });
  var p = service.preview({ articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] });
  fs.appendFileSync(path.join(precleanedDir, "guide.md"), "外部修改\n", "utf8");
  assert.throws(function () { return service.save(p.fileRevision, { articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] }); }, function (e) { return e.code === "ARTICLE_REVISION_CONFLICT"; });
});

test("articles absent from the pinned Release are excluded from association writes", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-unapproved-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "guide.md");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [] }; },
    getGraph: function () { return { nodes: [] }; }, getRegistry: function () { return { products: {} }; },
  });
  assert.deepStrictEqual(service.list().articles, []);
  assert.throws(function () { service.preview({ articleId: "ART-1", action: "replace", componentIds: [], versionIds: [] }); }, function (error) { return error.code === "ARTICLE_NOT_FOUND"; });
});

test("audit write failure rolls back the frontmatter current state", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-audit-rollback-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "guide.md");
  var articlePath = path.join(vaultPath, "知识库", "raw", "precleaned", "guide.md");
  var before = fs.readFileSync(articlePath, "utf8");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "guide.md")] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; }, getRegistry: function () { return { products: {} }; },
    writeAuditRaw: function () { throw Object.assign(new Error("audit unavailable"), { code: "ARTICLE_ASSOCIATIONS_WRITE_FAILED", status: 500 }); },
  });
  var request = { articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: [] };
  var preview = service.preview(request);
  assert.throws(function () { service.save(preview.fileRevision, request); }, /audit unavailable/);
  assert.equal(fs.readFileSync(articlePath, "utf8"), before, "failed audit commit restores article source bytes");
});

// ── #1797 版本下拉按文章 product 过滤（拍板：具体产品收窄；通用/未注册兜底显示全部）──
function multiProductRegistry() {
  return { products: {
    AnyShare: { versions: [{ id: "7.0", label: "AnyShare 7.0", status: "published" }] },
    AnyBackup: { versions: [{ id: "6.0", label: "AnyBackup 6.0", status: "published" }] },
  } };
}
function scopedService(vaultPath, article) {
  return createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc(article.articleId || "ART-1", "Guide", "知识库/raw/precleaned/guide.md", article.sourceHash || "sha256:" + "a".repeat(64), article.product, article.version || "7.0", ["gateway"])] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: multiProductRegistry,
  });
}

test("#1797 scopedVersionOptions: 具体产品文章只见该产品版本", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-scoped-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var service = scopedService(vaultPath, { product: "AnyShare" });
  var options = service.scopedVersionOptions({ product: "AnyShare", articleId: "ART-1" });
  assert.deepEqual(options.map(function (o) { return o.id; }), ["version-anyshare-7-0"]);
});

test("#1797 scopedVersionOptions: 通用/未注册产品/缺 product 兜底显示全部", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-scoped-generic-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  var service = scopedService(vaultPath, { product: "通用" });
  var all = service.scopedVersionOptions({ product: "通用", articleId: "ART-1" }).map(function (o) { return o.id; }).sort();
  assert.deepEqual(all, ["version-anybackup-6-0", "version-anyshare-7-0"]);
  assert.equal(service.scopedVersionOptions({ product: "NoSuchProd", articleId: "ART-1" }).length, 2, "产品键不在注册表兜底显示全部");
  assert.equal(service.scopedVersionOptions({ articleId: "ART-1" }).length, 2, "缺 product 兜底显示全部");
  assert.equal(service.scopedVersionOptions({ product: "  通用  ", articleId: "ART-1" }).length, 2, "通用含空白修饰仍兜底");
});

test("#1797 边界负例: 具体产品文章尝试关联其他产品版本 → 422 VERSION_NOT_REGISTERED", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-scoped-deny-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "guide.md");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:" + "a".repeat(64), "AnyShare", "7.0", ["gateway"])] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: multiProductRegistry,
  });
  assert.throws(
    function () { service.preview({ articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: ["version-anybackup-6-0"] }); },
    function (error) { return error.code === "VERSION_NOT_REGISTERED" && error.status === 422; },
  );
});

test("#1797 兜底正例: 通用文章可关联任意产品版本（不收窄）", function (t) {
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-scoped-generic-ok-")); t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); }); process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎：夹具免 repo 回落
  writeActiveArticle(vaultPath, "guide.md");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [artDoc("ART-1", "Guide", "知识库/raw/precleaned/guide.md", "sha256:" + "a".repeat(64), "通用", "", ["gateway"])] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: multiProductRegistry,
  });
  var preview = service.preview({ articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: ["version-anybackup-6-0"] });
  assert.equal(preview.article.product, "通用");
  assert.ok(preview.next.versionIds.includes("version-anybackup-6-0"));
});

// ── WP-075/P2-8 生产领土态回归钉：主源住 vault 册外时，账本写不得被 vault 通道目的地执法拒 ──
// 修复前实况（tr_504310b2，2026-11-02）：save 全链 500 ARTICLE_ASSOCIATIONS_WRITE_FAILED——
// 本例把「resolver 落点在仓内」这一生产形态跑通，并反向证明 F1 执法仍在位（本包不是放水让写通过）。
test("主源在 vault 册外（生产形态）：save 账本落 resolver 目录，不被目的地执法拒", function (t) {
  var previousPin = process.env.THESCHEMA_DIR;
  var vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "aa-repo-territory-"));
  var repoSchemaDir = fs.mkdtempSync(path.join(os.tmpdir(), "aa-repo-theschema-"));
  t.after(function () {
    resetVaultIO();
    if (previousPin === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = previousPin;
    fs.rmSync(vaultPath, { recursive: true, force: true });
    fs.rmSync(repoSchemaDir, { recursive: true, force: true });
  });
  process.env.THESCHEMA_DIR = repoSchemaDir; // 三级阶梯的「主源住 vault 外」档（生产＝仓内 data/theschema）
  initVaultIO({ vaultPath: vaultPath });     // 装 vault 根＝生产形态：vault-io 的 F1 目的地执法在位
  writeActiveArticle(vaultPath, "guide.md");
  var service = createArticleAssociationService({
    vaultPath: vaultPath,
    listFormalArticles: function () { return { articles: [formalArticleFromFile(vaultPath, "guide.md", ["gateway"])] }; },
    getGraph: function () { return { nodes: [{ id: "gateway", label: "Gateway" }] }; },
    getRegistry: function () { return { products: {} }; },
    now: function () { return new Date("2026-11-03T00:00:00.000Z"); },
  });
  var request = { articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] };
  var p = service.preview(request);
  var saved = service.save(p.fileRevision, request); // 修复前此即抛 ARTICLE_ASSOCIATIONS_WRITE_FAILED
  assert.equal(fs.existsSync(path.join(repoSchemaDir, "article_associations.yaml")), true, "账本落在 resolver 解析目录（仓内主源）");
  assert.equal(saved.auditRecords.length, 1, "决策入账");
  // 反向证明：同一落点仍不许经 vault 通道写——执法面没被本包削弱，只是选路归位
  assert.throws(
    function () { writeVault(path.join(repoSchemaDir, "article_associations.yaml"), "x\n", { expectedContentHash: ABSENT_REVISION, domain: "workflow", summary: "probe" }); },
    function (error) { return error.code === "VAULT_WRITE_DESTINATION_REJECTED"; },
    "vault 通道写仓内落点必须仍被拒（SPEC-012 F1 未削弱）",
  );
});
