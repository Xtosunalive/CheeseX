const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSnapshotStore } = require("../release-governance/snapshot-store-service.cjs");
const { createReleaseBuilderService } = require("../release-governance/release-builder-service.cjs");

test("单文件发布生成可读、可编辑的正式文章", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-test-"));
  const ss = createSnapshotStore({ vaultPath: tmp, builderService: null, logger: {} });
  const raw = "# 测试\\n正文";
  const contentHash = require("node:crypto").createHash("sha256").update(raw).digest("hex"); // B2/D2：哈希必须与内容一致
  const snap = ss.snapshotSingleFile({
    articleId: "test-a", contentHash, raw,
    sourcePath: "知识库/raw/precleaned/test-a.md",
    document: { articleId: "test-a", title: "测试", product: "AnyShare", version: "1.0", categoryPath: "ops:maintain:test-a" }, // SPEC-030 派②域段
  });
  assert.ok(snap.snapshotPath.includes("知识库/wiki/articles/ops/测试-1.0.md"));
  const real = path.join(tmp, snap.snapshotPath);
  assert.ok(fs.existsSync(real), "快照文件应存在");
  assert.equal(fs.statSync(real).mode & 0o200, 0o200, "正式文章应可编辑");
  fs.chmodSync(tmp, 0o755); 
  const clean = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(a, 0o755); clean(a); } else fs.chmodSync(a, 0o644); } }; 
  clean(tmp); 
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("整 Release 打包复用 release-builder（sourceCommit 40 位内容寻址）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-test-"));
  const releasesDir = path.join(tmp, "releases");
  fs.mkdirSync(releasesDir, { recursive: true });
  const builder = createReleaseBuilderService({ releasesDir, logger: { info(){}, error(){} } });
  const ss = createSnapshotStore({ vaultPath: tmp, builderService: builder, logger: {} });
  const release = ss.buildRelease({
    sourceCommit: "39ace82a91c167e26461e5b307e651b270a04545",
    artifacts: { "doc.md": Buffer.from("# 内容") },
  });
  assert.match(release.releaseId, /^release-[0-9a-f]{64}$/);
  assert.ok(release.manifestHash.startsWith("sha256:"));
  fs.chmodSync(tmp, 0o755); 
  const clean = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(a, 0o755); clean(a); } else fs.chmodSync(a, 0o644); } }; 
  clean(tmp); 
  fs.rmSync(tmp, { recursive: true, force: true });
});

// WP-069 S3 一表一主收编：writeCurrent/readCurrentReleaseId 自 snapshot-store 退役——
// 指针读写归 release-publisher 唯一所有；容错语义（损坏 current.json → null）由
// current-restore.test.cjs「restores even when current.json is corrupt」承接，此处不再双测。

test("快照输入不完整 fail-closed（缺 contentHash）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-test-"));
  const ss = createSnapshotStore({ vaultPath: tmp, builderService: null, logger: {} });
  assert.throws(() => ss.snapshotSingleFile({ articleId: "a", raw: "# x" }), { code: "SNAPSHOT_INPUT_INVALID" });
  fs.chmodSync(tmp, 0o755); 
  const clean = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(a, 0o755); clean(a); } else fs.chmodSync(a, 0o644); } }; 
  clean(tmp); 
  fs.rmSync(tmp, { recursive: true, force: true });
});

// S5 红灯→绿灯：同一 articleId 写入新哈希快照时必须取代旧快照（单快照不变式）。
// 根因（浏览器实测 #1050 场景⑧）：wiki/articles/{id}/ 残留多个 contentHash 快照 →
// scanFormalReleaseSources 按 article_id 判重 → collectCompleteArtifacts 抛 DUPLICATE_DOCUMENT_ID。
test("S5 绿灯：snapshotSingleFile 写新哈希时取代同 articleId 旧快照（单快照不变式）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-supersede-"));
  const ss = createSnapshotStore({ vaultPath: tmp, builderService: null, logger: {} });
  const rawA = "---\narticle_id: sup-a\ntitle: A\n---\n# A\n正文 A\n";
  const rawB = "---\narticle_id: sup-a\ntitle: A\n---\n# A\n正文 B（源已更新）\n";
  const hashA = require("node:crypto").createHash("sha256").update(rawA).digest("hex");
  const hashB = require("node:crypto").createHash("sha256").update(rawB).digest("hex");
  const document = { articleId: "sup-a", title: "A", product: "", version: "", categoryPath: "ops:maintain:sup-a" }; // SPEC-030 派②域段
  const snapA = ss.snapshotSingleFile({ articleId: "sup-a", contentHash: hashA, raw: rawA, sourcePath: "知识库/raw/precleaned/sup-a.md", document });
  const snapB = ss.snapshotSingleFile({ articleId: "sup-a", contentHash: hashB, raw: rawB, sourcePath: "知识库/raw/precleaned/sup-a.md", document });
  assert.equal(snapB.snapshotPath, "知识库/wiki/articles/ops/A.md");
  const snapshotDir = path.join(tmp, "知识库", "wiki", "articles", "ops");
  const files = fs.readdirSync(snapshotDir).filter((name) => name.endsWith(".md"));
  assert.deepEqual(files, ["A.md"], "同 articleId 应只保留当前可编辑文件");
  assert.equal(snapA.snapshotPath, snapB.snapshotPath);
  fs.chmodSync(tmp, 0o755);
  const clean = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) { fs.chmodSync(a, 0o755); clean(a); } else fs.chmodSync(a, 0o644); } };
  clean(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});
