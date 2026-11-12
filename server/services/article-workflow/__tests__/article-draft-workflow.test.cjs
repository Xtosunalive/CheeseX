const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createArticleDraftWorkflow } = require("../article-draft-workflow.cjs");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-draft-workflow-"));
  const scripts = path.join(vaultPath, "知识库", ".claude", "scripts");
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts", "投稿"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.mkdirSync(scripts, { recursive: true });
  // SPEC-022 波 B：校验器已切统一客户端——桩改为客户端形态（stdout JSON 同形）
  fs.writeFileSync(path.join(scripts, "schema-write-client.mjs"), "process.stdout.write(JSON.stringify({ errors: [], warnings: [] }))\n");
  // PR-016 方案甲：脚本解析单点默认仓内优先——本文件靠「临时 vault 注入 stub」测工作流契约，
  // 须经解析器的显式目录开关（VAULT_RUNTIME_SCRIPTS_DIR）把注入点接到 stub 目录（resolver 语义：
  // 显式指定完全采信）。每个测试的 fixture 都会重设，进程退出即失效，无跨文件泄漏。
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scripts;
  return { vaultPath, scripts };
}

function createWorkflow(vaultPath) {
  const error = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
  return createArticleDraftWorkflow({
    vaultPath,
    logger: { info() {} },
    workflowError: error,
    ensureUploadTask() {},
    relativeVaultPath: (absolute) => path.relative(vaultPath, absolute).split(path.sep).join("/"),
  });
}

function writePromoter(scripts, body) {
  fs.writeFileSync(path.join(scripts, "promote-article.py"), body);
}

