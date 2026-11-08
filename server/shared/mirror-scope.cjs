// Component: Mirror-Scope（WP-076·runtime-scope 域登记解析器）
// @responsible: `DECISIONS_MIRROR_DIR` 的唯一解析点——裁决镜像落点三档：**钉扎 ＞ 登记真库确认 ＞ 拒**
//   （runtime-scope 规则 `no_implicit_fallback_on_write`：写路径上作用域变量缺席即 fail-closed；
//    同族先例＝V01 `merge-inferred._trajectory_dir()`、V05 `kb_paths.data_dir()`）。
//   登记真库＝本仓 `.env` 的 VAULT_PATH（无 .env 退 process.env.VAULT_PATH）；镜像的定义是
//   「那个登记库的字节级副本」（contracts/data-territory.json:governance-mirror.authority），
//   所以源不等于登记库就没有资格写仓内默认落点——夹具/他库/临时覆盖态一律拒，出口只有一条：显式钉。
// @inputs: 源 vaultPath（要镜像哪个库）＋环境变量 DECISIONS_MIRROR_DIR／VAULT_PATH／.env
// @outputs: { destDir, sandboxed, reason }；不可解析即 throw（MirrorScopeError，调用方按既有 fail-open 包装降级为告警）
// @context: 登记条目 contracts/runtime-scope.json resolvers:mirror-scope-resolve；
//   本文件是「登记解析器本体」，含 data/governance 字面量属登记语义（门禁②面对象豁免见 check-runtime-scope EXEMPT）。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DEST_DIR = path.join(ROOT, "data", "governance");

class MirrorScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "MirrorScopeError";
    // 不设 code：登记解析器的拒写是装配级信号、无 HTTP 消费者——同族先例 theschema-root.cjs:26
    // 用「NAME: 消息」前缀形，不新增 error-code 欠账（内部通道码须有消费方才立，见 PR-086 定性）
  }
}

/** 登记真库单源：.env 的 VAULT_PATH 优先（那是本仓「镜像归属哪个库」的一次登记），无 .env 退 env。 */
function registeredVaultRoot() {
  const { loadEnvFile } = require("./env-load.cjs");
  const fromEnvFile = loadEnvFile(path.join(ROOT, ".env")).VAULT_PATH;
  if (fromEnvFile) return path.resolve(String(fromEnvFile).trim());
  return process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : null;
}

/**
 * 解析裁决镜像落点。
 * @param {string} sourceVaultPath 本次要镜像的 vault（源）
 * @returns {{destDir: string, sandboxed: boolean, reason: string}}
 * @throws {MirrorScopeError} 三档皆不成立（缺席回落＝写路径禁，规则 no_implicit_fallback_on_write）
 */
function resolveMirrorDestDir(sourceVaultPath) {
  const pinned = process.env.DECISIONS_MIRROR_DIR;
  if (pinned) return { destDir: path.resolve(pinned), sandboxed: true, reason: "DECISIONS_MIRROR_DIR 显式钉扎——落沙箱，仓内真账面不受影响" };

  const authority = registeredVaultRoot();
  if (!authority) {
    throw new MirrorScopeError("MIRROR_SCOPE_UNRESOLVED: 镜像落点不可解析：登记真库缺失（.env 无 VAULT_PATH 且环境变量亦未设）——写路径不允许按脚本位置猜；出口：钉 DECISIONS_MIRROR_DIR（测试/CI）或补登记 VAULT_PATH");
  }
  if (!sourceVaultPath) {
    throw new MirrorScopeError("MIRROR_SCOPE_UNRESOLVED: 镜像落点不可解析：未给出源 vault——无法判定它是否登记真库；出口：给源或钉 DECISIONS_MIRROR_DIR");
  }
  if (path.resolve(sourceVaultPath) !== authority) {
    throw new MirrorScopeError(`MIRROR_SCOPE_UNRESOLVED: 镜像落点拒绝：源非登记真库（源 ${path.resolve(sourceVaultPath)} ≠ 登记 ${authority}）——夹具/他库态不配拥有仓内默认镜像；出口：钉 DECISIONS_MIRROR_DIR`);
  }
  return { destDir: DEFAULT_DEST_DIR, sandboxed: false, reason: "源＝登记真库——落仓内默认镜像住址" };
}

module.exports = { resolveMirrorDestDir, registeredVaultRoot, MirrorScopeError, DEFAULT_DEST_DIR };
