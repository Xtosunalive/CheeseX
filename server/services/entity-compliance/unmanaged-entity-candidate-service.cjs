// @responsible: 在 Vault 中查找与未解析目标匹配的未治理实体候选。
const fs = require("node:fs");
const path = require("node:path");

const SKIP = new Set([".ledger", ".pipeline", ".obsidian", ".git", "node_modules"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\.md$/i, "");
}

function findUnmanagedEntityCandidates(vaultPath, unresolvedTargets) {
  const wanted = new Set((unresolvedTargets || []).map(normalize).filter(Boolean));
  if (!wanted.size) return [];
  const governedRoot = path.resolve(vaultPath, "知识库", "wiki", "entities");
  const matches = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(absolutePath) === governedRoot) continue;
        walk(absolutePath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md" && wanted.has(normalize(entry.name))) {
        matches.push({ target: normalize(entry.name), sourcePath: path.relative(vaultPath, absolutePath).split(path.sep).join("/") });
      }
    }
  }

  walk(vaultPath);
  return matches.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

module.exports = { findUnmanagedEntityCandidates };
