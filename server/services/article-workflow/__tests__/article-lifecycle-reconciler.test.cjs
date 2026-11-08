// PR-065/SPEC-013 L2——生命周期对账器：发布后退场（读时幂等）＋退役动作（预演/事务性/悬空自证）。
// 层级：真实文件系统单元（tmp vault）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createArticleLifecycleReconciler } = require("../article-lifecycle-reconciler.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");

function makeVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-reconcile-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "archive", "投稿"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts", "投稿"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
  return vaultPath;
}

function publish(vaultPath, name, content, sourceFile) {
  const dirName = `article-${name.replace(/\.md$/, "").slice(0, 8)}`;
  const dir = path.join(vaultPath, "知识库", "wiki", "articles", "ops", dirName); // SPEC-030 派②两层（域段）
  fs.mkdirSync(dir, { recursive: true });
  const fm = sourceFile ? `source_file: ${sourceFile}\n` : "";
  fs.writeFileSync(path.join(dir, name), `---\n${fm}title: t\n---\n${content}`);
  return path.join(dir, name);
}

// 项目自有文件集成：实际不可变快照写入口，文件名由真实内容哈希生成。
function publishSnapshot(vaultPath, articleId, raw) {
  const { createStandardVersion } = require("../article-workflow-store.cjs");
  const contentHash = require("node:crypto").createHash("sha256").update(raw).digest("hex");
  return createStandardVersion(vaultPath, { contentHash }, raw,
    { articleId, title: "t", frontmatter: { "category-path": "ops:maintain" } }, new Date().toISOString(),
    { allowedDomains: ["ops"] }).version.snapshotPath;
}

