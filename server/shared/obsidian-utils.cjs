// Component: Obsidian-Utils
// @responsible: Derive vault name and build obsidian://open deep links
// @inputs: vaultPath (absolute), relativePath (from vault root)
// @outputs: vaultName, Obsidian protocol URI
// @context: Vault

const path = require("path");

/**
 * Derive the Obsidian vault name from the absolute vault path.
 * Vault name = basename of vaultPath.
 * @param {string} vaultPath - absolute path to Obsidian vault
 * @returns {string}
 */
function deriveVaultName(vaultPath) {
  if (!vaultPath || typeof vaultPath !== "string") return "";
  return path.basename(vaultPath);
}

/**
 * Build an obsidian://open deep link URI.
 * @param {string} vaultName - Obsidian vault name (e.g. "Obsidian Vault Bare Test")
 * @param {string} relativePath - file path relative to vault root (e.g. "知识库/wiki/entities/mvp-gateway.md")
 * @returns {string|null}
 */
function buildObsidianUri(vaultName, relativePath) {
  if (!vaultName || !relativePath) return null;
  const encodedVault = encodeURIComponent(vaultName);
  const encodedFile = encodeURIComponent(relativePath);
  return `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
}

module.exports = { deriveVaultName, buildObsidianUri };
