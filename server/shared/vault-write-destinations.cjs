// Component: Vault-Write-Destinations
// @responsible: SPEC-012 F1 写通道目的地执法——contracts/vault-write-destinations.json 的读取与判定。
//   vault-io 唯一写通道的每次写入先经 assertVaultWriteDestination（越界 throw，fail-closed）；
//   check:vault-write-destinations 静态门禁同源读同一契约。堵「新投影经合法通道写回 vault」的复发门。
// @inputs: contracts/vault-write-destinations.json（单源）；vaultPath + 待写绝对路径
// @outputs: assertVaultWriteDestination / isDeclaredVaultDestination / loadDestinations
// @context: Vault（cheese 仓）
//
// 匹配语义（与契约 $comment 同源）：声明键以 / 结尾＝目录前缀匹配，否则＝精确文件匹配。
// allowedPermanent＝①⑤类终态落点；migrationWhitelist＝②③④迁移期暂存（只减不增，由静态门禁棘轮执法）。
// 运行时只拦「vault 内」写入：vault 根之外的路径不经 vault-io（data/ 目录写走 persistence 层，不经本通道）。

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTRACT_PATH = path.resolve(__dirname, "..", "..", "contracts", "vault-write-destinations.json");
let cached = null;

function loadDestinations() {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8"));
  if (!raw || typeof raw !== "object") throw new Error("vault-write-destinations.json 声明非法：根必须是对象");
  if (!raw.allowedPermanent || typeof raw.allowedPermanent !== "object" || Object.keys(raw.allowedPermanent).length === 0) {
    throw new Error("vault-write-destinations.json 声明非法：allowedPermanent 不得为空");
  }
  if (!raw.migrationWhitelist || typeof raw.migrationWhitelist !== "object") {
    throw new Error("vault-write-destinations.json 声明非法：migrationWhitelist 必须是对象");
  }
  for (const key of [...Object.keys(raw.allowedPermanent), ...Object.keys(raw.migrationWhitelist)]) {
    if (typeof key !== "string" || key.length === 0 || key.startsWith("/") || key.includes("\\") || key.includes("..")) {
      throw new Error(`vault-write-destinations.json 声明非法：键 ${JSON.stringify(key)} 必须是正向 vault 相对路径`);
    }
  }
  cached = raw;
  return cached;
}

/** 测试缝：换契约后清缓存（生产代码不调用）。 */
function resetDestinationCache() {
  cached = null;
}

function normalizeRel(rel) {
  return rel.split(path.sep).join("/");
}

function matchesDeclaredKey(declaredKey, rel) {
  if (declaredKey.endsWith("/")) return rel.startsWith(declaredKey);
  return rel === declaredKey;
}

/**
 * 判定 vault 内相对路径是否落在声明目的地内。
 * @param {string} rel 正斜杠形式的 vault 相对路径
 */
function isDeclaredRelative(rel) {
  const { allowedPermanent, migrationWhitelist } = loadDestinations();
  const keys = [...Object.keys(allowedPermanent), ...Object.keys(migrationWhitelist)];
  return keys.some((key) => matchesDeclaredKey(key, rel));
}

/**
 * 路径归一（macOS /tmp→/private/tmp、/var→/private/var 同族）：对「最深现存祖先」做 realpath
 * 再回拼余段——写前目标常不存在，直接 realpath 会失败，直接 resolve 又可能保留 symlink 前缀
 * 与已 realpath 的 vault 根错位（e2e 实证：/var/folders 根 × /private/var/folders 目标误判越界）。
 */
function canonicalize(targetPath) {
  const resolved = path.resolve(targetPath);
  let current = resolved;
  const suffix = [];
  while (!fs.existsSync(current)) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) return resolved; // 到根都不存在——退回 resolve 形态
    current = parent;
  }
  try {
    return path.join(fs.realpathSync(current), ...suffix);
  } catch {
    return resolved;
  }
}

function normalizedRootPair(vaultPath, targetPath) {
  const root = canonicalize(vaultPath);
  return { root, target: canonicalize(targetPath) };
}

/**
 * 判定绝对路径是否为已声明的 vault 写入目的地。
 * @param {string} vaultPath vault 根
 * @param {string} targetPath 待写绝对路径
 */
function isDeclaredVaultDestination(vaultPath, targetPath) {
  const { root, target } = normalizedRootPair(vaultPath, targetPath);
  const rel = normalizeRel(path.relative(root, target));
  if (rel.startsWith("../") || path.isAbsolute(rel)) return false; // vault 外不经本通道管辖
  return isDeclaredRelative(rel);
}

/**
 * vault-io 写入前执法（fail-closed）：目的地不在契约声明内即 throw。
 * @param {string} vaultPath vault 根
 * @param {string} targetPath 待写绝对路径
 * @throws {Error} code=VAULT_WRITE_DESTINATION_REJECTED（vault 内未声明目的地）
 */
function assertVaultWriteDestination(vaultPath, targetPath) {
  const { root, target } = normalizedRootPair(vaultPath, targetPath);
  const rel = normalizeRel(path.relative(root, target));
  if (rel.startsWith("../") || path.isAbsolute(rel)) {
    // vault 根之外的写入不应走 vault 通道（data/ 走 persistence 层）——编程错误，同样拦截
    throw Object.assign(
      new Error(`vault-io 目的地执法：${targetPath} 在 vault 根（${vaultPath}）之外——vault 通道只写 vault，应用运行时数据走 persistence 层（KB_DATA_DIR）`),
      { code: "VAULT_WRITE_DESTINATION_REJECTED", rel },
    );
  }
  if (isDeclaredRelative(rel)) return;
  throw Object.assign(
    new Error(
      `vault-io 目的地执法：${rel} 不在 contracts/vault-write-destinations.json 声明内（SPEC-012 F1）。` +
        `②③④类数据住 data/ 持久层；确属①⑤类新落点须先修订 SPEC 再改契约。`,
    ),
    { code: "VAULT_WRITE_DESTINATION_REJECTED", rel },
  );
}

/**
 * 自管落账的⑤类系统文件清单（vault 相对路径）——reconcile 层二漂移排除与门禁⑥洁净度白名单
 * 的同源事实源（SPEC-012 F2 修复批：排除面单源声明派生，消费方禁止自写清单）。
 */
function selfAccountedVaultFiles() {
  const { allowedPermanent } = loadDestinations();
  return Object.entries(allowedPermanent)
    .filter(([, meta]) => meta && typeof meta === "object" && meta.selfAccounted === true)
    .map(([key]) => key);
}

/**
 * 非治理对象形态派生（vault 文件治理单一事实源 ignoredForms）——watcher 监听忽略、
 * 门禁⑥洁净度白名单、reconcile 层二漂移排除三消费方同源取用（SPEC-012 结构收口批：
 * 「双处同步维护」这一类问题构造性消灭）。
 * @param {"watcher"|"git-clean"} consumer 消费面
 * @returns {RegExp[]} 该面适用的形态正则集
 */
function ignoredFormsFor(consumer) {
  const forms = loadDestinations().ignoredForms && Array.isArray(loadDestinations().ignoredForms.forms)
    ? loadDestinations().ignoredForms.forms
    : [];
  return forms
    .filter((form) => form && form.consumers && form.consumers.includes(consumer))
    .map((form) => new RegExp(form.pattern));
}

module.exports = {
  CONTRACT_PATH,
  loadDestinations,
  isDeclaredVaultDestination,
  assertVaultWriteDestination,
  resetDestinationCache,
  canonicalize,
  selfAccountedVaultFiles,
  ignoredFormsFor,
};
