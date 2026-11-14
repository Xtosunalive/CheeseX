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
// - 内容寻址（PR-307）：漂移＝内容变化，非 mtime 变化——stat（路径+大小+mtime）只作初筛，
//   初筛变化者再按内容哈希确认；同内容重写（派生缓存/状态面每轮无条件重写，mtime 抖动）被
//   吸收为不漂移。实测（2026-11-15 dev 栈实录）：mtime 指纹下 graph-status.md（管线自有产物，
//   每跑重写）×_enums-cache.md（watcher 桥同步每轮重写）自激励 ~15s 一轮空跑管线，PR-301
//   退避咬不住——每轮成功即時比对都「稳定」清零，尾巴写在比对之后落盘。
// - 基线保守：kv 无基线时只立基线不触发（部署首启不自动跑管线）；基线只在管线成功摄取后记
//   （recordRefreshed）；检查路径只允许「同内容 mtime 吸收」这一种等价重写（内容哈希已验证
//   相等），不做预记；重算期间再变化由下一轮事件/读捕获；
// - 逃生口：GRAPH_DRIFT_REFRESH=0 整体停用（沿 VAULT_GIT_LEDGER_DISABLE 先例）。

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { listManifestSources, sourceExists } = require("../article-workflow/article-manifest-paths.cjs");

