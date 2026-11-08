// Assembly 集成测试：approval-state-machine-assembly（S5 快照单版本取代）
// 覆盖：publishArticle 先 snapshotArticle 后 collectCompleteArtifacts 时，snapshotArticle 写新哈希快照
// 必须取代同 article_id 的旧哈希快照——否则 collectCompleteArtifacts 的 scanFormalReleaseSources 按
// article_id 判重抛 DUPLICATE_DOCUMENT_ID（document-source-scanner.cjs:118）。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitFixtureEnv } = require("../../../scripts/quality/shared/git-fixture-env.cjs");

const { registerApprovalStateMachine } = require("../release-governance/approval-state-machine-assembly.cjs");

function git(args, cwd) {
  return execFileSync("git", args, { env: gitFixtureEnv(process.env), cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

// macOS 上 rmSync recursive 对含 0o444 Release 产物的深树会 ENOTEMPTY——先 chmod 再删（snapshot-store.test.cjs 同款模式）
function cleanTree(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) { try { fs.chmodSync(absolute, 0o755); } catch {} stack.push(absolute); }
      else { try { fs.chmodSync(absolute, 0o644); } catch {} }
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

// 可被 collectCompleteArtifacts 完整消费的 git 仓库 fixture（minimal-vault + 必需派生产物）
// SPEC-012 wave-2 图族：图/清单真身迁 derived-index.db、master_graph.db 住 repo 侧 data/——
// 种子改种 store（fixture 图原文入行，物化字节与旧盘读一致）＋临时 KB_DATA_DIR
let fixtureDataDir = null;
function fixtureVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asm-assembly-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-pin-"); // Master 加固批：镜像写通道钉 /tmp
  const source = path.resolve(__dirname, "../../../test/fixtures/minimal-vault");
  fs.cpSync(source, root, { recursive: true });
  git(["init", "-b", "main"], root);
  git(["config", "user.email", "test@example.invalid"], root);
  git(["config", "user.name", "Asm Test"], root);
  git(["add", "-A"], root);
  git(["commit", "-m", "fixture"], root);
  fixtureDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-assembly-data-"));
  process.env.KB_DATA_DIR = fixtureDataDir;
  write(fixtureDataDir, "master_graph.db", "");
  const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
  const store = getDerivedIndexStore(root);
  // fixture 图原文入行（minimal-vault 自带 .ledger/master_graph.json；物化走 stable 变换后与旧盘读等价）
  store.artifacts.put("master_graph", fs.readFileSync(path.join(source, ".ledger", "master_graph.json"), "utf8"));
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  return root;
}

function buildAssembly(vaultPath) {
  const logger = { info() {}, warn() {}, error() {} };
  return registerApprovalStateMachine({
    vaultPath,
    logger,
    articleWorkflowService: {
      // B2 实时探针（真实语义）：按 articleId 定位 precleaned 源文件、每次调用现算哈希——
      // 固定哈希 mock 掩盖了「探针值与存储 revision 同源恒等」的探针错配缺陷（定性文档 D2 §1.3）
      getPrecleaned: (articleId) => {
        // 精确 ${articleId}.md 优先；legacy fixture（article_id=001 ↔ 文件名 fixture-candidate.md）兜底
        const candidates = [path.join(vaultPath, "知识库", "raw", "precleaned", `${articleId}.md`), path.join(vaultPath, "知识库", "raw", "precleaned", "fixture-candidate.md")];
        for (const abs of candidates) {
          if (fs.existsSync(abs)) {
            return { standardizationStatus: "standardized", formalContentHash: sha256(fs.readFileSync(abs, "utf8")) };
          }
        }
        return { standardizationStatus: "pending_standardization", formalContentHash: null };
      },
    },
  });
}

async function standardizeToApproved(sm, articleId, H) { // PR-056：transition 异步化随迁
  await sm.transition(articleId, "standardize", {
    sourcePath: "知识库/raw/precleaned/fixture-candidate.md",
    contentHash: H,
    title: "测试候选文章",
    product: "FixtureProduct",
    version: "1.0.0",
  });
  await sm.transition(articleId, "confirm", { contentHash: H });
}

// S4（gherkin 场景⑧）：publish 失败必须落持久 Issue（release_publication_failure，listIssues 可读）。
// 缺必需产物 master_graph.db → collectCompleteArtifacts 抛 RELEASE_ARTIFACT_MISSING →
// publishArticle 的 catch 复用 publisherService.recordFailure 写 .releases/issues/publication-issues.json。
//（SPEC-012 wave-2：db 字节工件住 data/——删除 dataDir 内文件触发同款失败）
test("S4：publish 失败落持久 Issue（release_publication_failure，listIssues 可读）", async () => {
  const vaultPath = fixtureVault();
  try {
    const precleaned = path.join(vaultPath, "知识库/raw/precleaned/fixture-candidate.md");
    const HA = sha256(fs.readFileSync(precleaned, "utf8"));
    const sm = buildAssembly(vaultPath);
    await standardizeToApproved(sm, "fixture-candidate-001", HA);
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved");
    // 删除必需产物触发发布失败
    fs.rmSync(path.join(fixtureDataDir, "master_graph.db"), { force: true });
    await assert.rejects(
      () => sm.transition("fixture-candidate-001", "publish", {
        sourcePath: "知识库/raw/precleaned/fixture-candidate.md",
        title: "测试候选文章",
        product: "FixtureProduct",
        version: "1.0.0",
      }),
      (e) => e.code === "RELEASE_ARTIFACT_MISSING" || e.message.includes("master_graph.db"),
      "publish 应因缺 master_graph.db 失败",
    );
    // 失败后状态不得推进到 snapshot
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved", "失败后状态不得推进");
    // 持久 Issue 已落盘且可被 listIssues 读
    const issuesPath = path.join(vaultPath, ".releases", "issues", "publication-issues.json");
    assert.ok(fs.existsSync(issuesPath), "发布失败应落持久 Issue 文件");
    const issues = JSON.parse(fs.readFileSync(issuesPath, "utf8"));
    assert.equal(issues.length, 1, "应恰好 1 条发布失败 Issue");
    assert.equal(issues[0].issueKind, "release_publication_failure");
    assert.equal(issues[0].status, "open");
    assert.ok(issues[0].stage, "Issue 应记录失败阶段 stage");
    assert.ok(issues[0].errorCode, "Issue 应记录错误码");
  } finally {
    cleanTree(vaultPath);
  }
});

// S5 重写（B2/D2+D3）：原用例「批准后源变化再 publish 期望成功」钉的正是 D2 要修的假发布——
// 场景⑥/GOAL-5：来源变化使旧审批资格失效，publish 必须 409。合法恢复路径 = reject → resubmit
// 重标准化（D3 管线，快照取代语义在此链路验证，不回归 DUPLICATE_DOCUMENT_ID）→ confirm 新哈希 → publish。
test("S5 重写（B2）：批准后源变化 publish 409；resubmit 重标准化→confirm→publish 走取代语义", async () => {
  const vaultPath = fixtureVault();
  try {
    const sm = buildAssembly(vaultPath);
    const src001 = "知识库/raw/precleaned/fixture-candidate.md";
    const src002 = "知识库/raw/precleaned/fixture-candidate-002.md";
    // 记录 001：批准（A1）后源变化 → publish 409（资格失效），状态保持 approved
    const contentA = fs.readFileSync(path.join(vaultPath, src001), "utf8");
    const HA = sha256(contentA);
    await sm.transition("fixture-candidate-001", "standardize", { sourcePath: src001, contentHash: HA, title: "测试候选文章", product: "FixtureProduct", version: "1.0.0" });
    await sm.transition("fixture-candidate-001", "confirm", { contentHash: HA });
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved");
    // 记录 002（独立源文件/独立 article_id frontmatter——身份源是快照正文的 frontmatter，双 id 共源必撞 DUPLICATE）：
    // standardize(B1) → reject；改源后 resubmit 管线重快照 B2 取代 B1 → confirm 新哈希 → publish
    const contentB1 = `---
article_id: fixture-candidate-002
title: 测试候选文章二
product: FixtureProduct
version: "1.0.0"
module: fixture-module
article_type: 排错指南
doc-type: 用户手册
category-path: ops:maintain
tags: "[测试, 候选]"
architecture_associations: []
---

# 测试候选文章二

第二篇候选正文（v1）。
`;
    write(vaultPath, src002, contentB1);
    const HB1 = sha256(contentB1);
    await sm.transition("fixture-candidate-002", "standardize", { sourcePath: src002, contentHash: HB1, title: "测试候选文章二", product: "FixtureProduct", version: "1.0.0" });
    await sm.transition("fixture-candidate-002", "reject", { contentHash: HB1 });
    // 批准后源变化（001）：publish 必须 fail-closed
    write(vaultPath, src001, `${contentA}\n# 更新内容\n`);
    await assert.rejects(
      () => sm.transition("fixture-candidate-001", "publish", { sourcePath: src001 }),
      (e) => e.code === "APPROVAL_EVIDENCE_STALE",
      "批准后源变化 publish 应 409 APPROVAL_EVIDENCE_STALE（旧审批资格失效）",
    );
    assert.equal(sm.getStatus("fixture-candidate-001").status, "approved", "重验失败不得推进 snapshot");
    // 记录 002 合法路径：修改后 resubmit（管线重快照 HB2 取代 HB1）→ confirm 新哈希 → publish
    const contentB2 = `${contentB1}\n更新段落（v2 修改后重新标准化）。\n`;
    write(vaultPath, src002, contentB2);
    const HB2 = sha256(contentB2);
    const r = await sm.transition("fixture-candidate-002", "resubmit", { sourcePath: src002 });
    assert.equal(r.status, "pending");
    assert.equal(r.revision, `sha256:${HB2}`, "resubmit 管线应刷新 revision 为新源哈希");
    await sm.transition("fixture-candidate-002", "confirm", { contentHash: HB2, sourcePath: src002 });
    const result = await sm.transition("fixture-candidate-002", "publish", { sourcePath: src002, title: "测试候选文章二", product: "FixtureProduct", version: "1.0.0" });
    assert.ok(result.releaseId, "重新审批后 publish 应成功（取代语义不得 DUPLICATE_DOCUMENT_ID）");
    assert.equal(sm.getStatus("fixture-candidate-002").status, "snapshot");
    // 工作树只保留当前快照（旧哈希被取代）
    // SPEC-030 派②两层：<域>/<articleId>/——先定位域目录
    const formalRootA5 = path.join(vaultPath, "知识库", "wiki", "articles");
    const domainEntryA5 = fs.readdirSync(formalRootA5, { withFileTypes: true }).find((e) => e.isDirectory() && fs.existsSync(path.join(formalRootA5, e.name, "fixture-candidate-002")));
    const articleDir = path.join(formalRootA5, domainEntryA5.name, "fixture-candidate-002");
    const snapshots = fs.readdirSync(articleDir).filter((name) => name.endsWith(".md"));
    assert.equal(snapshots.length, 1, `同 articleId 应只保留 1 个快照，实际: ${JSON.stringify(snapshots)}`);
    assert.equal(snapshots[0], `${HB2}.md`, "应保留当前源哈希快照");
    // current 指针已切换
    const currentPath = path.join(vaultPath, ".releases", "current.json");
    assert.ok(fs.existsSync(currentPath), "publish 成功后 current.json 应存在");
    const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
    assert.equal(current.releaseId, result.releaseId);
  } finally {
    cleanTree(vaultPath);
  }
});
