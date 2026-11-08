// Component: Graph-Drift-Refresher
// @responsible: 图族派生物漂移自动刷新（2026-10-15 Master 裁「图族刷新收敛」）——外部写/读时检测
//   源指纹漂移 → 去抖后自动触发管线全量重算（article_graph 用途→staging→post-run 摄取），
//   并顺带清理「源已删除」的孤儿 manifest 行（复用 article-manifest-paths 的 B1 对账工具）。
// @inputs: vaultPath（源指纹扫描域=知识库/ 全树）；derived-index store kv（指纹基线）；
//   pipeline（start/getStatus——start("full",{purpose:"article_graph"}) 与人工全量跑同一语义）
// @outputs: noteExternalActivity（watcher 桥接入口）/ checkAndSchedule（图族读路径入口）/
//   recordRefreshed（管线完成摄取后记基线）
// @context: main.cjs 装配；失败可见=结构化日志＋管线失败经 pipeline_failure 异常问题浮出（既有链）
//
// 设计约束：
// - 去抖合并：事件/读触发共用 quiet 窗（默认 8s），Obsidian 连续编辑只触发一次检查；
// - 在途护栏：管线 running 时不重复启动（getStatus 探测＋PIPELINE_ALREADY_RUNNING 双保险）；
// - 防循环：watcher 只桥接「外部写」（内部通道写不桥接，vault-watcher 归属取证保证）；
//   管线自身的 vault 写经通道记账 → 不回流本刷新器；
// - 基线保守：kv 无基线时只立基线不触发（部署首启不自动跑管线）；基线只在管线成功摄取后记
//   （recordRefreshed）——检查时只比对不预记，重算期间再变化由下一轮事件/读捕获；
// - 逃生口：GRAPH_DRIFT_REFRESH=0 整体停用（沿 VAULT_GIT_LEDGER_DISABLE 先例）。

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { listManifestSources, sourceExists } = require("../article-workflow/article-manifest-paths.cjs");

const KV_BASELINE = "graph_drift.source_fingerprint";
const KV_FAIL_STREAK = "graph_drift.fail_streak";
// 连续失败退避：自动触发的重算连续失败 N 次后停手（等人工/后续成功复位）——防「注定失败的跑
// ×日志事件」自激励循环的第二断路器（第一断路器=指纹排除 log.md；实测：fixture blocker 每
// 跑必败，无退避则每 14s 一轮直至天荒地老）。
const MAX_AUTO_FAILURES = 3;
// 指纹扫描忽略形态：macOS 元数据与 vault-io 原子写瞬态（rename 前后非稳定内容）
const SCAN_IGNORE = /(^|\/)(\.DS_Store|[^/]*\.tmp)$/;
// 指纹排除：管线运行日志（pipeline-runner.py 每跑必追加——不排除会自激励循环：跑→日志变→
// 漂移→再跑。实测红过一轮）。语义性写面（frontmatter 回写/enums 同步）收敛不排除。
const SCAN_EXCLUDE = [/^知识库\/wiki\/log\.md$/];

