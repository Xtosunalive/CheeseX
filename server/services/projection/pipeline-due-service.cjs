// Component: Pipeline-Due-Service
// @responsible: D2 触发收敛（ADR-011／SPEC-025 C2）——boot 检查 due（阈值 1 篇/1 天，Master 2026-10-23），
//   due 即自动执行确定性抽取（spawn 仓内 extract_graph --apply --incremental；D3 降级容忍——空配置不拒跑）；
//   抽取成功即运行时摄取 staging（与 pipelineRunService post-run hook 同款配对——缺此接线则新图要等
//   下次重启才可见，ADR-011「服务跑着=自动更新」的运行时兑现）；规则资产发布永不自动（D6 人 gate）。
//   执行事件记 telemetry（④类，readers=/api/health、状态页）。
//   fail-open：due 判定、抽取或摄取失败只告警不阻断 boot/watcher（与 watcher 装配、同步器重建同款纪律）。
// @inputs: scripts/vault-py/graph/{pipeline_due.py,extract_graph.py}（经 resolvePythonPath 单源解析）、telemetry store、
//   vaultPath（语义作用域锚，WP-069 §3.1）、ingestStagedGraph／recordGraphRefreshed（main.cjs 装配注入，
//   与 post-run hook 同源闭包；runScript 仅供测试注入）
// @outputs: telemetry traces（pipeline-due／pipeline-run）＋抽取产物（extract_graph 自管）＋staging 摄取
const path = require("node:path");
const { execVaultRuntimeScript } = require("../../shared/vault-runtime-spawn.cjs"); // WP-069 §3.1：唯一拉起点——env 全集由构造器组装

const ROOT = path.resolve(__dirname, "..", "..", "..");

function createPipelineDueService({ logger = console, telemetry, runScript, vaultPath, extraEnv, ingestStagedGraph, recordGraphRefreshed } = {}) {
  const trace = (kind, payload) => {
    try { telemetry && telemetry.recordTrace(kind, payload); } catch (_e) { /* ④类尽力而为 */ }
  };
  const py = runScript || ((script, args, opts = {}) =>
    // WP-069 §3.1/§3.2：经唯一拉起模块 exec（family=vault-py-graph 解析 scripts/vault-py/graph；
    // env 全集由构造器组装——extraEnv 禁携身份变量）；runCommand 语义：error=spawn 级失败
    execVaultRuntimeScript(script, args, {
      vaultPath,
      family: "vault-py-graph",
      cwd: ROOT,
      vocabEnvelope: Boolean(opts.vocabEnvelope),
      docEnvelope: Boolean(opts.docEnvelope), // WP-117 批2：文档信封按调用点opt-in（pipeline_due --mark-run 不需要）
      extraEnv,
    }).then((result) => {
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${script} exit=${result.status}: ${(result.stderr || result.stdout).slice(300)}`); // 失败正文在 stderr——不透出即盲修
      return result.stdout;
    }));

  /** 执行核心：确定性增量抽取＋mark-run＋运行时摄取（SPEC-025 C2 自动语义；WP-027 抽出复用） */
  async function executeIncrementalRun(reason) {
    try {
      // WP-049 L3（ADR-016 §四-2 同宿主裁决）＋WP-069 §3.1：extract_graph 经信封取数零词表文件
      // 读取——信封由唯一拉起模块随拉起物化（vocabEnvelope 语义选项）；物化失败走 py promise
      // rejection → 本函数既有失败面（trace＋warn＋ran:false，不抛出）。
      // 旧形态回退隐患移除：信封库锚曾回落 ROOT/..（静默猜库）——现 vaultPath 缺失即 TypeError。
      // D4：--incremental＝指纹未变跳过全量；不带即全量（force 语义）——extract_graph 既有行为。
      // 注意：勿走 pipelineRunService 的 global_diagnostic（那是 --diagnostic 只读诊断——未发布主图/
      // SQLite/语义架构，红队证伪先例）；article_graph 是 --force 全量且不前进 manifest，freshness 不收敛。
      const out = await py("extract_graph.py", ["--apply", "--incremental"], { vocabEnvelope: true, docEnvelope: true }); // WP-117 批2：文档信封随拉起物化——extract_graph 文档面经信封供给（SPEC-084 §二.2）
      await py("pipeline_due.py", ["--mark-run"]); // 计数清零＋checkpoint 前进（仅执行成功后）
      // 运行时摄取（fail-open）：不摄取则活读库仍是旧图——与 post-run hook 的 ingest＋记基线同款配对
      let ingested = null;
      if (ingestStagedGraph) {
        try {
          ingested = ingestStagedGraph();
          if (recordGraphRefreshed) recordGraphRefreshed();
        } catch (err) {
          logger.warn && logger.warn({ event: "pipeline-due-ingest-failed", error: String(err) });
        }
      }
      trace("pipeline-run", { ok: true, reason, ingested, tail: String(out).slice(-400) });
      return { ran: true, ingested };
    } catch (err) {
      trace("pipeline-run", { ok: false, reason, error: String(err).slice(400) });
      logger.warn && logger.warn({ event: "pipeline-run-failed", error: String(err) });
      return { ran: false, error: String(err) };
    }
  }

  async function runIfDue() {
    let verdict;
    try {
      verdict = JSON.parse(await py("pipeline_due.py", ["--check"]));
    } catch (err) {
      logger.warn && logger.warn({ event: "pipeline-due-check-failed", error: String(err) });
      return { ran: false, error: String(err) };
    }
    trace("pipeline-due", verdict);
    if (!verdict.due) return { ran: false, verdict };
    logger.info && logger.info({ event: "pipeline-due-triggered", reason: verdict.reason });
    const result = await executeIncrementalRun(verdict.reason);
    return { ...result, verdict };
  }

  /**
   * WP-027（PR-142）：无条件执行一次自动增量抽取（due 同款配对）——schema 图输入跟随通道。
   * 与 runIfDue 的区别：不做 due 判定（调用方——去抖调度器——已用 freshness 复核过该不该跑）；
   * mark-run 语义不变：跑成功即清计数＋前移 last_run_at（调度窗开启时的 noteSchemaWrite 计数随之消化）。
   */
  async function runNow(reason) {
    return executeIncrementalRun(reason || "schema-graph-refresh");
  }

  function noteExternalWrite() {
    // watcher external 桥（main.cjs onExternalWrite 链）：计数 +1——fire-and-forget，失败只告警
    py("pipeline_due.py", ["--inc"]).catch((err) =>
      logger.warn && logger.warn({ event: "pipeline-due-inc-failed", error: String(err) }));
  }

  function noteSchemaWrite() {
    // WP-027（PR-142）：schema 图输入写桥（scheduler 每静默窗调一次）——同计数器 +1：
    // 服务重启丢去抖窗时由 boot runIfDue 兜底补跑。fire-and-forget，失败只告警
    py("pipeline_due.py", ["--inc"]).catch((err) =>
      logger.warn && logger.warn({ event: "pipeline-due-schema-inc-failed", error: String(err) }));
  }

  return { runIfDue, runNow, noteExternalWrite, noteSchemaWrite };
}

module.exports = { createPipelineDueService };
