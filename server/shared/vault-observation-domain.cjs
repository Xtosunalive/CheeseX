// Component: Vault-Observation-Domain
// @responsible: PR-055 观测域单一声明的读取器——contracts/observation-domain.json 是唯一事实源，
//   watcher（监听忽略）/reconcile（漂移扫描排除）/门禁面⑥（洁净度白名单）三消费方同源引用，
//   禁止各写清单（枚举式白名单=补丁，Master 2026-10-13 裁定开发阶段不允许）。
// @inputs: contracts/observation-domain.json；待判定的 vault 相对/绝对路径
// @outputs: isObservationPath() 布尔判定 + loadDeclaration() 声明读取
// @context: Vault（cheese 仓）

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTRACT_PATH = path.resolve(__dirname, "..", "..", "contracts", "observation-domain.json");
let cached = null;

function loadDeclaration() {
  if (cached) return cached;
  cached = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8"));
  if (!cached.dir || typeof cached.dir !== "string" || !cached.dir.startsWith(".")) {
    throw new Error("observation-domain.json 声明非法：dir 必须是 vault 相对路径（. 开头）");
  }
  return cached;
}

/**
 * 判定路径是否落在观测域内。
 * @param {string} targetPath vault 相对路径或绝对路径
 * @param {string} [vaultPath] targetPath 为绝对路径时的 vault 根（用于求相对路径）
 */
function isObservationPath(targetPath, vaultPath) {
  if (!targetPath || typeof targetPath !== "string") return false;
  const dir = loadDeclaration().dir;
  let rel = targetPath;
  if (path.isAbsolute(targetPath)) {
    if (!vaultPath) return false;
    rel = path.relative(path.resolve(vaultPath), targetPath);
  }
  const norm = rel.split(path.sep).join("/");
  return norm === dir || norm.startsWith(dir + "/");
}

module.exports = { isObservationPath, loadDeclaration, CONTRACT_PATH };
