// Component: API-Server — standalone HTTP server for rebuild project.
// @responsible: 启动本地 HTTP API，装配 Vault 数据读取器与业务路由。
// @inputs: Vault 派生产物、环境变量与 HTTP 请求
// @outputs: /api/* HTTP 响应与结构化日志
// @context: Canvas
// All frontend routes are owned locally; unknown routes return an explicit 404.
const path = require("path");
const { loadEnv } = require("./shared/env-load.cjs");
loadEnv(path.resolve(__dirname, ".."));

const fs = require("fs");
const os = require("os");
const { sendJSON } = require("./shared/api-envelope.cjs");
const { logger, httpLogger } = require("./shared/json-logger.cjs");
// PR-085 第 1 步：传输层换 Fastify——route-dispatch（错误隔离）／route-pattern（线性匹配）随框架退役
const { requestSpan } = require("./shared/langfuse-tracer.cjs");
const { createHttpApp } = require("./shared/http-app.cjs");
const { createPipelineRunService } = require("./services/pipeline/pipeline-run-service.cjs");
const { computeVaultId } = require("./shared/vault-id.cjs");
const { getVersionsFilePath } = require("./vault-paths.cjs");
const { createArticleManifestService } = require("./services/article-workflow/article-manifest-service.cjs");
const { createArticleWorkflowService } = require("./services/article-workflow/article-workflow-service.cjs");
const { createDraftDropAutomation } = require("./services/article-workflow/draft-drop-automation.cjs");
const { registerApprovalStateMachine } = require("./services/release-governance/approval-state-machine-assembly.cjs");
const { buildGraphRelationCtx } = require("./services/projection/graph-relation-ctx.cjs");
const { createLocalOperatorContext } = require("./services/governance/local-operator-context.cjs");
// PR-085 第 2 步（ADR-010 决策 6/7）：身份层——AUTH_MODE=local（缺省，现状）| oidc；缺配置启动即错，不回落
const { createAuthFromEnv } = require("./shared/auth/index.cjs");
const { createObsidianOpenService } = require("./services/pipeline/obsidian-open-service.cjs");
// SPEC-011-W11 WP5·403：写者来源校验（未在 domain-registry writers 登记 → 403）
const { createWriterGate } = require("./shared/writer-gate.cjs");
// SPEC-011-W11 WP3：Obsidian/外部写入监听（watcher 装配失败只告警不阻断启动）
const { createVaultWatcherService } = require("./services/governance/vault-watcher-service.cjs");

const PORT = parseInt(process.env.API_PORT || "18083", 10);
const HOST = process.env.API_HOST || "127.0.0.1";
let vaultPath = process.env.VAULT_PATH || "";
if (!vaultPath) {
  console.error("FATAL: VAULT_PATH environment variable is required but not set.");
  process.exit(1);
}
const stagingBasePath = path.join(os.tmpdir(), "anyshare-article-graph-staging", computeVaultId(vaultPath));
const auth = createAuthFromEnv(process.env);
logger.info({ subsystem: "auth", event: "auth-layer-configured", ...auth.describe() });
// operator-context 自第 2 步起从请求上下文 Principal 读身份（5 个消费点签名不变）
const localOperatorContext = createLocalOperatorContext({ mode: auth.mode });
const architectIdentities = new Set(["local-architect"]);
// SPEC-011-W11 WP5·403：写者校验中间件（写方法 + 非健康/只读端点 → 校验 operator 在 domain-registry）
const writerGate = createWriterGate({
  operatorContext: localOperatorContext,
  archRepoPath: path.resolve(__dirname, ".."),
  logger,
});
// SPEC-010-W10 WP2/WP3：vault git 落账器（审批状态机/管线收尾/schema 写服务共用同一实例）
const vaultGitLedger = require("./services/governance/vault-git-ledger.cjs").createVaultGitLedger({ vaultPath, logger });
// SPEC-011-W11 WP0 + PR-055/PR-057：vault 唯一写通道（boot 漂移修复扫 + SIGTERM 有序排水 + 观测域健康写）
const { initVaultIO, recoverBootDrift, registerShutdownHandlers, onVaultWrite } = require("./shared/vault-io.cjs");
const vaultIO = initVaultIO({ vaultPath, gitLedger: vaultGitLedger, logger }); // PR-057：模块级缺省通道同步激活（函数式服务模块经 writeVault 取用）
// WP-048 Wave 1（ADR-014 §6.1）：动作注册快照＋统一执行工厂——必须在路由注册之前装配
// （快照供 preHandler 角色门与工厂动作查找同源同 revision；首次构建失败＝boot fail-closed）。
const { initActionRegistry } = require("./shared/action-registry.cjs");
const { initActionFactory } = require("./shared/action-execution-factory.cjs");
initActionRegistry({ vaultPath, logger });
initActionFactory({ vaultPath, logger });
// boot 漂移修复扫：启动时扫 vault 工作区 vs git HEAD，有变更补 recovery: 提交（crash window 兜底）
// PR-056：listen 前 await 完成（SPEC-011 WP0「flush 确保在 server 开始处理请求前落账」的顺序兑现）
const bootDriftReady = recoverBootDrift(vaultPath, vaultGitLedger, logger).catch(() => {}); // 失败只告警不阻断启动
// SPEC-011 §三·附 修订（2026-10-20）：启动期运行时事实源守卫退役——其前提（cheeseh-runtime 中转树）已于
// PR-044③（8f14fcee）放宽为「任一本仓克隆」，树不存在时守卫恒报 synced=true 属 fail-open 假绿；校验面由 check:schema-writers 面⑤承担。
// SIGTERM/SIGINT 有序退出：等待在途 ledger 批次落账后再退出（防 git index 半提交）
registerShutdownHandlers(vaultGitLedger, logger);
// SPEC-012 WP-C：持久层 derived-index.db ＋②类同步器骨架（boot 全量重建＝停跑盲区兜底；
// 通道挂钩事件＝内部写增量；watcher external: 桥接＝外部写增量。fail-open：重建失败只告警不阻断 listen）
// SPEC-012 wave-2：库级迁移属主收口 derived-index-store（同步器与 article-manifests 共用同一 store）
const { dataDbPath } = require("./shared/persistence/data-dir.cjs");
const { openPersistenceDb } = require("./shared/persistence/sqlite-adapter.cjs");
const { createDerivedIndexSynchronizer } = require("./services/projection/derived-index-synchronizer.cjs");
const { initDerivedIndexStore, getDerivedIndexStore } = require("./shared/persistence/derived-index-store.cjs");
// SPEC-012 wave-2 图族：master_graph/extract_manifest 真身迁 derived-index.db（boot/管线完成钩
// 双点摄取 data/staging；vault .ledger 图投影停读停写）
const { ingestStagedGraphArtifacts, readGraphArtifactText } = require("./shared/persistence/graph-artifact-ingest.cjs");
const derivedIndexDb = openPersistenceDb({ path: dataDbPath("derived-index.db") });
const derivedIndexStore = initDerivedIndexStore(derivedIndexDb);
const graphDataDir = path.dirname(dataDbPath("derived-index.db")); // staging/ 与 master_graph.db 同住持久层根
// EDGE-RELATION-GOV-001（ADR-012/SPEC-026 §五）②类 edge 投影：图族入行后重建行级两表——boot 摄取/
// 存量导入补摄取/管线完成钩三点共用本包装，摄取后重建（staging 空 no-op 时也对既有行重建，保一致）。
// setVaultPath 提前（幂等 setter，后文装配点同参再设无害）保证 boot 首次重建时图读取（含审批账本合并）就绪。
const masterGraphServiceForProjection = require("./services/projection/master-graph-service.cjs");
masterGraphServiceForProjection.setVaultPath(vaultPath);
const { createEdgeProjectionService } = require("./services/projection/edge-projection-service.cjs");
// 对象本体批（ADR-012 D1）：治理关系并源装载——relations.yaml 实例＋字典对象（宽容读，写侧严格）
const { loadGovernanceRelations } = require("./shared/relations-source.cjs");
// PR-109 缺口②：投影值域对账键集——relationTypeNames 为注册表读法单一事实源（写闸门与投影共用）
const { relationTypeNames } = require("./services/schema-manager/relations-write-service.cjs");
const edgeProjectionService = createEdgeProjectionService({
  store: derivedIndexStore,
  readGraph: masterGraphServiceForProjection.readMasterGraph,
  readRelations: () => loadGovernanceRelations({ vaultPath, logger }),
  listRelationTypes: () => relationTypeNames(vaultPath),
  logger,
});
const ingestGraphStaging = () => {
  const ingested = ingestStagedGraphArtifacts({ dataDir: graphDataDir, store: derivedIndexStore, logger });
  try { edgeProjectionService.rebuild(); } catch (e) { logger.warn({ event: "edge-projection-rebuild-failed-at-ingest", error: e.message }); } // fail-open：投影失败只告警不阻断图族摄取
  return ingested;
};
ingestGraphStaging(); // boot 摄取（derivedIndexDb init 后、manifests boot rebuild 前；staging 空时 no-op）
const derivedIndexSync = createDerivedIndexSynchronizer({ vaultPath, logger });
// 图漂移自动刷新（2026-10-15 Master 裁「图族刷新收敛」）：外部写/读时检测源指纹漂移→去抖后
// 自动触发全量管线重算＋孤儿 manifest 清行。pipeline 经惰性适配器引用（pipelineRunService 在后装配，
// 事件/钩子触发时早已就绪）；GRAPH_DRIFT_REFRESH=0 可整体停用。
let pipelineRunServiceRef = null;
const { createGraphDriftRefresher } = require("./services/projection/graph-drift-refresher.cjs");
const graphDriftRefresher = createGraphDriftRefresher({
  vaultPath,
  store: derivedIndexStore,
  pipeline: {
    start: (mode, options) => pipelineRunServiceRef.start(mode, options),
    getStatus: () => pipelineRunServiceRef.getStatus(),
  },
  logger,
});
const derivedIndexReady = Promise.resolve()
  .then(() => derivedIndexSync.rebuildAll())
  .catch((e) => logger.warn({ event: "derived-index-boot-failed", error: e.message }));
