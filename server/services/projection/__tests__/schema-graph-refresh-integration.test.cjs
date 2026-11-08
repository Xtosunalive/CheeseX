// WP-027（PR-142）红队阻断②收口：真实集成证据——
// 跑前 false（改 ontology）→ 调度器自动触发（真 pipelineDue.runNow → 真 Python extract --apply
// --incremental → manifest 前进 → 摄取配对回调）→ 跑后 true。非 mock：extract 是真进程、
// manifest 是真文件、freshness 是真对账；mock 只打摄取落库边界（派生库摄取由既有 D2 测试族覆盖）。
// 通道语义即生产接线：runRefresh=runNow（红队证伪 global_diagnostic 只读诊断后的修正形态）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createPipelineDueService } = require("../pipeline-due-service.cjs");
const { createSchemaGraphRefreshScheduler } = require("../schema-graph-refresh-scheduler.cjs");
const { computeGraphFreshness } = require("../schema-graph-freshness.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTITY_MD = `---
title: Fixture Component
architecture-node-id: fixture-component
status: 在线
date: 2026-07-09
---

# Fixture Component

集成测试夹具实体（WP-027）。
`;

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "wp027-it-vault-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp027-it-data-"));
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  // 与 py e2e 同款：TheSchema 主源落位到临时 vault（vault 优先解析次序不变）。
  // PR-158：源改为洁净基线夹具——repo data/theschema 是活库运行态（released 版本/依赖引用随用随长），
  // 活态使真实增量抽取按活库依赖校验索要夹具库不存在的图节点（doc-article-agents 前科）→ 抽取 exit 1 假红。
  fs.cpSync(path.join(REPO_ROOT, "test", "fixtures", "theschema-baseline"), schemaDir, { recursive: true });
  const entities = path.join(vault, "知识库", "wiki", "entities");
  fs.mkdirSync(entities, { recursive: true });
  fs.writeFileSync(path.join(entities, "fixture-component.md"), ENTITY_MD, "utf8");
  process.env.THESCHEMA_DIR = schemaDir; // freshness 模块与写链同源解析（防串台其他用例残留）
  return { vault, dataDir, schemaDir };
}

async function waitFor(predicate, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

test("真实链路：改 ontology → 调度器自动真实增量抽取 → freshness 收敛 true（红队阻断②）", async () => {
  const { vault, dataDir, schemaDir } = makeVault();
  const ingestCalls = [];
  const traces = [];
  const silent = { info() {}, warn() {}, error() {} };

  const pipelineDue = createPipelineDueService({
    logger: silent,
    telemetry: { recordTrace(kind, payload) { traces.push({ kind, ...payload }); } },
    // WP-069 §3.1：vaultPath 语义锚；KB_DATA_DIR 测试隔离经 extraEnv（非身份变量）
    vaultPath: vault,
    extraEnv: { KB_DATA_DIR: dataDir },
    ingestStagedGraph: () => { ingestCalls.push(Date.now()); return { graphArtifacts: 2 }; },
    recordGraphRefreshed: () => {},
  });

  try {
    // ⓪ 基线：先真实跑一次增量（模拟既有图状态——产 manifest＋staging）
    const bootstrap = await pipelineDue.runNow("integration-bootstrap");
    assert.equal(bootstrap.ran, true, `bootstrap 抽取须成功（error=${bootstrap.error}）`);
    assert.equal(ingestCalls.length, 1, "runNow 含摄取配对回调");
    const fresh0 = computeGraphFreshness({ vaultPath: vault, dataDir });
    assert.equal(fresh0.upToDate, true, "基线后图与输入一致");

    // ① 跑前：改 ontology.yaml（真实写）→ freshness=false 且点名
    const ontologyPath = path.join(schemaDir, "ontology.yaml");
    fs.appendFileSync(ontologyPath, "\n# WP-027 集成测试触笔（改动即图输入变更）\n", "utf8");
    const fresh1 = computeGraphFreshness({ vaultPath: vault, dataDir });
    assert.equal(fresh1.upToDate, false, "跑前必须 false");
    assert.deepEqual(fresh1.changed, ["ontology.yaml"]);

    // ② 自动跟随：真调度器（静默窗 20ms）＋生产同款接线（runRefresh=runNow）
    const scheduler = createSchemaGraphRefreshScheduler({
      logger: silent,
      telemetry: { recordTrace() {} },
      computeFreshness: () => computeGraphFreshness({ vaultPath: vault, dataDir }),
      runRefresh: () => pipelineDue.runNow("schema-graph-refresh"),
      pipelineDue,
      quietMs: 20,
    });
    scheduler.notify({ category: "ontology", source: "service" });
    const done = await waitFor(() => scheduler.getState().lastTriggeredAt !== null, 120_000);
    assert.equal(done, true, "调度器须在时限内完成真实触发");
    assert.equal(scheduler.getState().pending, false);

    // ③ 跑后：manifest 已前进 → freshness 收敛 true；摄取配对再次发生
    const fresh2 = computeGraphFreshness({ vaultPath: vault, dataDir });
    assert.equal(fresh2.upToDate, true, "跑后必须收敛 true（manifest 前进）");
    assert.equal(ingestCalls.length, 2, "跟随运行同样配对摄取");
    assert.ok(traces.some((t) => t.kind === "pipeline-run" && t.ok === true), "telemetry 记真实运行成功");
  } finally {
    delete process.env.THESCHEMA_DIR;
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}, { timeout: 240_000 });
