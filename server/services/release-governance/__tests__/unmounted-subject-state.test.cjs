// 「无挂载主体」合法空态（ADR-009 D5，Master 2026-10-25「A」，PR-103／WP-014）。分层：
//   L2 消费端契约——真实 release-builder/release-reader/formal-knowledge-consumer（零 mock）：
//      双空身份＝合法空态（上下文可建、非身份读面可用、投影读面 409 定义码）；半身份仍 500 fail-closed；
//      显式选择绕过空态走既有 404 语义；满身份行为不变
//   L3 HTTP 真进程——空身份发布落 .releases/ 后真起 server/main.cjs：分类列表 200＋空＋指引（展示类，WP-070）、
//      词表接口 200、health ready（公开端点视角）
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { collectCompleteArtifacts } = require("../complete-release-artifact-service.cjs");
const { createReleaseBuilderService } = require("../release-builder-service.cjs");
const { createReleaseReaderService } = require("../release-reader-service.cjs");
const { createFormalKnowledgeConsumerService } = require("../formal-knowledge-consumer-service.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
const { SOURCE_ROOTS } = require("../../projection/document-source-scanner.cjs");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const YAML = require("yaml");
const { REPO_THESCHEMA } = require("../../../shared/theschema-root.cjs");
const FIXTURE_THESCHEMA = path.join(REPO_ROOT, "test/fixtures/minimal-vault/知识库/TheSchema");
const quiet = { info() {}, warn() {}, error() {} };

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// Vault：受管根骨架＋一篇实体；store 种管线四件（与真库跑过一次管线后形态同）
function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unmounted-vault-"));
  for (const def of SOURCE_ROOTS) fs.mkdirSync(path.join(root, def.relativePath), { recursive: true });
  fs.mkdirSync(path.join(root, "知识库/wiki/articles"), { recursive: true });
  write(root, "知识库/wiki/entities/fixture-component.md", "---\ntitle: Fixture Component\narchitecture-node-id: fixture-component\narch_component: true\nmodule: [fixture-module]\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Fixture Component\n");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unmounted-data-"));
  write(dataDir, "master_graph.db", "sqlite-fixture");
  const store = getDerivedIndexStore(root);
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  store.artifacts.put("master_graph", JSON.stringify({ generatedAt: "volatile", nodes: [{ id: "fixture-component", label: "Fixture" }], connections: [] }));
  store.artifacts.put("sa", JSON.stringify({ _format_version: "1.0", nodes: [{ id: "fixture-component", label: "Fixture" }], connections: [] }));
  store.artifacts.put("sa_layout", JSON.stringify({ positions: {} }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return { root, dataDir };
}

// 以给定 TheSchema 目录（身份形态由它决定）打包并落发布指针，返回 reader。
// artifactOverrides：产物层注入口——打包期投影身份成对护栏（RELEASE_PROJECTION_IDENTITY_INVALID 409）
// 上线后打包器不再铸造半身份 Release；消费端「半身份 500 fail-closed 不放宽」语义仍须独立覆盖
//（存量旧版 Release／外部铸造面仍可能带入半身份产物），经此注入构造，不经打包器。
function publish(root, dataDir, theschemaDir, { artifactOverrides } = {}) {
  const artifacts = withEnv({ THESCHEMA_DIR: theschemaDir, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
  for (const [name, content] of Object.entries(artifactOverrides || {})) artifacts[name] = Buffer.from(content, "utf8");
  const releasesDir = path.join(root, ".releases");
  const builder = createReleaseBuilderService({ releasesDir, logger: quiet });
  const manifest = builder.build({ sourceCommit: "2".repeat(40), artifacts });
  fs.writeFileSync(path.join(releasesDir, "current.json"), JSON.stringify({ releaseId: manifest.releaseId, sourceCommit: "2".repeat(40), manifestHash: manifest.manifestHash }));
  return createReleaseReaderService({ builderService: builder, releasesDir, logger: quiet });
}

// 半身份词表：夹具 TheSchema 复制一份，只保留 product
function partialIdentityTheSchema() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partial-theschema-"));
  for (const name of fs.readdirSync(FIXTURE_THESCHEMA)) fs.copyFileSync(path.join(FIXTURE_THESCHEMA, name), path.join(dir, name));
  const enums = fs.readFileSync(path.join(dir, "enums.yaml"), "utf8").replace(/^  version: 1\.0\.0$/m, "  version: ''");
  assert.ok(/version: ''/.test(enums), "夹具 version 行应被置空");
  fs.writeFileSync(path.join(dir, "enums.yaml"), enums);
  return dir;
}

// 整合批注：原 PR-159 emptyIdentityTheSchema 助手随冲突取 PR-158 基线注入版而退役。

test("L2 双空身份＝合法空态：上下文可建、projectionIdentity 报 unmounted、非身份读面可用、投影读面 409 PROJECTION_IDENTITY_UNMOUNTED 带引导", () => {
  const { root, dataDir } = vault();
  // PR-158：双空前提钉扎洁净基线（仓内 data/theschema 为活库运行态，可能已挂载身份——「仓内真 enums 双空」
  // 的旧假设把活态当夹具，活库一挂载即假红）；回落档语义经 THESCHEMA_REPO_FALLBACK_DIR 注入保持
  const BASELINE_THESCHEMA = path.join(REPO_ROOT, "test/fixtures/theschema-baseline");
  const consumer = createFormalKnowledgeConsumerService({ releaseReader: withEnv({ THESCHEMA_REPO_FALLBACK_DIR: BASELINE_THESCHEMA }, () => publish(root, dataDir, undefined)) }); // 基线：双空
  const result = consumer.withPinnedRelease((ctx) => ({
    identity: ctx.projectionIdentity,
    masterGraphNodes: ctx.readMasterGraph().nodes.length,
    registryProducts: Object.keys(ctx.readVersionRegistry().products || {}).length,
  }));
  assert.deepEqual(result.identity, { product: null, version: null, mounted: false });
  assert.equal(result.masterGraphNodes, 1, "不依赖产品身份的读面照常");
  assert.equal(result.registryProducts, 0);
  assert.throws(() => consumer.withPinnedRelease((ctx) => ctx.readSemanticArchitecture({})), (error) => {
    assert.equal(error.code, "PROJECTION_IDENTITY_UNMOUNTED");
    assert.equal(error.status, 409);
    assert.equal(error.details.state, "unmounted");
    // WP-070 R6：指引文案与空态语义契约同源（逐字）——第二文案源即断
    const { guidanceFor, noteFor } = require("../../../shared/availability-view.cjs");
    assert.equal(error.details.guidance, [guidanceFor("product-identity-unmounted"), noteFor("product-identity-unmounted")].join("｜"));
    assert.match(error.details.guidance, /尚未挂载任何主体|产品身份未配置/);
    assert.equal(error.details.subjectsRegistry, "data/theschema/subjects.yaml");
    return true;
  });
  // 显式选择绕过空态——走既有选择语义（此处无该投影 → 404 定义码，非 500）
  assert.throws(() => consumer.withPinnedRelease((ctx) => ctx.readSemanticArchitecture({ product: "X", version: "1.0.0" })), (error) => error.code === "SEMANTIC_PROJECTION_NOT_FOUND" && error.status === 404);
});

test("L2 半身份仍是配置错误：只填 product → createContext 抛 RELEASE_PROJECTION_IDENTITY_INVALID（500，fail-closed 不放宽）", () => {
  const { root, dataDir } = vault();
  // 半身份产物经产物层注入构造（打包期护栏已拦新铸——见 publish 注释）；本测钉消费端对在场
  // 半身份产物的 500 fail-closed 语义（与打包护栏同码异层，两端互查同名）。
  const partialDir = partialIdentityTheSchema();
  const halfEnums = fs.readFileSync(path.join(partialDir, "enums.yaml"), "utf8");
  const consumer = createFormalKnowledgeConsumerService({
    releaseReader: publish(root, dataDir, FIXTURE_THESCHEMA, { artifactOverrides: { "知识库/TheSchema/enums.yaml": halfEnums } }),
  });
  assert.throws(() => consumer.withPinnedRelease((ctx) => ctx.projectionIdentity), (error) => error.code === "RELEASE_PROJECTION_IDENTITY_INVALID" && error.status === 500);
});

test("L2 满身份行为不变：夹具 FixtureProduct/1.0.0 → mounted，readSemanticArchitecture 选中槽物化投影", () => {
  const { root, dataDir } = vault();
  const consumer = createFormalKnowledgeConsumerService({ releaseReader: publish(root, dataDir, FIXTURE_THESCHEMA) });
  const out = consumer.withPinnedRelease((ctx) => ({ identity: ctx.projectionIdentity, sa: ctx.readSemanticArchitecture({}) }));
  assert.deepEqual(out.identity, { product: "FixtureProduct", version: "1.0.0", mounted: true });
  assert.deepEqual(out.sa.nodes, [{ id: "fixture-component", label: "Fixture" }]);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

test("L3 HTTP 真进程：空身份发布在场 → 分类列表 200＋空列表＋契约同源指引（展示类，Master 2026-11-02 三类裁决；消费层 409 由 L2 钉）；词表接口 200；health ready", { timeout: 90_000 }, async () => {
  const { root, dataDir } = vault();
  // PR-158：铸造段同钉洁净基线（publish 内部 withEnv 只设 THESCHEMA_DIR——回落档仍读盘上活态
  // versions → 索要 released 快照假红；外层补 FALLBACK 使铸包同样落在基线前提）
  withEnv({ THESCHEMA_REPO_FALLBACK_DIR: path.join(REPO_ROOT, "test/fixtures/theschema-baseline") }, () => publish(root, dataDir, undefined));
  const port = await freePort();
  const env = { ...process.env, VAULT_PATH: root, KB_DATA_DIR: dataDir, API_PORT: String(port) };
  delete env.THESCHEMA_DIR;
  // PR-158：空身份前提钉扎洁净基线（仓内 data/theschema 为活库运行态，挂载身份后「空身份」前提失真）
  env.THESCHEMA_REPO_FALLBACK_DIR = path.join(REPO_ROOT, "test/fixtures/theschema-baseline");
  // PR-099 镜像面（本地红/CI 绿的环境分叉）：服务端 boot 会给 vault 补
  // 「recovery: boot-time drift」提交（vault-io.cjs:189-218）。夹具仓库 git init 后
  // 本无 HEAD；本机有 git 身份时该提交成功 → HEAD 存在且 ≠ 夹具 release sourceCommit
  // → freshness=stale → 活读分流（null-context）→ 本端点 200——本地断言红；
  // CI 无 git 身份提交恒败 → HEAD 未生 → unknown → pinned 上下文 → 身份闸 409——绿。
  // 本测的是空身份闸，不是 boot 漂移恢复；用其设计开关关掉 ledger，两端一致走被测路径，
  // 不再依赖「boot 提交在 CI 恰好失败」的环境巧合。
  env.VAULT_GIT_LEDGER_DISABLE = "1";
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
    assert.ok(ready, `server 未 ready：\n${log.slice(-2000)}`);
    const classification = await fetch(`http://127.0.0.1:${port}/api/kg/classification/list`, { signal: AbortSignal.timeout(5_000) });
    const body = await classification.json();
    // WP-070 §3.3：展示站点在路由层接住消费层 PROJECTION_IDENTITY_UNMOUNTED（服务层 409 不变，L2 钉）→ 200＋空＋指引
    assert.equal(classification.status, 200, JSON.stringify(body).slice(0, 300));
    assert.deepEqual(body.data.items, [], "展示类空态＝空列表而非错误");
    assert.equal(body.data.availability?.empty, true);
    assert.deepEqual(body.data.availability?.kinds, ["product-identity-unmounted"]);
    const { guidanceFor } = require("../../../shared/availability-view.cjs");
    assert.equal(body.data.availability?.hints?.[0], guidanceFor("product-identity-unmounted"), "指引与契约单源逐字同源");
    const enums = await fetch(`http://127.0.0.1:${port}/api/schema/enums`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(enums.status, 200, "词表面不受无主体态影响");
    assert.ok(!/RELEASE_PROJECTION_IDENTITY_INVALID/.test(log), "空态不得再以 500 身份码出现在日志");
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
});