const unsubscribeVaultWrite = onVaultWrite((record) => derivedIndexSync.onChannelWrite(record));
// SPEC-012 WP-A：③类运行时状态库——审批/工作流/治理/人裁/推理冲突/期望边/锁（store 层单源取用）
const { initRuntimeStateStore } = require("./shared/persistence/runtime-state-store.cjs");
const { createStateJournal, replayStateJournal } = require("./shared/persistence/state-journal.cjs");
const runtimeStateDb = openPersistenceDb({ path: dataDbPath("runtime-state.db") });
// SPEC-012 F2：③类耐久性流水——store 写事务后追加⑤类 jsonl（vault git 备份），boot 按水位重放
const stateJournal = createStateJournal(vaultPath, { gitLedger: vaultGitLedger });
const runtimeStateStore = initRuntimeStateStore(runtimeStateDb, { journal: stateJournal });
const stateJournalReplayReady = Promise.resolve()
  .then(() => replayStateJournal({ vaultPath, store: runtimeStateStore, logger }))
  .catch((e) => logger.warn({ event: "state-journal-replay-failed", error: e.message }));
// boot 一次性迁移：vault .ledger 存量③类 json 导入库（幂等；导入后旧文件改名 .migrated 人裁删）
const { importLegacyRuntimeState } = require("./shared/persistence/runtime-state-import.cjs");
const runtimeStateImportReady = Promise.resolve()
  .then(() => importLegacyRuntimeState({
    vaultPath, store: runtimeStateStore, derivedIndexStore, gitLedger: vaultGitLedger, logger, dataDir: path.dirname(dataDbPath("runtime-state.db")),
  }))
  .catch((e) => logger.warn({ event: "runtime-state-import-boot-failed", error: e.message }));
// SPEC-012 wave-2 图族：存量 vault 图文件导入（②类迁移）完成后再摄取一次 staging——升级窗口
// 下 vault 旧图与新 Python 写的 staging 并存时，staging（较新）胜出，不覆盖成旧图
const graphIngestReady = runtimeStateImportReady.then(ingestGraphStaging);
// SPEC-012 WP-B：④类遥测库（watcher/reconcile/enums 三痕迹 + reconcile 心跳；/api/health 消费）
const { initTelemetryStore, TRACE_KINDS, getTelemetryStore } = require("./shared/persistence/telemetry-store.cjs");
const telemetryDb = openPersistenceDb({ path: dataDbPath("telemetry.db") });
initTelemetryStore(telemetryDb);
// boot 清理：vault .ledger/health 存量痕迹导入 telemetry.db 后移除（④类可丢弃，导入保留 PR-052 复核历史）
const { importLegacyTelemetry } = require("./shared/persistence/telemetry-import.cjs");
const telemetryImportReady = Promise.resolve()
  .then(() => importLegacyTelemetry({ vaultPath, gitLedger: vaultGitLedger, logger }))
  .catch((e) => logger.warn({ event: "telemetry-import-boot-failed", error: e.message }));
// SPEC-025 C2（W1b，ADR-011 D2）：管线触发收敛——boot 检查 due（阈值 1 篇/1 天）→ due 即自动抽取
// （--incremental 指纹增量；D3 降级容忍）；规则发布永不自动（D6 人 gate）。fail-open：失败只告警不阻断 boot。
const { createPipelineDueService } = require("./services/projection/pipeline-due-service.cjs");
const pipelineDue = createPipelineDueService({
  logger,
  telemetry: getTelemetryStore(vaultPath),
  // PR-134＋WP-069 §3.1：vaultPath 语义锚——KB_VAULT/KB_DATA_DIR 等环境全集由
  // 唯一拉起模块（vault-runtime-spawn）组装，装配点零自拼 env
  vaultPath,
  // 抽取成功即运行时摄取＋记图族刷新基线——与下方 pipelineRunService post-run hook 同源闭包同款配对
  ingestStagedGraph: ingestGraphStaging,
  recordGraphRefreshed: () => graphDriftRefresher.recordRefreshed(),
});
pipelineDue.runIfDue(); // fire-and-forget（boot 兜底；服务运行期由 watcher 计数驱动下一轮）
// WP-027（PR-142，Master 2026-10-28 裁「要」）：schema 图输入写→图谱自动跟随——去抖调度器。
// 双缝汇入：①服务回调（schema-write-service/fields-write-service 成功后 onGraphInputWrite）
// ②watcher 桥（知识库/TheSchema 四件写事件，不分内外部写）；静默窗后 freshness 复核，未最新即经
// pipelineDue.runNow 执行**真实增量抽取＋摄取**（due 同款配对——勿走 global_diagnostic 只读诊断，红队证伪）。
// 每窗 due 计数 +1（重启丢窗兜底，runNow 成功 mark-run 消化）。fail-open 不阻断写路径。
const { createSchemaGraphRefreshScheduler } = require("./services/projection/schema-graph-refresh-scheduler.cjs");
const { computeGraphFreshness } = require("./services/projection/schema-graph-freshness.cjs");
const schemaGraphRefreshScheduler = createSchemaGraphRefreshScheduler({
  logger,
  telemetry: getTelemetryStore(vaultPath),
  computeFreshness: () => computeGraphFreshness({ vaultPath, dataDir: graphDataDir }),
  runRefresh: () => pipelineDue.runNow("schema-graph-refresh"),
  pipelineDue,
});
// PR-109 缺口①：校验执法活性——boot 期对真 TheSchema 全量跑既有校验器（断线/悬空引用可见化；
// 观测不拦截——违例落 telemetry trace〔schema-selfcheck-run〕＋结构化 warn，不阻断启动）
const { runSchemaBootSelfCheck } = require("./services/schema-manager/schema-boot-selfcheck.cjs");
// PR-156 刀二：自检结果留驻——/api/health 暴露（此前只落日志 warn，前端/巡检完全无感——
// 矩阵漂移攒到无关保存才爆的教训：违例必须在可查询面上可见）
let schemaSelfcheckSummary = null;
const schemaSelfcheckReady = Promise.resolve()
  .then(() => runSchemaBootSelfCheck({ vaultPath, logger, telemetry: getTelemetryStore(vaultPath) }))
  .then((summary) => { schemaSelfcheckSummary = summary; return summary; })
  .catch((e) => logger.warn({ event: "schema-selfcheck-boot-failed", error: e.message }));
