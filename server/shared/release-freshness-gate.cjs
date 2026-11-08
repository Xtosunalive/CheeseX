// Component: Release-Freshness-Gate
// @responsible: 正式代次读时验活单点——Release sourceCommit 落后于活 Vault HEAD 时，
//   把请求分流到各路由既有的 null-context 活读分支（工作投影），并产出 freshness 标注。
// @context: ADR064。三态语义对齐 source-freshness-service.compareFreshness（fresh/stale/unknown）；
//   零写入面（current.json 写者不变）；unknown（git 不可用/非仓库）fail-open 维持现状读法。
// PR-056：rev-parse 异步化（请求路径禁同步子进程）；withPinnedRelease 底层为 AsyncLocalStorage.run，
//   上下文随异步回调延续（ALS 语义），pin 生命周期不受 await 影响——异步回调安全已核实。

const { runCommand } = require("./async-exec.cjs");

async function readVaultHead(vaultPath) {
  if (!vaultPath) return null;
  try {
    const result = await runCommand("git", ["rev-parse", "HEAD"], { cwd: vaultPath, encoding: "utf8" });
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
  } catch (_error) {
    return null;
  }
}

async function checkFreshness(context, vaultPath, now = () => new Date()) {
  const releaseSourceCommit = context && context.sourceCommit ? String(context.sourceCommit) : null;
  const liveHead = await readVaultHead(vaultPath);
  const checkedAt = now().toISOString();
  if (!releaseSourceCommit || !liveHead || !/^[0-9a-f]{40}$/.test(liveHead)) {
    return { status: "unknown", dataOrigin: context ? "release" : "working-projection", releaseSourceCommit, liveHead, checkedAt };
  }
  const stale = releaseSourceCommit !== liveHead;
  return {
    status: stale ? "stale" : "fresh",
    dataOrigin: stale ? "working-projection" : "release",
    releaseSourceCommit,
    liveHead,
    checkedAt,
  };
}

// 语义契约：
//   fresh/unknown → callback(context, freshness)（context 为 release 上下文，行为与现状一致）
//   stale         → callback(null, freshness)（各路由 null 分支即既有活读实现）
//
// 修订（Master 2026-10-15 裁「2 选 A」）：检索面（release-pinned 索引语义）原排除在本门外，
// 现纳入**标注**语义——kg search-documents/node-documents 数据仍读 pinned（保索引稳定），
// 响应携带 freshness 字段（stale＝正式快照落后于活库 HEAD，已删内容仍可见，前端提示）。
// 与操作/视图面的分流语义并存：分流（null-context 活读）vs 标注（pinned 读＋提示）。
//   无 consumer   → callback(null, null)（与既有 withFormal 的 callback(null) 等价）
function createFreshnessGate({ formalConsumer, vaultPath, now } = {}) {
  async function withFreshness(callback, options) {
    if (!formalConsumer || typeof formalConsumer.withPinnedRelease !== "function") {
      return callback(null, null);
    }
    // PR-139：无 current Release（空库/未发布）按调用方声明分流——options.onEmptyRelease="degrade"
    // 走 null-context 活读（清单/检索面空库空态，article-workflow.currentStandardVersion 同族
    // fail-open 先例）；缺省上抛 404（正式投影面〔classification 等〕发布前 404 是产品语义
    // ——WP-017 独立发布入口头条证明「新库 404→mint→200」依赖此行为）。
    // 结构约束：callback 必须在 withPinnedRelease 回调**内部**执行——withPinnedRelease 底层是
    // AsyncLocalStorage.run，context.readXxx 依赖 pin 内的 releaseId；把 callback 挪到 pin 外
    // 会让 mint 后的正式读取 500（standalone-release-mint 实测）。故空库分流只能外层 try-catch
    //（NO_CURRENT_RELEASE 在 withPinnedRelease 进入时即抛，先于 callback 执行，catch 内降级安全）。
    try {
      return await formalConsumer.withPinnedRelease(async (context) => {
        const freshness = await checkFreshness(context, vaultPath, now);
        if (freshness.status === "stale") return callback(null, freshness);
        return callback(context, freshness);
      });
    } catch (error) {
      const emptyRelease = error && (error.code === "NO_CURRENT_RELEASE" || error.code === "CURRENT_POINTER_INVALID" || error.code === "CURRENT_RELEASE_INVALID" || error.code === "CURRENT_POINTER_MISMATCH");
      if (emptyRelease && options && options.onEmptyRelease === "degrade") {
        // dataOrigin 对齐 checkFreshness 枚举（:27 working-projection）——enforce 契约
        // ArticleManifestQueryData.freshness.dataOrigin 必填，缺则 oneOf 两分支全不匹配（PR-139 首验实录）
        return callback(null, { status: "unknown", dataOrigin: "working-projection", checkedAt: new Date().toISOString(), reason: "no-current-release", degraded: true });
      }
      throw error;
    }
  }
  return { withFreshness };
}

module.exports = { createFreshnessGate, checkFreshness, readVaultHead };
