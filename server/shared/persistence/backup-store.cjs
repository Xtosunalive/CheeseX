// Component: Backup-Store
// @responsible: SPEC-012 WP-A 写前备份的持久层落点——data/backups/ 平面文件（原始字节保真，不进库不进 vault）。
//   备份内容是被修复/被写回的 md/yaml 原始字节，文件形态最保真；wx 排他语义沿用（同刻并发不覆盖）。
// @inputs: 备份族名（articles/entities/schema）＋原文件名＋原始字节
// @outputs: writeBackup({ family, basename, raw }) → { backupPath, backupRel }
// @context: data/backups/<family>/<basename>.<epoch-ms>.bak（人裁清理，无限保留策略不变）
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveDataDir } = require("./data-dir.cjs");

/**
 * 写一份写前备份（wx 排他——同毫秒并发写由时间戳＋wx 双保险拒重）。
 * @param {{ family: string, basename: string, raw: string|Buffer, dataDir?: string }} input
 * @returns {{ backupPath: string, backupRel: string }} 绝对路径与展示用相对路径（data/ 相对）
 */
function writeBackup({ family, basename, raw, dataDir }) {
  if (!/^[a-z0-9-]+$/.test(family)) throw new Error(`backup-store: family 非法 ${JSON.stringify(family)}`);
  const base = path.join(resolveDataDir({ dir: dataDir }), "backups", family);
  fs.mkdirSync(base, { recursive: true });
  const target = path.join(base, `${basename}.${Date.now()}.bak`);
  fs.writeFileSync(target, raw, { flag: "wx" });
  return { backupPath: target, backupRel: path.join("data", "backups", family, path.basename(target)) };
}

module.exports = { writeBackup };