// SPEC-011-W11 WP3：vault 文件监听服务（Obsidian/外部写入 → external: 账，装配失败只告警不阻断启动）
// WP-041：投放自动链消费者占位——监听先起、服务后建（同一 boot tick 内完成注入，事件到达时必已就位）
let draftDropAutomation = null;
const vaultWatcher = createVaultWatcherService({
    vaultPath, gitLedger: vaultGitLedger, vaultIO, logger,
    // WP-156 必修修复（红队⑤）：实时面词表提供者真实装配——与查询面 health 读模型同源
    // （compliance-rule-set-service 经词表装载端口），函数形态每次校验现取（词表热更即新值）。
    ruleSet: () => require("./services/schema-manager/compliance-rule-set-service.cjs").loadRuleSetForVault(vaultPath),
  onExternalWrite: (paths) => {
    derivedIndexSync.notifyExternalWrite(paths); // SPEC-012 WP-C 外部写桥接（枚举试点家族）
    graphDriftRefresher.noteExternalActivity(paths); // 图族漂移自动刷新（知识库/ 域内事件，去抖合并）
    pipelineDue.noteExternalWrite(); // SPEC-025 C2（W1b）：外部写计数 +1（1 篇即 due，Master 2026-10-23 阈值）
    if (draftDropAutomation) void draftDropAutomation.onExternalWrite(paths); // WP-041：投稿投放自动校验＋提升（装配于 articleWorkflowService 之后注入）
  },
  // WP-027（PR-142）：图输入 schema 写事件桥（内部写早退于 onExternalWrite，本桥独立于归属判定）
  onSchemaInputWrite: (paths) => {
    const first = paths && paths[0] ? path.basename(paths[0], ".yaml") : null;
    schemaGraphRefreshScheduler.notify({ category: first, source: "watcher" });
  },
});
try { vaultWatcher.start(); } catch (e) { logger.warn({ event: "vault-watcher-start-failed-at-boot", error: e.message }); }
// SPEC-011-W11 WP4：运行时周期对账——双层漂移判定（5 分钟周期，main.cjs 顶层注册）
const { createVaultReconcileService } = require("./services/governance/vault-reconcile-service.cjs");
const vaultReconcile = createVaultReconcileService({ vaultPath, logger }); // SPEC-012 WP-B：痕迹写走 telemetry store
vaultReconcile.start();
const pipelineRunService = createPipelineRunService({
  vaultPath,
  archRepo: path.resolve(__dirname, ".."),
  stagingBasePath,
  logger,
});
pipelineRunServiceRef = pipelineRunService; // 图漂移刷新器惰性引用就位
// SPEC-012 wave-2 图族：管线完成即摄取 staging 新图（post-run hook 按注册序执行——本 hook 注册在
// document-index/article-manifests 两个读图 hook 之前，图更新后下游重建才用上新图；幂等，
// global_diagnostic 只读不写 staging 故跳过）
pipelineRunService.addPostRunHook((finished) => {
  if (finished && finished.purpose === "global_diagnostic") return { skipped: true, reason: "GLOBAL_DIAGNOSTIC_READ_ONLY" };
  const ingested = { graphArtifacts: ingestGraphStaging() };
  graphDriftRefresher.recordRefreshed(); // 图族刷新收敛：成功摄取后记源指纹基线＋再清一次孤儿 manifest
  return ingested;
});
// SPEC-010-W10 WP3：管线收尾落账——run 结束（succeeded/failed，取消除外）时 vault 内
// 未提交变更（--sync-enums、派生物、.ledger 运行账）合并为一笔 pipeline 提交。
// 用整目录收账而非精确路径：管线写入面广（enums/派生/账本），精确清单在 python 侧易漂移。
pipelineRunService.addCompletionHook((finished) => {
  graphDriftRefresher.noteRunOutcome(finished); // 图族刷新收敛：成功复位失败计数／失败累加（退避刹车）
  if (!finished || finished.state !== "succeeded") return; // 失败/取消的 run 不落账（半成品不进版本史）
  vaultGitLedger.scheduleLedger("pipeline", `run 收尾（${finished.jobId || "job"}）`, [
    path.join(vaultPath, "知识库"),
    path.join(vaultPath, ".ledger"),
  ]);
});
let releaseRuntimeRef = null;
const articleWorkflowService = createArticleWorkflowService({
  vaultPath,
  logger,
  getReleaseReader: () => releaseRuntimeRef?.readerService || null,
});
// WP-041（Master 2026-10-29「接」）：监听器外部写 → drafts/**.md 自动 validate+promote（Obsidian 投放与网页上传同链）
draftDropAutomation = createDraftDropAutomation({ vaultPath, articleWorkflowService, logger });
let formalKnowledgeConsumerService = null;
let schemaProposalRuntimeHolder = null;
// S8（场景⑫）：kg/review 批准前查 open missing_entity/unrecognized_entity blocker。
// anomalyWorkbenchService 在 loadDashboardRoutes 内创建（晚于 review-routes 注册），用惰性引用注入，
// 复用 anomaly-workbench-service.list() 的既有 issue 采集，不自造第二套 blocker 查询。
let anomalyWorkbenchRef = null;
const formalConsumer = {
  withPinnedRelease(callback) {
    if (!formalKnowledgeConsumerService) {
      const error = new Error("Formal Release consumer is not initialized");
      Object.assign(error, { code: "FORMAL_CONSUMER_UNAVAILABLE", status: 503 });
      throw error;
    }
    return formalKnowledgeConsumerService.withPinnedRelease(callback);
  },
};
// ── Route table ──
// PR-085 第 1 步（ADR-010）：路由注册唯一入口＝http-app 的 registerRoute——契约推导 schema.body／onRoute
// fail-closed／writer-gate 钩子／ALS 请求上下文／pino-http 日志行／Langfuse span／onSend 响应探针／错误处理器
// 全部装配在 shared/http-app.cjs；main 只保留业务装配与启动顺序。
const httpApp = createHttpApp({
  logger,
  httpLogger,
  requestSpan,
  auth, // 身份接缝（CORS 随模式收窄；/api/auth/* 四端点随之注册）
  writerGate,
  // SPEC-011-W11 WP5·403 白名单（语义不变）：健康端点与 /api/graph/ 族写方法免写者校验
  isWriteGateExempt: (pathname) => pathname === "/api/health" || pathname.startsWith("/api/graph/"),
});
const registerRoute = httpApp.registerRoute;