test("validation archives exact web submission bytes before mutating the draft", async function (t) { // PR-056：随 validateDraft 异步化
  const { vaultPath } = fixture();
  t.after(() => { try { fs.chmodSync(path.join(vaultPath, "知识库", "raw", "archive"), 0o755); } catch { /* 解封父目录 */ } for (const l of ["投稿", "本地草稿"]) { try { fs.chmodSync(path.join(vaultPath, "知识库", "raw", "archive", l), 0o755); } catch { /* 无该 lane 则跳过 */ } } fs.rmSync(vaultPath, { recursive: true, force: true }); });
  const raw = "# 原始投稿\n\n保持这些字节。\n";
  const relative = "知识库/raw/drafts/投稿/article.md";
  fs.writeFileSync(path.join(vaultPath, ...relative.split("/")), raw);

  const result = await createWorkflow(vaultPath).validateDraft(relative);
  assert.equal(result.valid, true);
  const archives = fs.readdirSync(path.join(vaultPath, "知识库", "raw", "archive", "投稿"));
  assert.equal(archives.length, 1);
  assert.equal(fs.readFileSync(path.join(vaultPath, "知识库", "raw", "archive", "投稿", archives[0]), "utf8"), raw);
  assert.match(fs.readFileSync(path.join(vaultPath, ...relative.split("/")), "utf8"), /source_file: 知识库\/raw\/archive\/投稿\//);
  // SPEC-028：source-archive=read-only-evidence——归档件落地 0o444（真文件 fs.stat）＋ lane 目录封 0o555
  const archiveAbs = path.join(vaultPath, "知识库", "raw", "archive", "投稿", archives[0]);
  assert.equal(fs.statSync(archiveAbs).mode & 0o777, 0o444, "归档件权限须为只读 0o444"); // 目录封断言在 vault-io 套件（initVaultIO 装配面）
});

test("SPEC-028 红队 P1 回归：initVaultIO 装配下同 lane 连续两篇投稿归档均成功", async function (t) {
  const { vaultPath } = fixture();
  t.after(() => { for (const l of ["投稿", "本地草稿"]) { try { fs.chmodSync(path.join(vaultPath, "知识库", "raw", "archive", l), 0o755); } catch { /* 无该 lane 跳过 */ } } fs.rmSync(vaultPath, { recursive: true, force: true }); });
  // 生产同款装配：initVaultIO 设缺省根（缺陷版本下第二篇在此 EACCES——红队以真 workflow 复现）
  const { initVaultIO } = require(path.join(ROOT, "server", "shared", "vault-io.cjs"));
  initVaultIO({ vaultPath, gitLedger: { scheduleLedger() {}, markSystemFile() {} } });
  // 模块级缺省根是进程单例——用例结束把缺省根指向无害空槽（后续夹具不受污染；正式复位接口 initVaultIO({vaultPath:undefined}) 见其实现）
  t.after(() => require(path.join(ROOT, "server", "shared", "vault-io.cjs")).resetVaultIO()); // 复位进程单例缺省根，防污染后续夹具
  const wf = createWorkflow(vaultPath);
  const first = "知识库/raw/drafts/投稿/p1.md";
  const second = "知识库/raw/drafts/投稿/p2.md";
  fs.writeFileSync(path.join(vaultPath, ...first.split("/")), "# 第一篇\n");
  fs.writeFileSync(path.join(vaultPath, ...second.split("/")), "# 第二篇\n");
  const r1 = await wf.validateDraft(first);
  const r2 = await wf.validateDraft(second); // 缺陷版本：第一篇封 lane 0o555 → 此处归档 EACCES
  assert.equal(r1.valid, true, JSON.stringify(r1));
  assert.equal(r2.valid, true, `第二篇投稿不得被第一篇的归档阻断: ${JSON.stringify(r2)}`);
  const lane = path.join(vaultPath, "知识库", "raw", "archive", "投稿");
  const names = fs.readdirSync(lane);
  assert.equal(names.length, 2, "同 lane 两篇归档件都在");
  for (const n of names) assert.equal(fs.statSync(path.join(lane, n)).mode & 0o777, 0o444, `归档件 ${n} 0o444`);
  assert.notEqual(fs.statSync(lane).mode & 0o777, 0o555, "lane 目录不封（红队 P1 修正）");
});

test("local drafts receive an immutable local source baseline", async function (t) { // PR-056：随 validateDraft 异步化
  const { vaultPath } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const relative = "知识库/raw/drafts/local.md";
  fs.writeFileSync(path.join(vaultPath, ...relative.split("/")), "# 本地草稿\n");
  await createWorkflow(vaultPath).validateDraft(relative);
  assert.equal(fs.readdirSync(path.join(vaultPath, "知识库", "raw", "archive", "本地草稿")).length, 1);
});

test("an existing source_file archives the referenced original instead of the edited draft", async function (t) { // PR-056：随 validateDraft 异步化
  const { vaultPath } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const imported = path.join(vaultPath, "知识库", "raw", "imported", "original.txt");
  fs.mkdirSync(path.dirname(imported), { recursive: true });
  fs.writeFileSync(imported, "original bytes");
  const relative = "知识库/raw/drafts/投稿/edited.md";
  fs.writeFileSync(path.join(vaultPath, ...relative.split("/")), "---\nsource_file: 知识库/raw/imported/original.txt\n---\n已编辑");
  await createWorkflow(vaultPath).validateDraft(relative);
  const archiveDir = path.join(vaultPath, "知识库", "raw", "archive", "投稿");
  assert.equal(fs.readFileSync(path.join(archiveDir, fs.readdirSync(archiveDir)[0]), "utf8"), "original bytes");
});

test("promotion refuses a missing archive and keeps the draft", async function (t) { // PR-056：随 promoteDraft 异步化
  const { vaultPath, scripts } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const relative = "知识库/raw/drafts/投稿/missing.md";
  const absolute = path.join(vaultPath, ...relative.split("/"));
  fs.writeFileSync(absolute, "# 投稿\n");
  const workflow = createWorkflow(vaultPath);
  await workflow.validateDraft(relative);
  fs.rmSync(path.join(vaultPath, "知识库", "raw", "archive"), { recursive: true });
  writePromoter(scripts, "raise SystemExit(0)\n");

  await assert.rejects(() => workflow.promoteDraft(relative, true), { code: "SOURCE_ARCHIVE_MISSING" });
  assert.equal(fs.existsSync(absolute), true);
  assert.equal(fs.existsSync(path.join(vaultPath, "知识库", "raw", "precleaned", "missing.md")), false);
});

test("failed promoter cannot leave a candidate or delete the draft", async function (t) { // PR-056：随 promoteDraft 异步化
  const { vaultPath, scripts } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const relative = "知识库/raw/drafts/投稿/fail.md";
  const absolute = path.join(vaultPath, ...relative.split("/"));
  fs.writeFileSync(absolute, "# 投稿\n");
  writePromoter(scripts, [
    "import os, shutil, sys",
    "source = sys.argv[1]",
    "target = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(source))), 'precleaned', os.path.basename(source))",
    "shutil.copy2(source, target)",
    "os.remove(source)",
    "raise SystemExit(1)",
  ].join("\n") + "\n");

  await assert.rejects(() => createWorkflow(vaultPath).promoteDraft(relative, true), { code: "PROMOTE_FAILED" });
  assert.equal(fs.existsSync(absolute), true);
  assert.equal(fs.existsSync(path.join(vaultPath, "知识库", "raw", "precleaned", "fail.md")), false);
});

test("successful promotion keeps the archive and creates only the active candidate", async function (t) { // PR-056：随 promoteDraft 异步化
  const { vaultPath, scripts } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const relative = "知识库/raw/drafts/投稿/success.md";
  const absolute = path.join(vaultPath, ...relative.split("/"));
  fs.writeFileSync(absolute, "# 投稿\n");
  writePromoter(scripts, [
    "import os, shutil, sys",
    "source = sys.argv[1]",
    "target = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(source))), 'precleaned', os.path.basename(source))",
    "shutil.copy2(source, target)",
    "os.remove(source)",
  ].join("\n") + "\n");

  const result = await createWorkflow(vaultPath).promoteDraft(relative, true);
  assert.equal(result.precleanedPath, "知识库/raw/precleaned/success.md");
  assert.equal(fs.existsSync(absolute), false);
  assert.equal(fs.readdirSync(path.join(vaultPath, "知识库", "raw", "archive", "投稿")).length, 1);
});

test("speculative fields are not written to the draft, only returned as suggestions", async function (t) { // PR-056：随 validateDraft 异步化
  const { vaultPath } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // Provide enums so autoFill has speculative candidates
  const schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), [
    "modules:",
    "  可观测引擎:",
    "    system: obs-engine",
    "article_types:",
    "- 排错指南",
    "- 场景规范",
    "doc_types:",
    "- 知识文章",
    "domains:",
    "  ops:",
    "subdomains:",
    "  ops:",
    "  - monitoring",
    "lifecycle:",
    "  status:",
    "  - 制定中",
    "  - 有效",
    "  - 已归档",
    "  default_status: 有效",
  ].join("\n"));
  const relative = "知识库/raw/drafts/投稿/speculative.md";
  const absolute = path.join(vaultPath, ...relative.split("/"));
  fs.writeFileSync(absolute, "# 可观测引擎方案\n\n关于可观测引擎的内容。\n");

  const result = await createWorkflow(vaultPath).validateDraft(relative);
  assert.equal(result.valid, true);

  // Suggestions are returned
  assert.equal(result.suggested.module, "可观测引擎");
  assert.equal(result.suggested.article_type, "排错指南");
  assert.equal(result.suggested["doc-type"], "知识文章");
  assert.equal(result.suggested["category-path"], "ops:monitoring"); // WP-040 两段建议（topic 派生退役）

  // But NOT written to the file
  const content = fs.readFileSync(absolute, "utf8");
  assert.equal(content.includes("module:"), false, "module must not be written to draft");
  assert.equal(content.includes("article_type:"), false, "article_type must not be written to draft");
  assert.equal(content.includes("doc-type:"), false, "doc-type must not be written to draft");
  assert.equal(content.includes("category-path:"), false, "category-path must not be written to draft");

  // Mechanical fields ARE written
  assert.match(content, /title: speculative/);
  assert.match(content, /status: 有效/);
});

