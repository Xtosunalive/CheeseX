const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPipelineRunService } = require("../pipeline-run-service.cjs");
const { createJsonLogger } = require("../../../shared/json-logger.cjs");
const { runWithRequestContext } = require("../../../shared/request-context.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = function () { child.emit("close", 143); };
  return child;
}

async function run() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-service-"));
  const scripts = path.join(vault, "知识库", ".claude", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "pipeline-runner.py"), "# fixture\n");
  // PR-016 方案甲：runner 解析默认仓内优先——本测试以临时 vault 注入 stub runner，
  // 须经解析器的显式目录开关（VAULT_RUNTIME_SCRIPTS_DIR）把注入点接到 stub 目录
  // （resolver 语义：显式指定完全采信；article-draft-workflow.test 同法先例）。
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scripts;
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });
  // SPEC-012 wave-2/F3：准入批次种子迁 data/admission-batches——显式设 KB_DATA_DIR
  // 使种子目录与服务端验证根（同 env）一致
  process.env.KB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "admission-data-"));
  const admissionBatches = path.join(process.env.KB_DATA_DIR, "admission-batches");
  fs.mkdirSync(admissionBatches, { recursive: true });
  const admissionManifest = path.join(admissionBatches, "batch-1.json");
  fs.writeFileSync(admissionManifest, "{}\n");
  // SPEC-012 WP-A：run 摘要种子改经 runtime-state store（readLatestRun 读库）
  const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
  getRuntimeStateStore(vault).pipeline.runsInsert({
    run_ts: "20260716-063858",
    timestamp: "2026-07-16T06:39:00.451135+00:00",
    status: "success",
    nodes: 37,
    connections: 29,
    components: 1,
    plates: 0,
    failed_stage: null,
    error: null,
    duration_ms: 2305,
  });
  const child = fakeChild();
  const calls = [];
  const postActions = [];
  const logRecords = [];
  const pipelineLogger = createJsonLogger({ sink: (line) => logRecords.push(JSON.parse(line)) });
  const service = createPipelineRunService({
    vaultPath: vault,
    archRepo: "/tmp/rebuild",
    logger: pipelineLogger,
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });
  service.addPostRunHook(async (job) => {
    postActions.push(job.stage);
  });
  let releaseCompletion;
  let completionStarted = false;
  const completionGate = new Promise((resolve) => { releaseCompletion = resolve; });
  service.addCompletionHook(async (job) => {
    completionStarted = true;
    assert.strictEqual(job.state, "succeeded");
    await completionGate;
    return { status: "completed", generatedAt: "2026-07-25T00:00:00.000Z", blockerCount: 0, verifiedCount: 1, issueIds: [], message: "未发现待处理问题" };
  });

  const started = runWithRequestContext({ traceId: "tr_pipeline-12345678" }, () => (
    service.start("full", { admissionManifestPath: admissionManifest })
  ));
  assert.strictEqual(started.state, "running");
  assert.strictEqual(started.lastRun.nodes, 37);
  assert.strictEqual(started.lastRun.connections, 29);
  assert.strictEqual(calls[0].command, process.env.PYTHON_PATH || "python3");
  assert.deepStrictEqual(calls[0].args.slice(-3), ["--force", "--article-admission-manifest", admissionManifest]);
  assert.strictEqual(calls[0].options.env.KB_VAULT, vault);
  assert.throws(() => service.start("quick"), /已在运行/);

  child.stdout.emit("data", "Stage 3: SYNC SA\n");
  child.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(completionStarted, true);
  assert.strictEqual(service.getStatus().state, "running", "completion reconciliation must finish before exposing a terminal state");
  releaseCompletion();
  await new Promise((resolve) => setImmediate(resolve));
  const finished = service.getStatus();
  assert.strictEqual(finished.state, "succeeded");
  assert.strictEqual(finished.stage, "complete");
  assert.strictEqual(finished.diagnostics.blockerCount, 0);
  assert.deepStrictEqual(postActions, ["post-actions"]);
  assert.ok(logRecords.some((entry) => entry.event === "pipeline.output" && entry.stage === "3"));
  assert.ok(logRecords.filter((entry) => entry.event.startsWith("pipeline.")).every((entry) => entry.trace_id === "tr_pipeline-12345678"));
  assert.equal(JSON.stringify(logRecords).includes(vault), false);
  service.dispose();

  const failedChild = fakeChild();
  let failedArgs = null;
  const completionResults = [];
  // 并发纪律：runRebuildEntryTest() 与本 run() 顶层并行——任何一段跑完都可能把全局开关
  // 重指到已删目录。每段创建 service 前重置开关到「本段仍存在」的 stub 目录（主 vault 在
  // 本段之后才删除）。resolver：显式指定完全采信。
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scripts;
  const failedService = createPipelineRunService({
    vaultPath: vault,
    archRepo: "/tmp/rebuild",
    logger: { info() {}, error() {} },
    spawnProcess(_command, args) { failedArgs = args; return failedChild; },
  });
  failedService.addCompletionHook((job) => {
    completionResults.push(job.state);
    return { status: "failed", generatedAt: "2026-07-23T00:00:00.000Z", blockerCount: 1, verifiedCount: 0, issueIds: ["pipeline-failure"], message: "发现 1 项待处理问题" };
  });
  const diagnostic = failedService.startDiagnostic("full");
  assert.strictEqual(diagnostic.purpose, "global_diagnostic");
  assert.ok(failedArgs.includes("--diagnostic"));
  assert.strictEqual(failedService.startDiagnostic("full").jobId, diagnostic.jobId);
  failedChild.stdout.emit("data", "Stage 0.5: ADMISSION READINESS\n█ 管道中断 — Stage 0.5 失败: READINESS_FAILED: routes.scanAndCheck is not a function\nStage 7: RECORD MEMORY\n");
  failedChild.emit("close", 1);
  await new Promise((resolve) => setImmediate(resolve));
  const failed = failedService.getStatus();
  assert.strictEqual(failed.state, "failed");
  assert.strictEqual(failed.stage, "0.5");
  assert.match(failed.message, /READINESS_FAILED/);
  assert.deepStrictEqual(completionResults, ["failed"]);
  assert.strictEqual(failed.diagnostics.blockerCount, 1);
  failedService.dispose();
  const stagingBase = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-staging-"));
  const stagingVault = path.join(stagingBase, "batch-1", "vault");
  fs.mkdirSync(stagingVault, { recursive: true }); // 旧 manifest 种子路径顺带建仓的语义显式化
  const stagingManifest = path.join(process.env.KB_DATA_DIR, "admission-batches", "batch-1.json");
  fs.mkdirSync(path.dirname(stagingManifest), { recursive: true });
  fs.writeFileSync(stagingManifest, "{}\n");
  const stagingChild = fakeChild();
  let stagingCall = null;
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scripts; // 同上：并发段间重置（主 vault 尚在）
  const stagingService = createPipelineRunService({
    vaultPath: vault,
    archRepo: "/tmp/rebuild",
    stagingBasePath: stagingBase,
    logger: { info() {}, error() {}, warn() {} },
    spawnProcess(command, args, options) { stagingCall = { command, args, options }; return stagingChild; },
  });
  const stagingJob = stagingService.start("full", { purpose: "article_graph_staging", stagingVaultPath: stagingVault, admissionManifestPath: stagingManifest });
  assert.strictEqual(stagingJob.purpose, "article_graph_staging");
  assert.strictEqual(stagingCall.options.env.KB_VAULT, stagingVault);
  assert.ok(stagingCall.args.includes(stagingManifest));
  stagingChild.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  stagingService.dispose();
  fs.rmSync(stagingBase, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });

  // ── Cancel → cancelled 终态（幽灵状态修复：取消后不再卡 cancelling，可再次启动）──
  const cancelVault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-cancel-"));
  const cancelScripts = path.join(cancelVault, "知识库", ".claude", "scripts");
  fs.mkdirSync(cancelScripts, { recursive: true });
  fs.writeFileSync(path.join(cancelScripts, "pipeline-runner.py"), "# fixture\n");
  // 前一 fixture 的临时目录已删，显式开关须重指本 fixture 的 stub 目录（resolver：显式指定完全采信）。
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = cancelScripts;
  fs.mkdirSync(path.join(cancelVault, ".ledger"), { recursive: true });
  fs.writeFileSync(path.join(cancelVault, ".ledger", "pipeline-runs.json"), "[]\n");
  const cancelChild = fakeChild();
  let cancelSpawnCount = 0;
  const cancelService = createPipelineRunService({
    vaultPath: cancelVault,
    archRepo: "/tmp/rebuild",
    logger: { info() {}, error() {}, warn() {} },
    spawnProcess() { cancelSpawnCount += 1; return cancelChild; },
  });
  const cancelJob = cancelService.start("full", { purpose: "global_diagnostic" });
  assert.strictEqual(cancelJob.state, "running");
  const cancelling = cancelService.cancel();
  // 取消已发起：fake 环境下 abort→SIGTERM→close 为同步链，可能已直接到 cancelled；
  // 真实子进程场景为异步（先 cancelling 后 cancelled）。断言取消流程已离开 running 即可。
  assert.ok(cancelling.state === "cancelling" || cancelling.state === "cancelled", "cancel 后必须离开 running（cancelling 或 cancelled）");
  // 若仍是 cancelling（异步场景），触发 close 事件完成取消
  if (cancelService.getStatus().state === "cancelling") {
    cancelChild.emit("close", 143);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const cancelled = cancelService.getStatus();
  assert.strictEqual(cancelled.state, "cancelled", "取消后必须到达 cancelled 终态（不得卡 cancelling）");
  assert.strictEqual(cancelled.exitCode, 143);
  assert.ok(cancelled.finishedAt !== null);
  // cancelled 后可再次启动（同进程不报 PIPELINE_ALREADY_RUNNING）
  const restarted = cancelService.start("full", { purpose: "global_diagnostic" });
  assert.strictEqual(restarted.state, "running");
  assert.strictEqual(cancelSpawnCount, 2, "取消后必须可再次启动（第二次 spawn）");
  cancelService.dispose();
  fs.rmSync(cancelVault, { recursive: true, force: true });

  console.log("Pipeline-Run-Service tests passed: 14 passed, 0 failed");
}