require("./shared/retired-route-registrar.cjs").registerRetiredRoutes(registerRoute);
// PR-048：补齐字段写后即时对账 anomaly issue 卡（钩子经路由层调 reconcileDiagnostic，
// anomalyWorkbenchService 晚于此处创建 → 走 anomalyWorkbenchRef 惰性引用，同 S8 场景⑫先例；
// 未就绪时静默跳过 = 退化为旧行为「下次诊断销账」，不产生错误）。
// PR-065/SPEC-013 L2：生命周期对账器——读时（清单查询挂点在 service 内）稳态对账＋退役实现
const { createArticleLifecycleReconciler } = require("./services/article-workflow/article-lifecycle-reconciler.cjs");
const articleLifecycleReconciler = createArticleLifecycleReconciler({
  vaultPath, logger,
  // 惰性引用：association service 在 dashboard routes 段创建（晚于此）——退役时早已就绪
  removeDecisions: (basename) => associationRetirementPort ? associationRetirementPort(basename) : 0,
  digestUploadTasks: (basename) => { try { return articleWorkflowService.digestUploadTasks(basename); } catch (_e) { return 0; } },
});
let associationRetirementPort = null; // loadDashboardRoutes 段赋值
require("./routes/article-workflow-routes.cjs").register(registerRoute, {
  articleWorkflowService,
  reconcileAnomalies: (job) => { if (anomalyWorkbenchRef) anomalyWorkbenchRef.reconcileDiagnostic(job); },
  // PR-065/SPEC-013 L2：文章退役动作（预演/事务性沿 source_file 链全清）
  retireArticle: (input) => articleLifecycleReconciler.retireArticle(input),
  logger,
});
// 读时对账冷启动一次（幂等）＋每小时兜底重跑（发布动作不挂删除钩子——发布是指针切换，
// 退场语义归读时对账家族，与异常台账同哲学）
setInterval(() => { try { articleLifecycleReconciler.reconcileWorkingCopies(); } catch (_e) { /* fail-open */ } }, 60 * 60 * 1000).unref();
// ADR-004 / W2-WP2：审批状态机由服务层装配返回，端点注册归本层（routes 职责）
// vaultGitLedger 已在管线服务前创建（SPEC-010-W10 WP2/WP3 共用实例）
const approvalStateMachine = registerApprovalStateMachine({ vaultPath, logger, articleWorkflowService, pipelineRunService, gitLedger: vaultGitLedger });
require("./routes/approval-state-machine-routes.cjs").register(registerRoute, { approvalStateMachine });
// WP-156：查询面健康度读模型（按契约全量规则筛违规文章＋JSON 导出——与实时面同引擎同契约）
require("./routes/article-health-routes.cjs").register(registerRoute, { vaultPath });
  // WP-018：变更探针（多用户跨会话通知，轮询消费）
  require("./routes/system-routes.cjs").register(registerRoute, { runtimeStateStore });

require("./routes/obsidian-open-routes.cjs").register(registerRoute, {
  obsidianOpenService: createObsidianOpenService({ vaultPath }),
});
// SPEC-027 WP-003：建议服务晚装配（ontology 读取在下方 edgeRoutes 块）——早声明＋getter 供先注册的路由取
let confidenceSuggestionService = null;
function revisionOfOntologyFile(vaultPath) {
  // WP-049 余量批：指纹经词表装载端口（sha256 与文件字节哈希同值；缺件→null 保持）
  const { loadVocabBundle } = require("./shared/vocab-load-port.cjs");
  const file = loadVocabBundle(vaultPath, { files: ["ontology"] }).files.ontology;
  return file && file.state === "present" ? "sha256:" + file.fingerprint : null;
}
// PR-045：异常问题清单同一源头供两路消费——写门 409（review-routes）与读侧前置（pending-review-routes）
const listOpenIssues = () => (anomalyWorkbenchRef ? anomalyWorkbenchRef.list().issues : []);
require("./routes/pending-review-routes.cjs").register(registerRoute, { vaultPath, listOpenIssues, getSuggestionService: () => confidenceSuggestionService });
require("./routes/review-routes.cjs").register(registerRoute, {
  vaultPath,
  readMasterGraph,
  listOpenIssues,
  getSuggestionService: () => confidenceSuggestionService,
});
// EDGE-RELATION-GOV-001 阶段 3（SPEC-026 §十一）：统一读接口 /api/edges——④类查询模块（shared/edge-query，
// 零 SQL 零连接点）＋路由。门禁三答：正式读 consumer 复用 relation_search（selectFormalRelations 按断言政策
// 过滤）、stale 分流回落工作态投影、邻域恒工作态现算（runtime_view）
const { createEdgeQuery } = require("./shared/edge-query.cjs");
const edgeRoutes = require("./routes/edge-routes.cjs");
edgeRoutes.setVaultPath(vaultPath);
// SPEC-027 WP-003：置信度建议值——读面现算装配（零落盘；建议永不改 reviewStatus）
// 证据联取 MVP：product/version 节点 id 约定（article-association-service 同款 slug 规则）；组件名解析留校准期
try {
  const { createConfidenceSuggestionService } = require("./services/inference/confidence-suggestion-service.cjs");
  const { readRelationsFile } = require("./services/schema-manager/relations-write-service.cjs");
  const { normalizeDocument: normalizeOntologyDoc } = require("./shared/theschema-loader.cjs");
  const { resolveTheSchemaDir: resolveSchemaDir } = require("./shared/theschema-root.cjs");
  // WP-053 V-A：在场判断经装载端口（词表 basename 从本段消失）
  const suggestionOntologyPresent = (() => {
    try {
      const { loadVocabBundle } = require("./shared/vocab-load-port.cjs");
      return loadVocabBundle(vaultPath, { files: ["ontology"] }).files.ontology.state === "present";
    } catch { return false; }
  })();
  if (suggestionOntologyPresent) {
    const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
    const buildArticleCoverage = () => {
      try {
        const assocPath = require("node:path").join(resolveSchemaDir(vaultPath), "article_associations.yaml");
        if (!fs.existsSync(assocPath)) return new Map();
        const doc = require("yaml").parse(fs.readFileSync(assocPath, "utf8")) || {};
        const entries = [];
        (function collect(x) {
          if (Array.isArray(x)) x.forEach(collect);
          else if (x && typeof x === "object") {
            if (x.article_id || x.articleId || x.article) entries.push(x);
            Object.values(x).forEach(collect);
          }
        })(doc);
        const map = new Map();
        for (const e of entries) {
          const articleId = e.article_id || e.articleId || e.article;
          const nodes = map.get(articleId) || new Set();
          if (e.product) { nodes.add(`product-${slug(e.product)}`); nodes.add(slug(e.product)); }
          for (const v of [e.version_since, e.version_until, e.version]) if (e.product && v) nodes.add(`version-${slug(e.product)}-${slug(v)}`);
          map.set(articleId, nodes);
        }
        return map;
      } catch { return new Map(); }
    };
    // WP-053 V-A（红队发现 A）：词表经装载端口（data＝同一收口引擎——normalizeDocument 在装载点已过）
    const { loadVocabBundle } = require("./shared/vocab-load-port.cjs");
    const ontologyVFile = loadVocabBundle(vaultPath, { files: ["ontology"] }).files.ontology;
    const normalizedOntology = { data: ontologyVFile && ontologyVFile.state === "present" ? ontologyVFile.data : {} };
    confidenceSuggestionService = createConfidenceSuggestionService({
      ontologyData: normalizedOntology.data,
      sourceRevision: (() => { try { return revisionOfOntologyFile(vaultPath); } catch { return null; } })(),
      articleCoverage: buildArticleCoverage,
      listRelationBands: () => { try { return readRelationsFile(vaultPath).data.relations || []; } catch (e) { return []; } },
    });
  }
} catch (e) { logger.warn({ event: "confidence-suggestion-wiring-failed", error: e.message }); }
edgeRoutes.register(registerRoute, { edgeQuery: createEdgeQuery({ store: derivedIndexStore }), formalConsumer, suggestionService: confidenceSuggestionService });
// 对象本体批（ADR-012 D1）：人工/治理关系实例账通道——PUT/rollback 后并源重建投影（/api/edges 即时可读）
require("./routes/relations-routes.cjs").register(registerRoute, {
  vaultPath,
  listGraphNodeIds: () => derivedIndexStore.graphProjection.listNodeIds(),
  onRelationsWritten: () => { try { edgeProjectionService.rebuild(); } catch (e) { logger.warn({ event: "relations-write-projection-rebuild-failed", error: e.message }); } },
});

// ── Data readers ──
// WP-058 X-A（SPEC-052 D2）：raw 图读实现体迁入 read-model-port（getRawGraph——P6 双实现副本
// 消灭）。本别名保留：12 处消费面引用零改动；语义逐字节一致（原文行读＋parse 失败 null）。
function readMasterGraph() {
  return require("./shared/read-model-port.cjs").getRawGraph(vaultPath);
}

