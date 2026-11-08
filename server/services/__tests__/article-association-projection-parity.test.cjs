// A1 切片红灯证据工具：文章映射「双投影注册表等价」端到端集成测试。
// 红灯语义（基线 ee9b1bd3 / tag pre-a1-registry-20260911 可重放）：
//   main.cjs:352 pinned 装配 getRegistry 读冻结工件（RAW 产品键），save 走活工作树
//   readVersionRegistry（canonicalizeRegistryProducts 规范化）→ list/preview 吐出的
//   versionId 在 save 侧 byId 必然 miss → 422 VERSION_NOT_REGISTERED（结构性保存死锁）。
// 本测试走真实生产路径：fixture vault → 真实状态机 standardize/confirm/publish 生成合法
// Release 快照 → spawn main.cjs（生产启动路径）→ HTTP list/preview/save 全链。
// 修后语义（A1）：装配 getRegistry 换活读闭包（同 :369 save 链、:349-351 getGraph #1776 活锚），
//   文章目录保持冻结（TC-frozen 守护 #1776 语义不被连带冲掉）。
// 夹具不对称注入复现生产：versions.yaml RAW 键 `AS` + enums 别名 `AS→FixtureProduct`
//   （对应生产 versions.yaml 键 `As` + 别名 `AS→AnyShare`，schema-config.cjs:43 机制）。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { gitFixtureEnv } = require("../../../scripts/quality/shared/git-fixture-env.cjs");

const { registerApprovalStateMachine } = require("../release-governance/approval-state-machine-assembly.cjs");

function git(args, cwd) {
  return execFileSync("git", args, { env: gitFixtureEnv(process.env), cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sha256Hex(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

// macOS 上 rmSync recursive 对含 0o444 Release 产物的深树会 ENOTEMPTY（assembly 先例同款）
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

// 可被 collectCompleteArtifacts 完整消费的 git 仓库 fixture（approval-state-machine-assembly 先例同款）
// SPEC-012 wave-2 图族：图/清单真身迁 derived-index.db、master_graph.db 住 repo 侧 data/——
// 种 store＋临时 KB_DATA_DIR（bootServer spawn 继承该 env，server 进程持久层同隔离）
let fixtureDataDir = null;
function fixtureVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a1-parity-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-pin-"); // Master 加固批：含 approval 装配——镜像写通道钉 /tmp
  const source = path.resolve(__dirname, "../../../test/fixtures/minimal-vault");
  fs.cpSync(source, root, { recursive: true });
  git(["init", "-b", "main"], root);
  git(["config", "user.email", "test@example.invalid"], root);
  git(["config", "user.name", "A1 Test"], root);
  git(["add", "-A"], root);
  git(["commit", "-m", "fixture"], root);
  fixtureDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "a1-parity-data-"));
  process.env.KB_DATA_DIR = fixtureDataDir;
  write(fixtureDataDir, "master_graph.db", "");
  const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
  const store = getDerivedIndexStore(root);
  store.artifacts.put("master_graph", fs.readFileSync(path.join(source, ".ledger", "master_graph.json"), "utf8"));
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  return root;
}

// 生产同款不对称：RAW 注册表产品键与 canonical 架构产品 slug 不同（As vs AnyShare 的夹具等价物）
function injectRegistryAsymmetry(vaultPath) {
  write(vaultPath, "知识库/TheSchema/versions.yaml", `schema_version: 1
products:
  AS:
    versions:
      - id: 1.0.0
        label: AS 1.0.0
        status: draft
        aliases: []
        snapshot: null
`);
  const enumsPath = path.join(vaultPath, "知识库", "TheSchema", "enums.yaml");
  const text = fs.readFileSync(enumsPath, "utf8");
  const patched = text.replace(
    "architecture_projection:\n  product: FixtureProduct\n  version: 1.0.0\n",
    "architecture_projection:\n  product: FixtureProduct\n  version: 1.0.0\n  product_aliases:\n    AS: FixtureProduct\n",
  );
  assert.notEqual(patched, text, "enums.yaml architecture_projection 注入别名应命中");
  // PR-160 批次一（副本→收据）：B3 现场计算后，夹具必须携带真库形态的完整规则真身——
  // fields.yaml＋products 闭合段＋解析物投影（真库写路径必产；替身缺失＝假绿， ValidatorFatal 503 现形）
  fs.writeFileSync(enumsPath, patched.includes("\nproducts:") ? patched : patched + "\nproducts:\n  - FixtureProduct\n");
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "fields.yaml"), [
    "schema_version: 1",
    'last_updated: "2026-10-30"',
    "fields:",
    "  - {name: title, label: 标题, type: string, required: 是, scope: [article], layer: 内容属性, value_domain: {source: free}}",
    "  - {name: product, label: 产品, type: string, required: 是, scope: [article], layer: 业务属性, value_domain: {source: products}}",
    "  - {name: version, label: 适用版本, type: string, required: 是, scope: [article], layer: 业务属性, value_domain: {source: free}}",
    "  - {name: module, label: 产品模块, type: string, required: 是, scope: [article], layer: 业务属性, value_domain: {source: modules}}",
    "  - {name: article_type, label: 知识文章类型, type: enum, required: 是, scope: [article], layer: 业务属性, value_domain: {source: article_types}}",
    "  - {name: doc-type, label: 文档类型, type: enum, required: 是, scope: [article], layer: 业务属性, value_domain: {source: doc_types}}",
    "  - {name: category-path, label: 知识域目录, type: string, required: 是, scope: [article], layer: 业务属性, value_domain: {source: free}}",
  ].join("\n") + "\n");
  const pinnedSchema = path.join(vaultPath, "知识库", "TheSchema");
  const prevPinned = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = pinnedSchema; // repo-schema-io 钉扎领地：tmp 夹具写解析物的合法通道（用后恢复）
  try {
    execFileSync("node", [path.resolve(__dirname, "..", "..", "..", "scripts", "quality", "project-resolved-domains.mjs")],
      { stdio: "pipe", env: { ...process.env, VAULT_PATH: vaultPath } });
  } finally {
    if (prevPinned === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = prevPinned;
  }
  git(["add", "-A"], vaultPath);
  git(["commit", "-m", "fixture: registry asymmetry (raw AS key + alias to canonical)"], vaultPath);
}

