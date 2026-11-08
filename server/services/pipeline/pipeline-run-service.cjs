// Component: Pipeline-Run-Service — one-at-a-time application job for Vault projection.
// @responsible: 串行启动、监控和取消 Vault pipeline-runner 作业。
// @inputs: Vault 路径、架构仓库路径与管道控制命令
// @outputs: 作业状态、截断日志与退出结果
// @context: Pipeline
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { createPythonBridge } = require("./python-bridge.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs"); // SPEC-012 WP-A
const { createTraceId, getTraceId, runWithRequestContext } = require("../../shared/request-context.cjs");
// PR-016 方案甲二期：运行时脚本路径解析单点（仓内 scripts/vault-runtime 优先，vault 旧位回退）。
const { resolveVaultRuntimeScript } = require("../../shared/vault-runtime-resolver.cjs");
const { materializeVocabEnvelope } = require("../../shared/vocab-envelope-materializer.cjs"); // WP-049 L3：转 running 前的 fail-closed 物化闸（env 注入本体经 WP-069 唯一拉起模块）
const { buildVaultRuntimeEnv } = require("../../shared/vault-runtime-spawn.cjs"); // WP-069 §3.1：唯一拉起点
const { resolveDataDir } = require("../../shared/persistence/data-dir.cjs"); // WP-069 ⑦面：KB_DATA_DIR 消费走登记解析器

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);
const MAX_LOG_LINES = 120;

const VALID_STATES = ["idle", "running", "cancelling", "cancelled", "succeeded", "failed"];
const VALID_PURPOSES = new Set(["global_diagnostic", "article_graph", "article_graph_staging"]);
const TRANSITIONS = {
  idle:       ["running"],
  running:    ["succeeded", "failed", "cancelling"],
  cancelling: ["cancelled"],
  cancelled:  ["running"],
  succeeded:  ["running"],
  failed:     ["running"],
};

