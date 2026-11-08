// Component: Telemetry-Import
// @responsible: SPEC-012 WP-B boot 一次性迁移——vault .ledger/health 存量④类痕迹导入 telemetry.db
//   后移除该目录（观测域迁出被观测域的收尾；④类可丢弃，导入仅为保留 PR-052 可粘贴复核历史）。
// @inputs: vaultPath；gitLedger（目录移除的落账）
// @outputs: importLegacyTelemetry() → { imported: number, removed: boolean }
// @context: boot 期（listen 前）；幂等（目录不存在即 no-op）；失败只 warn 不阻断启动

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getTelemetryStore, TRACE_KINDS } = require("./telemetry-store.cjs");
const { loadDeclaration } = require("../vault-observation-domain.cjs");

// 旧痕迹文件 → telemetry 种类
const LEGACY_TRACES = {
  "frontmatter-check.json": TRACE_KINDS.FRONTMATTER_CHECK,
  "vault-drift.json": TRACE_KINDS.VAULT_DRIFT,
  "enums-normalization.json": TRACE_KINDS.ENUMS_NORMALIZATION,
};

function importLegacyTelemetry({ vaultPath, gitLedger, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const ledger = gitLedger || { markSystemFile() {}, scheduleLedger() {} };
  const healthDir = path.join(vaultPath, loadDeclaration().dir);
  if (!fs.existsSync(healthDir)) return { imported: 0, removed: false };

  let imported = 0;
  for (const [filename, kind] of Object.entries(LEGACY_TRACES)) {
    const source = path.join(healthDir, filename);
    try {
      if (!fs.existsSync(source)) continue;
      const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
      if (getTelemetryStore(vaultPath).recordTrace(kind, parsed)) imported += 1;
    } catch (error) {
      log.warn({ event: "telemetry-import-file-failed", file: filename, error: error.message });
    }
  }

  // 移除观测目录（含可能的未识别残留文件——目录整体退场；落一笔 health: 提交记录迁移）
  try {
    ledger.markSystemFile([healthDir]); // 目录移除不是外部写（WP-J：静态登记，替代原时间窗）
    fs.rmSync(healthDir, { recursive: true, force: true });
    ledger.scheduleLedger("health", "SPEC-012 ④类迁出（health→telemetry.db）", [healthDir]);
    log.info({ event: "telemetry-import-done", imported, removed: true });
    return { imported, removed: true };
  } catch (error) {
    log.warn({ event: "telemetry-import-remove-failed", error: error.message });
    return { imported, removed: false };
  }
}

module.exports = { importLegacyTelemetry, LEGACY_TRACES };