test("promotion does not create or modify wiki/entities", async function (t) { // PR-056：随 promoteDraft 异步化
  const { vaultPath, scripts } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const entitiesDir = path.join(vaultPath, "知识库", "wiki", "entities");
  fs.mkdirSync(entitiesDir, { recursive: true });
  const relative = "知识库/raw/drafts/投稿/entity-check.md";
  const absolute = path.join(vaultPath, ...relative.split("/"));
  fs.writeFileSync(absolute, "---\nmodule: 可观测引擎\n---\n# 投稿\n");
  // Promoter that mimics old behavior: attempts to create entity files
  writePromoter(scripts, [
    "import os, shutil, sys",
    "source = sys.argv[1]",
    "vault = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(source))))",
    "target = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(source))), 'precleaned', os.path.basename(source))",
    "shutil.copy2(source, target)",
    "os.remove(source)",
  ].join("\n") + "\n");

  await createWorkflow(vaultPath).promoteDraft(relative, true);
  const entities = fs.readdirSync(entitiesDir);
  assert.equal(entities.length, 0, "wiki/entities must remain empty after promote");
});

test("candidate missing required attribution stays editable but cannot be approved", function (t) {
  const { vaultPath } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // Write a precleaned candidate without module/article_type/doc-type/category-path
  const precleanedDir = path.join(vaultPath, "知识库", "raw", "precleaned");
  const candidatePath = path.join(precleanedDir, "incomplete.md");
  fs.writeFileSync(candidatePath, "---\ntitle: 不完整文章\narticle_id: incomplete-test\nproduct: AnyShare\nversion: '6.0'\n---\n# 正文\n");

  // The file is still readable/editable
  assert.equal(fs.existsSync(candidatePath), true);
  const content = fs.readFileSync(candidatePath, "utf8");
  assert.equal(content.includes("不完整文章"), true);

  // Admission policy blocks approval due to missing module/article_type/doc-type/category-path
  const { assertCandidateCanBeApproved } = require("../article-admission-policy.cjs");
  assert.throws(
    () => assertCandidateCanBeApproved(vaultPath, content, "知识库/raw/precleaned/incomplete.md"),
    (error) => error.code === "ARTICLE_ADMISSION_BLOCKED" && error.details.blockers.length > 0,
  );
});

