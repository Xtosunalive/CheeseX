// Component: Vault-Id — frozen vault identity algorithm.
// @responsible: 对 fs.realpathSync(vaultPath) 计算 SHA-256，取前 16 hex chars。
//   客户端（Obsidian 插件）和服务端（本模块）必须使用完全相同的算法。
// @inputs: vaultPath (绝对路径)
// @outputs: 16 字符 hex vaultId
// @context: Sync
const crypto = require("crypto");
const fs = require("fs");

/**
 * 计算稳定的 Vault 标识。
 * 算法冻结：fs.realpathSync(vaultPath) → SHA-256(UTF-8 bytes) → hex → slice(0, 16)
 * 禁止使用未经 fs.realpathSync 规范化的路径直接计算 hash。
 * @param {string} vaultPath - Vault 根目录绝对路径
 * @returns {string} 前 16 个十六进制字符
 */
function computeVaultId(vaultPath) {
  const realPath = fs.realpathSync(vaultPath);
  const hash = crypto.createHash("sha256");
  hash.update(realPath, "utf8");
  return hash.digest("hex").slice(0, 16);
}

module.exports = { computeVaultId };