const KV_BASELINE = "graph_drift.source_fingerprint";
const KV_FAIL_STREAK = "graph_drift.fail_streak";
// PR-301：成功后仍漂移计数——管线成功但内容指纹仍漂移＝自激励循环，再跑也无济于事。
// 达上限停手等人工干预，成功且指纹稳定即复位（PR-307 内容寻址后仍保留作第二断路器）。
const KV_DRIFT_AFTER_SUCCESS = "graph_drift.drift_after_success";
const MAX_DRIFT_AFTER_SUCCESS = 3;
// 连续失败退避：自动触发的重算连续失败 N 次后停手（等人工/后续成功复位）——防「注定失败的跑
// ×日志事件」自激励循环的第二断路器（第一断路器=指纹排除 log.md；实测：fixture blocker 每
// 跑必败，无退避则每 14s 一轮直至天荒地老）。
const MAX_AUTO_FAILURES = 3;
// 指纹扫描忽略形态：macOS 元数据与 vault-io 原子写瞬态（rename 前后非稳定内容）
const SCAN_IGNORE = /(^|\/)(\.DS_Store|[^/]*\.tmp)$/;
// 指纹排除：管线每跑必写的自有产物（不排除会自激励循环：跑→文件变→漂移→再跑）：
// - log.md：pipeline-runner.py 每跑追加（内容单调增长，实测红过一轮）；
// - graph-status.md：extract_graph --apply 每跑整文件重生成，内容嵌「上次抽取」时间戳
//   （PR-307 实测：内容与 mtime 每跑双变，内容寻址也拦不住，只能按产物排除）。
// 语义性写面（frontmatter 回写/enums 同步）不排除——交给内容确认吸收同内容抖动。
const SCAN_EXCLUDE = [/^知识库\/wiki\/log\.md$/, /^知识库\/wiki\/graph-status\.md$/];

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
    if (kv.get(KV_DRIFT_AFTER_SUCCESS) !== null && kv.get(KV_DRIFT_AFTER_SUCCESS) !== "0") {
      kv.put(KV_DRIFT_AFTER_SUCCESS, 0); // PR-301：重启复位（同失败退避语义）
    }
  } catch (_e) { /* kv 缺表等——退避语义降级为跨重启，无害 */ }

  function enabled() {
    return process.env.GRAPH_DRIFT_REFRESH !== "0";
  }

  /** 源指纹 v2（PR-307 内容寻址）：
   *  - statMap：知识库/ 全树（路径+大小+mtime）——stat 只作初筛（mtime 抖动的同内容重写在此浮出）；
   *  - 基线：JSON {v:2, files:{rel:{size,mtimeMs,sha}}}；旧值（"sha256:..." 字符串）
   *    视为无基线 → 首检重立不触发（既有保守语义），一次性迁移；
   *  - 确认：初筛变化者逐文件内容哈希比对——内容相等＝吸收新 mtime（等价重写，不漂移）；
   *    增/删/内容变＝真漂移。 */
  function scanStatMap() {
    const root = path.join(vaultPath, "知识库");
    const files = new Map();
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
        files.set(rel, { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
      }
    };
    walk(root);
    return files;
  }

  function hashFileContent(abs) {
    return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  }

  function writeBaseline(files) {
    kv.put(KV_BASELINE, JSON.stringify({ v: 2, files: Object.fromEntries(files) }));
  }

  function readBaseline() {
    const raw = kv.get(KV_BASELINE);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 2 || !parsed.files || typeof parsed.files !== "object") return null;
      return parsed;
    } catch { return null; } // 旧字符串形态（v1 mtime 指纹）——视为无基线重立
  }

  /** 全量记基线：逐文件内容哈希（recordRefreshed 专用——管线成功后一次全量，量级＝知识库全树）。 */
  function buildFullBaseline() {
    const statMap = scanStatMap();
    const files = new Map();
    for (const [rel, stat] of statMap) {
      files.set(rel, { ...stat, sha: hashFileContent(path.join(vaultPath, rel)) });
    }
    return files;
  }

  /** 初筛＋内容确认。返回 { noBaseline:true } | { drifted, changed:[rel...], absorbed:Map, churn:boolean }
   *  absorbed＝内容等价视角下的全量映射（未变条目沿用基线、同内容重写吸收新 stat），
   *  churn＝本轮存在 stat 抖动（drifted=false 且 churn=true 时调用方回写吸收，防每轮重复
   *  哈希同一批抖动文件；稳态零抖动不回写）。
   *  已知边界（红队记档①，v1 同形未扩大）：同尺寸＋mtime 精确复原基线值的真改不触发重哈希
   *  （cp -p/rsync -a/touch -r 类 mtime 保留工具＋等长内容）——本库写路径均产新 mtime 不落此窗，
   *  且任何后续 mtime 变化都会连带检出此前被吞的变化。 */
  function confirmAgainstBaseline() {
    const baseline = readBaseline();
    if (!baseline) return { noBaseline: true };
    const statMap = scanStatMap();
    const baselineFiles = baseline.files;
    const absorbed = new Map();
    const changed = [];
    let churn = false;
    for (const [rel, stat] of statMap) {
      const prior = baselineFiles[rel];
      if (!prior) { changed.push(rel); continue; } // 新文件
      const statSame = prior.size === stat.size && prior.mtimeMs === stat.mtimeMs;
      if (statSame) { absorbed.set(rel, prior); continue; } // 初筛未变——沿用基线（免读盘）
      let sha;
      try { sha = hashFileContent(path.join(vaultPath, rel)); }
      catch { changed.push(rel); continue; } // 读失败＝按变化处理（保守触发）
      if (sha === prior.sha) { absorbed.set(rel, { ...stat, sha }); churn = true; continue; } // 同内容重写——吸收新 stat
      changed.push(rel); // 内容真变
    }
    for (const rel of Object.keys(baselineFiles)) {
      if (!statMap.has(rel)) changed.push(rel); // 文件删除
    }
    return { drifted: changed.length > 0, changed, absorbed, churn };
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

  /** 核心：内容指纹比对（PR-307 内容寻址），漂移且管线空闲 → 自动触发全量重算。 */
  function check(reason) {
    lastCheckAt = Date.now();
    const pruned = pruneOrphanManifests();
    let confirmed;
    try { confirmed = confirmAgainstBaseline(); } catch (error) {
      log.warn({ event: "graph-drift-fingerprint-failed", error: error.message });
      return { checked: false, pruned };
    }
    if (confirmed.noBaseline) {
      try {
        const files = buildFullBaseline();
        writeBaseline(files);
        log.info({ event: "graph-drift-baseline-established", files: files.size });
      } catch (error) {
        log.warn({ event: "graph-drift-baseline-establish-failed", error: error.message });
        return { checked: false, pruned };
      }
      return { checked: true, drifted: false, baseline: true, pruned };
    }
    if (!confirmed.drifted) {
      // 同内容 mtime 吸收回写（内容哈希已验证相等——等价基线，非预记）：防每轮检查重复
      // 哈希同一批抖动文件（派生缓存/状态面每轮无条件重写）。仅本轮确有抖动才回写（稳态零写）；
      // 回写失败可观测不阻断（下轮重哈希同一批文件，功能无损——红队记档③补观测）。
      if (confirmed.churn) {
        try { writeBaseline(confirmed.absorbed); }
        catch (error) { log.warn({ event: "graph-drift-churn-absorb-failed", error: error.message }); }
      }
      return { checked: true, drifted: false, pruned };
    }
    // 失败退避：连续失败达上限后停手，直到一次成功（人工或自动）复位
    const failStreak = Number(kv.get(KV_FAIL_STREAK) || 0);
    if (failStreak >= MAX_AUTO_FAILURES) {
      log.warn({ event: "graph-drift-backoff", failStreak, reason });
      return { checked: true, drifted: true, triggered: false, backoff: true, pruned };
    }
    // PR-301 成功后仍漂移退避：连续 N 次成功但指纹仍漂移＝自激励循环（dev 服务 619 次实录），
    // 更多管线跑不会收敛。停手等人工处理（改代码/改数据/重启复位）。
    const driftAfterSuccess = Number(kv.get(KV_DRIFT_AFTER_SUCCESS) || 0);
    if (driftAfterSuccess >= MAX_DRIFT_AFTER_SUCCESS) {
      log.warn({ event: "graph-drift-loop-backoff", driftAfterSuccess, reason, hint: "连续成功仍漂移——自激励循环，停自动触发" });
      return { checked: true, drifted: true, triggered: false, loopBackoff: true, pruned };
    }
    // 漂移：在途护栏（双保险——状态探测＋启动竞争捕获）
    const status = pipeline.getStatus();
    if (status && (status.state === "running" || status.state === "cancelling")) {
      log.info({ event: "graph-drift-detected-pipeline-busy", reason, changed: confirmed.changed });
      return { checked: true, drifted: true, triggered: false, pruned };
    }
    try {
      pipeline.start("full", { purpose: "article_graph" });
      log.info({ event: "graph-drift-refresh-triggered", reason, changed: confirmed.changed });
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

  /** 管线成功摄取后记基线（main.cjs post-run 钩子接线；再清一次孤儿行）。PR-307：全树内容哈希。 */
  function recordRefreshed() {
    try {
      const pruned = pruneOrphanManifests();
      const files = buildFullBaseline();
      writeBaseline(files);
      log.info({ event: "graph-drift-baseline-recorded", files: files.size, pruned });
    } catch (error) {
      log.warn({ event: "graph-drift-record-failed", error: error.message });
    }
  }

  /** PR-301：管线成功且指纹稳定（下次 check 不再触发）→ 复位自激励计数。 */
  function noteFingerprintStable() {
    try {
      if (kv.get(KV_DRIFT_AFTER_SUCCESS) !== null && kv.get(KV_DRIFT_AFTER_SUCCESS) !== "0") {
        kv.put(KV_DRIFT_AFTER_SUCCESS, 0);
        log.info({ event: "graph-drift-loop-counter-reset" });
      }
    } catch (_e) { /* kv 缺表等，无害 */ }
  }

  /** PR-301：管线成功但下次 check 仍将触发（成功未收敛漂移）→ 计数递增。 */
  function noteDriftAfterSuccess() {
    try {
      const count = Number(kv.get(KV_DRIFT_AFTER_SUCCESS) || 0) + 1;
      kv.put(KV_DRIFT_AFTER_SUCCESS, count);
      log.warn({ event: "graph-drift-after-success", count, max: MAX_DRIFT_AFTER_SUCCESS });
    } catch (_e) { /* kv 缺表等，无害 */ }
  }

  /** 管线终态观察（completion 钩子接线，成功/失败均达）：成功复位失败计数，失败累加。 */
  function noteRunOutcome(finished) {
    try {
      if (finished && finished.state === "succeeded") {
        if (kv.get(KV_FAIL_STREAK) !== null && kv.get(KV_FAIL_STREAK) !== "0") kv.put(KV_FAIL_STREAK, 0);
        // PR-301/PR-307：成功后立刻内容确认，与基线（recordRefreshed 已更新）比对——不等
        // 下次 check 才发现仍在漂移。稳定（含同内容 mtime 抖动被吸收）＝复位计数；
        // 内容仍漂移＝递增（自激励候选，第二断路器）。
        try {
          const confirmed = confirmAgainstBaseline();
          if (confirmed.noBaseline || !confirmed.drifted) noteFingerprintStable();
          else noteDriftAfterSuccess();
        } catch (_e) { /* 指纹计算失败不阻断结果记录 */ }
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
