// Component: Frozen-Artifact-Reader
// @responsible: 冻结产物（derived-index.db artifacts 槽）读侧唯一咽喉（PR-084）——注册制＋统一空态/降级语义。
// @inputs: vaultPath＋注册槽名（contracts/frozen-artifacts.registry.json）
// @outputs: readFrozenArtifact / readFrozenArtifactState / readFrozenArtifactSnapshot
// @context: data/（KB_DATA_DIR 族；PR-082 落位的 staging/sa 摄取产物）
//
// 设计决策（PR-084，Master 2026-10-20 结构标尺——注册制，类消灭）：
// - 未登记槽名 fail-closed：FROZEN_ARTIFACT_NOT_REGISTERED——不注册即无读取路径，
//   「新冻结产物散布读语义」从缺省态变成不可能态（散布是缺省才会发生的事）；
// - 槽缺席/库不可达/脏 JSON fail-open 返回零值形状：无数据＝合法数据态（PR-081 裁定延续），
//   消费方拿到的永远是形状合法的文档——「不存在/空了怎么办」这个问题在接口上被删除，只实现一次；
// - 格式主版本不符 fail-closed：FORMAT_VERSION_MISMATCH（生产者管线需重跑的真错误，不降级）；
// - 字节级消费（审计/哈希）走 readFrozenArtifactSnapshot（present=false 时 revision/bytes 为 null，
//   零值只属于文档语义层——字节层「没有就是没有」）。
// - 边界：release 包内冻结副本（formal-knowledge-consumer-service）读 release 文件清单，单一实现
//   自有错误语义（RELEASE_ARTIFACT_MISSING 等），不经本咽喉——两族读取不混轴（SPEC-012 PR-084 节）。
"use strict";

const registry = require("../../contracts/frozen-artifacts.registry.json");
const { getDerivedIndexStore } = require("./persistence/derived-index-store.cjs");
const { createError } = require("./error-factory.cjs"); // EG-1b：错误构造单源
const { logger } = require("./json-logger.cjs");

const ARTIFACTS = (registry && registry.artifacts) || {};

function entryFor(name) {
  const entry = ARTIFACTS[name];
  if (!entry) {
    throw createError(
      "FROZEN_ARTIFACT_NOT_REGISTERED",
      `frozen artifact '${name}' is not registered in contracts/frozen-artifacts.registry.json — register the slot (or use an existing one); unregistered frozen artifacts have no read path`,
      500,
    );
  }
  return entry;
}

function zeroDoc(entry) {
  return JSON.parse(JSON.stringify(entry.zeroValue || {}));
}

/**
 * 文档语义层读取（消费方主入口）。
 * @returns {{ name: string, present: boolean, reason: "ok"|"absent"|"store_unreadable"|"corrupt", data: object }}
 *   present=false 时 data 为注册表零值形状（合法可直接渲染的空文档）。
 */
function readFrozenArtifactState(vaultPath, name) {
  const entry = entryFor(name);
  let raw;
  try {
    raw = getDerivedIndexStore(vaultPath).artifacts.get(entry.slot);
  } catch (error) {
    logger.warn({ event: "frozen-artifact-store-unreadable", artifact: name, error: error.message });
    return { name, present: false, reason: "store_unreadable", data: zeroDoc(entry) };
  }
  if (raw === undefined) return { name, present: false, reason: "absent", data: zeroDoc(entry) };
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    logger.error({ event: "frozen-artifact-parse-failed", artifact: name, error: error.message });
    return { name, present: false, reason: "corrupt", data: zeroDoc(entry) };
  }
  assertFormatVersion(doc, name, entry.expectedFormatVersion);
  return { name, present: true, reason: "ok", data: doc };
}

/** 便捷形态：直接返回文档本体（零值即零值文档）——供只关心形状的消费方。 */
function readFrozenArtifact(vaultPath, name) {
  return readFrozenArtifactState(vaultPath, name).data;
}

/**
 * 字节级快照（审计/working-revisions 用；形状对齐 working-artifact-snapshot 快照族）。
 * 脏 JSON 照旧抛 WORKING_JSON_INVALID（字节层审计不容静默降级——与文档层语义分工）。
 * @returns {{ data: object|null, bytes: Buffer|null, revision: string|null, path: string, exists: boolean }}
 */
function readFrozenArtifactSnapshot(vaultPath, name) {
  const entry = entryFor(name);
  let text;
  try {
    text = getDerivedIndexStore(vaultPath).artifacts.get(entry.slot);
  } catch {
    return { data: null, bytes: null, revision: null, path: entry.stagingPath, exists: false };
  }
  if (text === undefined) return { data: null, bytes: null, revision: null, path: entry.stagingPath, exists: false };
  try {
    const bytes = Buffer.from(text, "utf8");
    const crypto = require("node:crypto");
    const revision = "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
    assertFormatVersion(JSON.parse(text), name, entry.expectedFormatVersion);
    return { data: JSON.parse(text), bytes, revision, path: entry.stagingPath, exists: true };
  } catch (error) {
    if (error.code === "FORMAT_VERSION_MISMATCH") throw error;
    throw createError("WORKING_JSON_INVALID", `Invalid working artifact: ${entry.stagingPath}`, 500, { path: entry.stagingPath });
  }
}

function assertFormatVersion(doc, name, expectedVersion) {
  if (!expectedVersion) return; // 槽未声明期望版本＝不校验（注册即口径）
  const actual = doc && doc._format_version;
  if (!actual) {
    logger.warn({
      event: "frozen-artifact-format-version-missing",
      artifact: name,
      message: "Artifact missing _format_version. Assuming backward compatible. Producer should add _format_version.",
    });
    return;
  }
  const expectedMajor = String(expectedVersion).split(".")[0];
  const actualMajor = String(actual).split(".")[0];
  if (expectedMajor !== actualMajor) {
    throw createError(
      "FORMAT_VERSION_MISMATCH",
      `Format version mismatch: ${name} expected major ${expectedMajor} (full: ${expectedVersion}), got ${actual}. The data pipeline may need to be rerun.`,
      500,
    );
  }
}

module.exports = { readFrozenArtifact, readFrozenArtifactState, readFrozenArtifactSnapshot };
