// @responsible: 集中判定投稿草稿扫描路径是否应被排除。
const path = require("node:path");

// 原「本系统读书skill」「读书skill」两个目录已移出 Vault。
// 目录不再存在于投稿区，扫描排除清单为空，保留此模块作为未来排除项的扩展点。
const EXCLUDED_DRAFT_SCAN_ROOTS = [];

function normalizeVaultPath(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isExcludedDraftScanPath(value) {
  const normalized = normalizeVaultPath(value);
  return EXCLUDED_DRAFT_SCAN_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

module.exports = { EXCLUDED_DRAFT_SCAN_ROOTS, isExcludedDraftScanPath };