// SPEC-011 §三·附 设计 5：validate/promote 子进程须显式拿到 KB_VAULT=vaultPath。
// server 进程本身无 KB_VAULT，脚本经 resolver 落在仓内时 kb_paths 缺省推导到不存在目录（枚举集为空）。
// 桩脚本把收到的 KB_VAULT 回显出来，断言注入值 = 本 vault；进程环境故意设成错值以证明是显式注入而非继承。
test("validate and promote subprocesses receive KB_VAULT = vaultPath (design 5)", async function (t) { // PR-056：随异步化
  const { vaultPath, scripts } = fixture();
  const prev = process.env.KB_VAULT;
  process.env.KB_VAULT = "/nonexistent-inherited-value";
  t.after(() => {
    if (prev === undefined) delete process.env.KB_VAULT; else process.env.KB_VAULT = prev;
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(scripts, "schema-write-client.mjs"),
    "process.stdout.write(JSON.stringify({ errors: [], warnings: [], summary: process.env.KB_VAULT || '' }))\n");
  const relative = "知识库/raw/drafts/kbv.md";
  fs.writeFileSync(path.join(vaultPath, ...relative.split("/")), "# kb vault\n");
  const validated = await createWorkflow(vaultPath).validateDraft(relative);
  assert.equal(validated.summary, vaultPath, "validate 子进程应收到 KB_VAULT=vaultPath");

  const marker = path.join(vaultPath, "promote-kbvault.txt");
  writePromoter(scripts, `import os\nopen(${JSON.stringify(marker)}, "w").write(os.environ.get("KB_VAULT", ""))\nraise SystemExit(1)\n`);
  await assert.rejects(() => createWorkflow(vaultPath).promoteDraft(relative, true), (error) => error.code === "PROMOTE_FAILED");
  assert.equal(fs.readFileSync(marker, "utf8"), vaultPath, "promote 子进程应收到 KB_VAULT=vaultPath");
});

// WP-169（SPEC-095 §3.1 首批）：草稿校验响应带受管字段来源三态，快照经回调落任务通道
test("WP-169 validateDraft 响应含 fieldProvenance 三态且快照回调收到同份", async function (t) {
  const { vaultPath } = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // 新草稿：tags＝人工预填（human），其余无信号——title/date/updated 由机械填（auto）、module 等＝未提取到
  const relative = "知识库/raw/drafts/投稿/wp169-来源标记.md";
  fs.writeFileSync(path.join(vaultPath, ...relative.split("/")), "---\ntags:\n  - 人工标签\n---\n正文\n", "utf8");
  const snapshots = [];
  const error = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
  const wf = createArticleDraftWorkflow({
    vaultPath, logger: { info() {} }, workflowError: error,
    ensureUploadTask() {},
    relativeVaultPath: (absolute) => path.relative(vaultPath, absolute).split(path.sep).join("/"),
    saveDraftProvenance: (draftPath, provenance) => snapshots.push({ draftPath, provenance }),
  });
  const result = await wf.validateDraft(relative);
  const fp = result.fieldProvenance;
  assert.ok(fp && typeof fp === "object", "响应必须带 fieldProvenance");
  for (const source of ["auto", "human", "not-extracted"]) {
    assert.ok(Object.values(fp).some((entry) => entry.source === source), `三态之一 ${source} 应在场`);
  }
  assert.ok(["title", "date", "updated"].every((field) => fp[field].source === "auto"), "机械填字段＝auto（title←文件名、date/updated←当日）");
  assert.equal(fp.tags.source, "human", "人工预填 tags＝human");
  assert.equal(fp.module.source, "not-extracted", "module 无词表信号＝未提取到（B12：不自动填）");
  assert.equal(snapshots.length, 1, "快照回调恰好一次");
  assert.equal(snapshots[0].draftPath, relative);
  assert.equal(snapshots[0].provenance, fp, "快照与响应同源同引用（不重算）");
});
