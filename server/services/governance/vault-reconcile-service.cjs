// Component: Vault-Reconcile-Service
// @responsible: 运行时周期对账——双层漂移判定（SPEC-011 WP4）
// @context: Canvas (server 进程)
//
// 双层判定：
//   层一（git diff HEAD）：已入库内容被外部改动 → 漂移
//   层二（git status）：工作区有未提交变更 → 脏
// 结果落 telemetry.db（SPEC-012 WP-B：④类痕迹迁库——reconcile-run 心跳＋vault-drift 明细）；
// health 端点暴露 lastReconcileAt
// 不在路由模块注册（路由会多次实例化），必须在 main.cjs 顶层 setInterval
//
// PR-056：git 调用一律异步（execFile）——同步子进程会在 git 慢时冻结事件循环（最坏 5×10s），
// runner 可注入供测试构造慢 git 断言非阻塞。
// SPEC-012 WP-J：观测域过渡消费摘除——.ledger/health/ 已构造性不存在（痕迹住 telemetry.db，
// boot 导入即移除；第 23 号门禁反向断言回流），漂移排除里的观测域分支是死代码。

"use strict";

const path = require("path");
const fs = require("fs");
const { execFile } = require("node:child_process");

// SPEC-012 WP-B：漂移/心跳痕迹迁 telemetry.db
const { getTelemetryStore, TRACE_KINDS } = require("../../shared/persistence/telemetry-store.cjs");
const { selfAccountedVaultFiles, ignoredFormsFor } = require("../../shared/vault-write-destinations.cjs");

// SPEC-012 结构收口批：层一漂移盯防面从 theschema.registry 单源派生——新增 TheSchema 文档
// 只改注册表（documents 加一行＋schema 文件），本清单不再手工跟（「注册了却没盯/盯了却没注册」这类问题消灭）
const SCHEMA_FILES = (() => {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "contracts", "theschema.registry.json"), "utf-8"));
    return Object.keys(registry.documents || {}).map((name) => `知识库/TheSchema/${name}.yaml`);
  } catch {
    return [];
  }
})();

/**
 * createVaultReconcileService — 创建周期对账服务
 *
 * @param {{ vaultPath: string, logger?: object, intervalMs?: number, gitRunner?: Function }} options
 *   gitRunner: (args: string[]) => Promise<string>——可注入假 runner（测试非阻塞/漂移判定）
 *   vaultIO 参数已退役（SPEC-012 WP-B：痕迹写迁 telemetry.db，见 getTelemetryStore）
 * @returns {{ start, stop, getLastReconcileAt, runReconcile }}
 */
function createVaultReconcileService({ vaultPath, logger, intervalMs = 5 * 60 * 1000, gitRunner }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  // PR-056：异步 git——execFile 不阻塞事件循环；默认单次 10s 超时与原版一致
  const runGit = gitRunner || function runGitDefault(args) {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: vaultPath, encoding: "utf8", timeout: 10000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  };
  let lastReconcileAt = null;
  let timer = null;
  let running = false; // 防重入：周期重叠时跳过本轮（异步化后可能出现上轮未完下轮到点）

  async function runReconcile() {
    if (running) return;
    running = true;
    try {
      const driftFiles = [];
      const dirtyFiles = [];

      // 层一：git diff HEAD — 检测已入库内容被改动
      for (const rel of SCHEMA_FILES) {
        const absPath = path.join(vaultPath, rel);
        if (!fs.existsSync(absPath)) continue;
        try {
          const out = await runGit(["-c", "core.quotepath=false", "diff", "HEAD", "--", rel]);
          if (out.trim()) driftFiles.push(rel);
        } catch {
          // git 不可用时跳过该文件
        }
      }

      // 层二：git status --porcelain — 工作区洁净度
      try {
        const statusOut = await runGit(["-c", "core.quotepath=false", "status", "--porcelain"]);
        // SPEC-012 F2 修复批：⑤类自管系统文件（流水/通道日志——落账内建于写路径）不算漂移证据，
        // 排除面从 destinations 契约单源派生，消费方不自写清单
        const selfAccounted = new Set(selfAccountedVaultFiles());
        const ignoredClean = ignoredFormsFor("git-clean");
        for (const line of statusOut.trim().split("\n").filter(Boolean)) {
          const rel = line.trim().replace(/^\S+\s+/, "").replace(/^"|"$/g, "");
          if (selfAccounted.has(rel)) continue;
          if (ignoredClean.some((re) => re.test(rel))) continue; // 非治理形态（swp/~ 等）不是漂移证据
          dirtyFiles.push(line.trim());
        }
      } catch {
        // git 不可用时跳过
      }

      const now = new Date().toISOString();
      lastReconcileAt = now;
      const telemetry = getTelemetryStore(vaultPath);

      // SPEC-012 WP-B：④类痕迹迁 telemetry.db——每轮记 heartbeat（reconcile-run，/api/health 据此算
      // lastReconcileAt/reconcileStale）；有漂移另记 vault-drift 明细。观测自指构造性解（vault 无 health 落盘）
      telemetry.recordTrace(TRACE_KINDS.RECONCILE_RUN, { checkedAt: now, dirty: driftFiles.length > 0 || dirtyFiles.length > 0, driftCount: driftFiles.length, dirtyCount: dirtyFiles.length });

      if (driftFiles.length > 0 || dirtyFiles.length > 0) {
        telemetry.recordTrace(TRACE_KINDS.VAULT_DRIFT, { checkedAt: now, driftFiles, dirtyFiles });
        log.warn({ event: "vault-reconcile-drift-detected", driftFiles, dirtyCount: dirtyFiles.length });
      } else {
        log.info({ event: "vault-reconcile-clean", checkedAt: now });
      }
    } catch (err) {
      log.warn({ event: "vault-reconcile-error", error: err.message });
    } finally {
      running = false;
    }
  }

  function start() {
    runReconcile().catch(() => {}); // 立即执行一次（异步，不阻塞启动）
    timer = setInterval(() => { runReconcile().catch(() => {}); }, intervalMs);
    if (timer.unref) timer.unref(); // 不阻止进程退出
    log.info({ event: "vault-reconcile-started", intervalMs });
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function getLastReconcileAt() { return lastReconcileAt; }

  return { start, stop, getLastReconcileAt, runReconcile };
}

module.exports = { createVaultReconcileService };