function createGraphDriftRefresher({ vaultPath, store, pipeline, logger, quietMs = 8000, recheckIntervalMs = 10_000 }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const kv = store.kv;
  let quietTimer = null;
  let lastCheckAt = 0;
  // boot 复位失败计数：重启＝操作者动作（大概率换了代码/环境修因），退避不跨重启死锁
  // 「修复→重启→被旧计数拦住」路径（生产实证：门控修复部署后首跑被 3 败旧账拦）。
  // 滥用面评估：确定性失败重启后 3 败再退避——每次重启最多多跑 3 次，可接受。
  try {
    if (kv.get(KV_FAIL_STREAK) !== null && kv.get(KV_FAIL_STREAK) !== "0") {
      kv.put(KV_FAIL_STREAK, 0);
      log.info({ event: "graph-drift-fail-streak-reset-at-boot" });
    }
  } catch (_e) { /* kv 缺表等——退避语义降级为跨重启，无害 */ }

  function enabled() {
    return process.env.GRAPH_DRIFT_REFRESH !== "0";
  }

  /** 源指纹：知识库/ 全树（路径+大小+mtime）排序哈希——增删改任一变化即漂移。 */
  function computeFingerprint() {
    const root = path.join(vaultPath, "知识库");
    const lines = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { throw Object.assign(new Error("指纹扫描失败: " + dir), { code: "GRAPH_DRIFT_SCAN_FAILED" }); }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(vaultPath, abs).split(path.sep).join("/");
        if (SCAN_IGNORE.test(rel) || SCAN_EXCLUDE.some((re) => re.test(rel))) continue;
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!entry.isFile()) continue;
        let stat;
        try { stat = fs.statSync(abs); } catch { continue; }
        lines.push(`${rel}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
      }
    };
    walk(root);
    lines.sort();
    return "sha256:" + crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
  }

  /** 孤儿 manifest 清行（源已删除）——复用 B1 对账工具，幂等。返回清理数。 */
  function pruneOrphanManifests() {
    let pruned = 0;
    for (const { sourcePath } of listManifestSources(vaultPath)) {
      if (sourceExists(vaultPath, sourcePath)) continue;
      try {
        store.articleManifests.delete(sourcePath.replace(/^知识库\//, ""));
        pruned += 1;
      } catch (error) {
        log.warn({ event: "graph-drift-manifest-prune-failed", sourcePath, error: error.message });
      }
    }
    if (pruned > 0) log.info({ event: "graph-drift-manifests-pruned", count: pruned });
    return pruned;
  }

  /** 核心：比对指纹，漂移且管线空闲 → 自动触发全量重算。 */
  function check(reason) {
    lastCheckAt = Date.now();
    const pruned = pruneOrphanManifests();
    let fingerprint;
    try { fingerprint = computeFingerprint(); } catch (error) {
      log.warn({ event: "graph-drift-fingerprint-failed", error: error.message });
      return { checked: false, pruned };
    }
    const baseline = kv.get(KV_BASELINE);
    if (baseline === null) {
      kv.put(KV_BASELINE, fingerprint);
      log.info({ event: "graph-drift-baseline-established", fingerprint: fingerprint.slice(0, 16) });
      return { checked: true, drifted: false, baseline: true, pruned };
    }
    if (baseline === fingerprint) return { checked: true, drifted: false, pruned };
    // 失败退避：连续失败达上限后停手，直到一次成功（人工或自动）复位
    const failStreak = Number(kv.get(KV_FAIL_STREAK) || 0);
    if (failStreak >= MAX_AUTO_FAILURES) {
      log.warn({ event: "graph-drift-backoff", failStreak, reason });
      return { checked: true, drifted: true, triggered: false, backoff: true, pruned };
    }
    // 漂移：在途护栏（双保险——状态探测＋启动竞争捕获）
    const status = pipeline.getStatus();
    if (status && (status.state === "running" || status.state === "cancelling")) {
      log.info({ event: "graph-drift-detected-pipeline-busy", reason, fingerprint: fingerprint.slice(0, 16) });
      return { checked: true, drifted: true, triggered: false, pruned };
    }
    try {
      pipeline.start("full", { purpose: "article_graph" });
      log.info({ event: "graph-drift-refresh-triggered", reason, fingerprint: fingerprint.slice(0, 16) });
      return { checked: true, drifted: true, triggered: true, pruned };
    } catch (error) {
      if (error && error.code === "PIPELINE_ALREADY_RUNNING") {
        log.info({ event: "graph-drift-refresh-raced-pipeline", reason });
        return { checked: true, drifted: true, triggered: false, raced: true, pruned };
      }
      log.warn({ event: "graph-drift-refresh-trigger-failed", reason, error: error.message });
      return { checked: true, drifted: true, triggered: false, pruned };
    }
  }

  function runQuietCheck(reason) {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      quietTimer = null;
      try { check(reason); } catch (error) { log.warn({ event: "graph-drift-check-crashed", error: error.message }); }
    }, quietMs);
    if (typeof quietTimer.unref === "function") quietTimer.unref();
  }

  /** watcher 外部写桥接入口（只关心知识库/ 域内事件）。 */
  function noteExternalActivity(paths) {
    if (!enabled()) return;
    const hit = (paths || []).some((p) => {
      const rel = path.relative(vaultPath, p).split(path.sep).join("/");
      return rel.startsWith("知识库/");
    });
    if (!hit) return;
    log.info({ event: "graph-drift-external-activity", count: paths.length });
    runQuietCheck("external-write");
  }

  /** 图族读路径入口：节流内不重复检查，静默失败不阻塞读。 */
  function checkAndSchedule() {
    if (!enabled()) return;
    if (quietTimer) return; // 已有静默窗在途，事件会覆盖本次读
    if (Date.now() - lastCheckAt < recheckIntervalMs) return;
    try { check("read-time"); } catch (error) { log.warn({ event: "graph-drift-check-crashed", error: error.message }); }
  }

  /** 管线成功摄取后记基线（main.cjs post-run 钩子接线；再清一次孤儿行）。 */
  function recordRefreshed() {
    try {
      const pruned = pruneOrphanManifests();
      const fingerprint = computeFingerprint();
      kv.put(KV_BASELINE, fingerprint);
      log.info({ event: "graph-drift-baseline-recorded", fingerprint: fingerprint.slice(0, 16), pruned });
    } catch (error) {
      log.warn({ event: "graph-drift-record-failed", error: error.message });
    }
  }

  /** 管线终态观察（completion 钩子接线，成功/失败均达）：成功复位失败计数，失败累加。 */
  function noteRunOutcome(finished) {
    try {
      if (finished && finished.state === "succeeded") {
        if (kv.get(KV_FAIL_STREAK) !== null && kv.get(KV_FAIL_STREAK) !== "0") kv.put(KV_FAIL_STREAK, 0);
        return;
      }
      const streak = Number(kv.get(KV_FAIL_STREAK) || 0) + 1;
      kv.put(KV_FAIL_STREAK, streak);
      log.warn({ event: "graph-drift-auto-run-failed", streak, state: finished && finished.state });
    } catch (error) {
      log.warn({ event: "graph-drift-outcome-record-failed", error: error.message });
    }
  }

  function dispose() {
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
  }

  return { noteExternalActivity, checkAndSchedule, recordRefreshed, noteRunOutcome, check, dispose };
}

module.exports = { createGraphDriftRefresher, GRAPH_DRIFT_KV_KEY: KV_BASELINE };