async function runRebuildEntryTest() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-rebuild-"));
  const scripts = path.join(vault, "知识库", ".claude", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "pipeline-runner.py"), "# fixture\n");
  // 主 fixture 的临时目录已删，显式开关重指本 fixture 的 stub 目录。
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = scripts;
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });
  const child = fakeChild();
  const calls = [];
  const service = createPipelineRunService({
    vaultPath: vault,
    archRepo: "/tmp/rebuild",
    logger: createJsonLogger({ sink: () => {} }),
    spawnProcess(command, args, options) { calls.push({ command, args, options }); return child; },
  });
  const started = runWithRequestContext({ traceId: "tr_pipeline-abcdef12" }, () => (
    service.start("full", { purpose: "article_graph", joinExisting: true })
  ));
  assert.strictEqual(started.purpose, "article_graph");
  assert.deepStrictEqual(calls[0].args.slice(1), ["--force"], "重建入口必须真跑全量重建");
  assert.strictEqual(calls[0].options.env.KB_VAULT, vault, "重建直写真实 Vault（非暂存）");
  child.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(vault, { recursive: true, force: true });
  console.log("Pipeline rebuild entry test passed: 1 passed, 0 failed");
}

// WP-049 L3：四段串行执行——并发时共享全局 env（VAULT_RUNTIME_SCRIPTS_DIR／KB_DATA_DIR
// 的 save/restore）存在既有竞态；start() 内新增词表信封物化（同步耗时）会拨宽窗口引爆它
// （run() 在 rebuild 段 rmSync 其 stub 目录后重启 → RUNNER_NOT_FOUND 假红）。串行化后各段
// env 恢复自洽，时序确定。
async function main() {
  await run();
  await runRebuildEntryTest();
  await pr110CwdFallback();
  await pr119ResumeArgs();
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// PR-110 回归：vault 侧旧脚本位（知识库/.claude/scripts）缺席＝新库/迁仓后真库的常态——
// spawn cwd 必须回落 vault 根，不得指向不存在目录（Node 对「cwd 不存在」报 spawn <python> ENOENT，
// 错误信息会把人带偏到解释器路径；runner 自身脚本定位已是绝对候选链，不依赖 cwd）
async function pr110CwdFallback() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-cwd-fallback-"));
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });
  const stubScripts = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-cwd-stub-"));
  fs.writeFileSync(path.join(stubScripts, "pipeline-runner.py"), "# fixture\n");
  const prevScripts = process.env.VAULT_RUNTIME_SCRIPTS_DIR;
  const prevData = process.env.KB_DATA_DIR;
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = stubScripts;
  process.env.KB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-cwd-data-"));
  // 与 run() 同款：readLatestRun 消费 runtime-state store，先种一条历史 run
  const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
  getRuntimeStateStore(vault).pipeline.runsInsert({
    run_ts: "20260716-063858", timestamp: "2026-07-16T06:39:00.451135+00:00", status: "success",
    nodes: 0, connections: 0, components: 0, plates: 0, failed_stage: null, error: null, duration_ms: 1,
  });
  try {
    const child = fakeChild();
    const calls = [];
    const service = createPipelineRunService({
      vaultPath: vault,
      archRepo: "/tmp/rebuild",
      logger: createJsonLogger({ sink: () => {} }),
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child; },
    });
    service.start("full", { purpose: "global_diagnostic" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const spawnCall = calls.find((c) => c.args.some((a) => String(a).includes("pipeline-runner.py")));
    assert.ok(spawnCall, "应已 spawn runner");
    assert.equal(spawnCall.options.cwd, vault, "旧脚本位缺席时 cwd 应回落 vault 根");
    assert.notEqual(spawnCall.options.cwd, path.join(vault, "知识库", ".claude", "scripts"), "不得指向不存在目录（spawn ENOENT 误报源）");
    console.log("pr110-cwd-fallback ok: cwd =", spawnCall.options.cwd);
    child.emit("close", 0); // 收掉 fake 子进程，结束运行态（防测试进程被运行中任务拖住）
  } finally {
    if (prevScripts === undefined) delete process.env.VAULT_RUNTIME_SCRIPTS_DIR; else process.env.VAULT_RUNTIME_SCRIPTS_DIR = prevScripts;
    if (prevData === undefined) delete process.env.KB_DATA_DIR; else process.env.KB_DATA_DIR = prevData;
  }
}


