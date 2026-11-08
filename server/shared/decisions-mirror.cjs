// Component: Decisions-Mirror（Master 2026-10-19「做」——裁定账本仓内只读镜像）
// @responsible: 裁定账本（vault .ledger/decisions.jsonl，唯一事实源）→ 仓内只读投影
//   data/governance/decisions-mirror.jsonl（字节级镜像）。写侧零改动（vault 追加照旧）；
//   镜像由三个时机刷新：裁定追加后 fire-and-forget／post-commit 钩子（vault git 提交后）／
//   手动 npm run mirror:decisions。镜像只读——消费方（审计/统计/评审工具）读仓内副本，
//   不得写；漂移自愈（每次刷新全量重拷——追加型数据，字节一致即零漂移）。
// @context: WP-076 起本件**不再自拼落点**——`DECISIONS_MIRROR_DIR` 的解析搬进登记解析器
//   server/shared/mirror-scope.cjs（钉扎＞登记真库确认＞拒）。此前形态是「变量缺席就按 __dirname
//   猜仓根写 data/governance」，靠每个测试文件自觉钉环境变量兜（加固批 a620c2a5 逐件钉，
//   漏一件即复发：b3-fresh-validation-receipt.test.cjs 实测裸跑把镜像 41→1 行）。
//   哈希自证强度不动（PR-114 签收＝失配只告警不阻断，下次刷新全量重拷自愈）。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveMirrorDestDir, MirrorScopeError } = require("./mirror-scope.cjs");

function mirrorDecisions(vaultPath, logger) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const { getDecisionsLogPath } = require("../vault-paths.cjs"); // PR-243 批B：账本路径单源
  const src = getDecisionsLogPath(path.resolve(vaultPath));
  let resolved;
  try {
    resolved = resolveMirrorDestDir(vaultPath);
  } catch (e) {
    if (!(e instanceof MirrorScopeError)) {
      log.warn({ event: "decisions-mirror-failed", error: e.message });
      return { mirrored: false, error: e.message };
    }
    // 拒绝不静默：error 字段置上——消费口 approval-state-machine 的 !mirrored&&error 告警面才显形
    log.warn({ event: "decisions-mirror-scope-refused", src, reason: e.message });
    return { mirrored: false, reason: "scope-refused", error: e.message };
  }
  const destDir = resolved.destDir;
  const dest = path.join(destDir, "decisions-mirror.jsonl");
  if (!fs.existsSync(src)) return { mirrored: false, reason: "源账本不存在" };
  try {
    const raw = fs.readFileSync(src);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, raw); // eslint-disable-line no-restricted-syntax -- 仓内治理数据镜像（data/governance 非 vault 面——vault 源只读）
    // WP-019（PR-114）：拷后回读哈希自证——「字节一致即零漂移」从假设变断言（拷贝中断/磁盘错误可检测；
    // 模式先例＝derived_artifacts.content_hash 内容寻址）。失配只告警不阻断（下次刷新全量重拷自愈）。
    const written = fs.readFileSync(dest);
    const hashVerified = written.length === raw.length && crypto.createHash("sha256").update(written).digest("hex") === crypto.createHash("sha256").update(raw).digest("hex");
    if (!hashVerified) {
      log.warn({ event: "decisions-mirror-hash-mismatch", src, dest, srcBytes: raw.length, destBytes: written.length });
    }
    const lines = raw.length ? raw.toString("utf8").split("\n").filter(Boolean).length : 0;
    return { mirrored: true, lines, bytes: raw.length, hashVerified, sandboxed: resolved.sandboxed };
  } catch (e) {
    log.warn({ event: "decisions-mirror-failed", error: e.message });
    return { mirrored: false, error: e.message };
  }
}

module.exports = { mirrorDecisions };
