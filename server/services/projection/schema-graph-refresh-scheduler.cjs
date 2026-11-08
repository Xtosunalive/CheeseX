// Component: Schema-Graph-Refresh-Scheduler（WP-027/PR-142）
// @responsible: 规则图输入（四件 yaml）写入后自动跟随重抽——去抖调度器。
//   双缝汇入（main.cjs 装配）：①服务回调——schema-write-service/fields-write-service 成功后
//   onGraphInputWrite；②watcher 桥——知识库/TheSchema 四件写事件（不分内外部写，覆盖 Obsidian/CLI 直改）。
//   静默窗（默认 3 分钟）内多次保存只触发一次；触发时先 freshness 复核（已最新则跳过——
//   双缝对同一写入的重复通知在此去重），再经 runRefresh 执行**真实增量抽取＋摄取**（due 同款配对——
//   pipeline-due-service.runNow；勿走 global_diagnostic 只读诊断，红队证伪先例）。并发防撞由
//   extract_graph 管道锁（10 分钟）承担：在飞冲突即本次失败 fail-open（计数旁路保证 boot 兜底）。
//   due 计数旁路：每个静默窗开启时 pipelineDue.noteSchemaWrite() 计数 +1——服务重启丢窗由
//   boot runIfDue 兜底；runNow 成功即 mark-run 消化计数。全程 fail-open：调度任何失败只告警/记遥测，
//   绝不阻断保存写路径。
// @inputs: notify({ category, source })；computeFreshness 复核回调；runRefresh 执行回调（返回 {ran, ingested, error}）
// @outputs: getState()（pending/pendingSince/firesAt/lastTriggeredAt/lastSkipReason）＋telemetry 三事件
//   （notified／skip-fresh／run-triggered｜run-failed——kind=schema-graph-refresh，readers=/api/health 同族）
// @context: Pipeline；定时器 unref——不持有进程生命周期
"use strict";

const DEFAULT_QUIET_MS = 3 * 60 * 1000;

function createSchemaGraphRefreshScheduler(options) {
  const opts = options || {};
  const logger = opts.logger || { info() {}, warn() {}, error() {} };
  const telemetry = opts.telemetry || null;
  const computeFreshness = opts.computeFreshness || null;
  const runRefresh = opts.runRefresh || null;
  const pipelineDue = opts.pipelineDue || null;
  const quietMs = Number.isFinite(opts.quietMs) && opts.quietMs > 0 ? opts.quietMs : DEFAULT_QUIET_MS;

  let timer = null;
  let pendingSince = null;
  let firesAt = null;
  let lastCategory = null;
  let lastTriggeredAt = null;
  let lastSkipReason = null;

  const trace = (event, payload) => {
    try { telemetry && telemetry.recordTrace("schema-graph-refresh", { event, ...payload }); } catch (_e) { /* 遥测尽力而为 */ }
  };

  async function fire() {
    const category = lastCategory;
    timer = null;
    let freshness = null;
    try {
      freshness = computeFreshness ? computeFreshness() : null;
    } catch (error) {
      logger.warn({ event: "schema-graph-refresh-freshness-failed", error: String(error) });
      trace("freshness-failed", { category, error: String(error) });
      // 复核失败按「需要刷新」方向处理（fail toward refresh）——落入下方执行路径
    }
    if (freshness && freshness.upToDate === true) {
      lastSkipReason = "fresh";
      pendingSince = null;
      firesAt = null;
      trace("skip-fresh", { category });
      return;
    }
    pendingSince = null;
    firesAt = null;
    if (typeof runRefresh !== "function") {
      lastSkipReason = "run-channel-unavailable";
      trace("run-failed", { category, error: "runRefresh 未装配" });
      logger.warn({ event: "schema-graph-refresh-run-channel-unavailable" });
      return;
    }
    try {
      const result = await runRefresh();
      if (result && result.ran) {
        lastTriggeredAt = new Date().toISOString();
        lastSkipReason = null;
        trace("run-triggered", { category, ingested: result.ingested ?? null, freshness: freshness ? { upToDate: freshness.upToDate, changed: freshness.changed } : null });
      } else {
        // runNow 内部已 trace(pipeline-run, ok:false)＋告警；此处只记调度面结果（含管道锁在飞冲突）
        lastSkipReason = "run-failed";
        trace("run-failed", { category, error: (result && result.error) || "unknown" });
      }
    } catch (error) {
      trace("run-failed", { category, error: String(error) });
      logger.warn({ event: "schema-graph-refresh-run-failed", error: String(error) });
    }
  }

  /**
   * 图输入写入通知（双缝共用入口）。fail-open：任何内部异常吞掉只告警——绝不向保存路径抛错。
   * @param {{ category?: string, source?: string }} input source="service"|"watcher"
   */
  function notify(input) {
    try {
      const category = (input && input.category) || null;
      const source = (input && input.source) || "unknown";
      if (!timer) {
        // 每个静默窗只计数一次（多保存/双缝重复通知不重复 +1）
        try { pipelineDue && typeof pipelineDue.noteSchemaWrite === "function" && pipelineDue.noteSchemaWrite(); } catch (_e) { /* 计数旁路失败不阻断 */ }
        pendingSince = new Date().toISOString();
      }
      lastCategory = category;
      firesAt = new Date(Date.now() + quietMs).toISOString();
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, quietMs);
      if (typeof timer.unref === "function") timer.unref();
      trace("notified", { category, source, firesAt });
    } catch (error) {
      logger.warn({ event: "schema-graph-refresh-notify-failed", error: String(error) });
    }
  }

  function getState() {
    return {
      pending: timer !== null,
      pendingSince,
      firesAt,
      pendingCategory: lastCategory,
      lastTriggeredAt,
      lastSkipReason,
      quietMs,
    };
  }

  return { notify, getState };
}

module.exports = { createSchemaGraphRefreshScheduler, DEFAULT_QUIET_MS };