// 发布一篇正式文章，生成合法 Release 快照 + current.json（S5 002 配方：身份源=快照正文 frontmatter）
async function publishOneArticle(vaultPath) { // PR-056：transition 异步化随迁
  const sourceRel = "知识库/raw/precleaned/fixture-candidate-002.md";
  const content = `---
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

第二篇候选正文。
`;
  write(vaultPath, sourceRel, content);
  const H = sha256Hex(content);
  const logger = { info() {}, warn() {}, error() {} };
  const sm = registerApprovalStateMachine({
    vaultPath,
    logger,
    articleWorkflowService: {
      getPrecleaned: (articleId) => {
        const abs = path.join(vaultPath, "知识库", "raw", "precleaned", `${articleId}.md`);
        if (fs.existsSync(abs)) return { standardizationStatus: "standardized", formalContentHash: sha256Hex(fs.readFileSync(abs, "utf8")) };
        return { standardizationStatus: "pending_standardization", formalContentHash: null };
      },
    },
  });
  await sm.transition("fixture-candidate-002", "standardize", { sourcePath: sourceRel, contentHash: H, title: "测试候选文章二", product: "FixtureProduct", version: "1.0.0" });
  await sm.transition("fixture-candidate-002", "confirm", { contentHash: H, sourcePath: sourceRel });
  const result = await sm.transition("fixture-candidate-002", "publish", { sourcePath: sourceRel, title: "测试候选文章二", product: "FixtureProduct", version: "1.0.0" });
  assert.ok(result.releaseId, "publish 应生成合法 Release（快照哈希校验链真实生效）");
  // WP-023 迁家修锚（随波5 批②）：发布物新家＝resolver 语义（vault/.releases；存量库自动搬迁）
  const { resolveReleasesDir } = require("../../shared/releases-dir.cjs");
  const home = resolveReleasesDir({ vaultPath }).dir;
  assert.ok(fs.existsSync(path.join(home, "current.json")), `publish 后 current.json 应存在（${home}）`);
  return result;
}