// WP-019（PR-113）回归：resume 模式接线——透传 --resume 且不带 --force；status 透出 lastStage
async function pr119ResumeArgs() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-resume-"));
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });
  const stubScripts = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-resume-stub-"));
  fs.writeFileSync(path.join(stubScripts, "pipeline-runner.py"), "# fixture\n");
  const prevScripts = process.env.VAULT_RUNTIME_SCRIPTS_DIR;
  const prevData = process.env.KB_DATA_DIR;
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = stubScripts;
  process.env.KB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-resume-data-"));
  const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
  getRuntimeStateStore(vault).pipeline.runsInsert({
    run_ts: "20260726-000000", timestamp: "2026-07-26T00:00:00.000Z", status: "failed",
    nodes: 0, connections: 0, components: 0, plates: 0, failed_stage: "3.5", error: "x", duration_ms: 1,
  });
  // 模拟 runner 断点持久化：run_stage 键（load_stage 同形状）
  getRuntimeStateStore(vault).pipeline.statePut("run_stage", { last_stage: "3.5", stage_data: {} });
  try {
    const child = fakeChild();
    const calls = [];
    const service = createPipelineRunService({
      vaultPath: vault,
      archRepo: "/tmp/rebuild",
      logger: createJsonLogger({ sink: () => {} }),
      spawnProcess(command, args, options) { calls.push({ command, args, options }); return child; },
    });
    const statusBefore = service.getStatus();
    assert.equal(statusBefore.lastStage, "3.5", "status 应透出持久化断点阶段");
    service.start("resume", { purpose: "article_graph" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const spawnCall = calls.find((c) => c.args.some((a) => String(a).includes("pipeline-runner.py")));
    assert.ok(spawnCall, "应已 spawn runner");
    assert.ok(spawnCall.args.includes("--resume"), "resume 模式须透传 --resume");
    assert.ok(!spawnCall.args.includes("--force"), "resume 不得带 --force（抽取走增量指纹）");
    assert.ok(!spawnCall.args.includes("--diagnostic"), "resume 属产出支路（非只读诊断）");
    assert.equal(spawnCall.options.cwd, vault, "cwd 回落语义保持（PR-110）");
    child.emit("close", 0);
    console.log("pr119-resume-args ok");
  } finally {
    if (prevScripts === undefined) delete process.env.VAULT_RUNTIME_SCRIPTS_DIR; else process.env.VAULT_RUNTIME_SCRIPTS_DIR = prevScripts;
    if (prevData === undefined) delete process.env.KB_DATA_DIR; else process.env.KB_DATA_DIR = prevData;
  }
}