// PR-084：main.cjs 本地 SA 读函数退役——散布双实现合一，装配后统一取
// semantic-architecture-service（读侧唯一咽喉 frozen-artifact-reader 的 SA 槽视图；
// setVaultPath 在 :295 完成后 readSemanticArchitecture 才可用，与 dashboard 装配同序）。
let readSemanticArchitecture = null;

// 构建 graph-fact 关系校验上下文（relationOntology checker 用）
// 数据源：词表 enums 的 wikilink_type_labels（触发词→关系类型）+ ontology 的 relation_types
//   （source_types/target_types = SHACL domain/range）+ master_graph 节点 labels。
// 在此（主装配层）读取并注入，避免 release-governance 内 require compliance/ontology（service-boundaries）。
// ── Health ──
registerRoute("GET", "/api/health", (_req, res) => {
  // T4/#822：聚合业务装载就绪信号（保持 200 + status:"ok" 语义，兼容 gate/dev.mjs 只等 HTTP 200）。
  const ready = {
    dashboardRoutes: dashRoutesLoaded,
    formalConsumer: formalKnowledgeConsumerService !== null,
    schemaRuntime: typeof schemaProposalRuntimeHolder !== "undefined" && schemaProposalRuntimeHolder !== null,
  };
  const allReady = ready.dashboardRoutes && ready.formalConsumer && ready.schemaRuntime;
  // SPEC-012 WP-B：对账自证——lastReconcileAt 取自 telemetry.db 最新 reconcile-run 心跳；
  // 超 2×周期（10 分钟）未更新 → reconcileStale（setInterval 静默失效的可见化）
  const lastRun = getTelemetryStore(vaultPath).latestTrace(TRACE_KINDS.RECONCILE_RUN);
  const reconcileStale = !lastRun || (Date.now() - Date.parse(lastRun.recordedAt)) > 2 * (5 * 60 * 1000);
  sendJSON(res, 200, {
    status: "ok",
    service: "cheese",
    apiVersion: "1",
    vaultId: computeVaultId(vaultPath),
    capabilities: ["pipeline", "entity-readiness", "entity-repair", "sync-push-v2", "offline-article-workflow"],
    ready,
    readyState: allReady ? "ready" : "partial",
    lastReconcileAt: lastRun ? lastRun.recordedAt : null,
    reconcileStale,
    uptime: process.uptime(),
    // PR-156 刀二：启动自检违例可见化（clean 时 outcome=clean；违例时携带样本——页面/巡检可挂横幅）
    schemaSelfcheck: schemaSelfcheckSummary
      ? {
          outcome: schemaSelfcheckSummary.outcome,
          dataViolationCount: (schemaSelfcheckSummary.dataViolations || []).length,
          dataViolationSample: (schemaSelfcheckSummary.dataViolations || []).slice(0, 5),
        }
      : null,
  });
});

// ── Graph master ──
registerRoute("GET", "/api/graph/master", (_req, res) => {
  try {
    return formalConsumer.withPinnedRelease((context) => sendJSON(res, 200, context.readMasterGraph("relation_search")));
  } catch (error) {
    return sendJSON(res, error.status || 500, { error_code: error.code || "INTERNAL_ERROR", message: error.message });
  }
});

