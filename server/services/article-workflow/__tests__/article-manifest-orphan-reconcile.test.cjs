// B1/B2（#1795）红灯证据工具：manifest 孤儿对账 + Release 打包交叉验证。
// 缺陷机理（ADR063「重建即对账」向 manifest 域的缺失迁移，方案文档 0.2 分诊）：
//   B1：rebuild() 只遍历活源——源已删除的 manifest 永不在对账范围内，孤儿永久滞留并被打包进发布；
//   B2：collectCompleteArtifacts 把 manifest 全量原样打包（连索引），孤儿/漂移 manifest 冻进正式
//      Release → formal 消费端从冻结账本里读到幽灵条目。
// 修后语义：rebuild 对账孤儿（源不存在即清除，行集反解 key）；打包交叉验证 manifest↔快照源
//   fail-closed（RELEASE_MANIFEST_ORPHAN）。
// SPEC-012 wave-2：manifest 真身迁 derived-index.db 行级——种/断言改 store 行，不再扫盘。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createArticleManifestBatchService } = require("../article-manifest-batch-service.cjs");
const { createArticleManifestService } = require("../article-manifest-service.cjs");
const { assertNoOrphanManifests } = require("../../release-governance/complete-release-artifact-service.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");

test("B1 TC1 listManifestSources 反解：manifest key → 源路径（知识库/ 前缀还原）", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "b1-list-"));
  getDerivedIndexStore(vaultPath).articleManifests.put("wiki/entities/ECMS集群.md", { manifestKey: "wiki/entities/ECMS集群.md" });
  const service = createArticleManifestService({ vaultPath, readMasterGraph: () => ({ documents: [] }) });
  const sources = service.listManifestSources();
  assert.deepEqual(sources, [{ sourcePath: "知识库/wiki/entities/ECMS集群.md" }]);
  assert.equal(service.sourceExists("知识库/wiki/entities/ECMS集群.md"), false, "源不存在应判定 false（孤儿）");
  fs.rmSync(vaultPath, { recursive: true, force: true });
});

test("B1 TC2 rebuild 孤儿对账：源已删除的 manifest 被清除，活源不受影响", () => {
  const writes = [];
  const removals = [];
  const articleManifestService = {
    queryArticleSources() { return { items: [{ sourcePath: "知识库/wiki/entities/Live.md" }] }; },
    isSourceExcluded() { return { excluded: false }; },
    writeArticleManifest(sourcePath) { writes.push(sourcePath); return { written: true }; },
    removeArticleManifest(sourcePath) { removals.push(sourcePath); return { removed: sourcePath.includes("Gone") }; },
    listManifestSources() { return [{ sourcePath: "知识库/wiki/entities/Gone.md" }, { sourcePath: "知识库/wiki/entities/Live.md" }]; },
    sourceExists(sourcePath) { return sourcePath.includes("Live"); },
  };
  const batch = createArticleManifestBatchService({ articleManifestService });
  const result = batch.rebuild();
  assert.ok(removals.includes("知识库/wiki/entities/Gone.md"), "孤儿 manifest（源已删）必须被对账清除");
  assert.deepEqual(writes, ["知识库/wiki/entities/Live.md"]);
  assert.equal(result.orphanRemoved, 1, "结果应报告孤儿清除计数");
  assert.equal(result.failed, 0);
});

test("B2 TC3 打包交叉验证：孤儿 manifest（源不在快照）fail-closed 拒绝打包", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b2-orphan-"));
  const store = getDerivedIndexStore(root);
  store.articleManifests.put("wiki/entities/Gone.md", { manifestKey: "wiki/entities/Gone.md", sourcePathCanonical: "知识库/wiki/entities/Gone.md" });
  // 孤儿：manifest 行在场但其源文件不在发布快照 root → 必须 throw
  assert.throws(
    () => assertNoOrphanManifests(root, store.articleManifests.list()),
    (error) => error.code === "RELEASE_MANIFEST_ORPHAN" && Array.isArray(error.details?.orphanManifests) && error.details.orphanManifests.length === 1,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("B2 TC4 打包交叉验证正例：源随快照在场的 manifest 正常通过", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b2-ok-"));
  fs.mkdirSync(path.join(root, "知识库", "wiki", "entities"), { recursive: true });
  fs.writeFileSync(path.join(root, "知识库", "wiki", "entities", "Live.md"), "# live\n");
  const store = getDerivedIndexStore(root);
  store.articleManifests.put("wiki/entities/Live.md", { manifestKey: "wiki/entities/Live.md", sourcePathCanonical: "知识库/wiki/entities/Live.md" });
  assert.doesNotThrow(() => assertNoOrphanManifests(root, store.articleManifests.list()));
  fs.rmSync(root, { recursive: true, force: true });
});