function createPipelineRunService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const archRepo = path.resolve(options.archRepo);
  const logger = options.logger;
  const stagingBasePath = options.stagingBasePath ? path.resolve(options.stagingBasePath) : null;
  // ADR-002 §4 / W2-WP3：子进程 plumbing 统一走 python-bridge（唯一消费者），
  // 解释器解析单点 = shared/python-path.cjs（bridge 内部经 resolvePythonPath）。
  // options.spawnProcess / options.pythonPath 仅为测试注入口，透传 bridge。
  const spawnProcess = options.spawnProcess || null;
  // 工厂级注入口（注意 start() 有同名局部 options 遮蔽——须在此捕获）
  const pythonPathOption = options.pythonPath || undefined;
  const timeoutMs = options.timeoutMs || 10 * 60 * 1000;
  let activeChild = null;
  let abortController = null;
  let timeout = null;
  let job = idleJob();
  let failureStage = null;
  let failureMessage = null;
  const postRunHooks = [];
  const completionHooks = [];

  function readLatestRun() {
    // SPEC-012 WP-A：run 摘要迁 runtime-state.db（Python 写 Node 读，跨进程 WAL）
    try {
      const raw = getRuntimeStateStore(vaultPath).pipeline.runsLatest();
      if (!raw || typeof raw !== "object") return null;
      if (typeof raw.run_ts !== "string" || typeof raw.timestamp !== "string") return null;
      if (raw.status !== "success" && raw.status !== "failed") return null;
      const numericFields = ["nodes", "connections", "components", "plates", "duration_ms"];
      if (numericFields.some((field) => !Number.isInteger(raw[field]) || raw[field] < 0)) return null;
      if (raw.failed_stage !== null && typeof raw.failed_stage !== "string") return null;
      if (raw.error !== null && typeof raw.error !== "string") return null;
      return {
        runTs: raw.run_ts,
        timestamp: raw.timestamp,
        status: raw.status,
        nodes: raw.nodes,
        connections: raw.connections,
        components: raw.components,
        plates: raw.plates,
        failedStage: raw.failed_stage,
        error: raw.error,
        durationMs: raw.duration_ms,
      };
    } catch (_error) {
      return null;
    }
  }

  function snapshot() {
    // WP-019（PR-113）：透出上次断点阶段（runner 每阶段 save_stage 落 run_stage 键；无恢复点=null）
    let lastStage = null;
    try {
      const runStage = getRuntimeStateStore(vaultPath).pipeline.stateGet("run_stage");
      if (runStage && typeof runStage.last_stage !== "undefined") lastStage = runStage.last_stage;
    } catch (_error) { lastStage = null; }
    return {
      lastStage,
      state: job.state,
      jobId: job.jobId,
      mode: job.mode,
      purpose: job.purpose,
      stage: job.stage,
      message: job.message,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      logs: job.logs.slice(),
      lastRun: readLatestRun(),
      diagnostics: job.diagnostics,
    };
  }

  function transition(newState) {
    var allowed = TRANSITIONS[job.state];
    if (!allowed || allowed.indexOf(newState) < 0) {
      var error = new Error("非法状态转换: " + job.state + " -> " + newState);
      error.code = "ILLEGAL_TRANSITION";
      throw error;
    }
    job.state = newState;
  }

  function start(mode, options = {}) {
    options = options || {};
    // WP-019（PR-113）：resume＝断点续跑——透传 --resume 给 runner（其按持久化 last_stage 定起点；
    // FORCE_EXTRACT 不开＝抽取走 --incremental 指纹跳过）。机制 runner 侧一直在，本批接通 Node 消费面。
    var normalizedMode = mode === "quick" ? "quick" : (mode === "resume" ? "resume" : "full");
    const purpose = options.purpose || (options.admissionManifestPath ? "article_graph" : "global_diagnostic");
    if (!VALID_PURPOSES.has(purpose)) {
      const error = new Error("管道任务用途非法");
      error.code = "INVALID_PIPELINE_PURPOSE";
      throw error;
    }
    if (job.state === "running" || job.state === "cancelling") {
      if (options.joinExisting === true && job.purpose === purpose) return snapshot();
      var error = new Error("Pipeline 已在运行");
      error.code = "PIPELINE_ALREADY_RUNNING";
      throw error;
    }

    // PR-016 方案甲：runner 经解析单点定位（仓内 scripts/vault-runtime 优先，vault 旧位回退）。
    // 注意：cwd 仍取 vault 侧 scriptsDir——runner 编排的 B 类脚本（extract_graph/infer-*/...）
    // 物理留在数据仓（所有权表 B 类），按 SCRIPTS_DIR 相对路径查找；仓内 runner→vault 编排生态。
    // PR-110：vault 侧旧脚本位在迁仓后的新库/真库均不存在；Node 的 spawn 对「cwd 不存在」同样报 spawn <python> ENOENT，
    // 会把人带偏到解释器路径。runner 自身的 B/C 类脚本定位已是绝对候选链（不依赖 cwd），故旧位缺席时回落 vault 根；
    // 不在用户库里替它建目录（Vault 只收内容，脚本位已退役——ADR-011）。
    const legacyScriptsDir = path.join(vaultPath, "知识库", ".claude", "scripts");
    const scriptsDir = fs.existsSync(legacyScriptsDir) ? legacyScriptsDir : vaultPath;
    const runnerPath = resolveVaultRuntimeScript("pipeline-runner.py", { vaultPath });
    if (!fs.existsSync(runnerPath)) {
      const error = new Error("pipeline-runner.py 不存在");
      error.code = "PIPELINE_RUNNER_NOT_FOUND";
      throw error;
    }

    const stagingVaultPath = resolveStagingVaultPath(options.stagingVaultPath, purpose);
    const executionVaultPath = stagingVaultPath || vaultPath;
    const admissionManifestPath = resolveAdmissionManifestPath(options.admissionManifestPath, executionVaultPath);
    // WP-049 L3（ADR-016 §四-2「装载收进同一宿主」）：词表信封在拉起前物化——Node 装载入口
    // 产出五件词表类型化载荷写入执行库运行时槽，路径经 VOCAB_ENVELOPE_PATH 下发；runner 及其
    // Stage 子进程经 env 继承全链消费，Python 侧零词表文件读取。装载失败在此 fail-closed
    // （transition 前抛出，不产生 running 幽灵态）。
    const vocabEnvelopePath = materializeVocabEnvelope(executionVaultPath);
    const args = [];
    if (purpose === "global_diagnostic") args.push("--diagnostic");
    else if (normalizedMode === "resume") args.push("--resume"); // WP-019：产出支路断点续跑（rebuild 入口）；与只读诊断互斥
    else if (normalizedMode === "full") args.push("--force");
    if (admissionManifestPath) args.push("--article-admission-manifest", admissionManifestPath);
    transition("running");
    failureStage = null;
    failureMessage = null;
    job = {
      state: "running",
      jobId: randomUUID(),
      mode: normalizedMode,
      purpose,
      stage: "starting",
      message: "Pipeline 正在启动",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      traceId: getTraceId() || createTraceId(),
      logs: [],
      diagnostics: null,
    };

    // W2-WP3：异步流式子进程统一经 python-bridge（结构化行解析 + AbortSignal + 超时护栏）。
    // 等价保持：日志行仍走 appendLog（含失败语义正则）；取消/超时经 AbortSignal SIGTERM；
    // spawn 失败（如解释器不存在）经 bridge reject → 可见失败（H3 fail-closed，W1 测试继续覆盖）。
    abortController = new AbortController();
    const bridge = createPythonBridge({
      pythonPath: pythonPathOption,
      cwd: scriptsDir,
      // WP-069 §3.1：env 全集经唯一构造器（信封随构造二次物化——与 153 行闸同源幂等，spawn 时点更新鲜）
      env: buildVaultRuntimeEnv({
        vaultPath: executionVaultPath,
        archRepo,
        vocabEnvelope: true, // WP-049 L3：词表信封——Stage 子进程经 env 继承
        docEnvelope: true, // WP-117 批2／SPEC-084 §二.2：文档信封随拉起物化——extract_graph 文档面经信封供给（Stage 子进程经 env 继承）
        extraEnv: { API_PORT: process.env.API_PORT || "18083" }, // PR-133：发起方端口下发——runner Stage 0 只验发起方，不扫邻居（防跨服务假验证）
      }),
      // bridge 自带超时作兜底护栏（晚于本服务自身的超时 finish，防僵尸进程），不承担语义
      timeoutMs: timeoutMs + 30_000,
      logger,
      spawnProcess: spawnProcess || undefined,
    });
    bridge.spawn(runnerPath, args, {
      onLog: (entry) => appendLog(entry.message, entry.source),
      signal: abortController.signal,
    }).then((result) => {
      const code = result.exitCode;
      void finish(code === 0, code, code === 0 ? "Pipeline 执行完成" : (failureMessage || `Pipeline 退出码 ${code}`));
    }).catch((error) => {
      void finish(false, null, error.message);
    });
    timeout = setTimeout(() => {
      if (abortController) abortController.abort();
      void finish(false, null, "Pipeline 执行超时");
    }, timeoutMs);

    logger.info({
      subsystem: "pipeline",
      event: "pipeline-started",
      trace_id: job.traceId,
      job_id: job.jobId,
      mode: normalizedMode,
      purpose,
      admissionManifestPath,
      executionVaultPath,
    });
    return snapshot();
  }

  function resolveStagingVaultPath(value, purpose) {
    if (purpose !== "article_graph_staging") {
      if (value !== undefined && value !== null) {
        const error = new Error("只有暂存计算可以指定隔离 Vault");
        error.code = "INVALID_STAGING_VAULT";
        throw error;
      }
      return null;
    }
    if (!stagingBasePath || typeof value !== "string" || !value.trim()) {
      const error = new Error("暂存计算缺少隔离 Vault");
      error.code = "INVALID_STAGING_VAULT";
      throw error;
    }
    const resolved = path.resolve(value);
    if (!resolved.startsWith(stagingBasePath + path.sep) || !fs.existsSync(resolved)) {
      const error = new Error("隔离 Vault 不存在或超出允许目录");
      error.code = "INVALID_STAGING_VAULT";
      throw error;
    }
    return resolved;
  }

  function resolveAdmissionManifestPath(value, executionVaultPath) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !value.trim()) {
      const error = new Error("文章准入清单路径非法");
      error.code = "INVALID_ADMISSION_MANIFEST";
      throw error;
    }
    // SPEC-012 wave-2/F3：准入清单暂存迁 repo 侧 data/admission-batches（B 类 loader 同步迁）
    const directory = path.join(resolveDataDir(), "admission-batches"); // WP-069 ⑦面：经登记解析器（data-dir 单源），不点名读作用域变量
    const resolvedDirectory = path.resolve(directory);
    const resolvedPath = path.resolve(value);
    if (!resolvedPath.startsWith(resolvedDirectory + path.sep) || path.extname(resolvedPath) !== ".json" || !fs.existsSync(resolvedPath)) {
      const error = new Error("文章准入清单不存在或超出允许目录");
      error.code = "INVALID_ADMISSION_MANIFEST";
      throw error;
    }
    return resolvedPath;
  }

  function appendLog(rawLine, source) {
    const line = rawLine.trim().replace(/\u001b\[[0-9;]*m/g, "");
    if (!line) return;
    const failureMatch = line.match(/管道中断.*Stage\s+([0-9.]+)\s+失败:\s*(.+)$/);
    if (failureMatch) {
      failureStage = failureMatch[1];
      failureMessage = failureMatch[2].slice(0, 240);
      job.stage = failureStage;
      job.message = failureMessage;
    } else if (!failureStage) {
      const stageMatch = line.match(/^Stage\s+([0-9.]+):/);
      if (stageMatch) job.stage = stageMatch[1];
      job.message = line.slice(0, 240);
    }
    job.logs.push({ source, message: line.slice(0, 240) });
    if (job.logs.length > MAX_LOG_LINES) job.logs.shift();
    logger[source === "stderr" ? "warn" : "info"]({
      subsystem: "pipeline",
      event: "pipeline.output",
      trace_id: job.traceId,
      job_id: job.jobId,
      stage: job.stage,
      source,
      message: line,
    });
  }

  let finishInFlight = false; // W2 红队 advisory 修复：防 finish 二次调用竞态（首调 completionHooks await 挂起期间，bridge close 二调会穿透 TERMINAL_STATES 检查——state 仍非终态）

  async function finishInContext(success, exitCode, message) {
    if (TERMINAL_STATES.has(job.state)) return;
    if (finishInFlight) return; // 二次调用（超时/ENOENT 与 bridge close 竞态）：首调已在途，丢弃
    finishInFlight = true;
    try {
      await finishBody(success, exitCode, message);
    } finally {
      finishInFlight = false;
    }
  }

  async function finishBody(success, exitCode, message) {
    if (job.state === "cancelling") {
      // 取消流程完成：abort 已 SIGTERM 子进程，close 事件触发本路径。
      // 写入 cancelled 终态（TRANSITIONS 声明 cancelling→cancelled，此前无实现点——
      // 取消后卡 cancelling 且同进程不可重启，属幽灵状态修复）。
      // 取消不刷新派生索引、不跑诊断 reconcile（管道未完成），仅记录终态。
      if (timeout) clearTimeout(timeout);
      timeout = null;
      activeChild = null;
      abortController = null;
      job.finishedAt = new Date().toISOString();
      job.exitCode = exitCode ?? 130;
      job.message = message || "Pipeline 已取消";
      transition("cancelled");
      logger.info({
        event: "pipeline-cancelled",
        trace_id: job.traceId,
        job_id: job.jobId,
        exitCode: job.exitCode,
        message: job.message,
      });
      return;
    }
    if (timeout) clearTimeout(timeout);
    timeout = null;
    activeChild = null;
    abortController = null;

    if (success && postRunHooks.length > 0) {
      job.stage = "post-actions";
      job.message = "Pipeline 完成，正在刷新派生索引";
      for (const hook of postRunHooks) {
        try {
          await hook(snapshot());
        } catch (error) {
          logger.warn({ event: "pipeline-post-action-failed", trace_id: job.traceId, job_id: job.jobId, error: error.message });
          job.logs.push({ source: "post-action", message: `后置动作失败: ${error.message}` });
        }
      }
    }

    const terminalState = success ? "succeeded" : "failed";
    const terminalStage = success ? "complete" : job.stage;
    job.stage = success ? "reconciling" : job.stage;
    job.message = success ? "Pipeline 完成，正在更新待处理问题" : message;
    job.finishedAt = new Date().toISOString();
    job.exitCode = exitCode;
    for (const hook of completionHooks) {
      try {
        const result = await hook({ ...snapshot(), state: terminalState, stage: terminalStage, message });
        if (result && typeof result === "object" && !Array.isArray(result)) job.diagnostics = result;
      } catch (error) {
        logger.warn({ event: "pipeline-completion-action-failed", trace_id: job.traceId, job_id: job.jobId, error: error.message });
        job.logs.push({ source: "post-action", message: `诊断结果刷新失败: ${error.message}` });
        job.diagnostics = {
          status: "failed",
          generatedAt: new Date().toISOString(),
          blockerCount: 1,
          verifiedCount: 0,
          issueIds: [],
          message: error.message,
        };
      }
    }
    transition(terminalState);
    job.stage = terminalStage;
    job.message = success ? (job.logs.some((line) => line.source === "post-action") ? "Pipeline 完成，但刷新存在失败" : message) : message;
    logger[success ? "info" : "error"]({
      event: success ? "pipeline-succeeded" : "pipeline-failed",
      trace_id: job.traceId,
      job_id: job.jobId,
      exitCode,
      message,
    });
  }

  function finish(success, exitCode, message) {
    const traceId = job.traceId || createTraceId();
    return runWithRequestContext({ traceId }, () => finishInContext(success, exitCode, message));
  }

  function addPostRunHook(hook) {
    if (typeof hook !== "function") throw new TypeError("Pipeline 后置动作必须是函数");
    postRunHooks.push(hook);
    return () => {
      const index = postRunHooks.indexOf(hook);
      if (index >= 0) postRunHooks.splice(index, 1);
    };
  }

  function addCompletionHook(hook) {
    if (typeof hook !== "function") throw new TypeError("管道完成动作必须是函数");
    completionHooks.push(hook);
    return () => {
      const index = completionHooks.indexOf(hook);
      if (index >= 0) completionHooks.splice(index, 1);
    };
  }

  function startDiagnostic(mode = "full") {
    return start(mode, { purpose: "global_diagnostic", joinExisting: true });
  }

  function cancel() {
    // 幂等守卫：已在取消流程中，直接返回当前状态
    if (job.state === "cancelling") return snapshot();
    if (job.state !== "running") {
      var error = new Error("没有正在运行的 Pipeline");
      error.code = "PIPELINE_NOT_RUNNING";
      throw error;
    }
    transition("cancelling");
    job.message = "正在取消...";
    logger.info({ event: "pipeline-cancelling", trace_id: getTraceId() || job.traceId, job_id: job.jobId });
    if (abortController) abortController.abort();
    return snapshot();
  }

  function dispose() {
    if (timeout) clearTimeout(timeout);
    // 子进程 kill 经 AbortSignal 由 bridge 执行（W2-WP3 后本服务不再持有子进程句柄）
    if (abortController) abortController.abort();
    timeout = null;
    abortController = null;
  }

  return { start, startDiagnostic, cancel, getStatus: snapshot, dispose, addPostRunHook, addCompletionHook };
}

function idleJob() {
  return {
    state: "idle",
    jobId: null,
    mode: null,
    purpose: null,
    stage: null,
    message: "Pipeline 尚未运行",
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    traceId: null,
    logs: [],
    lastRun: null,
    diagnostics: null,
  };
}

module.exports = { createPipelineRunService };