// ── Load dashboard routes ──
let dashRoutesLoaded = false;
function loadDashboardRoutes() {
  if (dashRoutesLoaded) return;
  try {
    const mgs = require("./services/projection/master-graph-service.cjs");
    const sas = require("./services/projection/semantic-architecture-service.cjs");
    mgs.setVaultPath(vaultPath);
    sas.setVaultPath(vaultPath);
    readSemanticArchitecture = sas.readSemanticArchitecture; // PR-084：双读合一（main 本地实现退役）
    const { createGovernanceActionStore } = require("./services/governance/governance-action-store.cjs");
    const governanceActionStore = createGovernanceActionStore({ vaultPath });
    const { scanDraftSources } = require("./services/article-workflow/draft-source-scanner.cjs");
    const dr = require("./routes/dashboard-routes.cjs");
    dr.register(registerRoute, { readMasterGraph, readSemanticArchitecture, vaultPath, formalConsumer, getResolvedGapIds: governanceActionStore.getResolvedGapIds });
    const kgr = require("./routes/kg-routes.cjs");
    kgr.setVaultPath(vaultPath);
    const { createDocumentInventoryService } = require("./services/projection/document-inventory-service.cjs");
    const documentInventoryService = createDocumentInventoryService({ vaultPath, getGraph: readMasterGraph });
    documentInventoryService.initialize().catch((error) => logger.error({ event: "document-index-init-failed", error: error.message }));
    pipelineRunService.addPostRunHook(async () => {
      const result = await documentInventoryService.rebuild();
      logger.info({ event: "pipeline-post-action-document-index-rebuilt", ...result });
      return result;
    });

    // ── Inference engine wiring (failure leaves Phase 1 available) ──
    let inferenceEngine = null;
    let conflictStore = null;
    let versionRegistryService = null;
    let inferenceOntology = null;
    try {
      const { buildInferenceOntology } = require("./services/inference/inference-ontology.cjs");
      const { createInferenceConflictStore } = require("./services/inference/inference-conflict-store.cjs");
      const { createInferenceEngine } = require("./services/inference/inference-engine.cjs");
      const { detectRuleConflicts } = require("./services/inference/inference-rule-conflicts.cjs");
      const { createInferenceDecisionConsumer } = require("./services/inference/inference-decision-consumer.cjs");
      // WP-049 余量批：ontology 经词表装载端口（data＝同一收口、降级收据照旧告警；缺件跳过保持）
      const { loadVocabBundle } = require("./shared/vocab-load-port.cjs");
      const ontologyFile = loadVocabBundle(vaultPath, { files: ["ontology"] }).files.ontology;
      if (ontologyFile && ontologyFile.state === "present") {
        if (ontologyFile.degradedNodes.length) {
          logger.warn({ event: "ontology-degraded-nodes", nodes: ontologyFile.degradedNodes.map((node) => node.path) });
        }
        const ontology = buildInferenceOntology(ontologyFile.data);
        // C9 四槽 resolver（红队 R1 修复：定义与注入同批落地；适配 annotateEdge→引擎入参）
        const resolveEdgeConfidence = (edge) => {
          if (!confidenceSuggestionService) return null;
          const a = confidenceSuggestionService.annotateEdge({
            source: edge.source, target: edge.target, type: edge.type,
            confidence: edge.confidenceExplicit ? edge.confidence : undefined,
            properties: edge.structural ? { source: "auto-discovered" } : {},
          });
          return a.effectiveConfidence !== undefined
            ? { confidence: a.effectiveConfidence, confidenceSource: a.confidenceSource }
            : null;
        };
        inferenceOntology = ontology;
        conflictStore = createInferenceConflictStore({ vaultPath });
        inferenceEngine = createInferenceEngine({ ontology, conflictDetector: detectRuleConflicts, conflictStore, decisionConsumer: createInferenceDecisionConsumer(), resolveEdgeConfidence });
        logger.info({ event: "inference-engine-initialized", relation_consumer_mode: ontology._capabilityRegistry.mode });
      } else {
        // PR-176：原写 path: ontologyPath——该作用域无此变量（装载端口 missing 形态不带路径），一进分支即 ReferenceError 被外层 catch 吞掉。改吃在范畴量 vaultPath（496 行同源）。
        logger.warn({ event: "inference-ontology-missing", vault_path: vaultPath });
      }
    } catch (error) {
      logger.warn({ event: "inference-engine-init-failed", error: error.message });
    }

    const { createChangeDispositionService } = require("./services/governance/change-disposition-service.cjs");
    const { detectRuleConflicts: dispositionConflictDetector } = require("./services/inference/inference-rule-conflicts.cjs");
    const { createInferenceDecisionConsumer: createDispositionDecisionConsumer } = require("./services/inference/inference-decision-consumer.cjs");
    const changeDispositionService = createChangeDispositionService({
      conflictStore,
      conflictDetector: dispositionConflictDetector,
      decisionConsumer: createDispositionDecisionConsumer(),
    });

    const { createImpactAnalysisService } = require("./services/projection/impact-analysis-service.cjs");
    const { createGraphProvenanceService } = require("./services/projection/graph-provenance-service.cjs");
    const graphProvenanceService = createGraphProvenanceService({ vaultPath });
    const impactAnalysisService = createImpactAnalysisService({
      getGraph: readMasterGraph,
      getNodeDocuments: (nodeId) => documentInventoryService.getNodeDocuments(nodeId),
      getDocumentsByGraphNodeIds: (nodeIds) => documentInventoryService.getDocumentsByGraphNodeIds(nodeIds),
      inferenceEngine,
      graphProvenanceService,
      changeDispositionService,
      capabilityRegistry: inferenceOntology?._capabilityRegistry || null,
      getVersionStatus: (product, version) => versionRegistryService?.getRegistry().products?.[product]?.versions?.find((item) => item.id === version)?.status || null,
    });
    // Article manifest service — powers type=article-manifests kg/query
    const articleManifestService = createArticleManifestService({ vaultPath, readMasterGraph });
    const { createArticleManifestBatchService } = require("./services/article-workflow/article-manifest-batch-service.cjs");
    const articleManifestBatchService = createArticleManifestBatchService({ articleManifestService });
    const rebuildArticleManifests = () => {
      const result = articleManifestBatchService.rebuild();
      logger.info({ event: "article-manifests-rebuilt", ...result, failures: result.failures.slice(0, 10) });
      return result;
    };
    // ADR063/sidaima 批（#1741）：refreshPublishedConsumers 死赋值退役（消费计数 0，能力已由
    // 下方 inventory post-run hook + article-manifests post-run hook 承载，保留即第二实现）。
    // SPEC-012 wave-2：manifest 迁 derived-index.db 行级——boot 重建排在存量目录导入与图族摄取
    // 之后（②类目录导入先落行、staging 图摄取保证 rebuild 用上新图，行级 put 幂等覆盖；本 then
    // 注册早于 Promise.all(listen)，listen 前完成，语义与旧「listen 前 rebuild」等价）。
    graphIngestReady
      .then(() => { rebuildArticleManifests(); })
      .catch((error) => logger.warn({ event: "article-manifests-init-failed", error: error.message }));
    pipelineRunService.addPostRunHook((job) => {
      if (job.purpose === "global_diagnostic" || job.purpose === "article_graph_staging") {
        logger.info({ event: "pipeline-post-action-article-manifests-skipped", purpose: job.purpose });
        return { skipped: true, reason: "GLOBAL_DIAGNOSTIC_READ_ONLY" };
      }
      return rebuildArticleManifests();
    });
    const formalImpactAnalysisFactory = (context) => createImpactAnalysisService({
      getGraph: () => context.readMasterGraph("impact_analysis"),
      getNodeDocuments: (nodeId) => context.documentInventory.getNodeDocuments(nodeId),
      getDocumentsByGraphNodeIds: (nodeIds) => context.documentInventory.getDocumentsByGraphNodeIds(nodeIds),
      graphProvenanceService: context.provenanceService,
      capabilityRegistry: context.capabilityRegistry,
      inferenceEngine: context.inferenceEngine,
      getVersionStatus: (product, version) => context.readVersionRegistry().products?.[product]?.versions?.find((item) => item.id === version)?.status || null,
    });
    kgr.register(registerRoute, { readSemanticArchitecture, readMasterGraph, documentInventoryService, impactAnalysisService, formalConsumer, impactAnalysisFactory: formalImpactAnalysisFactory, articleManifestService, addGovernanceAction: governanceActionStore.addAction, graphDriftCheck: () => graphDriftRefresher.checkAndSchedule() });
    const pr = require("./routes/property-routes.cjs");
    pr.register(registerRoute, { readSemanticArchitecture, readMasterGraph, vaultPath });
    const ecr = require("./routes/entity-compliance-routes.cjs");
    const { createEntityRepairService } = require("./services/entity-compliance/entity-repair-service.cjs");
    // ADR-006 修订A：类别生长写入源（schemaWriteService 稍后创建——延迟闭包同 versionRegistryServiceFactory 先例）
    let schemaWriteServiceForGrowth = null;
    const entityRepairService = createEntityRepairService({
      vaultPath,
      ruleSetProvider: () => ecr.loadRuleSetForVault(vaultPath),
      growCategoryMatrix: (input) => schemaWriteServiceForGrowth.growCategoryMatrix(input),
    });
    const pipelineRoutes = require("./routes/pipeline-routes.cjs");
    pipelineRoutes.register(registerRoute, {
      pipelineRunService,
      // WP-055 试点消费方（SPEC-049 Q4）：status 响应 readModelVersion 的取数注入
      getReadModelVersion: () => require("./shared/read-model-port.cjs").getReadModelVersion({ vaultPath, dataDir: graphDataDir }),
      // WP-027（PR-142）：图新鲜度对账＋调度状态（GET /api/pipeline/graph-freshness）
      graphFreshness: () => computeGraphFreshness({ vaultPath, dataDir: graphDataDir }),
      graphRefreshScheduler: schemaGraphRefreshScheduler,
    });
    // ── Sync routes V2 (readiness-gated, no derived-graph write) ──
    const { scanAndCheck, buildReadiness } = require("./routes/entity-compliance-routes.cjs");
    const syncRoutes = require("./routes/sync-routes.cjs");
    syncRoutes.register(registerRoute, {
      pipelineRunService,
      getReadiness: function () { return buildReadiness(scanAndCheck(vaultPath, readMasterGraph(), scanDraftSources).results); },
      vaultPath,
    });
    // E3'b：schema 直接写回服务（ADR043 目标态，复用 enums-write/version-registry/entity-parent）
    // versionRegistryServiceFactory 用延迟闭包（versionRegistryService 稍后在下方赋值）
    const schemaWriteService = require("./services/schema-manager/schema-write-service.cjs").createSchemaWriteService({
      vaultPath,
      versionRegistryServiceFactory: () => versionRegistryService,
      logger,
      gitLedger: vaultGitLedger,
      // WP-027（PR-142）：图输入写通知缝——ontology/enums/versions 写成功后通知图谱刷新调度器
      onGraphInputWrite: (input) => schemaGraphRefreshScheduler.notify({ ...input, source: "service" }),
    });
    schemaWriteServiceForGrowth = schemaWriteService; // ADR-006 修订A：实体类别生长写入源接线
    require("./routes/enums-routes.cjs").register(registerRoute, { vaultPath, schemaWriteService });
    require("./routes/fields-routes.cjs").register(registerRoute, { vaultPath, onGraphInputWrite: (input) => schemaGraphRefreshScheduler.notify({ ...input, source: "service" }) }); // ADR-008 D2/SPEC-017 W4；WP-027 fields 写缝透传
    require("./routes/data-roles-routes.cjs").register(registerRoute, { repoRoot: path.resolve(__dirname, ".."), vaultPath }); // SPEC-019：树元数据源（WP-055 追加 vaultPath：rebuild 响应携带读模型版本）
    require("./routes/read-model-routes.cjs").register(registerRoute, { vaultPath, dataDir: process.env.KB_DATA_DIR || undefined }); // WP-055：读模型版本身份一等查询出口
    require("./routes/field-graph-routes.cjs").register(registerRoute, { vaultPath }); // SPEC-020 波 3：字段引用图谱只读投影
    require("./routes/subjects-routes.cjs").register(registerRoute, { vaultPath }); // SPEC-019 A 档：导航树 subjects/ 数据源
    require("./routes/ontology-routes.cjs").register(registerRoute, { vaultPath, schemaWriteService });
    const { createArticleAssociationService } = require("./services/article-workflow/article-association-service.cjs");
    const { readVersionRegistry } = require("./shared/version-registry-reader.cjs");
    let dependencyImpactService = null;
    const dependencyImpactPort = {
      assertWriteAllowed(items) {
        if (!dependencyImpactService) {
          const error = new Error("Dependency reasoning gate is unavailable");
          Object.assign(error, { code: "DEPENDENCY_REASONING_UNAVAILABLE", status: 503 });
          throw error;
        }
        return dependencyImpactService.assertWriteAllowed(items);
      },
    };
    const { releaseRuntime } = require("./services/release-governance/release-governance-assembly.cjs").createReleaseGovernanceFoundation({ vaultPath, logger });
    releaseRuntimeRef = releaseRuntime;
    schemaProposalRuntimeHolder = require("./routes/release-runtime-routes.cjs").registerSchemaReleaseRuntime({
      registerRoute,
      vaultPath,
      logger,
      operatorContext: localOperatorContext,
      architectIdentities,
      mintRelease: typeof approvalStateMachine.publishCurrent === "function" ? approvalStateMachine.publishCurrent : undefined,
      ...releaseRuntime,
    });
    const { createFormalKnowledgeConsumerService } = require("./services/release-governance/formal-knowledge-consumer-service.cjs");
    formalKnowledgeConsumerService = createFormalKnowledgeConsumerService({ releaseReader: releaseRuntime.readerService });
    // E2'b/E3'/E4'a：graph-fact/schema/article 提案链退役（ADR043 状态机 + 直接写回取代），不再装配 proposal runtime。
    ecr.register(registerRoute, {
      vaultPath, readMasterGraph, scanDraftSources, repairService: entityRepairService,
    });
    const { createVersionRegistryService, createPythonProjector } = require("./services/pipeline/version-registry-service.cjs");
    const { readEnums: readEnumsPort, writeArchitectureProjectionIdentity } = require("./services/schema-manager/enums-write-service.cjs");
    const projectVersion = createPythonProjector({ vaultPath, archRepo: path.resolve(__dirname, "..") });
    versionRegistryService = createVersionRegistryService({
      vaultPath,
      archRepo: path.resolve(__dirname, ".."),
      projectVersion,
      getDocumentsForVersion: (product, version) => documentInventoryService.searchDocuments({ product, version, limit: 200, offset: 0 }).documents,
      changeDispositionService,
      readEnums: readEnumsPort,
      writeArchitectureProjectionIdentity,
    });
    require("./routes/version-registry-routes.cjs").register(registerRoute, { versionRegistryService, schemaWriteService });
    const { createDependencyImpactPreviewService } = require("./services/schema-manager/dependency-impact-preview-service.cjs");
    const { listDependencies: listDependencyRules, validateDependencyPayload: validateDependencyRules } = require("./services/schema-manager/dependencies-write-service.cjs");
    dependencyImpactService = createDependencyImpactPreviewService({
      vaultPath,
      getRegistry: () => versionRegistryService.getRegistry(),
      analyzeImpact: (request) => impactAnalysisService.analyze(request),
      changeDispositionService,
      listDependencies: listDependencyRules,
      validateDependencyPayload: validateDependencyRules,
    });
    require("./routes/dependencies-routes.cjs").register(registerRoute, { vaultPath, impactPreviewService: dependencyImpactService, schemaWriteService });
    const { createArchitectureVersionService } = require("./services/projection/architecture-version-service.cjs");
    const architectureVersionService = createArchitectureVersionService({
      vaultPath,
      getRegistry: () => versionRegistryService.getRegistry(),
      projectVersion,
      searchDocuments: (params) => documentInventoryService.searchDocuments(params),
    });
    const formalArchitectureVersionFactory = (context) => createArchitectureVersionService({
      vaultPath,
      getRegistry: context.readVersionRegistry,
      projectVersion: context.readArchitectureProjection,
      readSnapshotArtifact: context.readVersionSnapshot,
      searchDocuments: context.documentInventory.searchDocuments,
      filterRelations: (relations) => context.selectRelations(relations, "relation_search"),
    });
    const architectureVersionRoutes = require("./routes/architecture-version-routes.cjs");
    const { sha256Revision } = require("./shared/working-artifact-snapshot.cjs");
    function computeArchitectureVersionFallback() {
      try {
        const filePath = getVersionsFilePath(vaultPath);
        if (!fs.existsSync(filePath)) return { dataSource: "worktree" };
        const bytes = fs.readFileSync(filePath);
        return { dataSource: "worktree", workingRevision: sha256Revision(bytes) };
      } catch (_error) {
        return { dataSource: "worktree" };
      }
    }
    architectureVersionRoutes.register(registerRoute, {
      architectureVersionService,
      formalConsumer,
      serviceFactory: formalArchitectureVersionFactory,
      computeFallbackMetadata: computeArchitectureVersionFallback,
    });
    const withFormalArticleAssociations = (callback) => formalConsumer.withPinnedRelease((context) => callback(createArticleAssociationService({
      vaultPath,
      operatorContext: localOperatorContext,
      // #1776 ADR063 活锚：映射目标组件下拉吃活主图（冻结图已随源删除产生幽灵选项如 样本A）。
      // articles 目录仍走 release 上下文（下方 listFormalArticles），由 service 内按活文件系统过滤死源条目。
      getGraph: readMasterGraph,
      // A1 注册表活锚（补齐 #1776 同装配换锚的另一半）：写表单选项必须与 save 校验同源——
      // 冻结工件注册表是 RAW 产品键（生产 As），活读经 canonicalizeRegistryProducts 规范化
      // （AnyShare）；两者并存时 list/preview 吐 version-as-* 而 save 只认 version-anyshare-*，
      // 构成结构性保存死锁（红灯：article-association-projection-parity.test.cjs，规则 31
      // 「校验器读当前规则」：写表单属治理动作，选项应读当前权威源而非冻结快照）。
      getRegistry: () => readVersionRegistry(vaultPath),
      changeDispositionService,
      listFormalArticles: context.listFormalArticles,
      readAuditRaw: context.readArticleAssociationAudit,
      writeAuditRaw() {
        const error = new Error("Formal Release article associations are read-only");
        Object.assign(error, { code: "FORMAL_RELEASE_IMMUTABLE", status: 409 });
        throw error;
      },
    })));
    const { createWorktreeAssociationWriter } = require("./services/article-workflow/article-association-worktree-writer.cjs");
    // PR-205（2026-11-03，Master 裁 A 支「都按推荐办」）：save 与两个移除出口统一走活 writer 装配——
    // 2026-10-15「引用随源流转」批曾把 removeDecision/removeDecisionsForArticle 接在 writeAuditRaw
    // 恒 409（FORMAL_RELEASE_IMMUTABLE）的只读 pinned 实例上，生产形态下移除恒拒、reconciler 退役清行同堵。
    // tr_bbc0faf0（WP-090）：preview 必须与 save 同装配同目录源。原 preview 接上方 :715 的冻结 Release 装配
    // （listFormalArticles=context.listFormalArticles，吐发布快照里的 sourceHash），save 接本 writer 的活扫目录——
    // 文章一经发布后再改源文件，两侧哈希必然不等：save 的乐观锁 :303 恒 409，而「请重新预览」每次取回同一个
    // 陈旧冻结值，构成无解死路。这正是 tr_43c615f5（2026-10-07 Master 批 A 案）已在 writer 写好却从未接线的修法。
    // 合流（并行线合并，2026-11-03）：同一 writer 实例四口同源＝preview/save/removeDecision/removeDecisionsForArticle。
    // list 仍留冻结装配：#1776 的「正式文章目录不随活源漂移」语义由 TC-frozen 常驻钉守护，本处不动它。
    // seq180：getRegistry 须为零参闭包绑 vaultPath——reader readVersionRegistry(vaultPath) 是
    // 带参函数，裸引用在消费端零参调用（article-association-service.cjs:129/157）时
    // vaultPath=undefined → TypeError，文章映射 save 全链崩。
    const associationWriter = createWorktreeAssociationWriter({ vaultPath, operatorContext: localOperatorContext, getGraph: () => readMasterGraph("article_association"), getRegistry: () => readVersionRegistry(vaultPath), changeDispositionService });
    const articleAssociationService = {
      list: () => withFormalArticleAssociations((service) => service.list()),
      preview: associationWriter.preview,
      save: associationWriter.save,
      // 2026-10-15 引用随源流转：stale 决策移除出口（PR-205 改道：与 save/preview 同活装配，只读 pinned 实例只担读面）
      removeDecision: associationWriter.removeDecision,
      // 退役沿链清行（reconciler 经 main 闭包调用——见 articleLifecycleReconciler 装配；PR-205 同批改道）
      removeDecisionsForArticle: associationWriter.removeDecisionsForArticle,
    };
    associationRetirementPort = articleAssociationService.removeDecisionsForArticle;
    require("./routes/article-association-routes.cjs").register(registerRoute, {
      articleAssociationService,
    });
    const { createAnomalyWorkbenchService } = require("./services/anomaly/anomaly-workbench-service.cjs");
    const { isWorkbenchIssueFinding } = require("./services/entity-compliance/entity-compliance-service.cjs");
    const { createAnomalyActionAdapter } = require("./services/anomaly/anomaly-action-adapter.cjs");
    const { listRelationTargetOptions } = require("./services/entity-compliance/entity-relation-patch-service.cjs");
    const { findUnmanagedEntityCandidates } = require("./services/entity-compliance/unmanaged-entity-candidate-service.cjs");
    const anomalyActionAdapter = createAnomalyActionAdapter({
      entityRepairService,
      articleAssociationService,
      conflictStore,
      operatorContext: localOperatorContext,
    });
    const { createAnomalyIssueCollector } = require("./services/governance/anomaly-issue-collector.cjs");
    const collectDomainIssues = createAnomalyIssueCollector({ vaultPath, logger, scanAndCheck, readMasterGraph, scanDraftSources, isWorkbenchIssueFinding, findUnmanagedEntityCandidates, listRelationTargetOptions, articleAssociationService, conflictStore, graphProvenanceService, relationRegistry: inferenceOntology?._capabilityRegistry || null, relationRuleSetProvider: () => ecr.loadRuleSetForVault(vaultPath) });
    const collectIssues = () => {
      const domainCollection = collectDomainIssues();
      // ADR063 #1746：读时对账后的活发布失败（同 commit 已被成功发布取代的记录不再注入待办）
      const publicationIssues = releaseRuntime.publisherService.listActiveIssues().map((issue) => ({
        ...issue,
        evidence: [{
          kind: "release-publication",
          coordinate: `release:${issue.sourceCommit || "unknown"}`,
          stage: issue.stage,
          errorCode: issue.errorCode,
        }],
        expectedRevisions: {
          sourceCommit: issue.sourceCommit || "unknown",
          previousReleaseId: issue.previousReleaseId || "none",
        },
        blockedActions: [],
        proposedAction: null,
      }));
      return {
        issues: [...domainCollection.issues, ...publicationIssues],
        workingRevisions: domainCollection.workingRevisions,
      };
    };
    const anomalyWorkbenchService = createAnomalyWorkbenchService({
      vaultPath,
      actionAdapter: anomalyActionAdapter,
      operatorContext: localOperatorContext,
      relationRegistry: inferenceOntology?._capabilityRegistry || null,
      collectIssues,
      rerunPipeline: (issue) => pipelineRunService.start("full", { anomalyIssueId: issue.issueId }),
      getPipelineStatus: () => pipelineRunService.getStatus(),
      verifyIssue: (_issue, activeIssue) => ({ verified: false, reason: "管道重跑后问题仍被来源检查器检出", activeIssueId: activeIssue.issueId }),
    });
    anomalyWorkbenchRef = anomalyWorkbenchService;
    pipelineRunService.addCompletionHook((job) => job.purpose === "global_diagnostic"
      ? anomalyWorkbenchService.reconcileDiagnostic(job)
      : job.diagnostics);
    require("./routes/anomaly-workbench-routes.cjs").register(registerRoute, { anomalyWorkbenchService });
    // 波3（SPEC-008）：discovery 挂 ruleCandidates（波1 mining 消费面——issues 源=anomaly workbench list）
    require("./routes/schema-discovery-routes.cjs").register(registerRoute, { vaultPath, schemaWriteService, anomalyListIssues: () => anomalyWorkbenchService.list().issues });
    // 波3（SPEC-008 §3.2）：规则通道——propose/retire 写 entity-readiness-rules 契约+索引联动
    const { createRulesLifecycleService } = require("./services/schema-profiling/rules-lifecycle-service.cjs");
    const rulesLifecycleService = createRulesLifecycleService({ repoRoot: path.resolve(__dirname, "..") });
    require("./routes/rules-lifecycle-routes.cjs").register(registerRoute, { rulesLifecycleService });
    require("./routes/inference-conflict-routes.cjs").register(registerRoute, { conflictStore, operatorContext: localOperatorContext });
    dashRoutesLoaded = true;
    logger.info({ event: "dashboard-routes-loaded" });
  } catch (e) { logger.warn({ event: "dashboard-routes-not-loaded", error: e.message }); }
}
loadDashboardRoutes();