async function bootServer(vaultPath) {
  const port = 18900 + (process.pid % 400);
  const child = spawn(process.execPath, [path.resolve(__dirname, "../../../server/main.cjs")], {
    env: { ...process.env, VAULT_PATH: vaultPath, API_PORT: String(port), THESCHEMA_DIR: path.join(vaultPath, "知识库", "TheSchema") }, // WP-079 唯一门：TheSchema 写须显式钉扎领地（旧形态靠未钉扎写 vault 分支，该分支与 A1-2 断言相抵已撤；resolver 解析结果不变）
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  child.stderr.on("data", (chunk) => { bootLog += String(chunk); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`main.cjs 启动即退（exit=${child.exitCode}）:\n${bootLog.slice(-2000)}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return { child, port };
    } catch { /* 未就绪继续等 */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`main.cjs 30s 未就绪:\n${bootLog.slice(-2000)}`);
}

async function getJSON(port, pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.json() };
}

async function postJSON(port, pathname, payload) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json() };
}

test("A1 双投影等价：list 选项与 save 校验同源（保存死锁）+ 冻结语义守护 + 边界负例", async () => {
  const vaultPath = fixtureVault();
  let booted = null;
  try {
    injectRegistryAsymmetry(vaultPath);
    await publishOneArticle(vaultPath);
    booted = await bootServer(vaultPath);
    const { port } = booted;

    // —— TC-parity（红灯靶心）：list 吐的每个 versionId 必须能走通 preview→save 全链 ——
    const list = await getJSON(port, "/api/article-associations");
    assert.equal(list.status, 200, "list 应 200");
    const data = list.body.data;
    assert.ok(data.articles.length >= 1, "正式目录应有已发布文章");
    assert.ok(data.versionOptions.length >= 1, "注册表应提供版本选项");
    const articleId = data.articles[0].articleId;
    const versionId = data.versionOptions[0].id;
    const auditRevision = data.revision;

    const preview = await postJSON(port, "/api/article-associations/preview", { revision: auditRevision, articleId, action: "replace", componentIds: [], versionIds: [versionId] });
    assert.equal(preview.status, 200, `preview 应 200，实际 ${preview.status}: ${JSON.stringify(preview.body)}`);
    const fileRevision = preview.body.data.fileRevision;
    assert.ok(fileRevision, "preview 应返回 fileRevision");

    const save = await postJSON(port, "/api/article-associations/save", { revision: fileRevision, articleId, action: "replace", componentIds: [], versionIds: [versionId] });
    assert.equal(save.status, 200, `【红灯靶心】选 list 提供的版本保存应 200，实际 ${save.status}: ${JSON.stringify(save.body)}——双投影不对称即在此显形`);

    // —— TC-frozen（#1776 冻结语义守护）：文章目录必须仍来自冻结 Release，不随活源漂移 ——
    const frozenBefore = (await getJSON(port, "/api/article-associations")).body.data.articles[0];
    // SPEC-030 派②两层：域/<articleId>/——先定位文章目录再取快照
    const formalRoot = path.join(vaultPath, "知识库", "wiki", "articles");
    const domainDir = fs.readdirSync(formalRoot, { withFileTypes: true }).find((e) => e.isDirectory() && fs.existsSync(path.join(formalRoot, e.name, articleId)));
    const liveSnapshots = path.join(formalRoot, domainDir.name, articleId);
    const snapshotFile = fs.readdirSync(liveSnapshots).find((name) => name.endsWith(".md"));
    const snapshotPath = path.join(liveSnapshots, snapshotFile);
    fs.chmodSync(snapshotPath, 0o644); // 发布器把快照写为 0o444 不可变（builder :124-125）——模拟活源漂移先解只读
    fs.writeFileSync(snapshotPath, fs.readFileSync(snapshotPath, "utf8") + "\n活源漂移行\n");
    const frozenAfter = (await getJSON(port, "/api/article-associations")).body.data.articles[0];
    assert.equal(frozenAfter.sourceHash, frozenBefore.sourceHash, "list 的文章 sourceHash 必须仍来自冻结快照（活源漂移不得穿透）");

    // —— TC-drift（tr_bbc0faf0 常驻钉）：上面 :231 已把活源改掉，这正是生产形态「文章发布后又编辑」——
    // 双源分歧下 preview 吐冻结哈希、save 现算活哈希 → save 恒 409「文章源文件已变化，请重新预览」，
    // 而重新预览每次拿回同一个陈旧值＝无解死路（原夹具发布后不再改源，所以这条一直没被覆盖）。
    const driftList = (await getJSON(port, "/api/article-associations")).body.data;
    const driftPreview = await postJSON(port, "/api/article-associations/preview", { revision: driftList.revision, articleId, action: "replace", componentIds: [], versionIds: [versionId] });
    assert.equal(driftPreview.status, 200, `漂移后 preview 应 200，实际 ${driftPreview.status}: ${JSON.stringify(driftPreview.body)}`);
    const driftRevision = driftPreview.body.data.fileRevision;
    assert.notEqual(driftRevision, frozenBefore.sourceHash, "preview 的 fileRevision 须来自与 save 同一份活扫目录——等于冻结快照哈希即双源回潮");
    const driftSave = await postJSON(port, "/api/article-associations/save", { revision: driftRevision, articleId, action: "replace", componentIds: [], versionIds: [versionId] });
    assert.equal(driftSave.status, 200, `【tr_bbc0faf0 靶心】发布后改过源的文章仍须能保存关联，实际 ${driftSave.status}: ${JSON.stringify(driftSave.body)}`);

    // —— 边界负例 1：未注册版本 fail-closed（改锚后仍必须 422，不得静默放行）——
    const ghostPreview = await postJSON(port, "/api/article-associations/preview", { revision: auditRevision, articleId, action: "replace", componentIds: [], versionIds: ["version-does-not-exist-1-0-0"] });
    assert.equal(ghostPreview.status, 422, "未注册版本 preview 应 422 fail-closed");
    assert.equal(ghostPreview.body.error_code, "VERSION_NOT_REGISTERED");

    // —— 边界负例 2：陈旧 revision fail-closed（409 而非覆盖）——
    const staleSave = await postJSON(port, "/api/article-associations/save", { revision: `sha256:${"b".repeat(64)}`, articleId, action: "replace", componentIds: [], versionIds: [versionId] });
    assert.equal(staleSave.status, 409, "陈旧 revision save 应 409 拒绝覆盖");
  } finally {
    // PR-210 根因修：SIGTERM 只投递信号、服务进程的 fire-and-forget 尾巴写（vault 账车／投影联动）
    // 可能在 cleanTree 的 rmSync 之后落盘 → Errno 66 ENOTEMPTY（全量并发跑批三遇、位置不定）。
    // 拆树必须排在「确认退出」之后：先 SIGTERM 等 exit（5s），超时升级 SIGKILL 再等（2s），仍不退才拆。
    // （红队 4b 补：race 后清定时器——否则每件白等满 5s 才收进程。）
    if (booted) {
      booted.child.kill("SIGTERM");
      let exitTimer;
      const exited = new Promise((resolve) => booted.child.once("exit", resolve));
      const fiveSeconds = new Promise((resolve) => { exitTimer = setTimeout(resolve, 5000); });
      await Promise.race([exited, fiveSeconds]);
      clearTimeout(exitTimer);
      if (booted.child.exitCode === null) {
        booted.child.kill("SIGKILL");
        let killTimer;
        const twoSeconds = new Promise((resolve) => { killTimer = setTimeout(resolve, 2000); });
        await Promise.race([exited, twoSeconds]);
        clearTimeout(killTimer);
      }
    }
    cleanTree(vaultPath);
  }
}, { timeout: 120_000 });
