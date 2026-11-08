// Component: Derived-Index-Synchronizer
// @responsible: SPEC-012 WP-C ②类派生索引同步器骨架——derived-index.db 的唯一重建/增量入口。
//   三源形态（SPEC §二 裁决）：boot 全量重建（盲区兜底）＋通道挂钩事件（内部写）＋watcher external: 桥接（外部写）。
//   同步器即感知器：server 停跑期间的写由 boot 全量重建构造性覆盖，无需测量盲区占比。
// @inputs: vaultPath（①类源）；derived-index store（SPEC-012 wave-2：迁移属主移 derived-index-store，可注入）
// @outputs: rebuildAll / onChannelWrite / notifyExternalWrite / getLastSync / projections
// @context: data/derived-index.db（可丢弃——删库零损失，boot 重建即恢复）
//
// 家族范围（本波 enums 投影＋article-manifests；article-manifests 的重建属主是
//   article-manifest-batch-service（行级 put 幂等），不经本同步器——两者共享同一 store/db 句柄）。
// 失败语义：fail-open 只对派生物——重建/增量失败记 warn + sync_state(status='failed')，不抛给主链路。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const YAML = require("yaml");
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");

function createDerivedIndexSynchronizer({ vaultPath, store, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  // 装配/取用两形态：生产 boot 已 initDerivedIndexStore（全局缺省）；测试可注入 store 或走 scopeKey 懒建
  const derivedStore = store || getDerivedIndexStore(vaultPath);

  // WP-049 余量批：enums 经装载端口（raw＝旧裸 parse 同形；缺件→空投影保持）。
  // enumsPath 保留：通道写事件家族过滤的路径比对（非读取——读经端口）。
  const enumsPath = path.join(resolveTheSchemaDir(vaultPath), "enums.yaml");
  function readSourceSections() {
    const { readVocabDoc } = require("../../shared/vocab-load-port.cjs");
    const doc = readVocabDoc(vaultPath, "enums", null);
    if (doc === null) return {}; // 源缺席＝空投影（派生物缺源不炸）
    const sections = {};
    for (const [key, value] of Object.entries(doc)) {
      if (value === null || value === undefined) continue;
      sections[key] = value;
    }
    return sections;
  }

  function contentHashOf(sections) {
    const canonical = JSON.stringify(sections, Object.keys(sections).sort());
    return "sha256:" + crypto.createHash("sha256").update(canonical).digest("hex");
  }

  function recordSync(kind, fn) {
    const startedAt = new Date();
    const t0 = process.hrtime.bigint();
    try {
      const result = fn();
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      derivedStore.syncState.recordSyncRow({
        kind, status: "ok",
        startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
        durationMs: Math.round(durationMs), contentHash: result.contentHash,
      });
      return result;
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      derivedStore.syncState.recordSyncRow({
        kind, status: "failed",
        startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
        durationMs: Math.round(durationMs), detail: error.message,
      });
      throw error;
    }
  }

  function projectSections(kind) {
    return recordSync(kind, () => {
      const sections = readSourceSections();
      const contentHash = contentHashOf(sections);
      derivedStore.enumsProjection.replaceAll(sections);
      return { contentHash, sectionCount: Object.keys(sections).length };
    });
  }

  /**
   * boot 全量重建（listen 前执行；耗时形成基线——SPEC §四.7）。
   * fail-open：失败只 warn 不抛（派生物降级不阻断主链路），由调用方决定等待语义。
   */
  function rebuildAll() {
    try {
      const result = projectSections("boot-rebuild");
      log.info({
        event: "derived-index-rebuild-ok",
        sectionCount: result.sectionCount,
        contentHash: result.contentHash,
        lastSync: getLastSync(), // 耗时基线随 sync_state 行落库（SPEC §四.7），不另设通道
      });
      return result;
    } catch (error) {
      log.warn({ event: "derived-index-rebuild-failed", error: error.message });
      return { failed: true, error: error.message };
    }
  }

  /** 通道挂钩事件（vault-io onVaultWrite 派发；非①类源路径忽略）。 */
  function onChannelWrite({ absPath }) {
    try {
      if (path.resolve(absPath) !== path.resolve(enumsPath)) return; // 试点家族外 no-op
      projectSections("channel-incremental");
    } catch (error) {
      log.warn({ event: "derived-index-incremental-failed", source: "channel", error: error.message });
    }
  }

  /** watcher external: 桥接（外部写路径列表；试点家族外忽略）。 */
  function notifyExternalWrite(paths) {
    try {
      const hit = (paths || []).some((p) => path.resolve(p) === path.resolve(enumsPath));
      if (!hit) return;
      projectSections("external-incremental");
    } catch (error) {
      log.warn({ event: "derived-index-incremental-failed", source: "external", error: error.message });
    }
  }

  /** 最近一次同步信息（健康面/调试读；空库返回 null）。 */
  function getLastSync() {
    return derivedStore.syncState.lastSync();
  }

  /** 试点投影读面（wave-2 切读前的唯一只读出口——双视角证明的库侧视角）。 */
  function projections() {
    return derivedStore.enumsProjection.list();
  }

  return { rebuildAll, onChannelWrite, notifyExternalWrite, getLastSync, projections };
}

module.exports = { createDerivedIndexSynchronizer };