// ── seq196 响应出站契约校验接线（enforce 翻转，#1592）──
// 默认 enforce：违约响应替换 500 INTERNAL_ERROR 不外泄（用户裁定①）；
// API_RESPONSE_SCHEMA_CHECK=0 显式关闭（裁定②默认开）；
// API_RESPONSE_SCHEMA_SHADOW=path 前缀名单回退 shadow（裁定③/ADR060 §5 可单独回退）。
const { createContractResponseProbe, contractRouteCount } = require("./shared/api-schema-validator.cjs");
const { setResponseSchemaProbe } = require("./shared/api-envelope.cjs");
setResponseSchemaProbe(createContractResponseProbe({ logger }));
logger.info({ subsystem: "api", event: "api_response_schema_enforce_on", contract_routes: contractRouteCount });

// ── Server（PR-085 第 1 步：框架装配见 shared/http-app.cjs；此处只保留启动顺序与生命周期）──

// PR-056：boot 漂移扫完成后才 listen——「server 开始处理请求前 recovery 提交已落」的顺序兑现
// SPEC-012 WP-C/WP-A：②类重建＋③类存量导入与漂移扫一并落定后再 listen（均 fail-open，失败不阻断）
// SPEC-012 wave-2：图族摄取（含存量导入后的二次摄取）同样 listen 前落定
// PR-109：TheSchema 自检同汇合（fail-open——纯读校验，慢/失败不阻断 listen）
Promise.all([bootDriftReady, derivedIndexReady, runtimeStateImportReady, graphIngestReady, telemetryImportReady, schemaSelfcheckReady]).then(() => {
  httpApp.listen({ port: PORT, host: HOST }).then((address) => {
    logger.info({ event: "server-start", port: address.port, vaultPath });
  }).catch((error) => {
    logger.error({ event: "server-listen-failed", error: error.message });
    process.exitCode = 1;
  });
});
httpApp.app.addHook("onClose", async () => {
  pipelineRunService.dispose();
  vaultWatcher.stop();
  vaultReconcile.stop();
  unsubscribeVaultWrite(); // SPEC-012 WP-C：退订通道挂钩
  try { derivedIndexDb.close(); } catch { /* best-effort */ }
  try { runtimeStateDb.close(); } catch { /* best-effort */ }
  try { telemetryDb.close(); } catch { /* best-effort */ }
});

// PR-084：readSemanticArchitecture 不再从 main 导出（无外部消费者；装配后绑定的 let 若在此快照即为 null）——
// 需要 SA 读取的模块直接取 services/projection/semantic-architecture-service（唯一咽喉视图）。
// PR-085：`server` 原始 http.Server 导出随自建传输层退役——无外部消费者；需要实例的测试用 app（inject 走进程内管线）。
module.exports = { app: httpApp.app, registerRoute, readMasterGraph };