test("WP-093 退役预检：路径越界、符号链接与目录均拒绝且原件不变", () => {
  const vaultPath = makeVault();
  const outside = makeVault();
  const working = path.join(vaultPath, "知识库/raw/precleaned");
  const victim = path.join(outside, "victim.md");
  fs.writeFileSync(victim, "must survive");
  try {
    const r = createArticleLifecycleReconciler({ vaultPath });
    for (const basename of [path.relative(working, victim), victim, "..\\victim.md"]) {
      for (const dryRun of [true, false]) assert.throws(() => r.retireArticle({ basename, dryRun }), (e) => e.code === "VALIDATION_ERROR");
    }
    fs.symlinkSync(victim, path.join(working, "link.md"));
    for (const dryRun of [true, false]) assert.throws(() => r.retireArticle({ basename: "link.md", dryRun }), (e) => e.code === "VALIDATION_ERROR");
    fs.mkdirSync(path.join(working, "folder.md"));
    assert.throws(() => r.retireArticle({ basename: "folder.md" }), (e) => e.code === "VALIDATION_ERROR");
    assert.equal(fs.readFileSync(victim, "utf8"), "must survive");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("WP-093 退役预检：source_file 非归档角色或归档父目录链接不得删除", () => {
  const vaultPath = makeVault();
  const outside = makeVault();
  const working = path.join(vaultPath, "知识库/raw/precleaned");
  try {
    const r = createArticleLifecycleReconciler({ vaultPath });
    fs.writeFileSync(path.join(outside, "victim.md"), "outside");
    fs.symlinkSync(outside, path.join(vaultPath, "知识库/raw/archive/external"));
    for (const anchor of ["../../../escape.md", "知识库/raw/precleaned/other.md", "知识库/raw/archive/external/victim.md"]) {
      const raw = `---\nsource_file: ${anchor}\n---\nworking`;
      fs.writeFileSync(path.join(working, "unsafe.md"), raw);
      for (const dryRun of [true, false]) {
        assert.throws(() => r.retireArticle({ basename: "unsafe.md", dryRun }), (e) => e.code === "VALIDATION_ERROR");
        assert.equal(fs.readFileSync(path.join(working, "unsafe.md"), "utf8"), raw, "预检在任何搬移之前");
      }
    }
    assert.equal(fs.readFileSync(path.join(outside, "victim.md"), "utf8"), "outside");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("WP-093 空态及真实哈希正式件：身份匹配支持内容演进，同源未发布保留、两轮幂等", () => {
  const vaultPath = makeVault();
  const working = path.join(vaultPath, "知识库/raw/precleaned");
  try {
    const r = createArticleLifecycleReconciler({ vaultPath });
    assert.deepEqual(r.reconcileWorkingCopies().retired, [], "空库可用");
    fs.writeFileSync(path.join(working, "guide.md"), "---\narticle_id: guide-1\n---\nworking edition");
    publishSnapshot(vaultPath, "guide-1", "---\narticle_id: guide-1\n---\npublished edition");
    const anchor = "知识库/raw/archive/投稿/source.md";
    fs.writeFileSync(path.join(working, "source.md"), `---\narticle_id: old-id\nsource_file: ${anchor}\n---\nworking`);
    // 生产发布入口可用不同审批 id 命名目录，正式字节仍保留原文 article_id。
    publishSnapshot(vaultPath, "approval-id", `---\narticle_id: old-id\nsource_file: ${anchor}\n---\nformal`);
    fs.writeFileSync(path.join(working, "directory-collision.md"), "---\narticle_id: approval-id\n---\nunpublished");
    fs.writeFileSync(path.join(working, "sibling.md"), `---\narticle_id: sibling-id\nsource_file: ${anchor}\n---\nanother article`);
    const exact = "---\ntitle: identical\n---\nexact content";
    fs.writeFileSync(path.join(working, "exact.md"), exact);
    publishSnapshot(vaultPath, "generated-id", exact);
    fs.writeFileSync(path.join(working, "unpublished.md"), "---\narticle_id: other\n---\nkeep");
    assert.deepEqual(r.reconcileWorkingCopies().retired.sort(), ["exact.md", "guide.md", "source.md"]);
    assert.equal(fs.readFileSync(path.join(working, "unpublished.md"), "utf8"), "---\narticle_id: other\n---\nkeep");
    assert.equal(fs.existsSync(path.join(working, "sibling.md")), true, "同源不等于同篇，不连坐拆分稿");
    assert.equal(fs.existsSync(path.join(working, "directory-collision.md")), true, "审批目录名不得覆盖正式字节的真实身份");
    assert.deepEqual(r.reconcileWorkingCopies().retired, []);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP-093 暂存目录链接到库外时，执行前拒绝且工作件不动", () => {
  const vaultPath = makeVault();
  const outside = makeVault();
  try {
    fs.symlinkSync(outside, path.join(vaultPath, ".ledger", ".retire-staging"));
    const working = path.join(vaultPath, "知识库/raw/precleaned/keep.md");
    fs.writeFileSync(working, "keep");
    assert.throws(() => createArticleLifecycleReconciler({ vaultPath }).retireArticle({ basename: "keep.md" }), (e) => e.code === "VALIDATION_ERROR");
    assert.equal(fs.readFileSync(working, "utf8"), "keep");
    assert.equal(fs.existsSync(path.join(outside, "working.md")), false);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("WP-093 显式退役复用身份匹配：原名工作件与哈希名正式件一起清理", () => {
  const vaultPath = makeVault();
  const working = path.join(vaultPath, "知识库/raw/precleaned", "guide.md");
  try {
    fs.writeFileSync(working, "---\narticle_id: guide-1\n---\nworking");
    const formal = path.join(vaultPath, publishSnapshot(vaultPath, "guide-1", "---\narticle_id: guide-1\n---\nformal"));
    const r = createArticleLifecycleReconciler({ vaultPath });
    assert.deepEqual(r.retireArticle({ basename: "guide.md", dryRun: true }).plan.formalPaths, [formal]);
    r.retireArticle({ basename: "guide.md" });
    assert.equal(fs.existsSync(working), false);
    assert.equal(fs.existsSync(formal), false);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP3 读时对账：已发布工作副本退场＋清单行清；未发布保留；内容不一致保留", () => {
  const vaultPath = makeVault();
  try {
    const working = path.join(vaultPath, "知识库", "raw", "precleaned");
    fs.writeFileSync(path.join(working, "published.md"), "same");
    fs.writeFileSync(path.join(working, "unpublished.md"), "draft state");
    fs.writeFileSync(path.join(working, "divergent.md"), "newer edits");
    publish(vaultPath, "published.md", "same");
    publish(vaultPath, "divergent.md", "older version"); // 同名正式件在（内容已演进）——仍退场（正式代次是权威版本）
    getDerivedIndexStore(vaultPath).articleManifests.put("published", { manifestKey: "published", title: "x" });

    const r = createArticleLifecycleReconciler({ vaultPath, logger: { info() {}, warn() {}, error() {} } });
    const result = r.reconcileWorkingCopies();

    assert.deepEqual([...result.retired].sort(), ["divergent.md", "published.md"], "同名正式件在即退场（正式代次权威）");
    assert.ok(!fs.existsSync(path.join(working, "published.md")));
    assert.ok(fs.existsSync(path.join(working, "unpublished.md")), "未发布保留");
    assert.ok(!fs.existsSync(path.join(working, "divergent.md")));
    assert.equal(getDerivedIndexStore(vaultPath).articleManifests.get("published"), undefined, "清单行随退场清理");
    // 幂等
    const again = r.reconcileWorkingCopies();
    assert.deepEqual(again.retired, []);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP4 退役：dryRun 零落盘＋预演清单含溯源锚", () => {
  const vaultPath = makeVault();
  try {
    const archiveRel = "知识库/raw/archive/投稿/" + "a".repeat(64) + "-retire.md";
    const archiveAbs = path.join(vaultPath, archiveRel);
    fs.writeFileSync(archiveAbs, "原文");
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "retire.md"), "工作");
    const formal = publish(vaultPath, "retire.md", "正式", archiveRel);
    getDerivedIndexStore(vaultPath).articleManifests.put("retire", { manifestKey: "retire", title: "x" });

    const r = createArticleLifecycleReconciler({ vaultPath, logger: { info() {}, warn() {}, error() {} } });
    const plan = r.retireArticle({ basename: "retire.md", dryRun: true });

    assert.equal(plan.dryRun, true);
    assert.equal(plan.plan.archivePath, archiveRel);
    assert.equal(plan.plan.formalPaths.length, 1);
    assert.ok(fs.existsSync(archiveAbs), "预演不动归档");
    assert.ok(fs.existsSync(formal), "预演不动正式版");
    assert.ok(fs.existsSync(path.join(vaultPath, "知识库", "raw", "precleaned", "retire.md")), "预演不动工作副本");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP4 退役：执行全链清理（工作/正式/归档/清单行）", () => {
  const vaultPath = makeVault();
  try {
    const archiveRel = "知识库/raw/archive/投稿/" + "b".repeat(64) + "-gone.md";
    const archiveAbs = path.join(vaultPath, archiveRel);
    fs.writeFileSync(archiveAbs, "原文");
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "gone.md"), "工作");
    publish(vaultPath, "gone.md", "正式", archiveRel);
    getDerivedIndexStore(vaultPath).articleManifests.put("gone", { manifestKey: "gone", title: "x" });

    const r = createArticleLifecycleReconciler({ vaultPath, logger: { info() {}, warn() {}, error() {} } });
    const result = r.retireArticle({ basename: "gone.md" });

    assert.equal(result.retired, true);
    assert.ok(!fs.existsSync(archiveAbs), "归档随链清理");
    assert.ok(!fs.existsSync(path.join(vaultPath, "知识库", "raw", "precleaned", "gone.md")));
    assert.equal(fs.readdirSync(path.join(vaultPath, "知识库", "wiki", "articles")).length, 0, "正式目录清空");
    assert.equal(getDerivedIndexStore(vaultPath).articleManifests.get("gone"), undefined, "清单行清理");
    assert.ok(!fs.existsSync(path.join(vaultPath, ".ledger", ".retire-staging")), "暂存区不残留");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP4 退役：不存在 404；悬空溯源锚降级 warning 不阻断", () => {
  const vaultPath = makeVault();
  const logger = { info() {}, warn() {}, error() {} };
  try {
    const r = createArticleLifecycleReconciler({ vaultPath, logger });
    assert.throws(() => r.retireArticle({ basename: "ghost.md" }), (e) => e.code === "ARTICLE_NOT_FOUND");

    const formal = publish(vaultPath, "dangle.md", "内容", "知识库/raw/archive/投稿/" + "c".repeat(64) + "-missing.md");
    const result = r.retireArticle({ basename: "dangle.md" });
    assert.equal(result.retired, true, "悬空仍可退役正式版");
    assert.ok(result.plan.warnings.some((w) => w.includes("悬空")));
    assert.ok(!fs.existsSync(formal));
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

// ── SPEC-028：归档 lane 被封 0o555 后退役仍可执行（moveTo 显式解锁/回封），封条不破坏合法清理链 ──
test("WP4 退役（SPEC-028）：封锁 lane 目录（0o555）＋只读归档件（0o444）下全链清理成功且回封", () => {
  const vaultPath = makeVault();
  const lane = path.join(vaultPath, "知识库", "raw", "archive", "投稿");
  try {
    const archiveRel = "知识库/raw/archive/投稿/" + "c".repeat(64) + "-sealed.md";
    const archiveAbs = path.join(vaultPath, archiveRel);
    fs.writeFileSync(archiveAbs, "原文");
    fs.chmodSync(archiveAbs, 0o444);       // 生产态：vault-io 排他写落地即只读
    fs.chmodSync(lane, 0o555);             // 生产态：lane 目录封条
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "sealed.md"), "工作");
    publish(vaultPath, "sealed.md", "正式", archiveRel);
    getDerivedIndexStore(vaultPath).articleManifests.put("sealed", { manifestKey: "sealed", title: "x" });

    const r = createArticleLifecycleReconciler({ vaultPath, logger: { info() {}, warn() {}, error() {} } });
    const result = r.retireArticle({ basename: "sealed.md" });

    assert.equal(result.retired, true, "封锁目录下退役须成功（解锁路径）");
    assert.ok(!fs.existsSync(archiveAbs), "只读归档件随链清理");
    assert.equal(fs.statSync(lane).mode & 0o777, 0o755, "lane 目录治愈为 0o755（P3 批口径：退役即愈合遗留封条，不回封）");
    assert.equal(getDerivedIndexStore(vaultPath).articleManifests.get("sealed"), undefined);
  } finally {
    try { fs.chmodSync(lane, 0o755); } catch { /* 解封以便清理 */ }
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

// ── P3-c：retire 事务失败 undo 路径——只读档排他重建＋人可改档凭据回滚（红队 P3「undo 零测试」补齐）──
// 注入方式：P3-b 愈合语义已消掉权限类故障（不可写目录会被治愈）——改 monkey-patch fs.renameSync 第 3 次调用
// （搬移次序 working→formal→archive）注入 EACCES，专测 undo 事务语义本身。
test("WP4 退役（P3-c）：archive 搬移中途失败触发 undo——正式件只读重建（wx+0o444）＋工作副本回滚＋归档原地未动", () => {
  const vaultPath = makeVault();
  const lane = path.join(vaultPath, "知识库", "raw", "archive", "投稿");
  const realRename = fs.renameSync;
  let renameCalls = 0;
  try {
    const { initVaultIO, resetVaultIO } = require(path.join(__dirname, "..", "..", "..", "..", "server", "shared", "vault-io.cjs"));
    initVaultIO({ vaultPath, gitLedger: { scheduleLedger() {}, markSystemFile() {} } }); // 装配缺省根：undo 只读重建走档位执法
    const archiveRel = "知识库/raw/archive/投稿/" + "d".repeat(64) + "-undo.md";
    const archiveAbs = path.join(vaultPath, archiveRel);
    fs.writeFileSync(archiveAbs, "原文");
    fs.chmodSync(archiveAbs, 0o444);
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "undo.md"), "工作");
    publish(vaultPath, "undo.md", "正式", archiveRel);
    getDerivedIndexStore(vaultPath).articleManifests.put("undo", { manifestKey: "undo", title: "x" });

    fs.renameSync = (a, b) => { renameCalls += 1; if (renameCalls === 3) { const e = new Error("EACCES: injected"); e.code = "EACCES"; throw e; } return realRename(a, b); };
    const r = createArticleLifecycleReconciler({ vaultPath, logger: { info() {}, warn() {}, error() {} } });
    let threw = null;
    try { r.retireArticle({ basename: "undo.md" }); } catch (e) { threw = e; }
    assert.ok(threw, "中途失败必须抛出（不留半态）");

    const working = path.join(vaultPath, "知识库", "raw", "precleaned", "undo.md");
    assert.ok(fs.existsSync(working) && fs.readFileSync(working, "utf8") === "工作", "工作副本经 undo 回滚（人可改档 PR-083 凭据路径）");
    // 正式件只读档重建：内容还原且落 0o444（initVaultIO 装配下档位执法强制）
    const formalDir = path.join(vaultPath, "知识库", "wiki", "articles");
    const formalFiles = [];
    for (const dom of fs.readdirSync(formalDir)) for (const d of fs.readdirSync(path.join(formalDir, dom))) for (const f of fs.readdirSync(path.join(formalDir, dom, d))) formalFiles.push(path.join(formalDir, dom, d, f));
    assert.equal(formalFiles.length, 1, "正式件唯一");
    assert.ok(fs.readFileSync(formalFiles[0], "utf8").includes("正式"), "正式件内容经 undo 还原（排他重建路径，含 publish 夹具 frontmatter）");
    assert.equal(fs.statSync(formalFiles[0]).mode & 0o777, 0o444, "重建的正式件为只读 0o444（read-only-evidence 档）");
    assert.ok(fs.existsSync(archiveAbs), "归档件原地未动（第 3 次搬移被注入失败）");
    resetVaultIO();
  } finally {
    fs.renameSync = realRename;
    try { fs.chmodSync(lane, 0o755); } catch { /* 解封清理 */ }
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});
