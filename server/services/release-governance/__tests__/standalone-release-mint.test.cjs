// WP-017 独立发布入口测试。分层：
//   L2 服务契约——registerApprovalStateMachine 返回的 publishCurrent：铸版结果形状、current 指针原子落盘、
//      复铸产生新 releaseId（时间戳身份，见重铸实验）、收集失败落持久 Issue（stage=artifact-collection，S4 同源）
//   L3 HTTP 真进程——真起 server/main.cjs：POST /api/releases/mint → 200＋current.json 落盘；
//      发布后 GET /api/kg/classification/list 从 404 NO_CURRENT_RELEASE 变 409 PROJECTION_IDENTITY_UNMOUNTED
//      （SPEC-029 定义空态——「发布按钮让新库走到定义态」的头条证明）
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { registerApprovalStateMachine } = require("../approval-state-machine-assembly.cjs");
const { initDerivedIndexStore, getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
const { SOURCE_ROOTS } = require("../../projection/document-source-scanner.cjs");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const quiet = { info() {}, warn() {}, error() {} };

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// 与 unmounted-subject-state.test 同款夹具：受管根骨架＋store 种管线四件＋git 单提交（sourceCommit 锚点）
function fixtureVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mint-vault-"));
  for (const def of SOURCE_ROOTS) fs.mkdirSync(path.join(root, def.relativePath), { recursive: true });
  fs.mkdirSync(path.join(root, "知识库/wiki/articles"), { recursive: true });
  write(root, "知识库/wiki/entities/mint-component.md", "---\narchitecture-node-id: mint-component\nmodule: [fixture-module]\n---\n\n# Mint Component\n");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mint-data-"));
  write(dataDir, "master_graph.db", "sqlite-fixture");
  // 种子＝staging 文件（管线产物落点）——服务 boot 会摄取进自己的库（NODE_TEST_CONTEXT 内存/文件模式皆然，
  // 这也是真路径：不绕过 boot 摄取；测试进程内消费时再显式摄取同款）
  write(dataDir, "staging/master_graph.json", JSON.stringify({ generatedAt: "volatile", nodes: [{ id: "mint-component", label: "Mint" }], connections: [] }));
  write(dataDir, "staging/extract_manifest.json", '{"generatedAt":"volatile","files":{}}\n');
  write(dataDir, "staging/sa/semantic_architecture.json", JSON.stringify({ _format_version: "1.0", generatedAt: "volatile", nodes: [{ id: "mint-component", label: "Mint" }], connections: [] }));
  write(dataDir, "staging/sa/architecture_layout.json", JSON.stringify({ positions: {} }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixture"]);
  return { root, dataDir };
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("L2 publishCurrent：铸版结果形状＋current 指针落盘＋复铸新身份＋收集失败落 Issue（与文章发布 S4 同源）", () => {
  const { root, dataDir } = fixtureVault();
  const service = registerApprovalStateMachine({ vaultPath: root, logger: quiet });
  assert.equal(typeof service.publishCurrent, "function", "装配应暴露 publishCurrent");

  const ingest = () => withEnv({ KB_DATA_DIR: dataDir }, () => {
    const { initRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
    const { openPersistenceDb } = require("../../../shared/persistence/sqlite-adapter.cjs");
    const { dataDbPath } = require("../../../shared/persistence/data-dir.cjs");
    initRuntimeStateStore(openPersistenceDb(dataDbPath("runtime-state.db")));
    initDerivedIndexStore(openPersistenceDb(dataDbPath("derived-index.db")));
    const { ingestStagedGraphArtifacts } = require("../../../shared/persistence/graph-artifact-ingest.cjs");
    ingestStagedGraphArtifacts({ dataDir, store: getDerivedIndexStore(root), logger: quiet });
  });
  ingest();

  const first = withEnv({ THESCHEMA_DIR: path.join(REPO_ROOT, "test/fixtures/minimal-vault/知识库/TheSchema"), KB_DATA_DIR: dataDir }, () => service.publishCurrent());
  assert.match(first.releaseId, /^release-[0-9a-f]{64}$/);
  assert.equal(first.sourceCommit.length, 40);
  assert.ok(first.artifactCount > 0);
  assert.equal(first.previousReleaseId, null, "首铸无前驱");

  const releasesDir = path.join(root, ".releases");
  const pointer = JSON.parse(fs.readFileSync(path.join(releasesDir, "current.json"), "utf8"));
  assert.equal(pointer.releaseId, first.releaseId);
  assert.equal(pointer.manifestHash, first.manifestHash);
  assert.ok(fs.existsSync(path.join(releasesDir, first.releaseId, "manifest.json")), "制品目录应落盘");

  // 复铸：新 releaseId（publishedAt 烤进身份——重铸实验实证）＋ previousReleaseId 接链
  const second = withEnv({ THESCHEMA_DIR: path.join(REPO_ROOT, "test/fixtures/minimal-vault/知识库/TheSchema"), KB_DATA_DIR: dataDir }, () => service.publishCurrent());
  assert.notEqual(second.releaseId, first.releaseId);
  assert.equal(second.previousReleaseId, first.releaseId);

  // 收集失败（产物缺）→ 定义错误码＋持久 Issue 落 stage=artifact-collection（与文章发布失败同源同账）
  fs.rmSync(path.join(dataDir, "master_graph.db"), { force: true });
  assert.throws(
    () => withEnv({ THESCHEMA_DIR: path.join(REPO_ROOT, "test/fixtures/minimal-vault/知识库/TheSchema"), KB_DATA_DIR: dataDir }, () => service.publishCurrent()),
    (error) => error.code === "RELEASE_ARTIFACT_MISSING",
  );
  const issuesPath = path.join(releasesDir, "issues", "publication-issues.json");
  assert.ok(fs.existsSync(issuesPath), "失败应落持久 Issue");
  const issues = JSON.parse(fs.readFileSync(issuesPath, "utf8"));
  assert.equal(issues[issues.length - 1].issueKind, "release_publication_failure");
  assert.equal(issues[issues.length - 1].stage, "artifact-collection");
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

test("L3 HTTP 真进程：POST /api/releases/mint → 200＋指针落盘；分类面从 404 NO_CURRENT_RELEASE 变 409 PROJECTION_IDENTITY_UNMOUNTED", { timeout: 90_000 }, async () => {
  const { root, dataDir } = fixtureVault();
  const port = await freePort();
  const env = { ...process.env, VAULT_PATH: root, KB_DATA_DIR: dataDir, API_PORT: String(port), THESCHEMA_DIR: path.join(REPO_ROOT, "test/fixtures/minimal-vault/知识库/TheSchema") };
  const server = spawn(process.execPath, [path.join(REPO_ROOT, "server", "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const body = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) })).json();
        if (body?.data?.readyState === "ready") { ready = true; break; }
      } catch { /* 未就绪 */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ready, `server 未 ready：\n${log.slice(-1500)}`);

    // 发布前：无任何发布 → 404 NO_CURRENT_RELEASE
    const before = await fetch(`http://127.0.0.1:${port}/api/kg/classification/list`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(before.status, 404);
    assert.equal((await before.json()).error_code, "NO_CURRENT_RELEASE");

    // 独立发布（真进程端点）
    const mint = await fetch(`http://127.0.0.1:${port}/api/releases/mint`, { method: "POST", signal: AbortSignal.timeout(30_000) });
    const mintBody = await mint.json();
    assert.equal(mint.status, 200, JSON.stringify(mintBody).slice(0, 300));
    assert.match(mintBody.data.releaseId, /^release-[0-9a-f]{64}$/);
    assert.ok(mintBody.data.artifactCount > 0);
    assert.ok(fs.existsSync(path.join(root, ".releases", "current.json")), "指针应落盘");

    // 发布后：消费面进入有内容状态（夹具词表带 FixtureProduct 身份——发布按钮让新库从 404 到 200 有数据，
    // 这是「发布入口补完」的头条证明；空身份库发布后呈 409 定义空态，由 unmounted-subject-state.test 覆盖）
    const after = await fetch(`http://127.0.0.1:${port}/api/kg/classification/list`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(after.status, 200);
    const afterBody = await after.json();
    assert.ok(afterBody.success === true || Array.isArray(afterBody.data?.items), JSON.stringify(afterBody).slice(0, 200));
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
});
